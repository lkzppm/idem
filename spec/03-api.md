# 03 — Public API

Signatures of the public API. `@idem/core`, `@idem/gateway`, `@idem/mcp`, `@idem/sim` and `@idem/ndn`
are implemented, and what is written here is what their `src/index.ts` exports. Small helpers (encoding, the JSON Schema subset, normalizers, wire helpers) are exported too
and are listed on the docs API page, not here. Changes here require updating the API reference in the
docs (`apps/web/content/docs/{en,pt}/api.md`).

## `@idem/core`

```ts
// Names and canonicalization
export interface CanonicalArgs { readonly value: JsonValue; readonly jcs: string; }
export function canonicalizeArgs(args: unknown, tool: Pick<ToolIdentity, "inputSchema">, policy: Pick<ToolPolicy, "normalizers">): Promise<CanonicalArgs>;
export function toolSchemaDigest(tool: ToolIdentity): Promise<string>;
export function makeName(input: { producer: string; tool: ToolIdentity; args: { jcs: string } }): Promise<IdemName>;
export function parseName(name: string): ParsedName;          // throws IdemError("BAD_NAME")
export function formatName(p: ParsedName): IdemName;
export function jcs(value: unknown): string;                  // RFC 8785

// Crypto (WebCrypto Ed25519; a runtime without it gets IdemError("CRYPTO_UNSUPPORTED"))
export function generateKeyPair(): Promise<IdemKeyPair>;
export function keyPairFromSeed(seed: Uint8Array): Promise<IdemKeyPair>;                      // tests/sim only
export function signData(input: UnsignedData, key: IdemKeyPair): Promise<Data>;
export function verifyData(data: Data, trust: TrustStore, opts?: { now?: number }): Promise<VerifyResult>;       // [P-5.5]
export function signManifest(m: UnsignedManifest, key: IdemKeyPair): Promise<Manifest>;
export function verifyManifest(m: Manifest, trust: TrustStore, opts?: { now?: number }): Promise<VerifyResult>;  // [P-6.2], = trust.check
export function verifyManifestSignature(m: Manifest): Promise<VerifyResult>;                  // self-consistency only
export function deriveAuthContext(edgeSecret: string, credential: string): Promise<string>;   // [P-8.4]
// `opts.now` (epoch ms, default Date.now()) is the time key `notAfter` is checked against; nodes on
// a virtual clock pass their own.
export type VerifyResult =
  | { ok: true; producer: string; keyId: string }
  | { ok: false; code: "BAD_SIGNATURE" | "UNTRUSTED_KEY" | "BAD_MANIFEST"; reason: string };

export class TrustStore {
  pin(producer: string, publicKeyJwk: JsonWebKey): Promise<string>;                 // returns the key id
  addManifest(m: Manifest, opts?: { now?: number }): Promise<VerifyResult>;         // verify, then accept
  check(m: Manifest, opts?: { now?: number }): Promise<VerifyResult>;               // same decision, no state change
  manifest(producer: string): Manifest | undefined;
  policy(producer: string, tool: string): ToolPolicy | undefined;
  key(producer: string, keyId: string, now?: number): Promise<CryptoKey | undefined>;
  producers(): string[];
}

// Engine
export interface ForwarderOptions {
  id: string;
  clock: Clock;
  cs?: ContentStore;            // default: 64 MiB LRU MemoryContentStore
  pit?: PitLimits;              // default: { maxEntries: 10_000, maxFacesPerEntry: 256 } [P-7.3]
  fib: Fib;
  trust: TrustStore;
  verifyOnInsert?: boolean;     // default true; false only in experiments [P-7.1]
  authSecret?: string;          // edge secret: authContext = HMAC(secret, credential) on consumer faces [P-8.4]
  onEvent?: (e: ForwarderEvent) => void;
}
export interface PitLimits { maxEntries: number; maxFacesPerEntry: number; }
export interface FaceOptions { consumer?: boolean; }   // the face leads to consumers: this node is their edge
export class Forwarder {
  constructor(opts: ForwarderOptions);
  readonly id: string;
  addFace(face: Face, opts?: FaceOptions): void;
  removeFace(id: string): void;
  receive(faceId: string, p: Packet): Promise<void>;
  pit(): { name: string; waiting: number; scope: Scope }[];
  get cs(): ContentStore;
}
export type Packet =
  | { type: "interest"; interest: Interest; auth?: string }
  | { type: "data"; nonce: string; data: Data }
  | { type: "nack"; nonce: string; name?: string; code: IdemWireErrorCode; message?: string }
  | { type: "call"; id: string; producer: string; tool: string; args: JsonValue; auth?: string; lifetimeMs?: number }
  | { type: "result"; id: string; result: CallToolResult };
export interface Face { readonly id: string; send(p: Packet): void; onReceive(cb: (p: Packet) => void | Promise<void>): void; close(): void; }
export function linkFaces(clock: Clock, opts: { a: string; b: string; latencyMs?: number }): [Face, Face];
export class Fib { add(prefix: string, nextHop: string): void; addProducer(producer: string, nextHop: string): void; remove(prefix: string): boolean; lookup(name: string): string | undefined; lookupProducer(producer: string): string | undefined; entries(): [prefix: string, nextHop: string][]; }
// Keyed by name, or by name partitioned with authContext for private Data (ADR-013)
export interface ContentStore { get(key: string, now: number): CsEntry | undefined; put(key: string, d: Data, now: number): { inserted: boolean; evicted: CsEntry[] }; delete(key: string): boolean; stats(): CsStats; }
export class MemoryContentStore implements ContentStore { constructor(opts: { maxBytes: number; policy?: "lru" | "lfu" | "fifo" }); entries(): IterableIterator<CsEntry>; }
export function isFresh(entry: Pick<CsEntry, "data" | "receivedAt">, now: number, ttlCapMs?: number): boolean;   // [P-8.1, P-8.2]
export function entryAge(entry: Pick<CsEntry, "data" | "receivedAt">, now: number): number;
export interface Clock { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void; }
export class RealClock implements Clock {}
export class VirtualClock implements Clock { constructor(start?: number); get pending(): number; nextAt(): number | undefined; step(): Promise<boolean>; runUntil(t: number): Promise<void>; runAll(maxSteps?: number): Promise<number>; }
export class IdemError extends Error { readonly code: IdemErrorCode; }
export function isIdemError(e: unknown, code?: IdemErrorCode): e is IdemError;

// Producer and consumer helpers (ADR-014)
export interface ProducerOptions {
  producer: string;
  key: IdemKeyPair;
  tools: ProducerTool[];
  clock?: Clock;
  manifestVersion?: number;     // default 1; bump on every change, key rotation included
  extraKeys?: ManifestKey[];    // more keys to list in the manifest (rotation); the signing key is always listed
}
export class Producer {
  constructor(opts: ProducerOptions);
  readonly producer: string;
  manifest(): Promise<Manifest>;
  toolList(): ToolInfo[];
  identity(tool: string): ToolIdentity;
  handleInterest(i: Interest, ctx?: { auth?: string }): Promise<Data>;                  // [P-5.1]
  handleCall(tool: string, args: unknown, ctx?: { auth?: string }): Promise<CallToolResult>;  // _meta["dev.idem/data"] for cacheable tools
  serve(face: Face, opts?: { clock?: Clock; serviceTimeMs?: (p: Packet) => number }): void;
}
export interface ProducerTool {
  name: string; description?: string; inputSchema: JsonSchema; outputSchema?: JsonSchema;
  annotations?: { readOnlyHint?: boolean; [k: string]: unknown };
  policyVersion?: number;                  // default 1 [P-2.2]
  policy?: ProducerToolPolicy;             // absent: never cacheable
  handler(args: JsonValue, ctx: ProducerContext): CallToolResult | Promise<CallToolResult>;   // ctx: { auth?, now }
}
export interface ProducerToolPolicy { cacheable: boolean; ttlMs: number; scope: Scope; normalizers?: Record<string, Normalizer[]>; }
export function cacheablePolicy(manifest: Manifest | undefined, tool: ToolInfo): Promise<{ policy: ToolPolicy; identity: ToolIdentity } | undefined>;  // [P-6.1]
export function buildInterest(input: BuildInterestInput): Promise<{ interest: Interest; args: CanonicalArgs }>;   // [P-4.1]
export interface BuildInterestInput { producer: string; identity: ToolIdentity; policy: ToolPolicy; args: unknown; nonce?: string; mustBeFresh?: boolean; lifetimeMs?: number; hopLimit?: number; }
export function attachData(result: CallToolResult, data: Data): CallToolResult;
export function dataFromToolResult(result: CallToolResult): Data | undefined;
```

