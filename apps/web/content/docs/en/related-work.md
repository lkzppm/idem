IDEM stands on other people's work, and most of what it does someone did first. This page says what each piece of that work does, in terms its authors would recognise, what it leaves open for tool calls, and which single claim IDEM makes. The short version is in the [last sections](#claim): no mechanism in IDEM is new, and the contribution is the combination.

The works fall into five groups. A [table](#comparison) then puts them side by side on the properties that separate them from IDEM. Every statement carries a key into the [references](/docs/references), and where a source was read only in part, its entry there says so.

## The ICN lineage {#icn}

**CCN and NDN** are where the model comes from. A consumer sends an Interest that names data; whoever has the data answers with a Data packet signed by its publisher; every node runs the same three tables: a FIB, a Content Store and a PIT that merges pending Interests for one name [CCN-2009][NDN-2014]. Security belongs to the data, not to the connection, so any node may serve a copy. IDEM's forwarder is that design, unchanged.

**Calling a function over ICN** has four well-known designs.

- **NFN** makes a name an expression: a function applied to data. The network decides where to compute it and caches the result as ordinary named content, so that the same expression asked again may be answered from a cache [NFN][NFN-ICN14].
- **NFaaS** moves the code. A function is a small virtual machine image that any node can download and run, and the result returns as Data [NFAAS].
- **RICE** is a general remote method invocation layer. It separates referentially transparent functions, named by the function and a hash of the inputs and therefore cacheable and aggregatable, from opaque ones, named with a unique component so that they are never shared. It refuses to carry arguments in the Interest and fetches them with a four-way handshake, and it answers long computations with a *thunk*: a name under which the result can be fetched later [RICE].
- **CFN** builds a distributed computing framework on RICE. A call returns a future that "is just the name of the data to be produced", so different callers of one program reuse a result. The program's components trust each other [CFN].

**Trust schemas** are the NDN answer to which key may sign which name: rules that relate data names to signer names, followed up to a trust anchor [TRUST-SCHEMA].

**Attacks on caches** were studied early. Content poisoning puts fake Data into router caches, and it works because verifying signatures is optional for routers [NDN-POISONING]. Cache privacy is the observation that a cache hit is faster than a miss, so a neighbour can learn what was requested recently; the proposed countermeasures are to mark private content and to delay or randomise answers to it [NDN-CACHE-PRIVACY].

**Matching by similarity** goes the other way from IDEM. Fuzzy Interest forwarding lets a router answer an Interest with Data whose name is only semantically close [FUZZY-FWD]. A talk at NDNComm 2026 on distributed AI (federated learning and split inference) adds embedding-based matching to the forwarder, and lists "Caching of inference outputs or model updates" and "Semantic-based caching" as future work. Its inference outputs are those of a split neural network, not the results of LLM tool calls [NDN-AI].

**The 2026 survey of NDN caching** covers where to place content and what to evict, for static content with Zipf-like demand. Computed results do not appear in it [NDN-CACHE-SURVEY].

*What this group leaves open for tool calls.* Who says that a call is cacheable: in RICE the caller decides by how it forms the name, in CFN the programmer decides with a decorator, and nobody signs the decision. What to do when two callers write the same arguments differently. A freshness period and a scope for results that are read-only but change over time. And a binding to MCP, which did not exist when these papers were written.

## Caches for tool results {#caches}

Caching the result of a tool call is not IDEM's idea, and it was published before IDEM.

- **ToolCaching** puts a cache server between the model and the tool APIs. The key is the tool name with a hash of an order-invariant serialization of the arguments. The model labels each request (informational or command, with a suggested lifetime), and rules on those labels decide what is cached. Its contribution is the admission and eviction policy. It calls itself "the first work to address caching for LLM tool-calling" and names multi-tenant and inter-agent caching as future work [TOOLCACHING].
- **TwinHash** gives every object of an agent workflow two hashes. The input-side key is a digest of a canonicalized descriptor of the request: task scope, tool name and version, regularized input, and the state epochs of the resources the call reads. The output-side fingerprint is a hash of the result bytes, kept to check what the cache serves and to store identical outputs once. Tools are admitted by profiling whether identical inputs give identical outputs, and sampled audits keep checking. Concurrent identical calls to an admitted tool wait for one execution. All of it lives inside one serving node; several nodes are a simulation in the discussion [TWINHASH].
- **TVCache** targets the post-training of agents, where parallel rollouts of the same prompt repeat tool calls. Because its tools have state, the key is the whole sequence of calls so far, matched by longest prefix, and one cache service is shared by the rollouts of a training job [TVCACHE].
- **Hierarchical caching** combines a cache of whole tool sequences with a cache of single calls, declares which data sources each tool reads and writes so that a write invalidates the reads it affects, and sets lifetimes per category of tool. Its evaluation is synthetic [HIER-CACHE].
- **A characterization of production agent workloads** measures recurrence in real traces and replays a two-tier exact-match cache over them. It says where such a cache belongs: "at the shared tool-serving boundary, where reuse can be aggregated across agents rather than hidden inside one session" [AGENTSYSBENCH].
- **ArcticSwarm's harness** contains a cache of fetched content shared by all the agents of one question, in one process [ARCTICSWARM].
- **Shipping middleware.** FastMCP caches inside the server, per access token [FASTMCP-CACHE]. The `mcp-proxy` crate caches at a proxy and can merge identical calls in flight, with the warning to enable that "only when sharing identical concurrent tool calls and resource reads is appropriate for the deployment" [MCP-PROXY]. The [Use cases](/docs/use-cases#gateways) page lists what the large gateways do.

Two neighbours cache something else. **Agentic plan caching** stores the plan of a task, not its tool results, and every step still runs [PLAN-CACHE]. **Workload-aware caching** stores the results of agent steps keyed by a task description [WA-CACHE]. Both tried approximate matching and both report that it costs accuracy: in the first, lowering the similarity threshold raised the hit rate from 46% to 64% and lowered accuracy from 85.50% to 77.00% on its benchmark; in the second, the semantic cache answered faster and scored lower than the exact one. One layer further up, **provider prompt caching** reuses the model's own state for a repeated prompt prefix. It is a different layer from IDEM's, and the study cited here treats tool results as dynamic content that gains little from it [PROMPT-CACHING].

Three measurements from this group set limits for any such cache, IDEM included.

- **A key made of the arguments alone is not safe for every tool.** In TwinHash's ablation, "an argument-only cache serves wrong bytes on 251 of 10,330 hits" [TWINHASH]. TVCache makes the same point for tools with hidden state [TVCACHE].
- **Sharing may add little.** In the one study that compared a shared cache with a per-user one, on a synthetic workload whose repetition rates the authors chose, sharing added between 0.5 and 0.9 percentage points [HIER-CACHE].
- **Live results drift.** When recorded calls to live MCP servers were run again, 33% of the 938 that completed returned an identical result and 67% something different, from 90% identical for developer tooling to 19% for science and health. The time between the two runs is not stated [DYNAMICMCPBENCH].

*What this group leaves open.* None of these caches lets the consumer check a copy it is served: the cache is trusted because it sits inside the same process, node or operator. Where the cache is apart from the tool, the decision about what is cacheable belongs to a model, to the cache or to its operator. None forwards over several hops, and the papers read do not consider an adversary on the path.

## Signing in MCP and signed caching on the web {#signing}

**MCPS** is an Internet-Draft that adds a security envelope to MCP. It signs every JSON-RPC message with the sender's key, optionally signs tool definitions so that a changed definition is detected, and protects against replay with a nonce and a timestamp: by default a message older than 300 seconds is rejected, with 60 seconds of tolerance for clock skew. A server's identity is bound to the origin the client connected to. It canonicalizes with JCS, the scheme IDEM uses. The draft does not discuss caches or intermediaries that store a message for someone else; replay is the attack it is built to stop [MCPS].

**Provider misbinding** is a measurement, not a mechanism. It shows that models select a tool by its name, description and schema, none of which identifies the provider, and it names "signed tool manifests, stable provider-bound tool identifiers, schema hashes, and client-side enforcement" as practical mechanisms, citing earlier signed-MCP designs [MISBINDING].

**Receipts and signed invocations.** One proposal signs each invocation inside the operator's pipeline before it runs and logs it for audit; the tool server signs nothing [MCP-MANIFEST-SIGNING]. The Acta draft signs a record of an access decision at a proxy and says of itself that it "does not attest that the action then executed, that it succeeded, or what it returned" [ACTA-RECEIPTS]. The XAIP draft has the agent that ran a tool sign a record with hashes of the input and of the output; the content itself is never included [XAIP-RECEIPTS]. These are evidence about a call. None is an answer that could be served.

**On the web**, the closest precedent is **Signed HTTP Exchanges**. A publisher signs a request URL and a response, with a `date` and an `expires` inside the signature, so that an intermediary may serve it and the browser treats it as coming from the origin. The window is at most seven days, no clock tolerance is specified, and only responses that a shared cache may store can be signed. The draft states the cost plainly: an attacker "can forward a signed response until its signature expires". It expired without being adopted by a working group [SXG]. **HTTP Message Signatures** let a response be signed together with components of its request, which binds an answer to its question; the standard leaves time windows and error codes to each application [RFC9421]. **HTTP caching** defines how age accumulates hop by hop in the `Age` header, and lets a cache "collapse requests", which is IDEM's PIT aggregation by another name [RFC9111].

*What this group leaves open.* In MCP, nobody has the producer of a tool sign the result, with its content, under a name derived from the call, so that a cache may hand it to a different consumer. On the web that exists for URLs and never became a standard.

## Agent networking {#agent-networking}

**The NDN community** has started to ask what agents need from the network. At NDNComm 2026, a panel on networking AI agents listed what agent networking can learn from NDN, beginning with "Naming: name agents, capabilities, tools, and results" (Chenguang Du). Dirk Kutscher argued that "Channel authentication is not artifact verification" and put "Caching / replication of signed artifacts" among the reasons ICN is relevant [NDNCOMM-PANEL]. These are positions on slides, not a protocol.

**AgentNet 2026**, a workshop at IEEE ICNP whose organizers come from that community, asks whether agent ecosystems need a new thin waist. Its call lists twenty topics, among them the provenance of agent outputs and the relation to ICN; caching is not one of them. The four papers in its programme are about discovery over DNS, signed evidence, the security of MCP servers and authorization [AGENTNET-2026]. We read two of them. The discovery paper shows that an agent's discovery metadata fits one DNS response and does not concern results [AGENTNET-DNS].

**Codexproof** is the other, and of the work from 2026 that we found it is the closest to IDEM. It turns each piece of evidence, tool result and answer into a small signed object with a hierarchical, NDN-style name, canonical JSON attributes, and typed links (W3C PROV relations) to the content ids of the objects it was derived from. A trust rule in the manner of NDN trust schemas ties data names to signer names. A gateway exposes it through MCP. The authors cite CCN and NDN as the source of the idea of securing the object instead of the channel, and they are exact about its limit: Codexproof "authenticates declared provenance, not truth" [CODEXPROOF].

The difference from IDEM is what gets a name. Codexproof names the *answer*: next to a name its producer chooses, its identifier is the hash of the result's own bytes. IDEM names the *question*, so a node can recognise a repeat before anyone has answered. Codexproof therefore has lineage, which IDEM lacks, and has no cache keyed by request, no merging of pending requests, no freshness period and no forwarding plane, which are what IDEM is made of. The two could be combined.

**MCP over Media over QUIC** is an Internet-Draft that carries MCP on a publish and subscribe transport with relays. Its relays merge subscriptions and cache tool schemas, resources and skill instructions. Tool calls are different: each one is forwarded to the origin, under a name that contains a session identifier. The security section reads "TODO", and the draft has expired [MCP-MOQ].

**The IETF** chartered a working group on agent communication protocols on 8 October 2026, to "define a common baseline agentic dialog management protocol" [AGENTPROTO-WG]. Neither the charter nor the documents that led to it list the caching of tool results, the merging of identical requests or integrity carried by the object as a problem or a requirement [IETF-AGENTS][AGENTPROTO-BOF][AGENTPROTO-USECASES]. IDEM is outside that scope. A reader may fairly conclude that the standards community has not made this problem a priority, and the answer has to come from workload evidence.

**A production MCP gateway** is described in a peer-reviewed paper from Alibaba Cloud. It adapts protocols, takes over authentication, recommends tools and routes sessions. It caches tool-search intents and session metadata, and does not cache or merge tool calls. The paper is clear about its trust model: the gateway is "a trust boundary that holds backend credentials on behalf of agents" [MCP-GATEWAY].

*What this group leaves open.* A concrete protocol for the two items on the panel's slides that IDEM takes up: naming tool calls and their results, and caching signed artifacts. The rest of that agenda (discovery, delegation, trust schemas for agents, lineage) IDEM does not address.

## Tool calls issued by code {#code}

In 2025 and 2026 the way agents issue tool calls changed. In Cloudflare's **Code Mode** the model writes a program against a generated API and the program runs in a sandbox [CODE-MODE]; a durable runtime records each call so that an execution can pause for approval and resume [CODE-MODE-DOCS]; a server-side variant runs the program at the MCP server [CODE-MODE-MCP]. Anthropic's **programmatic tool calling** does the same through its API, with the calling application performing each tool call [PTC], and a harness-side pattern reaches MCP servers from generated code [CODE-EXEC-MCP].

These designs are about tokens and model round trips, and that is where their authors report gains. They are not caches: the pages read describe no reuse of a result across executions, agents or users. They matter to IDEM for two reasons. They change the shape of the traffic, from one call per model turn to bursts, which is the workload behind hypothesis H6. And they move the model one step away from the tool result, since the model reads what the program prints. The [Use cases](/docs/use-cases#code) page follows a call through each design.

## Side by side {#comparison}

The columns are the properties that separate these works from IDEM. A cell holds what the source says; "not stated" means the source is silent. Works that are not caches (receipts, the working group) are left out.

| Work | Result cache shared across consumers | Served by intermediaries on the path | Identical calls merged in flight | Receiver can verify without trusting the cache | Who authorizes caching | Staleness bound |
|---|---|---|---|---|---|---|
| MCP 2026-07-28 caching [MCP-CACHE] | lists and resource reads only; `tools/call` is excluded | yes, for results marked `public` | not stated | no | the server, with an unsigned hint | `ttlMs` |
| NDN [NDN-2014][NDN-PACKET] | yes, any Data | yes | yes (PIT) | yes | any router may cache what it receives | a freshness period counted from arrival at each node |
| RICE [RICE] | yes, for transparent functions | yes | yes, for transparent functions | by NDN signatures; details left to future work | the caller, by how it forms the name | none: a transparent result does not expire |
| ToolCaching [TOOLCACHING] | the users of one application | no | not stated | no | rules on labels the model emits | a lifetime the model suggests |
| TwinHash [TWINHASH] | tasks and sessions of one node | no | yes, for admitted tools | no: a fingerprint kept by the cache itself | the cache, by profiling and audits | state epochs in the key; no TTL |
| TVCache [TVCACHE] | the rollouts of one training job | no | not stated | no | the developer, by annotation | same sandbox state; no TTL |
| Hierarchical caching [HIER-CACHE] | the paper states it both ways | no | no | no | the platform operator, per category | TTL per category, and invalidation on writes |
| Workload characterization [AGENTSYSBENCH] | yes, proposed across sessions; evaluated by replay | "at the shared tool-serving boundary" | not stated | not stated | not stated | one TTL |
| ArcticSwarm harness [ARCTICSWARM] | the agents of one question | no | not stated | no | the harness | none; the cache lasts for one question |
| FastMCP middleware [FASTMCP-CACHE] | one partition per access token; callers without a token share one | no: inside the server | no | no | the server's developer, by tool name; every tool by default | TTL, one hour by default |
| `mcp-proxy` [MCP-PROXY] | at the proxy; partition by caller not stated | yes, one proxy | yes, opt-in | no | the proxy's operator | TTL |
| MCPS [MCPS] | no cache | not stated | no | the message is verified by its recipient; not meant to be stored | not applicable | a timestamp window against replay |
| Signed HTTP Exchanges [SXG] | yes | yes | not stated | yes | the publisher, by signing | a signed window of at most seven days |
| HTTP caching [RFC9111] | yes | yes | yes ("collapse requests") | no | the origin | freshness lifetime against accumulated `Age` |
| Codexproof [CODEXPROOF] | no cache keyed by request | objects verify wherever they are stored | no | yes | no cacheability declaration | none per object; signed, expiring revocation lists |
| MCP over MoQ [MCP-MOQ] | schemas, resources and skills; tool results are not cached | yes, relays | for subscriptions, not tool calls | no | an unsigned hint in a catalog | "long TTLs" and invalidation |
| **IDEM** | yes for `public`; per authorization context for `private` | yes, every forwarder for `public` | yes (PIT) | yes | the producer, in a signed manifest | signed freshness capped by the manifest, and a signed lifetime [P-8.6] |

## What IDEM takes from each {#takes}

Some of this IDEM adopted knowingly. Some it arrived at separately and others had already published. In both cases the idea is theirs.

- **From CCN and NDN:** Interest and Data, the PIT, the Content Store and the FIB, and a signature that binds a name to its content [CCN-2009][NDN-2014].
- **From RICE and CFN:** naming a call by the function and a hash of its inputs, and the split between calls that may be shared and calls that may not [RICE][CFN]. IDEM moves that decision from the caller to the producer.
- **From ToolCaching and TwinHash:** nothing by inheritance, but the same key (a digest of canonicalized arguments, with the tool's version) and, in TwinHash, the same merging of concurrent calls [TOOLCACHING][TWINHASH].
- **From the tool-cache measurements:** the reason to cache only on the producer's word. A cache that keys on arguments alone and decides for itself serves wrong results [TWINHASH][TVCACHE].
- **From plan caching and workload-aware caching:** evidence for exact matching [PLAN-CACHE][WA-CACHE].
- **From the workload characterization:** where the cache goes, at the boundary that many agents share [AGENTSYSBENCH].
- **From MCP itself:** the vocabulary of a lifetime in milliseconds and a `public` or `private` scope, which MCP already has for lists and resource reads [MCP-CACHE].
- **From HTTP caching:** the `Age` arithmetic for freshness counted hop by hop, the apparent age that IDEM computes from a signed timestamp [P-8.6], and request collapsing as the precedent for aggregation [RFC9111].
- **From Signed HTTP Exchanges:** a validity window inside the signature, and the refusal of a signature dated in the future [SXG].
- **From MCPS and the NDN packet format:** the 60-second default for clock tolerance, which is MCPS's default clock skew and the grace period NDN recommends for signed Interests [MCPS][NDN-PACKET].
- **From trust schemas:** the rule that a key signs only under its own producer's prefix. IDEM uses one fixed rule and a manifest, not a schema language [TRUST-SCHEMA].
- **From the NDN security literature:** verify before caching, because a cache that does not verify can be poisoned [NDN-POISONING], and let the producer mark what is private [NDN-CACHE-PRIVACY].
- **From Codexproof:** the sentence every signed-data design owes its readers. A signature authenticates who said something, not whether it is true [CODEXPROOF].

## What IDEM claims {#claim}

> No single mechanism in IDEM is new. Its contribution is their combination into one protocol for tool calls, and its measurement: a call is named by its request, so a repeat is recognised before anyone answers; the result is signed by its producer with a scope and a bounded lifetime, so a cache the receiver does not trust may serve it; the producer, not an annotation or a gateway operator, authorizes caching; and the same objects run over an MCP-compatible HTTP overlay and over native NDN.

After the reading recorded on this page we found no work that combines those properties. That is the absence of a finding, not a proof. IDEM is not the first cache of tool results, not the first to merge identical calls in flight, and not the first to sign MCP messages. What its signature gives is **origin authenticity**: proof of which producer returned a result. It gives no lineage and no guarantee that the result is right.

Whether the combination is worth its cost is an empirical question, and the [Evaluation](/docs/evaluation) page says how it is tested. The comparison that matters most is against a shared cache without signatures, which is what a gateway could deploy today; that baseline is being added to the experiments.

## What stays open {#open}

- **Semantic matching.** IDEM matches exactly, after canonicalization that the producer declares. The work on matching by similarity, in NDN and in agent caches, reports wrong or irrelevant answers as its price [FUZZY-FWD][PLAN-CACHE][WA-CACHE]. Our reading: equivalence that a producer declares may be a way forward, and similarity that a forwarder infers is what the evidence argues against. Question Q4 in the [decisions](/docs/decisions).
- **Encrypted private content.** CCN's answer for private content is encryption, with the keys distributed as named data, so that any node may hold the ciphertext [CCN-2009]. IDEM version 1 keeps `private` results out of shared caches instead, and the edge that stores one can read it. Question Q2.
- **The timing side channel.** A cache hit is faster than a miss, and that tells an observer that someone asked before [NDN-CACHE-PRIVACY]. IDEM's names make the probe easy, since a name is a function of the tool and its arguments. No mitigation is in version 1. Question Q3.
- **Real traces.** The authors of ToolCaching built a synthetic workload and gave the reason: "Due to the lack of publicly available datasets that accurately reflect real-world LLM tool-calling workload patterns" [TOOLCACHING]. The paper with the production measurement of recurrence does not say that its traces will be released [AGENTSYSBENCH]. One benchmark does release recorded MCP tool calls with their arguments, from single agents [DYNAMICMCPBENCH]. We know of no public trace, under a clear licence, of several agents cooperating on one task with arguments and timestamps. IDEM's main experiment runs on a synthetic workload for that reason, and says so.
- **Invalidation before a lifetime ends.** IDEM has time and nothing else. TwinHash changes the key when a resource changes [TWINHASH], hierarchical caching invalidates on writes [HIER-CACHE], and Codexproof has revocation lists [CODEXPROOF].
- **Long-running tools.** RICE's thunks have no counterpart in IDEM [RICE].
- **Whether sharing pays.** One synthetic study found little gain from sharing a cache across users [HIER-CACHE], and one production trace found heavy recurrence across sessions [AGENTSYSBENCH]. Which of the two a given deployment resembles is the question the [Use cases](/docs/use-cases) page asks of each scenario.
