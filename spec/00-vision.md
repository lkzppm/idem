# 00 — Vision

## 1. Problem

LLM agents use external tools (fetch a page, read a PDF, query an API) through the **Model Context
Protocol (MCP)**. In the **2026-07-28** revision MCP became *stateless*: every request is
self-contained and the protocol now behaves like an ordinary HTTP API [MCP-CHANGELOG]. The
communication model is still **a message from one address to another**.

Three gaps follow:

1. **Tool calls are not cacheable by the protocol.** The 2026-07-28 caching mechanism covers only
   `server/discover`, `tools/list`, `prompts/list`, `resources/list`, `resources/templates/list` and
   `resources/read`. `tools/call` is excluded [MCP-CACHE].
2. **No integrity or provenance in the data.** `cacheScope` is a label; the spec requires servers not
   to rely on it for access control [MCP-CACHE], and the SDK docs call it "a label, not a lock"
   [MCP-PY-CACHE]. A response served by an intermediary cannot be verified by its receiver.
3. **Measured waste in agent swarms.** In a GPT-5 swarm on BrowseComp, 32.6% of `web_fetch` and 43.1%
   of `pdf_read` calls repeated fetches already made in the same case, almost all from a *different*
   subagent [ARCTICSWARM].

## 2. Thesis

Content-centric networking (ICN/NDN) addresses exactly this class of problem: the consumer asks for
**named data**, every Data packet is **signed** and binds name to content, so it can be served from any
caching node, and identical requests are aggregated along the path [NDN-2014][SRM-NDN].

**IDEM applies that model to LLM tool calls:**

- read-only call → **name** = producer + tool + schema version + digest of canonicalized arguments;
- result → **signed Data** from the producer, with freshness and scope;
- forwarders (gateways) with a **PIT** (aggregation), **CS** (cache) and **FIB** (route by producer prefix);
- end-to-end verification by the consumer, independent of the path.

### Where it sits in the stack (ADR-010)

| Binding | Layer | Stack |
|---|---|---|
| HTTP overlay | application (L7) overlay, like HTTP caches/CDNs but with signed, named objects | MCP / IDEM → HTTP → TLS → TCP/QUIC → IP |
| Native NDN | names carried by NDN, which replaces IP at the network layer (L3) | IDEM naming → NDN → link/UDP tunnels |

"Transport" in this project means an MCP transport, never OSI layer 4.

## 3. Novelty and related work

Remote function invocation over ICN exists: RICE [RICE] extends the named-data model to remote method
invocation, following Named Function Networking and NFaaS. The NDN community also discusses
distributed AI and lists **caching of inference outputs** and **semantic caching** as open problems
[NDN-AI]. What is new in IDEM:

1. **LLM workload.** Arguments are model-generated (surface variation), so schema-driven,
   producer-declared canonicalization is part of the protocol.
2. **Producer-authorized cacheability.** A signed manifest declares what is cacheable, instead of
   trusting MCP tool annotations (`readOnlyHint` etc.), which the MCP spec says to treat as untrusted.
3. **Compatibility with real MCP.** The edge gateway exposes a plain MCP 2026-07-28 endpoint: existing
   agents benefit without code changes.
4. **Evaluation with agent-swarm traffic**, the workload where cross-consumer redundancy is highest.

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

## 7. Project success criterion

Working prototype in both bindings, experiments E1–E5 run with reproducible results, showcase and docs
deployed, report delivered. A hypothesis refuted with sound methodology is also a valid result and must
be reported as such.
