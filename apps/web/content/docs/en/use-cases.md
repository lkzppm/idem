This page places IDEM in systems that run today, in late 2026. Each scenario has the same five parts: what people run **today**, **what repeats**, **where IDEM sits**, **what it gives** (mechanism by mechanism, and only the mechanisms that apply), and **what it does not solve**.

Every statement about the outside world carries a reference key. The scenarios do not rest on equally strong evidence, so each one says which kind it has: *measured* (someone counted the repeated calls), *documented practice* (people describe running the system, and nobody counted the repeats) or *by analogy* (the argument comes from how NDN behaves, with no present-day report behind it). The page states no result of IDEM's own experiments. Those are on the [benchmarks](/benchmarks) page, and the [last table](#experiments) says which experiment stands for which scenario.

## Research swarms {#research-swarms}

*Evidence: measured.*

**Today.** A lead agent splits a question and hands the parts to subagents that search and read in parallel. Anthropic describes its research system this way: the lead agent "spins up 3-5 subagents in parallel" and the subagents "use 3+ tools in parallel" [ANTHROPIC-RESEARCH]. ArcticSwarm, a research system described in a 2026 preprint, runs up to 16 subagents on one question [ARCTICSWARM].

**What repeats.** Subagents that work on the same question end up on the same pages. One published table counts it, for a GPT-5 swarm on 120 BrowseComp questions [ARCTICSWARM]:

| Tool | Calls | Repeats of a call made earlier in the same question | Of all calls: repeats of *another* subagent's call |
|---|---|---|---|
| `web_fetch` | 6,803 | 2,221 (32.6%) | 30.7% |
| `pdf_read` | 664 | 286 (43.1%) | 27.6% |
| `web_search` | 20,017 | 83 (0.4%) | not reported |

A call counts as a repeat when its key was already requested in the same question: the normalized URL and page range for the two fetch tools, the normalized query for search. Fetches converge and free-text searches do not. For `pdf_read`, about a third of the repeats are an agent repeating itself, which a cache inside the agent would catch; the rest come from another subagent, and a cache inside each agent cannot see them. The table exists in version 1 of the paper only. Version 2 removed it and kept the mechanism it motivated: a cache shared by all the agents of one question, keyed by the normalized URL.

Anthropic reports the same effect without a rate: with vague task descriptions, subagents "performed the exact same searches as other agents", which the team treated as a prompting defect and fixed with better instructions [ANTHROPIC-RESEARCH].

Across sessions the second measurement applies. In 24-hour production traces, 27% of the distinct queries of an agentic-search application recur and account for 67.3% of its 373,678 search calls, and in another application 24% of the distinct URLs recur and account for 64% of 4,389 web fetches [AGENTSYSBENCH]. That is recurrence across users and sessions within a day, not overlap inside one task.

::figure[swarm] The case the swarm measurement describes: several subagents ask for the same page. One Interest goes upstream and every subagent receives the same signed Data.

**Where IDEM sits.** The producer is the service that runs the fetch or the PDF reader, because whoever runs the tool signs. The forwarder is the edge at the swarm's MCP endpoint: inside the harness, or a gateway the organisation already runs. The subagents change nothing but the URL of their MCP server, since the edge is a plain MCP endpoint.

**What it gives.**

| Mechanism | In this scenario |
|---|---|
| Content Store | a second subagent that asks for a page inside its freshness period is answered at the edge, and the producer is not asked |
| PIT aggregation | subagents that ask for the same page at the same moment share one upstream request. Neither measurement above counts calls that overlap in time, so how often this happens in a real swarm is not known |
| Canonicalization | ArcticSwarm normalizes URLs in its own code. In IDEM the producer declares the normalizations, and every node applies the same ones |
| Signature | it matters once the cache is outside the swarm's own process: shared by several swarms, teams or organisations. Inside one process there is nobody to distrust |

**What it does not solve.** Free-text searches do not coincide, and exact matching does nothing for them. A cache inside the harness already collects the repeats of one question, so IDEM adds something only where the cache is shared beyond one process or one trust domain. And a freshness period keeps much less than the raw recurrence suggests: replayed over the production traces, an exact-match cache with a 10-minute TTL removes 35.2% of the *redundant* search calls, which is 19.3% of the aggregate search latency [AGENTSYSBENCH].

