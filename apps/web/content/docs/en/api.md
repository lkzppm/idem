This page lists what each package exports, checked against the source in `packages/*/src`. The TSDoc comments in the source are the full reference; this is the map. The packages are part of a research prototype and are not published to a registry, so there is no install command here.

Two conventions hold everywhere. Library packages have **no default exports**. Failures are a typed **`IdemError`** with a `code`: branch on the code, never on the message.

## A producer, an edge and a consumer {#example}

The shortest path through the three roles, with the HTTP binding. Each handler is a Web-standard `(Request) => Promise<Response>`, so it mounts in any runtime that speaks `fetch`.

```ts
import { generateKeyPair, Producer } from "@idem/core";
import { createGateway, createProducerHandler, IdemClient } from "@idem/gateway";

// 1. The producer declares its tools and, per tool, the policy that goes into the signed manifest.
const producer = new Producer({
  producer: "demo.idem.dev",
  key: await generateKeyPair(),
  tools: [
    {
      name: "fetch_page",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string", minLength: 1 } },
        required: ["url"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      policy: {
        cacheable: true,
        ttlMs: 300_000,
        scope: "public",
        normalizers: { "/url": ["url:sortQuery"] },
      },
      handler: async (args) => ({
        content: [{ type: "text", text: `page at ${(args as { url: string }).url}` }],
      }),
    },
  ],
});
const serveProducer = createProducerHandler(producer);

// 2. The edge is an HTTP forwarder whose upstream is the producer.
const edge = createGateway({
  id: "edge",
  upstreams: [{ producer: "demo.idem.dev", url: "https://producer.example", kind: "producer" }],
  authSecret: process.env.IDEM_EDGE_SECRET,
});
const serveEdge = (req: Request) => edge.handle(req);

// 3. The consumer names the call locally, asks its edge, and verifies what comes back.
const client = new IdemClient({ edge: "https://edge.example", producer: "demo.idem.dev" });
const out = await client.call("fetch_page", { url: "https://EXAMPLE.com:443/p?b=2&a=1#x" });

out.via;     // "idem": the call travelled as a named Interest
out.name;    // "/idem/v1/demo.idem.dev/fetch_page/<schema-digest>/<args-digest>"
out.verify;  // { ok: true, producer: "demo.idem.dev", keyId: "…" }
out.trace;   // the events at each hop, from the idem-trace header
out.result;  // the CallToolResult the agent gets
```

A producer whose tool has no `policy` is still served; that tool is simply never cacheable and always passes through.

## `@idem/core` {#core}

The protocol itself. Web APIs only (WebCrypto, `TextEncoder`, `fetch`, `URL`): the same build runs in a browser, in Node, in a Vercel Function and inside the simulator.

### Names and canonicalization {#core-names}