`ForwarderEvent` (the event stream of protocol §7) and the protocol objects (`Interest`, `Data`,
`Manifest`, `ToolPolicy`, ...) are exported as types with the shapes spec 01 and spec 02 give.

## `@idem/mcp` (implemented)

```ts
// Serve a core Producer as a stateless MCP server (SDK v2 createMcpHandler); results of cacheable
// tools carry _meta["dev.idem/data"]. Credential: Authorization: Bearer.
export function createMcpProducer(producer: Producer, info: McpServerInfo): McpHttpHandler;
// The IDEM edge as a plain MCP endpoint (protocol §9.1): it terminates MCP, lists the producer's
// tools, and sends each tools/call through the gateway in-process as a verifying consumer.
export function createMcpEdge(opts: McpEdgeOptions): Promise<McpHttpHandler>;
export interface McpServerInfo { name: string; version: string; }
export interface McpEdgeOptions { gateway: Gateway; producer: string; info: McpServerInfo; maxClients?: number; }  // per-credential clients, default 512
export class IdemConsumer {
  constructor(opts?: { trust?: TrustStore });
  readonly trust: TrustStore;
  pin(producer: string, keys: JsonWebKey[]): Promise<void>;
  verifyToolResult(result: CallToolResult): Promise<VerifyResult | { ok: false; code: "UNSIGNED"; reason: string }>;
}
```

