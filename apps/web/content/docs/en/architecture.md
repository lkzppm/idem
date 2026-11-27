The whole project hangs on one decision: the forwarder logic exists **exactly once**, in `@idem/core`, and everything else gives it something to run on. The production gateway, the simulator and the browser sandbox do not each implement the protocol. They run the same class with different links and a different clock (ADR-001).

## Topology {#topology}

The smallest useful deployment is a star: agents, one edge forwarder, the producer. The experiments on multi-hop behaviour use a tree, with a regional forwarder between the edges and the producer.

::figure[topology] The tree topology. An Interest climbs toward the producer and the Data comes back down the same path; any forwarder on the way that holds a fresh copy answers instead.

- **Agents** are consumers. They speak plain MCP to the edge, or IDEM over HTTP if they use the verifying client.
- The **edge** is each consumer's first hop. It is the only node that sees whose request it is, so it is the only one that keeps `private` Data, partitioned by authorization context.
- A **regional** forwarder aggregates and caches across edges. It stores `public` Data only.
- The **producer** runs the tools, names the results itself and signs them.

A server does not have to be rewritten to be a producer. An operator can put a **proxy-producer** in front of an MCP server that does not speak IDEM. The proxy takes the producer's place in this picture, with its own name and its own key, and calls that server over plain MCP. The [API reference](/docs/api#mcp-proxy) shows how, and [Security](/docs/security#limits) says what this changes about trust.

A call to a tool that is not cacheable does not take a different road. It travels the same links as a plain call, with no PIT entry and no cache entry, and each forwarder it crosses emits `bypass`.

## Packages {#packages}

::figure[packages] What depends on what. An arrow points from a package to the one it uses.

| Package | Responsibility | Runs in |
|---|---|---|
| `@idem/core` | names, canonicalization, JCS, digests, signed Data and manifests, the trust store, the **forwarder engine** (PIT, CS, FIB) and its events, the clocks, a transport-agnostic `Producer` and the consumer helpers | browser, Node, Vercel, simulator |
| `@idem/gateway` | IDEM over HTTP: a producer handler, an HTTP forwarder (edge or regional) and a verifying client. Everything is a Web-standard `(Request) => Promise<Response>` | browser (client), Node, Vercel |
| `@idem/mcp` | the MCP binding: a producer and an edge as MCP endpoints, verification of results received over MCP, and a proxy-producer for MCP servers that do not speak IDEM | Node, Vercel |
| `@idem/sim` | a deterministic discrete-event simulator: topologies, links with delay, loss and bandwidth, seeded workloads, metrics, and the unsigned gateway cache that the evaluation uses as a baseline | Node (experiments), browser (sandbox) |
| `@idem/ndn` | the native binding over NDN (NDNts): name mapping, the Interest/Data codec, NDN Ed25519 signatures, a producer that wraps `Producer` and a verifying consumer. PIT and CS are the NDN forwarder's | Node, browser |
| `apps/web` | this site: landing page, sandbox, docs, results, and the demo producer and edge as routes | Vercel |

The dependency rule is strict. `core` depends on nothing but Web APIs (WebCrypto, `TextEncoder`, `fetch`, `URL`) and imports no `node:*` module, which is what lets it run unchanged in a browser tab. `sim`, `gateway` and `ndn` depend only on `core` (`ndn` also on NDNts); `mcp` depends on `core` and `gateway`. Nothing depends on `apps/web`.

## One engine {#engine}