| Export | What it does |
|---|---|
| `canonicalizeArgs(args, tool, policy)` | Runs the pipeline of [protocol §3](/docs/protocol#s3): validate, defaults, declared normalizers, JCS. Returns `CanonicalArgs` (`{ value, jcs }`). Throws `INVALID_ARGS`, `UNSUPPORTED_SCHEMA` or `BAD_POLICY` |
| `makeName({ producer, tool, args })` | The name of a call, from the producer, the `ToolIdentity` and the canonical args [P-2.1] |
| `parseName(name)` | Splits a name into `{ producer, tool, schemaDigest, argsDigest }`. Throws `BAD_NAME` for malformed, non-canonical and reserved names |
| `formatName(parsed)` | The inverse of `parseName`, validating every component |
| `toolSchemaDigest(tool)` | `b64u(SHA-256(JCS(tool-identity)))[0:22]`; the description is never hashed [P-2.2] |
| `argsDigestOf(canonicalJcs)` | `b64u(SHA-256(...))` of a canonical JCS string, 43 characters |
| `keyLocator(producer, keyId)`, `parseKeyLocator(locator)` | Build and parse `/idem/v1/<producer>/_key/<keyId>` |
| `producerPrefix(producer)`, `assertProducer(producer)`, `encodeComponent(s)` | The routable prefix of a producer; producer syntax check; percent-encoding of a tool name |
| `jcs(value)`, `toJson(value)` | RFC 8785 serialization; a deep copy as plain JSON. Both throw `BAD_JSON` for non-JSON values |
| `applyNormalizer`, `applyNormalizers`, `isNormalizer`, `parsePointer`, `NORMALIZERS` | The normalizers of §3 and JSON Pointer handling |
| `validate(schema, value)`, `applyDefaults(schema, value)`, `assertSupportedSchema(schema)`, `SUPPORTED_SCHEMA_KEYWORDS` | The fixed JSON Schema subset of Appendix A [P-3.6] |
| `NAME_PREFIX`, `SCHEMA_DIGEST_LENGTH`, `ARGS_DIGEST_LENGTH` | `"/idem/v1/"`, 22, 43 |

Types: `IdemName`, `ParsedName`, `CanonicalArgs`, `Normalizer`, `JsonSchema`, `JsonValue`, `JsonObject`, `ToolIdentity`, `ToolPolicy`, and the protocol objects `Interest`, `Data`, `DataMeta`, `DataSignature`, `Manifest`, `UnsignedManifest`, `ManifestKey`, `Scope`, `CallToolResult`.

### Signatures and manifests {#core-crypto}

| Export | What it does |
|---|---|
| `generateKeyPair()` | A fresh Ed25519 `IdemKeyPair` (`keyId`, `privateKey`, `publicKey`, `publicKeyJwk`) |
| `importKeyPair(jwk)`, `exportPrivateKeyJwk(key)`, `importPublicKey(jwk)` | Move keys in and out as JWK |
| `keyPairFromSeed(seed)` | A deterministic key pair from 32 bytes. For tests and the simulator only, never for a real key |
| `keyIdFromJwk(jwk)` | The key id: a truncated RFC 7638 thumbprint, 16 characters |
| `signData(input, key)` | Signs an `UnsignedData` as `Data`. Throws `BAD_POLICY` if an error result has a non-zero freshness [P-5.3] |
| `verifyData(data, trust, opts?)` | End-to-end verification [P-5.5]: locator and name agree, the key is trusted and not expired, the content digest matches, the signature is valid. Returns a `VerifyResult`, never throws |
| `signManifest(m, key)`, `verifyManifest(m, trust, opts?)`, `verifyManifestSignature(m)` | Sign a manifest; check it against a trust store; check only its self-consistency |
| `contentDigest(content)`, `dataSignedBytes(name, meta)`, `manifestSignedBytes(m)`, `stripEphemeral(result)` | The exact bytes that are hashed and signed [P-5.2] |
| `deriveAuthContext(edgeSecret, credential)` | `b64u(HMAC-SHA256(secret, credential))[0:22]` [P-8.4]. The edge computes it; a forwarder never takes an `authContext` from a received Interest |
| `assertManifestShape(m)` | Throws `BAD_MANIFEST` unless `m` has the shape of §6 |

`VerifyResult` is `{ ok: true, producer, keyId }` or `{ ok: false, code, reason }` with `code` one of `BAD_SIGNATURE`, `UNTRUSTED_KEY`, `BAD_MANIFEST`. `verifyData` does not compare `producedAt` with a clock: a valid signature and a Data inside its lifetime are two separate verdicts.

### Signed lifetime {#core-lifetime}

The predicate of [P-8.6]. Forwarders and every consumer use this one definition. The judge of the safety experiment does not: it works on ground truth from its world, so that it cannot agree with the defence it judges.

| Export | What it does |
|---|---|
| `lifetimeState(meta, ttlMs, now, toleranceMs?)` | Where a Data stands at a node whose clock reads `now`: `"within"`, `"expired"` (its apparent age has reached `min(freshnessMs, ttlMs)` plus the tolerance) or `"future"` (dated further ahead than the tolerance). It fails closed: a value that is not a number gives `"expired"`. Pass `ttlMs = Infinity` when no manifest TTL is known |
| `isOutsideLifetime(meta, ttlMs, now, toleranceMs?)` | `true` when the state is not `"within"` |
| `apparentAge(meta, now)`, `lifetimeOf(meta, ttlMs, toleranceMs?)` | `now − producedAt`, not clamped at 0; and the apparent age at which a Data expires |
| `lifetimeReason(meta, ttlMs, now, toleranceMs?)` | The one-line message of an `EXPIRED` or `CLOCK_SKEW` error: which side of the window was missed, `producedAt` and the local time |
| `clockTolerance(ms)` | Validates a node's `clockToleranceMs` option. Throws `BAD_POLICY` for a negative value or one that is not a number |
| `DEFAULT_CLOCK_TOLERANCE_MS` | `60_000`, the default of every `clockToleranceMs` option |
| `staleByAge(data, ttlMs)` | `true` when a Data carries an `ageMs` of at least `min(freshnessMs, ttlMs)` [P-8.1]. A Data without `ageMs` comes from its producer and is not stale on arrival |
| `acceptData(data, { trust, now, name?, mustBeFresh, ttlMs?, toleranceMs? })` | The consumer's decision, the one every shipped consumer makes (`IdemClient`, `IdemConsumer`, `NdnConsumer`, the simulator's agents, the safety experiment): the Data carries the name asked for, it verifies [P-5.5], and, when fresh Data was asked for, it is within its signed lifetime and not stale by its age [P-8.7]. Returns `{ ok: true, verify }` or `{ ok: false, code, reason, verify }` with `code` one of `BAD_SIGNATURE` (a wrong name included), `UNTRUSTED_KEY`, `BAD_MANIFEST` or `EXPIRED`; for `EXPIRED`, `verify.ok` is `true` |