`withIdem(server)` (wrapping an existing `McpServer` whose tools are registered elsewhere) is still
planned; today a producer declares its tools through `Producer` and is served by `createMcpProducer`.

Producer example, as planned for `withIdem` (not implemented):

```ts
// apps/web/app/api/demo-producer/[transport]/route.ts
import { createMcpHandler } from "mcp-handler";
import { withIdem } from "@idem/mcp";

const handler = createMcpHandler((server) => {
  server.registerTool("fetch_page", { /* inputSchema, annotations: { readOnlyHint: true } */ }, fetchFromCorpus);
  server.registerTool("send_email", { /* readOnlyHint: false */ }, fakeSend);
  withIdem(server, {
    producer: "demo.idem.dev",
    key: await loadKey(),
    policies: { fetch_page: { cacheable: true, ttlMs: 300_000, scope: "public",
                              normalizers: { "/url": ["url:sortQuery"] }, policyVersion: 1 } },
  });
});
export { handler as GET, handler as POST };
```

> Check the exact `mcp-handler` 2 and SDK v2 APIs when implementing: the example shows the shape, not a contract.

## `@idem/gateway` (implemented)

```ts
export interface Upstream { producer: string; url: string; kind: "producer" | "forwarder"; manifestUrl?: string; }
export interface GatewayOptions {
  id: string;
  upstreams: Upstream[];
  cs?: ContentStore; trust?: TrustStore; pit?: PitLimits;
  authSecret?: string;                        // authContext = HMAC(secret, bearer credential) [P-8.4]
  verifyOnInsert?: boolean; basePath?: string; fetch?: typeof fetch;
  onEvent?: (e: ForwarderEvent) => void;
}
export interface Gateway { handle(req: Request): Promise<Response>; readonly forwarder: Forwarder; readonly trust: TrustStore; }
export function createGateway(opts: GatewayOptions): Gateway;                    // routes: protocol §9.1
export interface ProducerHandlerOptions { basePath?: string; id?: string; }   // id: node id in traces, default "producer"
export function createProducerHandler(p: Producer, opts?: ProducerHandlerOptions): (req: Request) => Promise<Response>;

export interface IdemClientOptions {
  edge: string;                               // base URL of the first hop
  producer: string;
  producerUrl?: string;                       // where the retry of [P-5.5] goes; default: a passthrough call through the edge
  credential?: string;                        // sent as Authorization: Bearer
  trust?: TrustStore;
  fetch?: typeof fetch;
  intercept?: (d: Data) => Data;              // test/demo hook: rewrite a Data before verification
}
export class IdemClient {                     // verifying consumer; browser, Node, edge runtimes
  constructor(opts: IdemClientOptions);
  readonly trust: TrustStore;
  init(): Promise<{ manifest: Manifest; tools: ToolInfo[] }>;
  prepare(tool: string, args: unknown): Promise<Interest | undefined>;          // undefined: the call is not IDEM
  call(tool: string, args: unknown): Promise<CallOutcome>;
  sendInterest(i: Interest): Promise<{ data?: Data; verify?: VerifyResult; error?: WireError; trace: TraceHop[] }>;
}
export interface CallOutcome {
  tool: string;
  result: CallToolResult;                     // an error result when `error` is set
  via: "idem" | "call";
  name?: string; data?: Data; verify?: VerifyResult;
  retried: boolean;                           // first answer failed verification; repeated as a plain call, verified again [P-5.5]
  trace: TraceHop[];
  latencyMs: number;
  error?: WireError;                          // { code, message }
}
```