The rules of [protocol §7](/docs/protocol#s7) live in one class, `Forwarder`. It is parameterized by everything that differs between environments:

| Parameter | Production gateway | Simulator and sandbox |
|---|---|---|
| **faces** (`Face`: `send`, `onReceive`) | an HTTP request per downstream, an HTTP client per upstream | virtual links with delay, loss and bandwidth |
| **clock** (`Clock`) | `RealClock`: wall time and platform timers | `VirtualClock`: discrete events, deterministic for a seed |
| **cs** (`ContentStore`) | `MemoryContentStore`, a byte-budgeted LRU; the interface allows another store | the same class |
| **trust** (`TrustStore`) | manifests fetched from the producer | a manifest built in the run |
| **onEvent** | traces returned to the caller in the `idem-trace` header | the sandbox's canvas and log; the experiments' metrics |

Each forwarder also takes a clock tolerance, `clockToleranceMs`, for the signed lifetime of [P-8.6]; it is 60 seconds unless configured.

Because the clock is injected, a simulation does not sleep: it jumps from event to event. Because WebCrypto is asynchronous, `VirtualClock` awaits each timer's callback before running the next one, so signing and verifying never reorder events and a run with a given seed is reproducible.

### The event stream {#events}

Every observable action of a forwarder is a typed event. Nothing else is measured: the sandbox draws these events and the experiments count them.

| Event | Emitted when |
|---|---|
| `interest_in` | an Interest arrives on a face |
| `cs_hit` | a fresh Data in the Content Store answers it (carries the Data's `ageMs`) |
| `pit_aggregate` | the name is already pending; the face joins the entry (carries the number waiting) |
| `upstream_out` | a new PIT entry is created and the Interest is sent to the next hop |
| `data_in` | a Data arrives from upstream (carries its size) |
| `verify_ok`, `verify_fail` | the signature and content digest were checked (carries the time it took) |
| `cs_insert`, `cs_evict` | a Data enters the Content Store, or leaves it to make room |
| `pit_satisfy` | the Data is delivered to every waiting face (carries how many) |
| `pit_expire` | a PIT entry's lifetime ran out; the waiters get `TIMEOUT` |
| `drop` | an Interest or Data is discarded, with a reason (`digest_mismatch`, `hop_limit`, `loop`, `unsolicited`, `expired`, ...) |
| `bypass` | a call or Interest goes through without PIT or CS state, with a reason |

## Flows {#flows}

### A miss, with aggregation {#flow-miss}

Three agents ask for the same page at almost the same moment.

1. Agent 1 calls `fetch_page(url)`. The edge canonicalizes the arguments and computes the name **N**. The CS has nothing for N and the PIT has no entry: the edge creates one, looks up the producer in the FIB and sends the Interest upstream (`upstream_out`).
2. Agent 2 calls `fetch_page` with an equivalent URL. Canonicalization yields the same name N. The PIT already has N: the edge adds agent 2 to the entry (`pit_aggregate`, 2 waiting). Nothing is sent.
3. Agent 3 does the same (`pit_aggregate`, 3 waiting).
4. The producer runs the tool once, computes N itself from the arguments, signs the result and returns the Data.
5. The edge verifies the signature (`verify_ok`), stores the Data (`cs_insert`), delivers it to the three waiting faces (`pit_satisfy`, 3 faces) and removes the PIT entry.

### A hit {#flow-hit}

A fourth agent asks for the same page while the Data is still fresh. The edge computes N, finds a fresh Data in the CS and answers at once (`cs_hit`), with `ageMs` updated. The producer is not contacted. The agent still verifies the signature: a cache hit is not trusted more than a fresh answer.

### A tool with a side effect {#flow-bypass}

`send_email` is not marked cacheable in the manifest. The consumer does not build an Interest for it; the call goes through the edge as a plain call and the edge emits `bypass`. Two identical `send_email` calls send two emails, as they should.

## Bindings {#bindings}

A **binding** is how names, Interests and Data are carried between nodes. The protocol defines two ([protocol §9](/docs/protocol#s9)).

### HTTP overlay {#http}

Implemented in `@idem/gateway` and `@idem/mcp`. Every hop is an HTTP exchange, and the exchange itself correlates an answer with its request.

| Who | Route | Body → response |
|---|---|---|
| producer | `GET /.well-known/idem.json` | the signed manifest |
| producer | `GET /idem/v1/tools` | the tool list, in the shape of `tools/list` |
| producer, forwarder | `POST /idem/v1/interest` | an Interest → a Data, or `{ code, message }` |
| producer, forwarder | `POST /idem/v1/call` | `{ producer, tool, args }` → a `CallToolResult` (passthrough) |
| forwarder | `GET /idem/v1/manifest/<producer>` | the manifest this node trusts |
| forwarder | `GET /idem/v1/tools/<producer>` | the producer's tool list, proxied |

Three headers matter. `Authorization: Bearer` carries the end user's credential hop by hop to the producer. `idem-forwarder` marks a request sent by a forwarder; its absence tells a node that the sender is a consumer and that this node is its edge. `idem-trace`, on responses, lists the events the request caused at each hop: it is diagnostic only and never trusted.

Over MCP itself the same objects ride in `_meta`. A producer served by `createMcpProducer` returns the normal `CallToolResult` and attaches the signature under `_meta["dev.idem/data"]`. A client that does not know IDEM ignores `_meta`, so the binding is backward compatible. And an edge served by `createMcpEdge` is a plain MCP endpoint: any agent can connect to it and each `tools/call` enters the forwarder engine as a consumer request.

### Native NDN {#ndn}

Implemented in `@idem/ndn` (ADR-026). It has been run against real NFD forwarders in Docker: a functional check over TCP, UDP and WebSocket faces, and the emulation experiment E4 ([Evaluation](/docs/evaluation#e4)). An IDEM name becomes an NDN name, one GenericNameComponent per part, and the Interest's ApplicationParameters carry the canonical arguments as JCS bytes. NDN appends its own ParametersSha256DigestComponent after the `args-digest`, so two equivalent calls get the same native name exactly when they get the same IDEM name. The Data's Content is the JCS envelope `{ content, meta, signature }`, and the packet is also signed with NDN's Ed25519 by the producer's key, so a consumer checks both signatures. NFD's own PIT and Content Store do the aggregation and caching; because they key by name alone, with no authorization context, `private` tools never use this binding and stay on the overlay.

## Where each piece runs {#deploy}

| Component | Locally | Deployed |
|---|---|---|
| Demo producer | a route of the dev server | a function: `/api/producer/*` (IDEM over HTTP and `/api/producer/mcp`) |
| Edge gateway | a route of the dev server | functions: `/api/edge/*` (IDEM over HTTP) and `/api/mcp` (plain MCP) |
| Simulator and engine | the browser | the browser: the sandbox costs the server nothing |
| Experiments | local Node, Docker | not deployed |

> [!NOTE]
> In the deployment the edge's Content Store lives in the memory of one function instance. Instances are reused, so hits do happen, but a request that lands on a fresh instance starts with an empty cache. The sandbox's live mode says so on the page. A shared store is possible through the `ContentStore` interface and is not on the critical path.

The API of each package is in the [API reference](/docs/api).
