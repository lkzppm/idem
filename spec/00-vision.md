# 00 — Vision

## 1. Problem

LLM agents use external tools (fetch a page, read a PDF, query an API) through the **Model Context
Protocol (MCP)**. In the **2026-07-28** revision MCP became *stateless*: every request is
self-contained and the protocol now behaves like an ordinary HTTP API [MCP-CHANGELOG]. The
communication model is still **a message from one address to another**.

Three gaps follow:

1. **Tool calls are not cacheable by the protocol.** The 2026-07-28 caching mechanism covers only
   `server/discover`, `tools/list`, `prompts/list`, `resources/list`, `resources/templates/list` and
   `resources/read`. `tools/call` is excluded [MCP-CACHE]. The proposal that introduced the
   mechanism never discusses `tools/call` and gives no reason for leaving it out [MCP-SEP-2549]. The
   MCP roadmap states the intent to extend caching with ETags, "in particular tool calls"
   [MCP-ROADMAP]; we found no proposal text for it.
2. **No integrity or origin authenticity in the data.** `cacheScope` is a label; the spec requires
   servers not to rely on it for access control [MCP-CACHE], and the SDK docs call it "a label, not a
   lock" [MCP-PY-CACHE]. A response served by an intermediary cannot be verified by its receiver.
3. **Measured repetition that a per-agent cache cannot see.** Two measurements exist, and each has a
   limit.
   - *Inside one task.* In a GPT-5 research swarm on 120 BrowseComp questions, 2,221 of 6,803
     `web_fetch` calls (32.6%) and 286 of 664 `pdf_read` calls (43.1%) asked for a key (normalized
     URL and page range) already requested earlier in the same question. The calls whose earlier
     request came from a *different* subagent were 30.7% of all `web_fetch` calls and 27.6% of all
     `pdf_read` calls, so about a third of the `pdf_read` repeats were an agent repeating itself.
     Free-text searches did not converge: 83 of 20,017 `web_search` calls (0.4%) were duplicates
     [ARCTICSWARM]. The table is in version 1 of the paper only; version 2 removed it and kept the
     shared cache it motivated.
   - *Across sessions.* In 24-hour production traces, 27% of the distinct queries of an
     agentic-search application recur and account for 67.3% of its 373,678 search calls, and in
     another application 24% of the distinct URLs recur and account for 64% of 4,389 web fetches.
     This is recurrence across sessions within a day, not overlap inside a task. Replayed over the
     same traces, an exact-match cache with a 10-minute TTL removes 35.2% of the *redundant* search
     calls, which is 19.3% of the aggregate search latency [AGENTSYSBENCH]: a time bound keeps much
     less than the raw recurrence suggests. The authors call for caching "at the shared tool-serving
     boundary".

   Both measure calls whose argument is a URL or a recurring query string. Neither measures identical
   calls that are in flight at the same moment.

## 2. Thesis

Content-centric networking (ICN/NDN) addresses exactly this class of problem: the consumer asks for
**named data**, every Data packet is **signed** and binds name to content, so it can be served from any
caching node, and identical requests are aggregated along the path [NDN-2014][SRM-NDN].

**IDEM applies that model to LLM tool calls:**

- read-only call → **name** = producer + tool + schema version + digest of canonicalized arguments;
- result → **signed Data** from the producer, with freshness and scope;
- forwarders (gateways) with a **PIT** (aggregation), **CS** (cache) and **FIB** (route by producer prefix);
- end-to-end verification by the consumer, independent of the path.

The thesis in one line, "if the question is the same, the answer is the same", holds only for the
period the producer is willing to sign. When recorded calls to live MCP servers were executed again,
of the 938 that completed 33% returned an identical result and 67% returned something different
(developer tooling: 90% identical; science and health: 19%); the paper does not say how much time
separated the two executions [DYNAMICMCPBENCH]. Freshness is therefore declared per tool by the
producer, and a Data's life is bounded by its signed timestamp (`01-protocol.md` §8).

### Where it sits in the stack (ADR-010)