The tolerance is local to each node, and each of them takes it as an option named `clockToleranceMs`: `Forwarder`, `createGateway`, `IdemClient`, `createMcpEdge`, `IdemConsumer` and `NdnConsumer`.

### `TrustStore` {#core-trust}

The trust state of one node: accepted manifests and the keys they authorize. Trust on first use with optional pinning [P-6.2], no rollback [P-6.3].

| Member | What it does |
|---|---|
| `pin(producer, publicKeyJwk)` | Pins a key by configuration; returns its key id |
| `addManifest(m, opts?)` | Verifies a manifest and, if trusted, accepts it in place of the previous one |
| `check(m, opts?)` | The same decision without changing state |
| `manifest(producer)`, `policy(producer, tool)` | The accepted manifest; the `ToolPolicy` it declares for a tool |
| `key(producer, keyId, now?)` | A verification key trusted right now, or `undefined` |
| `producers()` | Producers with an accepted manifest |

### The forwarder engine {#core-engine}

```ts
const forwarder = new Forwarder({
  id: "edge",          // node id used in events
  clock,               // RealClock or VirtualClock
  fib,                 // a Fib
  trust,               // a TrustStore
  cs,                  // optional; default: a 64 MiB LRU MemoryContentStore
  pit,                 // optional; default: { maxEntries: 10_000, maxFacesPerEntry: 256 }
  verifyOnInsert,      // optional; default true. false only in experiments [P-7.1]
  authSecret,          // optional; the edge secret that derives authContext [P-8.4]
  clockToleranceMs,    // optional; signed-lifetime tolerance [P-8.6]. Default DEFAULT_CLOCK_TOLERANCE_MS
  onEvent,             // optional; receives every ForwarderEvent
});
forwarder.addFace(face, { consumer: true });   // a face that leads to consumers: this node is their edge
```