## Tool calls issued by code {#code}

*Evidence: the mechanism is documented; nobody has measured repetition.*

**Today.** Instead of asking the model for one tool call per turn, the host asks it for a program, and the program makes the calls. Cloudflare's Code Mode converts MCP tools into a TypeScript API and runs the model's code in a sandbox with no access to the Internet; each call goes back to the agent's supervisor, "which holds the access tokens and adds them into requests sent on to MCP" [CODE-MODE]. In Anthropic's programmatic tool calling, Claude writes Python that calls tools as functions; when a function is called, "code execution pauses and the API returns a `tool_use` block", the calling application supplies the result, and several calls can run in parallel [PTC]. A third pattern presents each tool as a file whose body calls the harness's MCP client [CODE-EXEC-MCP]. There is also a server-side variant, in which the MCP server exposes two tools, `search()` and `execute()`, and runs the code itself [CODE-MODE-MCP].

**What repeats.** Nobody has measured it: none of these pages reports how often tool calls repeat. What they document is a shape. Calls leave a program in loops and fan-outs ("checking 50 endpoints or looking up 20 records" [PTC]), so they arrive close together instead of one per model turn. Our reading of that shape, which is not a measurement, cuts both ways. Code builds arguments mechanically, so two programs that ask for the same thing tend to spell it the same way. But the usual fan-out is one call per entity, which gives distinct names inside one program. If calls repeat here, they repeat across agents and sessions that run similar code.

**Where IDEM sits.** In every client-side design the tool call is not performed inside the sandbox. It leaves the sandbox and is performed by a component outside: the runtime's connector, which wraps the MCP server [CODE-MODE-DOCS], the application that answers the `tool_use` block [PTC], or the harness's MCP client [CODE-EXEC-MCP]. That component is where an IDEM consumer goes, and pointing it at an IDEM edge changes one URL. The prompt, the generated code and the model are untouched.

The server-side variant is different. The agent's visible call is `execute` with a program as its argument, and a program is not a question with one answer. IDEM can sit only behind that server, on the calls it makes to the servers underneath, and only whoever operates it can put it there.

**What it gives.**

| Mechanism | In this scenario |
|---|---|
| PIT aggregation | bursts from several agents overlap in time more than calls spaced by model turns do. Whether that makes aggregation matter is hypothesis H6, under test |
| Content Store | reuse across sessions and agents that run similar code |
| Signature | the result is verified by the consumer outside the sandbox, before the program receives it |

**What it does not solve.**

- **The signature covers what the tool returned, not what the model reads.** The program filters and reshapes results before the model sees anything: "Tool results from programmatic calls are not added to Claude's context: Only the final code output is" [PTC]; "The agent sees five rows instead of 10,000" [CODE-EXEC-MCP]. IDEM vouches for the input of the program.
- **IDEM saves no tokens.** The savings these pages report come from keeping tool definitions and intermediate results out of the model's context. IDEM acts on the path between the consumer and the tool and leaves the context as it was.
- **Canonicalization matters less.** Arguments written by code vary less than arguments written by a model. Free-form arguments such as a SQL string are not normalized by canonicalization.
- **A waiting call is still inside the sandbox's deadline.** In Anthropic's design a pending call "times out after about 4 minutes" [PTC].
- **Replay inside a runtime never reaches IDEM.** Code Mode's durable runtime stores a call's result and returns the recorded value on later passes of the same execution [CODE-MODE-DOCS]. Such a call is not asked again, so no freshness period applies to it.

## Documentation servers for coding agents {#docs-servers}

*Evidence: documented practice; nobody has measured repetition.*