Also exported: the faces `HttpUpstreamFace` and `RequestFace`, `credentialOf(req)`, and the wire
helpers (`PATHS`, `HEADERS`, `statusFor`, `errorResponse`, `json`, `isWireError`, `parseTrace`,
`formatTrace`, `routePath`). The MCP endpoint of the edge lives in `@idem/mcp` (`createMcpEdge`).

## `@idem/ndn` (implemented; protocol §9.2, ADR-026)

```ts
// Names: each IDEM part → one GenericNameComponent; the trailing ParametersSha256Digest is NDN's.
export function toNdnName(idemName: string): Name;
export function fromNdnName(name: Name): string;            // drops a trailing PSDC / implicit digest
export function ndnUri(name: Name): string;                 // readable URI (…/params-sha256=<hex>)
// Codec
export function encodeInterest(i: Interest): Promise<NdnInterest>;        // [P-9.1], unsigned, no authContext
export function decodeInterest(i: NdnInterest): Promise<Interest>;        // [P-9.2]
export function encodeData(d: Data, interestName: Name, signer: Signer): Promise<NdnData>; // refuses private [P-9.4]
export function encodeNack(name: Name, code: IdemWireErrorCode, message: string, signer: Signer): Promise<NdnData>;
export function decodeData(d: NdnData): { kind: "data"; data: Data } | { kind: "nack"; name: string; code: IdemWireErrorCode; message: string };
export function toWire(p: NdnInterest | NdnData): Uint8Array;
export function interestFromWire(w: Uint8Array): NdnInterest;
export function dataFromWire(w: Uint8Array): NdnData;
export const MAX_PACKET_SIZE: 8800;
// Keys (NDNts keychain, Ed25519) and verification
export function producerSigner(producer: string, key: IdemKeyPair): NdnSigner;   // KeyLocator = IDEM key locator
export function ndnSigner(privateKey: CryptoKey, keyLocator: Name): NdnSigner;
export function ndnVerifier(publicKey: CryptoKey): Promise<Verifier>;
export function verifyNdnData(d: NdnData, trust: TrustStore, opts?: { now?: number; outerKey?: { keyLocator: Name; publicKey: CryptoKey } }): Promise<NdnVerifyResult>; // [P-9.3]
// Endpoints
export function serveNdn(opts: { producer: Producer; key: IdemKeyPair; fw?: Forwarder; concurrency?: number }): Promise<NdnProducer>;
export class NdnConsumer {
  constructor(opts: { producer: string; fw?: Forwarder; trust?: TrustStore; lifetimeMs?: number;
                      interestLifetimeMs?: number; retransmissions?: number });   // retx: fresh Nonce, same name
  // call() → NdnCallOutcome also carries `attempts` (Interests sent) and `verifyMs` (both signatures)
  init(): Promise<{ manifest: Manifest; tools: ToolInfo[] }>;   // _manifest / _tools over NDN
  prepare(tool: string, args: unknown): Promise<Interest | undefined>;
  call(tool: string, args: unknown): Promise<NdnCallOutcome>;
}
// Display
export function tlvTree(wire: Uint8Array, opts?: { previewChars?: number }): TlvNode[];
export function toHex(bytes: Uint8Array): string;
```

`Name`, `Interest as NdnInterest`, `Data as NdnData`, `Signer` and `Verifier` are `@ndn/packet`
types. Also exported: `hasParamsDigest`, `ndnNonce`, `idemNonce`, `CONTENT_TYPE`, `RESERVED`,
`TLV_TYPES`, and the types `NativeEnvelope`, `DecodedData`, `NdnSigner`, `NdnProducer`,
`NdnProducerOptions`, `NdnConsumerOptions`, `NdnCallOutcome`, `NdnVerifyOptions`,
`NdnVerifyResult`, `OuterVerifyResult`, `TlvNode`.

## `@idem/sim` (implemented)