| Binding | Layer | Stack |
|---|---|---|
| HTTP overlay | application (L7) overlay, like HTTP caches/CDNs but with signed, named objects | MCP / IDEM → HTTP → TLS → TCP/QUIC → IP |
| Native NDN | names carried by NDN, which replaces IP at the network layer (L3) | IDEM naming → NDN → link/UDP tunnels |

"Transport" in this project means an MCP transport, never OSI layer 4.

## 3. Novelty and related work

Five groups of work surround IDEM. Each entry says what the work does and what it leaves open for
tool calls. The docs page "Related work" has the longer version and a comparison table.

**The ICN lineage.** CCN and NDN define the model IDEM uses: Interest and Data, a signature on every
Data, and a forwarder with a PIT, a Content Store and a FIB [CCN-2009][NDN-2014]. Invocation over ICN
followed. NFN names an expression and lets the network decide where to compute it, caching computed
results as named content [NFN][NFN-ICN14]. NFaaS moves function code so that any node can execute it
[NFAAS]. RICE separates referentially transparent calls, named by the function and a hash of the
inputs and therefore cacheable and aggregatable, from opaque ones; it keeps arguments out of the
Interest with a handshake and adds thunks so that a long computation outlives PIT state [RICE]. CFN
names a result by its invocation so that different callers of one mutually trusted program reuse it
[CFN]. Trust schemas relate data names to the keys allowed to sign them [TRUST-SCHEMA]. The security
literature documents what such a cache faces: content poisoning when routers do not verify
[NDN-POISONING], and cache hits observable by timing [NDN-CACHE-PRIVACY]. Fuzzy Interest forwarding
matches names that are only similar [FUZZY-FWD], and a 2026 NDNComm talk on distributed AI (federated
learning, split inference) lists "Caching of inference outputs or model updates" and "Semantic-based
caching" as future work; its inference outputs are those of split DNN inference, not LLM tool results
[NDN-AI]. The 2026 survey of NDN caching covers placement and replacement of static content and does
not treat computed results [NDN-CACHE-SURVEY]. *Left open:* who authorizes a call as cacheable (in
RICE and CFN the caller decides, and nobody signs it), arguments that mean the same and are written
differently, a freshness period and a scope for results that change, and a binding to MCP.

**Caches for tool results.** ToolCaching puts a cache server between the model and the tool APIs,
keyed by the tool name and a hash of an order-invariant serialization of the arguments; the model
labels each request and proposes its TTL, and rules on those labels decide what is cached
[TOOLCACHING]. TwinHash keys a tool call by a digest of its canonicalized descriptor (scope, tool
name and version, input, state epochs), keeps a fingerprint of the output, admits tools by profiling
their determinism, and makes concurrent identical calls wait for one execution, inside one serving
node [TWINHASH]. TVCache shares one cache service across the parallel rollouts of agent post-training
[TVCACHE]. A hierarchical design adds write-triggered invalidation and per-category TTLs
[HIER-CACHE]. A characterization of production agent workloads proposes, and replays, a cache "at the
shared tool-serving boundary" [AGENTSYSBENCH], and the swarm harness that measured the duplicates
contains a per-question cache shared by its agents [ARCTICSWARM]. Shipping middleware caches
`tools/call` as an add-on: inside the server, per access token and for every tool by default
[FASTMCP-CACHE], or at a proxy, by configuration, where one implementation also coalesces identical
calls in flight [MCP-PROXY]. Two neighbours cache plans or agent steps instead of tool results, and
both report that fuzzy matching costs accuracy [PLAN-CACHE][WA-CACHE]. *Left open:* none of these
lets a consumer check a served copy; where the cache sits apart from the tool, a model, the cache
itself or its operator decides what is cacheable; and each lives inside one process, node or product.