**Today.** Coding agents read library documentation, and the companies that host documentation report it from their own traffic. Mintlify wrote in April 2026 that "AI coding agents now account for 45.3% of all requests", and in July that agents account for 66% of the measured web traffic on the docs it hosts, where its hosted MCP servers "handled 1.42 million tool calls" in the month so far [MINTLIFY-AGENTS][MINTLIFY-MIDYEAR]. Fern reports that agents made up 60.6% of requests across its sites in September 2026 [FERN-DOCS]. Context7 serves library documentation to agents through MCP tools, counts each call against a quota, answers `429` beyond its rate limits, and advises its users to cache: "Documentation updates are relatively infrequent, so caching responses for several hours or days reduces API calls and improves performance" [CONTEXT7-API].

**What repeats.** No source measures how often different agents ask for the same page or the same query. The expectation is an argument, not a count: the documentation of a released version is the same for everyone who asks, and the provider itself says it changes rarely. A cache inside one agent serves that agent only, and the server cannot tell one session from another: MCP clients "do not expose a persistent conversation identifier to remote docs servers", so "calls arrive as stateless requests" [MINTLIFY-MIDYEAR].

**Where IDEM sits.** The documentation server is the producer: it signs each page and each search result, and its manifest declares those tools cacheable, public, with the lifetime it accepts. The forwarder is a team's gateway, the egress of a CI runner pool, or the provider's own edge. Agents change the URL of the documentation server, or nothing if the gateway is already where they connect.

**What it gives.**

| Mechanism | In this scenario |
|---|---|
| Content Store | a page of a released version is fetched from the producer once per freshness period at each forwarder. The provider's advice to cache for hours or days becomes a lifetime it signs instead of a line in a guide |
| PIT aggregation | CI jobs that start together and ask for the same pages share one request. This is reasoning, not a measurement |
| Signature | an agent acts on what the documentation says: it installs, configures and writes code. A cache that could alter a page is a place to attack. With a signed page the cache cannot change it unnoticed |
| Signed manifest | the provider, not the team that runs the cache, decides which tools are cacheable and for how long |

