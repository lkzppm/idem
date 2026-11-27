## The idea in one line {#idea}

> If the question is the same, the answer is the same, and it does not need to cross the network again.

IDEM (*Interest-Driven Exchange for Models*) is a content-centric layer for the [Model Context Protocol](https://modelcontextprotocol.io) (MCP), the protocol LLM agents use to call external tools. It changes what a tool call *is* on the network:

- a **read-only tool call** becomes a **name**, derived from the producer, the tool and the canonicalized arguments;
- the **result** becomes a **Data** object, signed by the producer that ran the tool;
- any node on the path may keep that Data and serve it later, because whoever receives it **verifies the signature** and does not have to trust the node that handed it over;
- identical requests that are in flight at the same moment are **aggregated**: one goes upstream, all of them get the answer.

This is the model of Named Data Networking [NDN-2014] applied to tool calling. *Idem* is Latin for "the same".

::figure[swarm] Three agents ask for the same page at the same time. The edge forwarder recognizes one name, sends one Interest upstream, and delivers the producer's signed Data to all three.

## The problem {#problem}

In its 2026-07-28 revision MCP became stateless: every request is self-contained and the protocol behaves like an ordinary HTTP API [MCP-CHANGELOG]. The communication model is still a message from one address to another, and three gaps follow from that.

1. **Tool calls are not cacheable by the protocol.** MCP's caching mechanism covers discovery and listing requests and `resources/read`. `tools/call` is left out [MCP-CACHE].
2. **Results carry no integrity and no proof of origin.** MCP's `cacheScope` is a label. The specification tells servers not to rely on it for access control [MCP-CACHE], and the SDK documentation calls it "a label, not a lock" [MCP-PY-CACHE]. A response that an intermediary serves cannot be checked by the one who receives it.
3. **Agents repeat each other, and a cache inside one agent cannot see it.** Two measurements exist. In a research swarm working on 120 questions, 32.6% of the `web_fetch` calls and 43.1% of the `pdf_read` calls asked for something already requested earlier in the same question; the calls that repeated a *different* subagent's request were 30.7% and 27.6% of all calls of each tool. Free-text searches did not converge: 0.4% were repeats [ARCTICSWARM]. In production traces of one day, 27% of the distinct search queries of an application recur and account for 67.3% of its search calls [AGENTSYSBENCH]. The second figure is recurrence across sessions over 24 hours, and a cache with a short lifetime collects much less of it. [Use cases](/docs/use-cases#research-swarms) gives both measurements in full, with their limits.

## What IDEM does about it {#approach}

Content-centric networking was designed for this class of problem. The consumer asks for *named data* instead of contacting a host; every Data packet is signed and binds a name to its content, so it can come from any cache; identical requests merge along the path [NDN-2014][SRM-NDN]. IDEM applies each piece to tool calls:

| Piece | In IDEM | Read more |
|---|---|---|
| Name | producer + tool + schema version + digest of the canonical arguments | [Names](/docs/concepts#names) |
| Data | the tool result, signed by the producer, with a freshness period and a scope | [Interest and Data](/docs/concepts#interest-and-data) |
| Forwarder | a gateway with a **PIT** (aggregation), a **CS** (cache) and a **FIB** (routing by producer) | [The forwarder](/docs/concepts#forwarder) |
| Trust | a manifest signed by the producer says which tools are cacheable and lists its keys | [Signatures and trust](/docs/concepts#trust) |
| Verification | the consumer verifies every Data, whatever path it took | [Security](/docs/security) |

Three things are specific to tool calls and are not in classic NDN.

- **Arguments are written by a model.** Two agents that mean the same request spell it differently (key order, an upper-case host, a default port). So canonicalization is part of the protocol, and only the normalizations the producer declared are applied.
- **The producer authorizes caching.** MCP tool annotations such as `readOnlyHint` are untrusted hints. In IDEM a tool is cacheable only if the producer's signed manifest says so.
- **Existing agents keep working.** The edge can be an ordinary MCP endpoint. An agent that knows nothing about IDEM connects to it and its repeated calls are named, aggregated and cached on the way.

None of these pieces is new on its own: other work caches tool results, merges identical calls or signs MCP messages. What IDEM claims is the combination, and [Related work](/docs/related-work) says where each piece comes from.

## Where it sits in the stack {#stack}

IDEM borrows the *model* of a network-layer architecture and runs it where HTTP caches and CDNs run.

| Binding | Layer | Stack |
|---|---|---|
| HTTP overlay (implemented) | application-layer overlay, like an HTTP cache or a CDN, but with signed, named objects | MCP / IDEM → HTTP → TLS → TCP/QUIC → IP |
| Native NDN (implemented; run on NFD) | the names are carried by NDN, which replaces IP at the network layer | IDEM naming → NDN → link / UDP tunnels |

In this project "transport" always means an MCP transport (stdio, Streamable HTTP), never OSI layer 4. IDEM claims no segmentation, flow control or congestion control: TCP and QUIC still do that (ADR-010).

## When it applies, and when it does not {#fit}

IDEM helps when all of these hold:

- the tool is **read-only** and its producer declares it cacheable in the signed manifest;
- **several consumers** ask overlapping questions (a swarm of subagents, many users of one service), or one consumer asks again within the freshness period;
- an answer that is a few seconds or minutes old is acceptable, for a period the producer chooses.

It deliberately does nothing in these cases, and the call proceeds as plain MCP:

- **tools with side effects** (send an email, write a file) always pass through;
- requests that are only *similar*: matching is exact after canonicalization, and semantic matching is future work;
- multi-round-trip tool results (`input_required`), which MCP itself does not cache;
- arguments that do not validate against the tool's schema.

IDEM is also not a replacement for MCP. It is a layer underneath and alongside it. It does not cache what a model writes and it saves no tokens: it acts below the model, on the path of the tool call.

[Use cases](/docs/use-cases) walks through eight settings that exist today and says for each one what repeats, where IDEM would sit and what it does not solve. The full list of poor fits is in [Where IDEM does not fit](/docs/use-cases#not-fit).

## What exists today {#status}

IDEM is a research prototype for the course EEL878 (Computer Networks I, UFRJ). This is what is implemented, as of this build:

| Part | State |
|---|---|
| `@idem/core`: names, canonicalization, signatures, manifest, forwarder engine | implemented, tested against the protocol's MUST rules |
| `@idem/gateway`: IDEM over HTTP (producer handler, forwarder, verifying client) | implemented |
| `@idem/mcp`: producer and edge as MCP endpoints, result verification, proxy-producer for servers that do not speak IDEM | implemented; the `withIdem(server)` wrapper is planned |
| `@idem/sim`: deterministic simulator on the real engine | implemented |
| `@idem/ndn`: native NDN binding (NDNts) | implemented; checked against real NFD forwarders in Docker and compared with the overlay under packet loss (experiment E4). Mini-NDN itself was not used |
| Experiments | see [Evaluation](/docs/evaluation) for the method and [Benchmarks](/benchmarks) for what has been measured |

The hypotheses the project tests are stated before any measurement, and a hypothesis refuted with sound method is reported as refuted.

## How to read these docs {#map}

- **[Use cases](/docs/use-cases)** shows where IDEM fits in systems that run today, and where it does not.
- **[Concepts](/docs/concepts)** explains the ideas in order, with figures. Start here for the mechanism.
- **[Architecture](/docs/architecture)** shows the packages, the single forwarder engine and the flows.
- **[Protocol](/docs/protocol)** is the normative text, rendered from the repository's spec. Every rule has an id such as [P-2.1] that the tests cite.
- **[Security](/docs/security)** walks through the threat model and the rule behind each defence.
- **[API reference](/docs/api)** lists what each package exports.
- **[Using the sandbox](/docs/sandbox)** tells you what you are looking at when you open the [sandbox](/sandbox).
- **[Related work](/docs/related-work)** places IDEM among the work it builds on and states the one thing it claims.
- **[Evaluation](/docs/evaluation)** describes the experiments; **[Decisions](/docs/decisions)** and **[References](/docs/references)** record why things are the way they are and what they build on.