| Export | What it is |
|---|---|
| `Forwarder` | The engine of [protocol §7](/docs/protocol#s7). `addFace(face, opts?)`, `removeFace(id)`, `receive(faceId, packet)`, `pit()` (pending names and how many wait), `cs` |
| `Face` | The link abstraction: `id`, `send(packet)`, `onReceive(cb)`, `close()` |
| `Packet` | What travels on a face: `interest`, `data`, `nack`, and `call` / `result` for passthrough |
| `linkFaces(clock, { a, b, latencyMs? })` | A connected pair of faces with a delay, for tests and simple simulations |
| `Fib` | Longest-prefix routing: `add(prefix, nextHop)`, `addProducer(producer, nextHop)`, `remove`, `lookup(name)`, `lookupProducer(producer)`, `entries()` |
| `ContentStore`, `MemoryContentStore` | The store interface (`get`, `put`, `delete`, `stats`) and the in-memory, byte-budgeted implementation with `lru`, `lfu` or `fifo` replacement [P-7.4] |
| `isFresh(entry, now, ttlCapMs?)`, `entryAge(entry, now)`, `dataBytes(data)` | Freshness [P-8.1, P-8.2], age, and the size counted against the budget |
| `Clock`, `RealClock`, `VirtualClock` | The time source. `VirtualClock` adds `step()`, `runUntil(t)`, `runAll()`, `nextAt()`, `pending` |
| `ForwarderEvent`, `ForwarderEventKind` | The typed event stream described in [Architecture](/docs/architecture#events) |

Option and record types: `ForwarderOptions`, `FaceOptions`, `PitLimits`, `CsEntry`, `CsStats`, `ReplacementPolicy`.

### `Producer` and the consumer helpers {#core-producer}

| Export | What it does |
|---|---|
| `new Producer({ producer, key, tools, clock?, manifestVersion?, extraKeys? })` | A transport-agnostic producer (ADR-014). Rejects a cacheable tool without `readOnlyHint: true` or with an unsupported schema |
| `producer.manifest()` | The signed manifest, computed once |
| `producer.toolList()` | The tools as MCP `tools/list` would report them (`ToolInfo[]`) |
| `producer.identity(tool)` | The naming identity of a tool |
| `producer.handleInterest(interest, ctx?)` | Answers an Interest with a signed `Data`. Recomputes the name itself and throws `DIGEST_MISMATCH` if it differs [P-5.1]; throws `NOT_CACHEABLE` for tools outside the policy and for multi-round-trip results [P-5.4] |
| `producer.handleCall(tool, args, ctx?)` | A plain `tools/call`. For cacheable tools the result also carries the signature under `_meta["dev.idem/data"]` |
| `producer.serve(face, opts?)` | Serves Interests and calls arriving on a face; `serviceTimeMs` models tool latency in simulations |
| `cacheablePolicy(manifest, tool)` | Decides whether a call may use IDEM [P-6.1]; returns `{ policy, identity }` or `undefined` |
| `buildInterest(input)` | Builds an Interest locally from the policy and the arguments [P-4.1]; returns `{ interest, args }` |
| `attachData(result, data)`, `dataFromToolResult(result)` | Put a signed envelope into a tool result's `_meta`, and rebuild the `Data` from one |
| `wireCode(error)` | Maps any error to a code that may cross a hop |
| `META_KEYS`, `INTEREST_DEFAULTS` | The `dev.idem/*` keys; `{ mustBeFresh: true, lifetimeMs: 10_000, hopLimit: 8 }` |

A `ProducerTool` is `{ name, description?, inputSchema, outputSchema?, annotations?, policyVersion?, policy?, handler(args, ctx) }`, and the handler's `ctx` (`ProducerContext`) is `{ auth?, now }`. The other option types are `ProducerOptions`, `ProducerToolPolicy` and `BuildInterestInput`.

### Errors and encoding {#core-errors}

`IdemError` carries a `code` of type `IdemErrorCode`, the union of the wire codes (`IdemWireErrorCode`: `DIGEST_MISMATCH`, `BAD_SIGNATURE`, `EXPIRED`, `UNTRUSTED_KEY`, `NOT_CACHEABLE`, `TIMEOUT`, `HOP_LIMIT`, `LOOP`, `UPSTREAM_ERROR`) and the local ones (`IdemLocalErrorCode`: `BAD_NAME`, `BAD_JSON`, `BAD_ENCODING`, `INVALID_ARGS`, `UNSUPPORTED_SCHEMA`, `BAD_POLICY`, `BAD_MANIFEST`, `CRYPTO_UNSUPPORTED`, `CLOCK_SKEW`). `isIdemError(e, code?)` narrows an unknown error. Two of the codes belong to the signed lifetime: a forwarder answers `EXPIRED` for a Data outside its lifetime when the Interest asked for fresh Data [P-8.6], and a consumer raises `CLOCK_SKEW` when its verified retry is still outside it [P-8.7].

Encoding helpers: `b64uEncode`, `b64uDecode`, `isB64u`, `sha256`, `sha256b64u`, `utf8`, `utf8Length`, `randomNonce`.

## `@idem/gateway` {#gateway}

IDEM over HTTP: the routes of [protocol §9.1](/docs/protocol#s9-1).

### `createGateway(options)` {#gateway-create}

An HTTP forwarder, edge or regional, running the core engine on the wall clock. Returns `{ handle(req), forwarder, trust }`.

| Option | Meaning |
|---|---|
| `id` | Node id, used in events and traces |
| `upstreams` | `{ producer, url, kind: "producer" \| "forwarder", manifestUrl? }[]`: the next hop for each producer |
| `cs`, `trust`, `pit` | A custom Content Store, trust store and PIT bounds |
| `authSecret` | The edge secret; `authContext` is an HMAC of it and the bearer credential [P-8.4] |
| `verifyOnInsert` | Experiment flag only [P-7.1] |
| `clockToleranceMs` | The tolerance of this forwarder's signed-lifetime check [P-8.6] |
| `basePath` | The path prefix the handler is mounted under, such as `/api/edge` |
| `fetch`, `onEvent` | An injected `fetch`; a listener for every forwarder event |

A request without the `idem-forwarder` header comes from a consumer, so this node acts as its edge. Every response carries the `idem-trace` header.

### `createProducerHandler(producer, options?)` {#gateway-producer}

Serves a core `Producer` over the same binding: the manifest, the tool list, `POST /idem/v1/interest` and `POST /idem/v1/call`. Options: `basePath`, and `id` for traces.

### `IdemClient` {#gateway-client}

The verifying consumer. It runs anywhere `fetch` and WebCrypto exist.

| Member | What it does |
|---|---|
| `new IdemClient({ edge, producer, producerUrl?, credential?, trust?, fetch?, clock?, clockToleranceMs?, intercept? })` | `edge` is the first hop. `producerUrl` is where the cache-free retry goes, for a consumer that can reach the producer; by default it is a passthrough call through the edge. `clock` and `clockToleranceMs` set the time source and the tolerance of the lifetime check [P-8.7]. `intercept` is a test hook that rewrites a Data before verification |
| `init()` | Fetches and verifies the manifest and the tool list |
| `prepare(tool, args)` | The Interest a call would send, or `undefined` if the call is not IDEM |
| `call(tool, args)` | Calls a tool and returns a `CallOutcome` |
| `sendInterest(interest)` | Sends a prepared Interest and verifies the answer. A Data that verifies but is outside its lifetime comes back with `verify.ok` true and `error` `EXPIRED` |

A `CallOutcome` has `tool`, `result`, `via` (`"idem"` or `"call"`), `name`, `data`, `verify`, `retried`, `trace`, `latencyMs` and `error`. `retried` is true when the first answer failed verification (`BAD_SIGNATURE`) or was outside its signed lifetime (`EXPIRED`, from a forwarder or by the client's own clock), and the call was repeated as a plain call that no cache answers [P-5.5, P-8.7]. The repeated answer is held to the same checks. If it is unsigned, signed for another name or invalid, `error` is `BAD_SIGNATURE`. If it verifies but is still outside its lifetime, `error` is `CLOCK_SKEW`, and `verify.ok` stays true because the signature is valid. In both cases `result` is an error result, never the unverified or expired content. Read `error` before `verify.ok`. `error` is a `CallError`: a wire code or `CLOCK_SKEW`, with a message.

Also exported: the faces `HttpUpstreamFace` and `RequestFace`; `credentialOf(req)`; and the wire helpers `PATHS`, `HEADERS`, `statusFor(code)`, `errorResponse`, `json`, `isWireError`, `parseTrace`, `formatTrace`, `routePath`, with the types `WireError`, `TraceHop`, `CallError`, `CallOutcome`, `Gateway`, `GatewayOptions`, `Upstream`, `IdemClientOptions`, `ProducerHandlerOptions`.

## `@idem/mcp` {#mcp}

The MCP binding, on the MCP TypeScript SDK v2.

| Export | What it does |
|---|---|
| `createMcpProducer(producer, info)` | Serves a `Producer` as a stateless MCP server. `tools/call` runs `handleCall`, so results of cacheable tools carry `_meta["dev.idem/data"]`. The credential is `Authorization: Bearer` |
| `createMcpEdge({ gateway, producer, info, maxClients?, clockToleranceMs? })` | A plain MCP endpoint in front of an IDEM edge. It terminates MCP: it lists the producer's tools (tools only), and each `tools/call` goes through the forwarder engine in-process, with the edge naming the call and verifying the answer on the client's behalf [P-5.5]. An answer that fails verification or the lifetime check even after the retry reaches the MCP client as an error result, never as content [P-8.7]. Asynchronous, because it learns the tool list and verifies the manifest first |
| `new IdemConsumer({ trust?, clock?, clockToleranceMs? })` | Verifies results received over MCP. `pin(producer, keys)` pins producer keys; `verifyToolResult(result)` returns a `VerifyResult`, or `{ ok: false, code: "UNSIGNED" }` for a result with no IDEM metadata, or `{ ok: false, code: "EXPIRED" }` for one whose signature verifies but which is outside its signed lifetime on this clock [P-8.7]. It has no cache-free path of its own, so the caller repeats the call |
| `createProxyProducer(options)` | An IDEM producer, with its own name and key, in front of an MCP server that does not speak IDEM. See [below](#mcp-proxy) |

Option types: `McpServerInfo` (`{ name, version }`) and `McpEdgeOptions`. The package re-exports the type `JsonSchema` from `@idem/core`.

> [!NOTE]
> A `withIdem(server)` wrapper, which would add IDEM to an existing `McpServer` whose tools are registered elsewhere, is planned and not implemented. Today a producer declares its tools through `Producer` and is served by `createMcpProducer`.

### `createProxyProducer(options)` {#mcp-proxy}

The proxy-producer of [protocol §9.1](/docs/protocol#s9-1) (ADR-038): an IDEM producer for an MCP server that knows nothing about IDEM, the origin. The proxy calls the origin over plain MCP, names the results and signs them with its own key. Trust moves to the proxy; [Security](/docs/security#limits) says what a consumer does and does not learn from its signature.

```ts
import { importKeyPair } from "@idem/core";
import { createProducerHandler } from "@idem/gateway";
import { createMcpProducer, createProxyProducer } from "@idem/mcp";

const proxy = await createProxyProducer({
  upstream: { url: "https://mcp.example.com/mcp", credential: process.env.ORIGIN_TOKEN },
  name: "proxy.example.com",                        // the proxy's own name, never the origin's
  key: await importKeyPair(JSON.parse(process.env.PROXY_KEY_JWK!)),
  tools: {                                          // any tool not listed is relayed, unsigned, never cached
    search_docs: { cacheable: true, ttlMs: 300_000, scope: "public", normalizers: { "/q": ["trim", "lowercase"] } },
    my_tickets: { cacheable: true, ttlMs: 30_000, scope: "private" },  // forwards the user's Bearer
    get_status: { cacheable: true, ttlMs: 10_000, scope: "public", operatorAssertsReadOnly: true },
  },
  onSchemaChange: () => void proxy.refresh(),       // or refresh from a deploy hook
});
export const idem = createProducerHandler(proxy);   // edges: { producer: "proxy.example.com", kind: "producer" }
export const mcp = createMcpProducer(proxy, { name: "idem-proxy", version: "1.0.0" });
```

`createProxyProducer` reads the origin's `tools/list` and returns a `ProxyProducer`, a subclass of the core `Producer`, so it is served by `createProducerHandler` or `createMcpProducer` like any other producer. It throws `BAD_POLICY` when the name is the origin's host, or when a tool declared cacheable cannot be: absent at the origin, marked `readOnlyHint: false`, without a `readOnlyHint` and without `operatorAssertsReadOnly`, or with a schema outside the supported subset.

| Option | Meaning |
|---|---|
| `upstream` | A `ProxyUpstream`, `{ url, fetch?, credential?, info? }`: the origin's Streamable HTTP endpoint. `credential` is the proxy's own Bearer at the origin, used for `tools/list` and for tools declared `public`, which never see an end user's credential, even while held or refused [P-9.7] |
| `name`, `key` | The proxy's own producer name and signing key, never the origin's [P-9.5] |
| `tools` | The operator's policy per origin tool, a `ProxyToolPolicy`: a `ProducerToolPolicy` plus `policyVersion?` and `operatorAssertsReadOnly?`. The last one is for a tool to which the origin gives no `readOnlyHint`; it cannot override `readOnlyHint: false` [P-9.6] |
| `onSchemaChange` | Called with a `SchemaChange`, `{ tool, manifestVersion }`, when the proxy sees the origin's entry for a tool change. The tool is held not cacheable from then until `refresh()` [P-9.8] |
| `clock`, `manifestVersion`, `maxClients` | The time source; the first manifest version, by default the clock in seconds so that a restart never rolls back [P-6.3]; the cap on origin clients, one per credential, default 512 |

A `ProxyProducer` adds `origin`, `manifestVersion` and `refresh()`, which re-reads the origin's tool list and returns a `ProxyRefresh`, `{ changed, manifestVersion, refused }`; `ProxyProducer.create(options)` is the same as the function. Each tool it lists carries `_meta["dev.idem/origin"]` (the key is `ORIGIN_META_KEY`), an `OriginRecord` of the form `{ origin, readOnlyHint: "origin" | "operator" | "absent" }`. Like the tool list, the record is unsigned and informational. The option type is `ProxyProducerOptions`.

One gap is known. Forwarders and `IdemClient` read a manifest once. After the origin changes a tool and the proxy refreshes, an edge that has not been restarted answers `NOT_CACHEABLE` or `DIGEST_MISMATCH` for that tool.

## `@idem/sim` {#sim}

A deterministic discrete-event simulator. It runs the real `Forwarder` over virtual links with a seeded workload.

```ts
import { buildTopology, defaultConfig, runSimulation } from "@idem/sim";

const config = defaultConfig({
  topology: buildTopology({ kind: "star", agents: 8, agentLinkMs: 5, producerLinkMs: 40 }),
  mode: "idem",
});
const { metrics } = await runSimulation(config, { seed: 42 });
```

| Export | What it does |
|---|---|
| `runSimulation(config, { seed, onEvent?, keepEvents? })` | Runs to completion and returns a `SimResult` (`metrics`, `events?`, `config`, `seed`) |
| `Simulation` | A run you can step: `Simulation.create(config, { seed, ...hooks })`, `runUntil(t)`, `run()`, `result()`, and the attacks `attackTamper()`, `attackForge()`, `attackPrivateProbe()` |
| `SimConfig` | `topology`, `mode`, `workload`, `producer`, `cs`, and optional settings such as `interestLifetimeMs` |
| `SimMode` | `"mcp-direct"`, `"mcp-local-cache"`, `"mcp-gateway-cache"`, `"idem"`, `"idem-noverify"` |
| `buildTopology(preset)` | `star` (agents → edge → producer) or `tree` (agents → edges → regional → producer) |
| `defaultConfig(overrides?)` | A reasonable starting configuration |
| `SyntheticWorkload`, `PerAgentWorkload`, `TraceWorkload`, `TraceRecord` | The workloads of [Evaluation](/docs/evaluation#workloads). A synthetic workload takes `burst: { size, parallel? }` and `startSpreadMs` for calls issued by code; without them it is one call per step, as before. A per-agent workload gives each agent its own `AgentPlan` |
| `Metrics`, `MetricsCollector` | The metrics of a run, computed from the forwarder event stream. `gatewayCacheHits` and `gatewayInflightDuplicates` are counted in the gateway-cache mode and are 0 in the others |
| `GatewayCache`, `GatewayRelay`, `gatewayCacheKey(producer, tool, args)`, `stableJson(value)` | The unsigned gateway cache of mode B5 (ADR-036): the cache, with a byte budget and the Content Store's replacement policies; the relay that wraps a client face of a forwarder relaying plain calls; and the key, which is the producer, the tool and the arguments as sent, serialized with sorted keys. It is a baseline of the evaluation and exists only in the simulator. `Simulation.gatewayCaches` holds each edge's cache in that mode |
| `validateConfig(config)`, `SimConfigError` | Checks a configuration and returns its producers with defaults filled in; throws a `SimConfigError` whose `path` points at the offending field |
| `routesTo`, `pathToProducer`, `reachableProducers` | Latency-shortest routes toward a producer on any graph (ADR-027) |
| `TOOL_CATALOG`, `TOOL_IDS`, `toolInfo`, `isToolId`, `simTool` | The simulated tools, which mirror the demo producer's, and their producer-side definition |
| `Rng`, `Zipf`, `percentile` | The seeded generator every random decision comes from |
| `planWorkload`, `SIM_PRODUCER`, `SimHooks`, `CallRecord`, `Transmission`, `AttackRecord` | Workload expansion, the producer name used in simulations, and the records a run reports. A `CallRecord` may carry `error`, a `SimCallError`: `"NO_ROUTE"`, or `"CLOCK_SKEW"` for a call whose verified retry was still outside its signed lifetime |

Configuration types: `SimNode`, `SimLinkConfig`, `TopologyPreset`, `SimProducerConfig`, `SimToolConfig`, `ToolId`, `ToolMixEntry`, `AgentPlan`, `Dist`. Other types: `PlannedCall`, `ResolvedProducer`, `RouteHop`, `RoutePath`, `GatewayCacheEntry`, `GatewayRelayOptions`, `ToolCatalogEntry`, `SimToolContext`, `SimErrorCode`. Constants: `AGENT_PLAN_DEFAULTS`, `DEFAULT_MAX_RESULT_BYTES`, `CORPUS_ORIGIN`, `SEARCH_QUERIES`, `CITIES`.

The package also exports the processing-cost model (`ProcessingCosts`, `ProcessingOp`, `costUs`, `assertProcessingCosts`) and, as types only, the shapes the results page reads: `ResultsData`, `SweepData`, `MicrobenchData`, `MicrobenchCell`, `MissOverhead`, `SafetyData`, `SafetyRowData`, `EmulationData`, `EmulationModeId`, `NfdData`, `NfdRunData`, `NfdScenario`, `RunRef`, `Stat`, `AttackClass`, `Expectation`, `EvalModeId`, `SweepBase`. Those belong to the evaluation and change with it; read them in `packages/sim/src`.

## `@idem/ndn` {#ndn}

The native binding over NDN, built on NDNts (protocol §9.2, ADR-026). It reuses `@idem/core` for naming, signing and verification; PIT, CS and aggregation are the NDN forwarder's (NFD).

```ts
import { Forwarder } from "@ndn/fw";
import { NdnConsumer, serveNdn } from "@idem/ndn";

const fw = Forwarder.create();                       // or a face to NFD
await serveNdn({ producer, key, fw });               // the same Producer as above
const consumer = new NdnConsumer({ producer: "demo.idem.dev", fw });
const out = await consumer.call("fetch_page", { url: "https://corpus.idem.dev/doc/3" });
```

| Export | What it does |
|---|---|
| `toNdnName`, `fromNdnName`, `ndnUri`, `hasParamsDigest` | IDEM name ⇄ NDN name (one GenericNameComponent per part; NDN's trailing parameters digest dropped on the way back), and a readable URI |
| `encodeInterest`, `decodeInterest` | IDEM Interest ⇄ NDN Interest: ApplicationParameters = JCS of the canonical args, unsigned, no `authContext`; decoding checks the bytes against `args-digest` |
| `encodeData`, `decodeData`, `encodeNack` | IDEM Data ⇄ NDN Data (Content = `{ content, meta, signature }` in JCS, FreshnessPeriod = `freshnessMs`); refuses `private` Data; errors are application Nacks |
| `toWire`, `interestFromWire`, `dataFromWire`, `MAX_PACKET_SIZE` | TLV wire encoding; results over the NDN packet limit are not segmented |
| `producerSigner`, `ndnSigner`, `ndnVerifier` | NDN Ed25519 signers and verifiers from the NDNts keychain, using the same WebCrypto keys as `@idem/core` |
| `verifyNdnData(data, trust, opts?)` | Both checks: the NDN signature and the IDEM signature and content digest. Never throws |
| `serveNdn(options)` | Serves a `Producer` under `/idem/v1/<producer>`, with `_manifest` and `_tools`; private tools get a `NOT_CACHEABLE` Nack and never run |
| `NdnConsumer` | `init()` fetches the manifest and tool list over NDN, `prepare()` names a call, `call()` sends it and verifies the answer. Its options include `retransmissions`, `clock` and `clockToleranceMs`. A verified Data outside its signed lifetime fails the call closed with `EXPIRED`: a native-only consumer has no plain call to retry on [P-8.7] |
| `tlvTree`, `toHex`, `TLV_TYPES` | A decoded TLV tree of a packet, for display (the sandbox's native view uses it) |

Also exported: `ndnNonce`, `idemNonce`, `CONTENT_TYPE`, `RESERVED`, and the option and result types `NdnConsumerOptions`, `NdnCallOutcome`, `NdnProducer`, `NdnProducerOptions`, `NdnSigner`, `NdnVerifyOptions`, `NdnVerifyResult`, `OuterVerifyResult`, `DecodedData`, `NativeEnvelope` and `TlvNode`.