**Signing in MCP, and signed caching on the web.** MCPS signs every MCP message and, optionally, tool
definitions; each message carries a nonce and a timestamp, and a repeated nonce or a timestamp
outside the window is rejected, so replay is the attack it exists to stop [MCPS]. A measurement of
provider misbinding shows that a tool name does not identify its provider, and names signed tool
manifests among the practical mechanisms [MISBINDING]. Other proposals sign the invocation inside the
operator's pipeline [MCP-MANIFEST-SIGNING], an access decision at a proxy [ACTA-RECEIPTS], or a
record holding hashes of a call's input and output [XAIP-RECEIPTS]. On the web, Signed HTTP Exchanges
let a publisher sign a response with its validity window so that any intermediary may serve it [SXG];
HTTP Message Signatures can bind a response to its request [RFC9421]; HTTP caching defines the `Age`
arithmetic and the collapsing of identical requests [RFC9111]. *Left open:* none has the producer of
a tool sign the result, with its content, under a name derived from the call, so that a cache may
hand it to another consumer.

**Agent networking.** The NDNComm 2026 panel on networking AI agents put the direction in two slides:
"name agents, capabilities, tools, and results" (Du); "Channel authentication is not artifact
verification", with "Caching / replication of signed artifacts" among the reasons ICN is relevant
(Kutscher) [NDNCOMM-PANEL]. The AgentNet 2026 workshop at IEEE ICNP, whose organizers come from the
NDN community, lists the provenance of agent outputs and the relation to ICN among its topics and
does not list caching [AGENTNET-2026]. Of its papers the closest to IDEM, Codexproof, signs each tool
result as a content-addressed object with a hierarchical name and typed links to what it was derived
from, with NDN as its stated ancestor; it names the answer, not the request, and has no notion of the
same call asked twice [CODEXPROOF]. An Internet-Draft maps MCP onto Media over QUIC, whose relays
cache tool schemas and resources and forward every tool call to the origin; its security section is
"TODO" and the draft has expired [MCP-MOQ]. The IETF chartered a working group on agent protocols on
8 Oct. 2026 for "agentic dialog management" [AGENTPROTO-WG]; its charter and the documents that led
to it do not list caching of results, aggregation of requests or object-level integrity
[IETF-AGENTS][AGENTPROTO-BOF][AGENTPROTO-USECASES]. A production MCP gateway at cloud scale caches
tool-search intents and session metadata, not results, and describes itself as "a trust boundary that
holds backend credentials" [MCP-GATEWAY]. *Left open:* a concrete protocol for the items the panel
names. IDEM is outside the working group's scope, which is a risk to its relevance there and is
stated as such.

**Tool calls issued by code.** In Code Mode and in programmatic tool calling the model writes a
program that runs in a sandbox, and each tool call the program makes leaves the sandbox to be
performed outside it: by the agent runtime that holds the credentials, or by the application that
called the model API [CODE-MODE][CODE-MODE-DOCS][PTC][CODE-EXEC-MCP]. These designs reduce tokens and
model round trips. *Left open:* the pages read describe no reuse of a tool result across executions,
agents or users.

### The claim

No single mechanism in IDEM is new. Its contribution is their combination into one protocol for tool
calls, and its measurement: a call is named by its request, so a repeat is recognised before anyone
answers; the result is signed by its producer with a scope and a bounded lifetime, so a cache the
receiver does not trust may serve it; the producer, not an annotation or a gateway operator,
authorizes caching; and the same objects run over an MCP-compatible HTTP overlay and over native NDN.

What the combination consists of, with what is taken from others:

1. **A name derived from the request.** A digest of canonicalized arguments is a known cache key
   inside one process or node [TOOLCACHING][TWINHASH], and RICE names a transparent call by a hash of
   its inputs [RICE]. In IDEM the digest is one component of a routable name that also carries the
   producer and the schema version. Arguments are model-generated (surface variation), so
   canonicalization is schema-driven, declared by the producer and specified normatively: every node
   computes the same name.
2. **Producer-authorized cacheability.** A signed manifest declares what is cacheable, with its TTL
   and scope. MCP tells clients to treat tool annotations (`readOnlyHint` etc.) as untrusted
   [MCP-TOOLS]; elsewhere the decision is taken by a model [TOOLCACHING], by the cache [TWINHASH], by
   the operator of the cache [HIER-CACHE][MCP-PROXY] or by the caller [RICE][CFN].
3. **A result that an untrusted cache may serve.** Signed Data is NDN's [NDN-2014]; a signed validity
   window is also how Signed HTTP Exchanges work [SXG]. IDEM applies both to tool results and adds a
   signed scope, with a Content Store and a PIT partitioned by authorization context for `private`.