**What it does not solve.** More than half of the MCP calls Mintlify counted were searches (56.57%) [MINTLIFY-MIDYEAR], and a free-text query matches another only when the two are identical after canonicalization. Documentation behind a login is `private`: it is reused by the same user and shared with nobody. And the provider has to sign. Until it does, the only route is a proxy-producer that signs in its own name ([protocol §9.1](/docs/protocol#s9-1)), which carries its operator's word and not the provider's.

## Enterprise MCP gateways {#gateways}

*Evidence: documented practice.*

**Today.** Companies put a gateway between their agents and their internal tools. PayPal's "handled more than 3.6 million MCP tool calls" in a month, with "close to 200 active MCP servers and 3,318 callable tools" behind it [PAYPAL-MCP]. Cloudflare runs MCP servers in front of public resources and in front of "private corporate resources", managed by one central team [CF-ENTERPRISE-MCP]. Sierra reports that 89% of its employees use its gateway to connect agents to 45 services [SIERRA-MCP]. Alibaba Cloud describes its production MCP gateway in a peer-reviewed paper [MCP-GATEWAY].

None of these reports caching tool results. The Alibaba gateway caches session metadata and tool-search intents, not results [MCP-GATEWAY]. The MCP documentation of Kong, LiteLLM, Agent Router and agentgateway describes routing, authentication, access control and rate limiting; we found no cache of `tools/call` results in it [KONG-MCP][LITELLM-MCP][AGENT-ROUTER-MCP][AGENTGATEWAY]. Cloudflare's AI Gateway caches the responses of model providers [CF-AIGW-CACHE]. One vendor's guide is explicit: "Avoid caching tools/call, as that is a function call with side effects" [GRAVITEE-MCP].

Where tool results are cached today, the cache is an add-on that the caller has to trust. FastMCP's middleware caches inside the server, partitioned by access token, and once installed it caches every tool for an hour by default [FASTMCP-CACHE]. The `mcp-proxy` crate caches at a proxy with a configured TTL and can merge identical calls in flight [MCP-PROXY]. A ContextForge plugin records a cache hit for the tools its configuration lists, but, in its own words, "Cannot short-circuit tool execution" [CONTEXTFORGE-CACHE].

**What repeats.** Nobody reports it. The write-ups stress the opposite property: "Users, agents, and external clients can share a route without sharing the same permissions" [PAYPAL-MCP]. Most results behind such a gateway depend on who asks. What could be shared is whatever is the same for every employee, and no source says how large that part is.

**Where IDEM sits.** The gateway is the edge forwarder, and agents already connect to it. The internal MCP servers are the producers. Either they sign their results, or the operator puts a proxy-producer in front of them ([protocol §9.1](/docs/protocol#s9-1)): it signs under its own name with its own key, so every Data says who signed it, the cache policy is the operator's, and trust moves to the proxy.

::figure[scope] What the gateway's Content Store looks like with both kinds of tool: one shared entry for a public result, one partition per authorization context for private ones.

**What it gives.**

| Mechanism | In this scenario |
|---|---|
| Signed scope | the producer declares each tool `public` or `private`, and the scope is signed inside each result. A `private` result is stored only at the edge, in a partition keyed by an authorization context that the edge derives from the credential and never accepts from the request [P-8.3][P-8.4] |
| Signed manifest | the operator does not guess which tools are read-only. The advice to avoid caching `tools/call` exists because a gateway has no reliable signal; the manifest is that signal, from the party that knows |
| Content Store | one entry serves every employee for a `public` tool, and each user's own repeats for a `private` one |
| Signature | a gateway is, in the words of the Alibaba paper, "a trust boundary that holds backend credentials" [MCP-GATEWAY]. When producers sign, a consumer that verifies does not depend on the gateway's cache for integrity |

A security advisory shows what the scope rules are for. Kong's caching plugins, which cache HTTP and model responses and not tool results, could "cache a response to a request that carried an `Authorization` or `Proxy-Authorization` header, and later serve that response to a caller that sends no credentials" [KONG-CVE]. In IDEM that is the case the partition is written against, and the rule has a test that may not be removed.

**What it does not solve.** If most calls are per-user, a shared cache has little to share, and what remains is reuse by the same user and verification. A `private` result is not encrypted: the edge that stores it can read it. A fast answer still reveals that someone asked the same question before. Tools with side effects pass through untouched. And behind a proxy-producer the signature is the proxy's, so the consumer trusts the gateway's operator as it does today.

## Metered and rate-limited tool APIs {#metered}

*Evidence: the billing model is documented; nothing else is.*

**Today.** Search and fetch services sold to agents charge by the call. Tavily: "Each request costs 1 API credit" for a basic search [TAVILY-CREDITS]. Firecrawl: "Every API call that you make consumes credits" [FIRECRAWL-BILLING]. Anthropic's web search tool: "Each web search counts as one use", charged on top of tokens [ANTHROPIC-WEB-SEARCH]. Context7 stops answering a free account when its monthly calls are used up [CONTEXT7-API].

**What repeats.** These pages say nothing about repetition. The evidence is the production trace of the [first scenario](#research-swarms): 67.3% of the search calls of one application came from queries that recur within a day [AGENTSYSBENCH].

**Where IDEM sits.** The provider is the producer. It signs each result and states in its manifest how long each tool's result may be reused. The forwarder is the customer's gateway or the provider's own edge.

**What it gives.**

| Mechanism | In this scenario |
|---|---|
| Content Store and PIT | a call answered by a forwarder does not reach the provider. If the provider meters at its origin, that call is neither billed nor counted against a rate limit |
| Signed manifest | the provider sets the lifetime it accepts, per tool. Reuse of a paid result is bounded by the party that sold it |
| Signature | the customer can check that a reused result is the provider's and was not altered where it was stored |

**What it does not solve.** Whether a provider wants this is a commercial question, not a protocol one: a cache in front of the meter lowers what the provider bills, and none of the pages read says whether a provider accepts results being served again by someone else. A provider that does not sign leaves only a proxy-producer, whose cache policy is its operator's: it carries neither the provider's authorization nor the provider's lifetime. And search results age: the same trace shows how little a short lifetime keeps of the recurrence (35.2% of the redundant search calls at 10 minutes) [AGENTSYSBENCH].

## Publishers and origin load {#publishers}

*Evidence: the load is measured; IDEM's fit is by analogy.*

**Today.** Automated readers are a large share of what origins serve. Wikimedia found that at least 65% of its most resource-consuming traffic comes from bots, although bots are about 35% of its pageviews, because crawlers "bulk read" unpopular pages that are in no cache and have to be served from the core data center [WIKIMEDIA-CRAWLERS]. Cloudflare reported in July 2026 that "more than 50% of traffic on the Internet is now non-human" [CF-AGENTIC-INTERNET].

**What repeats.** Less than those figures suggest, for this protocol. Most of the load is crawling for training. Over the twelve months to August 2025, "80% of AI crawling was for training, compared with 18% for search and just 2% for user actions" [CF-CRAWL-CLICK]. Only the last kind is an agent fetching a page for a user through a tool, which is the traffic IDEM sees. Training crawls read in bulk and reach the long tail, the pattern that defeats caches by Wikimedia's own account.

**Where IDEM sits.** Someone has to sign. Either the publisher acts as the producer of a fetch tool for its own content, or a fetch service signs as a proxy-producer, and then the signature speaks for the fetch service and not for the publisher.

**What it gives.**

| Mechanism | In this scenario |
|---|---|
| Content Store | a page that many agents fetch is taken from the origin once per freshness period at each forwarder, and the publisher chooses the period |
| Signature | a copy served by an intermediary can be checked against the publisher's key. The web has a precedent: Signed HTTP Exchanges let a publisher sign a response, with its validity window, so that any intermediary may serve it [SXG] |

**What it does not solve.** No origin signs tool results today, so this scenario describes what would be possible, not something to switch on. It does nothing about training crawlers, which do not come through a tool call. And HTTP caches already store responses by URL [RFC9111]. What IDEM would add is a copy the reader can verify at a cache it does not trust, and the precedent is not encouraging: the Signed HTTP Exchanges draft expired without being adopted by a working group [SXG].

## Checking where an answer came from {#origin}

*Evidence: the problem is measured; IDEM covers origin authenticity only.*

**Today.** A tool's name does not say who provides it. In a controlled study the attacker "only operates another MCP server that is visible to the same client and advertises tools with chosen metadata". When that server copied the legitimate tool's name and description and offered a compatible schema, three of the five model clients tested chose the attacker's tool in all 50 trials [MISBINDING]. On the path, a gateway is a party that holds credentials and handles every call [MCP-GATEWAY]. A proxy built to inject faults into tool calls for research can fabricate errors and alter payloads, and its authors note that the same primitives "could be repurposed adversarially by an attacker already positioned on the MCP path" [MCP-FAULTS].

**What repeats.** Nothing has to. This scenario is about the signature, not about the cache.

**Where IDEM sits.** In the consumer. The producer is part of every name, and the consumer is configured with the producers it accepts and, where first contact cannot be trusted, with their keys.

**What it gives.**

| Mechanism | In this scenario |
|---|---|
| Name and key | a Data is accepted only if its key locator names the producer of the name and the key is one that producer's trusted manifest lists [P-5.2]. A look-alike server cannot produce Data for another producer's name |
| Signature | a result altered by a gateway, a cache or anyone on the path fails verification before the agent sees it [P-5.5] |
| Signed manifest | the schema digest in the manifest ties the tool definition the consumer sees to the policy the producer signed [P-6.1] |

**What it does not solve.**

- **It does not stop an agent from choosing the wrong tool.** The attacker of that study can sign a manifest for its own name perfectly well. IDEM helps when the producer is fixed by configuration or by the user, not when a model picks a tool from descriptions.
- **A signature says who answered, not whether the answer is right.** In a fault profile calibrated on failure reports from 1,774 MCP repositories, silent content faults (wrong, invalid or slightly wrong output) carry 19.1% of the profile; the authors stress that it reflects the mix of reports, not a failure rate [MCP-FAULTS]. A producer signs a wrong answer like any other, and a cache then serves it until its lifetime ends.
- **It records no lineage.** An IDEM Data stands alone and does not say what it was computed from. That is the subject of Codexproof [CODEXPROOF]; see [Related work](/docs/related-work#agent-networking).
- **First contact is trusted** unless the key is pinned ([Security](/docs/security#limits)).

## Constrained and lossy networks {#lossy}

*Evidence: by analogy with NDN; we found no present-day report.*

**Today.** Agents do run at the edge. AWS describes MCP servers packaged for sites "where connectivity is unreliable", and its answer to a broken link is to run the tools locally and buffer their results until the link returns [AWS-GREENGRASS-MCP]. We found no report of agents that call remote read-only tools over a lossy link, and no measurement of MCP over one.

**What repeats.** Not measured. The argument is NDN's: a Data kept near the consumer outlives a broken path to the producer, and the paper that presents NDN says that even dynamic content benefits from caching for "retransmission after a packet loss" [NDN-2014].

**Where IDEM sits.** In the native binding. Names are carried by NDN, the forwarders are NDN routers with their own PIT and Content Store, and the producer answers behind one of them. Here the agent side does change: it needs an NDN consumer, or a local gateway that is one.

**What it gives.**

| Mechanism | In this scenario |
|---|---|
| Content Store on the path | a result that was lost on the last link does not have to be produced again: the retransmitted Interest is answered by the nearest node that holds it |
| PIT aggregation | retransmissions and identical calls for a name that is still pending join the entry that is already waiting |
| Signature | NDN requires it anyway, and it is what lets any router on the path answer |

**What it does not solve.** Experiment E4 ran this comparison, and the result was mixed: fewer bytes on the producer's link, and no gain in recovery time over TCP at the settings tested. The numbers and the settings are on the [benchmarks](/benchmarks) page. `private` tools cannot use the native binding at all [P-9.4]. A result that does not fit one NDN packet is not segmented in version 1. And one call is one Interest and one Data, which does not suit a tool that takes long to answer; RICE describes the mechanism that would [RICE].

## Where IDEM does not fit {#not-fit}

| Case | Why |
|---|---|
| Tools with side effects | sending, writing, buying. They are never named or cached; the call passes through as plain MCP |
| Answers that depend on who asks | a `private` result is reused only by the same authorization context. There is nothing to share, and IDEM is then a per-user cache with a signature |
| Data that must be current to the second | a cached result is as old as the producer allows, and the signed lifetime accepts a clock tolerance on top (60 seconds by default) [P-8.6]. A tool whose answer may not be a minute old should not be declared cacheable |
| Questions that are similar, not identical | matching is exact after canonicalization. Work on caches that match approximately reports a cost in accuracy [PLAN-CACHE][WA-CACHE] |
| Tools that take long to answer | no thunks, no asynchronous result; a call lives as long as one request |
| Saving tokens | IDEM does not cache model outputs or prompts. Provider prompt caching does that [PROMPT-CACHING], and code-driven tool calling keeps results out of the context [PTC] |
| One agent, one process, nothing shared | a cache inside the process is enough, and there is nobody to distrust |

## Scenarios and experiments {#experiments}

Each experiment is described on the [Evaluation](/docs/evaluation) page, and its results are on [Benchmarks](/benchmarks). "Not measured" means no IDEM experiment stands for the scenario.

| Scenario | Outside evidence | IDEM experiment |
|---|---|---|
| [Research swarms](#research-swarms) | measured | E2 sweeps `e2-agents`, `e2-overlap` and `e2-think-time`; `e2-surface` for arguments written in different forms |
| [Tool calls issued by code](#code) | mechanism documented, repetition not measured | E2 sweeps `e2-code-burst` (burst size) and `e2-code-sync` (how closely the agents start), for hypothesis H6 |
| [Documentation servers](#docs-servers) | documented practice, repetition not measured | not measured. `e2-ttl` varies the freshness period on the synthetic workload |
| [Enterprise gateways](#gateways) | documented practice | `e2-mixed` (calls that are not cacheable and `private` calls under load); E5 for the isolation of `private` results |
| [Metered APIs](#metered) | billing model documented | not measured. Upstream calls are counted in every E2 sweep; no billing model is simulated |
| [Publishers](#publishers) | load measured, fit by analogy | not measured |
| [Checking origin](#origin) | problem measured | E5: tampering, forged names, keys outside the manifest |
| [Lossy networks](#lossy) | by analogy | E4 |