```ts
export function runSimulation(cfg: SimConfig, opts: { seed: number; onEvent?: (e: ForwarderEvent) => void; keepEvents?: boolean }): Promise<SimResult>;
export type SimMode = "mcp-direct" | "mcp-local-cache" | "idem" | "idem-noverify";   // B0, B1, B2/B3 (by topology), B4
export interface SimConfig {
  topology: { nodes: SimNode[]; links: SimLinkConfig[] };
  mode: SimMode;
  workload: SyntheticWorkload | TraceWorkload;
  producer: {
    serviceTimeMs: { dist: "lognormal"; mu: number; sigma: number };
    ttlMs: number;
    pageBytesMedian?: number;       // default 6 KiB
    signPlainCalls?: boolean;       // baselines only: attach _meta["dev.idem/data"] to plain results; default true
  };
  cs: { maxBytes: number; policy: "lru" | "lfu" | "fifo" };
  interestLifetimeMs?: number;      // default 10 s
  processing?: ProcessingCosts;     // CPU cost charged as virtual delay in the IDEM modes; absent: none
}
export interface SimNode { id: string; kind: "agent" | "forwarder" | "producer"; }
export interface SimLinkConfig { a: string; b: string; latencyMs: number; lossPct: number; bandwidthMbps?: number; }
export interface SyntheticWorkload {
  kind: "synthetic"; agents: number; callsPerAgent: number; zipfAlpha: number; overlap: number; catalogSize: number;
  thinkTimeMs?: number; surfaceVariation?: number; privateFraction?: number; sideEffectFraction?: number;
}
// The records themselves, not a path: the simulator runs in the browser and never reads files.
export interface TraceWorkload { kind: "trace"; records: TraceRecord[]; }
export interface TraceRecord { t: number; agent: number; tool: string; args: unknown; }
export interface SimResult { metrics: Metrics; events?: ForwarderEvent[]; config: SimConfig; seed: number; gitSha?: string; }

export interface TopologyPreset { kind: "star" | "tree"; agents: number; agentLinkMs: number; coreLinkMs?: number; producerLinkMs: number; lossPct?: number; bandwidthMbps?: number; edges?: number; }
export function buildTopology(p: TopologyPreset): SimConfig["topology"];     // star: agents → edge → producer; tree: agents → edges → regional → producer
export function defaultConfig(overrides?: Partial<SimConfig>): SimConfig;
export function planWorkload(cfg: SimConfig, rng: Rng): { tool: string; args: JsonValue; at?: number }[][];   // one plan per agent
export const SIM_PRODUCER = "demo.idem.dev";

// A run that can be stepped and attacked (the sandbox's swarm mode)
export interface SimHooks { onEvent?: (e: ForwarderEvent) => void; onTransmit?: (tx: Transmission) => void; onCall?: (r: CallRecord) => void; onAttack?: (a: AttackRecord) => void; }
export class Simulation {
  static create(cfg: SimConfig, opts?: { seed: number; keepEvents?: boolean } & SimHooks): Promise<Simulation>;
  readonly config: SimConfig; readonly seed: number; readonly mode: SimMode;
  readonly clock: VirtualClock; readonly forwarders: Map<string, Forwarder>; readonly metrics: MetricsCollector;
  runUntil(t: number): Promise<void>; run(): Promise<SimResult>; result(): SimResult;
  attackTamper(): void; attackForge(agentIndex?: number): Promise<void>; attackPrivateProbe(a?: number, b?: number): Promise<void>;
}

// Processing-cost model: the virtual clock does not see CPU time, so E1's measurements are charged as delay
export interface ProcessingCosts { sizesBytes: number[]; canonicalizeUs: number[]; nameUs: number[]; signUs: number[]; verifyUs: number[]; }
export type ProcessingOp = "canonicalizeUs" | "nameUs" | "signUs" | "verifyUs";
export function costUs(costs: ProcessingCosts, op: ProcessingOp, bytes: number): number;   // linear interpolation
export function assertProcessingCosts(c: ProcessingCosts): void;

export class MetricsCollector { constructor(opts: { producerLinks: Set<string>; edges: Set<string> }); snapshot(now: number): Metrics; }   // fed by the run; `Metrics` holds the quantities of spec 05 §3
export class Rng { constructor(seed: number); next(): number; int(n: number): number; chance(p: number): boolean; exp(mean: number): number; normal(): number; lognormal(mu: number, sigma: number): number; bytes(n: number): Uint8Array; fork(label: string): Rng; }
export class Zipf { constructor(n: number, alpha: number); sample(rng: Rng): number; }
export function percentile(values: readonly number[], p: number): number;
```

Types only, for the `/results` page: `ResultsData`, `SweepData`, `MicrobenchData`, `MicrobenchCell`,
`MissOverhead`, `SafetyData`, `RunRef`, `Stat` (the export of committed runs), `AttackClass`,
`Expectation` (E5), `EvalModeId`, `SweepBase` (experiment specs), and the records `CallRecord`,
`Transmission`, `AttackRecord`, `Metrics`. The experiment pipeline itself (`packages/sim/src/experiments`,
run by `pnpm sim`) is not part of the package's entry point: it is Node-side tooling of the evaluation
(spec 05) and changes with it.