4. **PIT, CS and FIB over several hops, in two bindings.** The edge exposes a plain MCP 2026-07-28
   endpoint, so existing agents benefit without code changes, and the same names and Data run over
   native NDN.
5. **An evaluation against what people deploy:** direct MCP, a cache inside each agent, and a shared
   unsigned cache at the gateway, on swarm and code-burst workloads, plus an adversarial suite
   (`05-evaluation.md`).

What IDEM does not claim. It is not the first cache of tool results, the first to coalesce identical
calls, or the first to sign MCP messages. Its signature gives **origin authenticity**: it proves
which producer returned a result. It does not prove that the result is true, which Codexproof says of
its own signatures as well [CODEXPROOF], and it records no lineage. A wrong answer signed by its
producer is served as faithfully as a right one until its lifetime ends.

## 4. Goals

- G1. Specify the IDEM v1 protocol (names, envelope, manifest, forwarder behavior).
- G2. Implement a reusable TypeScript library (`@idem/*`) with two bindings: **HTTP overlay** (over
  MCP) and **native NDN** (NDNts).
- G3. Measure gains and costs against realistic baselines (see `05-evaluation.md`).
- G4. Ship an interactive showcase (sandbox) and the library docs on Vercel.
- G5. Deliver the academic report in the course format.

## 5. Non-goals (v1)

- Caching tools with side effects (send email, write a file). They pass through.
- **Semantic** matching of similar requests (embeddings). Exact match after canonicalization only.
  Future work (Q4 in `07-decisions.md`).
- Encrypting `private` content for shared caches (Q2). In v1, `private` is only cached in a CS
  partitioned by authorization context.
- Replacing MCP. IDEM is a layer underneath/alongside it.
- Caching model outputs or prompts, or saving tokens. That is the job of provider prompt caching
  [PROMPT-CACHING] and of code-driven tool calling [CODE-MODE][PTC]. IDEM acts below the model, on
  the tool-call path.
- Lineage of derived results (what an answer was computed from), which is Codexproof's subject
  [CODEXPROOF]. An IDEM Data stands alone.
- Long-running or asynchronous tools in the native binding. One call is one Interest and one Data;
  RICE's thunks are the published mechanism for the general case [RICE].
- Discovery, delegation and authorization of agents, the wider agenda of the IETF working group and
  of the NDN panel [AGENTPROTO-WG][NDNCOMM-PANEL].

## 6. Hypotheses

Stated to be **falsifiable**. No number is promised before the experiment runs.

- **H1 (redundancy).** On swarm workloads with cross-subagent overlap, IDEM reduces calls reaching the
  producer compared with direct MCP and with a per-agent local cache.
- **H2 (latency).** p50 and p95 latency per call drop when there is a CS hit or PIT aggregation, and the
  extra cost on a miss (canonicalize, sign, verify) is small relative to the RTT to the producer.
- **H3 (safety).** No tampered response is accepted and no `private` result is served to another
  context (0 occurrences in E5).
- **H4 (network).** Under loss and multi-hop topologies, on-path caching reduces bytes on the
  producer's link and recovery time, compared with end-to-end TCP/HTTP.
- **H5 (what the protocol adds to a shared cache).** Against a shared exact-match cache at the gateway
  with no signatures, no producer-declared canonicalization and no in-flight aggregation (B5):
  (a) IDEM sends fewer calls upstream when arguments vary in surface form or identical calls are in
  flight at the same time, and the same number when neither happens; (b) a result altered at the cache
  or on the path to it is accepted by B5's consumers and rejected by IDEM's.
- **H6 (code-driven bursts).** When agents issue their calls from code in bursts instead of one per
  model turn (W-code), the share of cacheable requests absorbed by PIT aggregation grows with the
  burst size and with how closely the agents' starts coincide, and IDEM's upstream reduction over B5
  grows with it.

## 7. Project success criterion

Working prototype in both bindings, experiments E1–E5 run with reproducible results, showcase and docs
deployed, report delivered. A hypothesis refuted with sound methodology is also a valid result and must
be reported as such.
