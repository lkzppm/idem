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
export function deriveAuthContext(edgeSecret: string, credential: string): Promise<string>;   // [P-8.4]; the edge's own, never taken from an Interest
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
  authSecret?: string;          // edge secret: authContext = HMAC(secret, credential) on consumer faces [P-8.4];
                                // an authContext carried by a received Interest is always ignored
  clockToleranceMs?: number;    // signed-lifetime tolerance [P-8.6]; default DEFAULT_CLOCK_TOLERANCE_MS
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
// Signed lifetime [P-8.6]: the one predicate forwarders and consumers use (the E5 judge works on ground truth).
export const DEFAULT_CLOCK_TOLERANCE_MS = 60_000;
export function apparentAge(meta: Pick<DataMeta, "producedAt">, now: number): number;            // now − producedAt, not clamped
export function lifetimeOf(meta: Pick<DataMeta, "freshnessMs">, ttlMs: number, toleranceMs?: number): number;  // min(freshness, ttl) + tolerance
export function lifetimeState(meta: Pick<DataMeta, "producedAt" | "freshnessMs">, ttlMs: number, now: number, toleranceMs?: number): "within" | "expired" | "future";  // non-numbers → "expired"
export function isOutsideLifetime(meta: Pick<DataMeta, "producedAt" | "freshnessMs">, ttlMs: number, now: number, toleranceMs?: number): boolean;
export function lifetimeReason(meta: Pick<DataMeta, "producedAt" | "freshnessMs">, ttlMs: number, now: number, toleranceMs?: number): string;  // side, producedAt, local time
export function clockTolerance(ms: number | undefined): number;   // validates the option; IdemError("BAD_POLICY") if negative or NaN
export function staleByAge(data: Pick<Data, "ageMs" | "meta">, ttlMs: number): boolean;  // ageMs present and ≥ min(freshness, ttl) [P-8.1]; no ageMs → false
// The consumer's decision [P-5.5, P-8.7]: name, verifyData, then (mustBeFresh) signed lifetime and age.
// Used by IdemClient, IdemConsumer, NdnConsumer, the simulator's agents and the E5 harness.
export function acceptData(data: Data, opts: AcceptOptions): Promise<AcceptVerdict>;
export interface AcceptOptions { trust: TrustStore; now: number; name?: string; mustBeFresh: boolean; ttlMs?: number; toleranceMs?: number; }  // ttlMs default: trust's policy, else Infinity
export type AcceptVerdict =
  | { ok: true; verify: VerifiedData }
  | { ok: false; code: "BAD_SIGNATURE" | "UNTRUSTED_KEY" | "BAD_MANIFEST"; reason: string; verify: VerifyResult }  // a wrong name is BAD_SIGNATURE
  | { ok: false; code: "EXPIRED"; reason: string; verify: VerifiedData };   // signature valid, outside the lifetime or stale by age
// Error codes: wire EXPIRED (HTTP 502) [P-8.6]; local CLOCK_SKEW [P-8.7]. Pass ttlMs = Infinity when no manifest TTL is known.
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
export interface McpEdgeOptions { gateway: Gateway; producer: string; info: McpServerInfo; maxClients?: number; clockToleranceMs?: number; }  // per-credential clients, default 512; tolerance of the edge's [P-8.7] check
export class IdemConsumer {
  constructor(opts?: { trust?: TrustStore; clock?: Clock; clockToleranceMs?: number });
  readonly trust: TrustStore;
  pin(producer: string, keys: JsonWebKey[]): Promise<void>;
  // EXPIRED: the signature verifies but the result is outside its signed lifetime on this clock [P-8.7]
  verifyToolResult(result: CallToolResult): Promise<VerifyResult | { ok: false; code: "UNSIGNED" | "EXPIRED"; reason: string }>;
}
```

Proxy-producer (protocol §9.1, "Legacy producer", [P-9.5]–[P-9.8], ADR-038): an IDEM producer with
its own name and key for an MCP server that knows nothing about IDEM. It is a core `Producer`, served
with `createProducerHandler` or `createMcpProducer` like any other.

```ts
export function createProxyProducer(opts: ProxyProducerOptions): Promise<ProxyProducer>;  // reads the origin's tools/list; BAD_POLICY if a declared tool cannot be cached
export interface ProxyProducerOptions {
  upstream: ProxyUpstream;
  name: string;                               // the proxy's producer name; never the origin's host [P-9.5]
  key: IdemKeyPair;                           // the proxy's key
  tools: Record<string, ProxyToolPolicy>;     // operator policy; a tool without one is relayed, unsigned [P-9.6]
  clock?: Clock;
  manifestVersion?: number;                   // first version, +1 per rebuild; default clock seconds, then max(prev + 1, seconds) [P-6.3]
  maxClients?: number;                        // origin clients, one per credential; default 512
  onSchemaChange?: (c: SchemaChange) => void; // the tool is held not cacheable until refresh() [P-9.8]
}
export interface ProxyUpstream {
  url: string | URL;                          // origin Streamable HTTP endpoint
  fetch?: typeof fetch;
  credential?: string;                        // the proxy's own Bearer at the origin: tools/list and tools declared public, held or refused too [P-9.7]
  info?: { name: string; version: string };   // client identity toward the origin
}
export interface ProxyToolPolicy extends ProducerToolPolicy {
  policyVersion?: number;
  operatorAssertsReadOnly?: boolean;          // only when the origin gives no readOnlyHint; never against false [P-9.6]
}
export class ProxyProducer extends Producer {
  static create(opts: ProxyProducerOptions): Promise<ProxyProducer>;  // same as createProxyProducer
  readonly origin: string;                    // scheme, host and path of the origin
  readonly manifestVersion: number;
  refresh(): Promise<ProxyRefresh>;           // re-read the origin's tools/list; new manifest version if it changed
}
export interface ProxyRefresh { changed: boolean; manifestVersion: number; refused: Record<string, string>; }  // refused: declared cacheable, not offered, with the reason
export interface SchemaChange { tool: string; manifestVersion: number; }
export const ORIGIN_META_KEY = "dev.idem/origin";
export interface OriginRecord { origin: string; readOnlyHint: "origin" | "operator" | "absent"; }  // in each listed tool's _meta, unsigned
```

The proxy checks the origin's `tools/list` after every origin call whose result it signs (one extra
request per miss; hits never reach it) [P-9.8]. Forwarders and consumers read a manifest once, so
after a schema change they need a restart, or a new edge, to see the refreshed one; until then the
changed tool answers `NOT_CACHEABLE` or `DIGEST_MISMATCH`, never a result signed under the old
digest after the change. `createMcpProducer` and `createMcpEdge` pass each tool's `_meta` through to
`tools/list`, so plain MCP clients see the origin record.

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
  clockToleranceMs?: number;                  // signed-lifetime tolerance of its forwarder [P-8.6]
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
  clock?: Clock;                              // time of the lifetime check and key expiry; default RealClock
  clockToleranceMs?: number;                  // default DEFAULT_CLOCK_TOLERANCE_MS [P-8.6]
}
export class IdemClient {                     // verifying consumer; browser, Node, edge runtimes
  constructor(opts: IdemClientOptions);
  readonly trust: TrustStore;
  init(): Promise<{ manifest: Manifest; tools: ToolInfo[] }>;
  prepare(tool: string, args: unknown): Promise<Interest | undefined>;          // undefined: the call is not IDEM
  call(tool: string, args: unknown): Promise<CallOutcome>;
  sendInterest(i: Interest): Promise<{ data?: Data; verify?: VerifyResult; error?: WireError; trace: TraceHop[] }>;  // verified but outside its lifetime: verify.ok, error EXPIRED
}
export interface CallOutcome {
  tool: string;
  result: CallToolResult;                     // an error result when `error` is set
  via: "idem" | "call";
  name?: string; data?: Data; verify?: VerifyResult;
  retried: boolean;                           // first answer BAD_SIGNATURE or EXPIRED; repeated as a plain call, checked again [P-5.5, P-8.7]
  trace: TraceHop[];
  latencyMs: number;
  error?: CallError;                          // { code, message }
}
export interface CallError { code: IdemWireErrorCode | "CLOCK_SKEW"; message: string; }  // CLOCK_SKEW: the verified retry is still outside its lifetime
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
                      interestLifetimeMs?: number; retransmissions?: number;    // retx: fresh Nonce, same name
                      clock?: Clock; clockToleranceMs?: number });              // [P-8.7]: outside its lifetime → EXPIRED, fail closed
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
export type SimMode = "mcp-direct" | "mcp-local-cache" | "mcp-gateway-cache" | "idem" | "idem-noverify";   // B0, B1, B5, B2/B3 (by topology), B4
export interface SimConfig {
  topology: { nodes: SimNode[]; links: SimLinkConfig[] };
  mode: SimMode;
  workload: SyntheticWorkload | TraceWorkload | PerAgentWorkload;
  // Absent: one producer named SIM_PRODUCER on the first producer-kind node, serving fetch_page,
  // my_notes and send_email with producer.ttlMs (every configuration written before ADR-027).
  producers?: SimProducerConfig[];
  producer: {                       // defaults shared by every producer
    serviceTimeMs: Dist;
    ttlMs: number;                  // only when `producers` is absent
    pageBytesMedian?: number;       // default 6 KiB
    signPlainCalls?: boolean;       // baselines only: attach _meta["dev.idem/data"] to plain results; default true
  };
  cs: { maxBytes: number; policy: "lru" | "lfu" | "fifo" };   // maxBytes: default of every forwarder
  interestLifetimeMs?: number;      // default 10 s
  processing?: ProcessingCosts;     // CPU cost charged as virtual delay in the IDEM modes; absent: none
}
export interface SimNode { id: string; kind: "agent" | "forwarder" | "producer"; csMaxBytes?: number; }   // csMaxBytes: forwarders only; default cs.maxBytes
export interface SimLinkConfig { a: string; b: string; latencyMs: number; lossPct: number; bandwidthMbps?: number; }
export interface Dist { dist: "lognormal"; mu: number; sigma: number; }
export interface SyntheticWorkload {
  kind: "synthetic"; agents: number; callsPerAgent: number; zipfAlpha: number; overlap: number; catalogSize: number;
  thinkTimeMs?: number; surfaceVariation?: number; privateFraction?: number; sideEffectFraction?: number;
  // W-code (ADR-037). Absent: one call per step, start window = thinkTimeMs (the same draws as before).
  burst?: { size: number; parallel?: boolean };   // a step issues `size` calls (at once by default), waits for all, then thinks
  startSpreadMs?: number;                         // agents start uniformly within [0, startSpreadMs); 0 = same instant
}
// The records themselves, not a path: the simulator runs in the browser and never reads files.
export interface TraceWorkload { kind: "trace"; records: TraceRecord[]; }
export interface TraceRecord { t: number; agent: number; tool: string; args: unknown; producer?: string; }   // producer name; default the first

// Graphs, several producers, per-agent workloads (ADR-027)
export type ToolId = "fetch_page" | "search_corpus" | "weather" | "my_notes" | "send_email";
export interface SimToolConfig { tool: ToolId; ttlMs?: number; }          // default TTL from TOOL_CATALOG
export interface SimProducerConfig {
  node: string;                     // a producer-kind node
  name: string;                     // producer component of the names (lowercase host[:port]), unique
  tools: SimToolConfig[];
  serviceTimeMs?: Dist;             // default producer.serviceTimeMs
  maxResultBytes?: number;          // default 64 KiB
}
export interface ToolMixEntry { producer: string; tool: ToolId; weight: number; }   // producer *name*
export interface AgentPlan {
  node: string; calls: number; mix: ToolMixEntry[];
  thinkTimeMs?: number;             // default 300
  overlap?: number;                 // fetch_page: share drawn from the shared catalog; default 0.6
  zipfAlpha?: number;               // over pages, queries and cities; default 0.9
  catalogSize?: number;             // pages; default 40
  surfaceVariation?: number;        // equivalent argument spellings (normalizers decide the names); default 0.3
}
export interface PerAgentWorkload { kind: "per-agent"; agents: AgentPlan[]; }
export interface ToolCatalogEntry { tool: ToolId; description: string; readOnly: boolean; cacheable: boolean; scope: Scope; ttlMs: number; normalizers: Record<string, Normalizer[]>; }
export const TOOL_CATALOG: readonly ToolCatalogEntry[];   // mirrors apps/web/lib/server/demo-producer.ts
export const TOOL_IDS: readonly ToolId[]; export function isToolId(x: unknown): x is ToolId; export function toolInfo(t: ToolId): ToolCatalogEntry;
export const SEARCH_QUERIES: readonly string[]; export const CITIES: readonly string[]; export const CORPUS_ORIGIN: string;

// Routing: Dijkstra on link latency, one tree per producer node, ties by next-hop id then link index.
// Only forwarders relay (never agents, never another producer).
export interface RouteHop { link: number; next: string; latencyMs: number; }
export interface RoutePath { nodes: string[]; links: number[]; latencyMs: number; }
export function routesTo(topology: SimConfig["topology"], producerNode: string): Map<string, RouteHop>;
export function pathToProducer(topology: SimConfig["topology"], from: string, producerNode: string): RoutePath | undefined;
export function reachableProducers(topology: SimConfig["topology"], agentId: string): string[];   // producer node ids, nearest first

// Checks: Simulation.create rejects with SimConfigError (code "BAD_CONFIG", path to the field).
export class SimConfigError extends Error { readonly code: "BAD_CONFIG"; readonly path: string; }
export interface ResolvedProducer { node: string; name: string; tools: { tool: ToolId; ttlMs: number }[]; serviceTimeMs: Dist; maxResultBytes: number; implicit: boolean; }
export function validateConfig(cfg: SimConfig): ResolvedProducer[];

export interface SimResult { metrics: Metrics; events?: ForwarderEvent[]; config: SimConfig; seed: number; gitSha?: string; }

export interface TopologyPreset { kind: "star" | "tree"; agents: number; agentLinkMs: number; coreLinkMs?: number; producerLinkMs: number; lossPct?: number; bandwidthMbps?: number; edges?: number; }
export function buildTopology(p: TopologyPreset): SimConfig["topology"];     // star: agents → edge → producer; tree: agents → edges → regional → producer
export function defaultConfig(overrides?: Partial<SimConfig>): SimConfig;
export interface PlannedCall { producer?: string; tool: string; args: JsonValue; at?: number; }
export function planWorkload(cfg: SimConfig, rng: Rng): PlannedCall[][];   // one plan per agent index, or per entry of a per-agent workload
export const SIM_PRODUCER = "demo.idem.dev";

// A run that can be stepped and attacked (the sandbox's swarm mode and the network editor)
export interface SimHooks { onEvent?: (e: ForwarderEvent) => void; onTransmit?: (tx: Transmission) => void; onCall?: (r: CallRecord) => void; onAttack?: (a: AttackRecord) => void; }
// CallRecord carries `producer` (name) and, for a call to an unreachable producer, `error: "NO_ROUTE"`
// (ok: false, attempts: 0, nothing sent). Metrics.noRoute counts those calls. `error: "CLOCK_SKEW"`
// marks a call whose verified plain-call retry was still outside its signed lifetime [P-8.7].
export class Simulation {
  static create(cfg: SimConfig, opts?: { seed: number; keepEvents?: boolean } & SimHooks): Promise<Simulation>;
  readonly config: SimConfig; readonly seed: number; readonly mode: SimMode;
  readonly clock: VirtualClock; readonly forwarders: Map<string, Forwarder>; readonly metrics: MetricsCollector;
  readonly producers: readonly ResolvedProducer[]; readonly defaultProducer: string; readonly manifests: Manifest[];
  readonly gatewayCaches: Map<string, GatewayCache>;   // B5 only: each edge's gateway cache, by node id
  cacheable(tool: string, producer?: string): { policy: ToolPolicy; identity: ToolIdentity } | undefined;
  runUntil(t: number): Promise<void>; run(): Promise<SimResult>; result(): SimResult;
  // `producer` is a producer name, default the first. An attack that cannot be staged returns without a record.
  attackTamper(producer?: string): void; attackForge(agentIndex?: number, producer?: string): Promise<void>;
  attackPrivateProbe(a?: number, b?: number, producer?: string): Promise<void>;
}

// B5, the industry baseline (ADR-036): plain MCP with a shared, unsigned response cache at the edge.
// Key = producer, tool and the arguments as sent (sorted keys, no normalization); TTL per tool; no
// coalescing of identical calls in flight; error results not stored. Simulator only, not in core.
export function stableJson(v: unknown): string;                                    // sorted keys, no whitespace
export function gatewayCacheKey(producer: string, tool: string, args: unknown): string;
export interface GatewayCacheEntry { key: string; result: CallToolResult; storedAt: number; ttlMs: number; bytes: number; hits: number; }
export class GatewayCache {                                                        // byte budget + the CS policies
  constructor(opts: { maxBytes: number; policy?: "lru" | "lfu" | "fifo" });
  get(key: string, now: number): GatewayCacheEntry | undefined;                    // fresh entries only
  put(key: string, result: CallToolResult, ttlMs: number, now: number): { inserted: boolean; evicted: number };
  entries(): IterableIterator<GatewayCacheEntry>; stats(): { entries: number; bytes: number; maxBytes: number; evictions: number };
}
export interface GatewayRelayOptions { cache: GatewayCache; clock: Clock; ttlFor(producer: string, tool: string): number | undefined; onHit?(key: string): void; onMiss?(key: string, inFlight: boolean): void; }
export class GatewayRelay { constructor(opts: GatewayRelayOptions); readonly cache: GatewayCache; face(inner: Face): Face; }   // wraps a client link of a plain-call relay
// Metrics adds gatewayCacheHits and gatewayInflightDuplicates (B5; 0 in the other modes).

// Processing-cost model: the virtual clock does not see CPU time, so E1's measurements are charged as delay
export interface ProcessingCosts { sizesBytes: number[]; canonicalizeUs: number[]; nameUs: number[]; signUs: number[]; verifyUs: number[]; }
export type ProcessingOp = "canonicalizeUs" | "nameUs" | "signUs" | "verifyUs";
export function costUs(costs: ProcessingCosts, op: ProcessingOp, bytes: number): number;   // linear interpolation
export function assertProcessingCosts(c: ProcessingCosts): void;

export class MetricsCollector { constructor(opts: { producerLinks: Set<string>; edges: Set<string>; producers?: Set<string> }); snapshot(now: number): Metrics; }   // fed by the run; `Metrics` holds the quantities of spec 05 §3
export class Rng { constructor(seed: number); next(): number; int(n: number): number; chance(p: number): boolean; exp(mean: number): number; normal(): number; lognormal(mu: number, sigma: number): number; bytes(n: number): Uint8Array; fork(label: string): Rng; }
export class Zipf { constructor(n: number, alpha: number); sample(rng: Rng): number; }
export function percentile(values: readonly number[], p: number): number;
```

Types only, for the `/benchmarks` page: `ResultsData`, `SweepData`, `MicrobenchData`, `MicrobenchCell`,
`MissOverhead`, `SafetyData` (IDEM variants in `rows`; the B5 baseline rows, when the run has them, in
`baseline`, each with the `mirrors` id of its IDEM variant), `SafetyRowData`, `RunRef`, `Stat` (the export of committed runs), `AttackClass`,
`Expectation` (E5), `EvalModeId`, `SweepBase` (experiment specs), and the records `CallRecord`,
`Transmission`, `AttackRecord`, `Metrics`. The experiment pipeline itself (`packages/sim/src/experiments`,
run by `pnpm sim`) is not part of the package's entry point: it is Node-side tooling of the evaluation
(spec 05) and changes with it.
