This page is the method: what is compared, on which workloads, with which metrics, in which experiments. It states **no results**. Numbers are published only on the [benchmarks](/benchmarks) page, and only once a committed run produced them.

## The rule about numbers {#rule}

Every number this project publishes, on this site, in the README or in the report, comes from one pipeline. A run is committed under `experiments/results/<experiment>/<run-id>/` with everything needed to repeat it:

| File | Content |
|---|---|
| `config.json` | the full configuration of the run |
| `metrics.csv` | the measured metrics |
| `events.jsonl.gz` | the forwarder event stream (optional) |
| `seed` | the seed every random choice was derived from |
| `git-sha` | the revision of the code that ran |
| `env.json` | runtime versions and CPU |

No page shows an estimate, a target or an illustrative value in place of a measurement. Where a run does not exist yet, the page says so.

## Hypotheses {#hypotheses}

The hypotheses were written before the experiments, in a form that can fail. A hypothesis refuted with sound method is a valid result and is reported as refuted, with the data.

| | Hypothesis | Tested by |
|---|---|---|
| **H1**, redundancy | On swarm workloads with cross-subagent overlap, IDEM reduces the calls that reach the producer, compared with direct MCP and with a cache inside each agent | E2 |
| **H2**, latency | Latency per call drops when there is a CS hit or a PIT aggregation, and the extra cost on a miss (canonicalize, sign, verify) is small next to the round trip to the producer | E1, E2 |
| **H3**, safety | No tampered response is accepted and no `private` result is served to another context | E5 |
| **H4**, network | Under loss and over several hops, on-path caching reduces the bytes on the producer's link and the recovery time, compared with end-to-end TCP/HTTP | E4 |
| **H5**, what the protocol adds to a shared cache | Against a shared exact-match cache at the gateway with no signatures, no producer-declared canonicalization and no in-flight aggregation (mode B5): (a) IDEM sends fewer calls upstream when arguments vary in surface form or identical calls are in flight at the same time, and the same number when neither happens; (b) a result altered at the cache or on the path to it is accepted by B5's consumers and rejected by IDEM's | E2, E5 |
| **H6**, code-driven bursts | When agents issue their calls from code in bursts instead of one per model turn, the share of cacheable requests absorbed by PIT aggregation grows with the burst size and with how closely the agents' starts coincide, and IDEM's upstream reduction over B5 grows with it | E2 |

## Modes compared {#modes}

The same workload runs in each mode. Three of them are baselines without IDEM.

::figure[modes] The three main modes. The local cache is the strongest baseline that changes nothing in the network: it catches an agent repeating itself, and misses one agent repeating another.

| Id | Mode | Description |
|---|---|---|
| B0 | `mcp-direct` | each agent calls the producer directly, as MCP 2026-07-28 does: `tools/call` is not cached |
| B1 | `mcp-local-cache` | each agent keeps its own exact-match cache of tool results |
| B2 | `idem` | agents → an edge forwarder with PIT and CS → producer |
| B3 | `idem-tree` | agents → edge → regional forwarder → producer (several hops) |
| B4 | `idem-noverify` | B2 with verification before caching turned off, **only** to isolate what verification costs |
| B5 | `mcp-gateway-cache` | plain MCP with one shared, unsigned exact-match response cache at the edge, the way the products that cache `tools/call` ship one |

B1 matters. Comparing IDEM only with "no cache at all" would credit the protocol with gains that any cache gives. The interesting difference is between a cache each agent owns and one the path shares. B4 is never a deployment option: [P-7.1] allows turning verification off only as an experiment flag.

B5 exists because the first question about IDEM is what it gives that a cache at the gateway does not. B5 models that cache as it is shipped, neither weakened nor improved [FASTMCP-CACHE] [MCP-PROXY] [CONTEXTFORGE-CACHE]. It is plain MCP end to end: no names, no signatures, and nothing is verified. The edge keeps one cache shared by all its agents, keyed by producer, tool and the arguments as sent, serialized with sorted keys. Key order therefore does not matter, and any other difference in spelling does, because no producer-declared normalization is applied. Two identical calls that miss while both are in flight both go upstream: the cache does not coalesce them. The model is generous where the comparison would otherwise be about configuration. It caches exactly the tools the producer's manifest marks cacheable, with the manifest's TTL, and it has the byte budget and the replacement policy of the Content Store. A `public` tool has one entry shared by every agent. A `private` tool has one entry per caller credential, the per-token partition of FastMCP's key, so B5 gets the same per-user repeats as IDEM's edge. What is left between B5 and B2 is what the protocol adds: canonicalization declared by the producer, aggregation of calls in flight, and signatures (ADR-036).

## Workloads {#workloads}

- **W-syn, synthetic.** A set of agents, each issuing a number of calls over a catalog of pages. Popularity within the catalog follows a Zipf distribution with exponent α. An explicit **cross-agent overlap** parameter sets the fraction of each agent's requests drawn from a pool shared by all agents; the rest are the agent's own. Each sweep moves one parameter from a common base point: the number of agents over 1, 2, 4, 8, 16 and 32, the overlap, the TTL, the Content Store size, the think time, or the surface variation of the arguments. The base point is a set of assumptions about a swarm, written in the configs under `experiments/configs/`; none was tuned on results.
- **W-trace, recorded.** Tool-call traces recorded from a real agent swarm in experiment E3, stored as JSON Lines with the time, the agent, the tool, the arguments and the result size of each call. The arguments are kept as the model wrote them, so canonicalization is exercised on real surface variation. No such trace has been recorded yet: see [E3](#e3).
- **W-mixed.** A workload with a fraction of non-cacheable calls (`send_email`) and of `private` calls (`my_notes`), to check that bypass and scope hold under load.
- **W-code, calls issued by code.** W-syn where an agent's calls come from a program the model wrote, as in Code Mode and programmatic tool calling [CODE-MODE] [PTC], instead of one call per model turn. A step issues a burst of calls at once, waits for all of them, then thinks for one model turn before the next step. The agents start within a configurable window, and a window of zero is an orchestrator spawning its sub-agents at the same instant. The calls themselves are planned as in W-syn and the number of calls per agent is held constant, so a burst changes when calls are issued, not which (ADR-037). How often calls issued by code repeat across agents has not been measured by anyone, so every base value of this workload is an assumption, stated as one in its config.

The synthetic workload makes overlap a knob, because overlap is what the result depends on most: with none, a shared cache has nothing to share. A recorded workload would say what overlap a real swarm actually has. Until E3 runs, IDEM has no data of its own on that.

## Metrics {#metrics}

All forwarder metrics are computed from the engine's event stream ([Architecture](/docs/architecture#events)), the same stream the sandbox draws.

| Metric | Definition |
|---|---|
| Upstream calls | `tools/call` requests that reach the producer |
| Upstream reduction | `1 − upstream(mode) / upstream(B0)`, paired by seed; also reported against B1 and against B5 |
| Oracle reduction | what a perfect shared cache would reach on the same calls: the bound for any mode |
| CS hit ratio | `cs_hit / (cacheable Interests at the edge)` |
| PIT aggregation ratio | `pit_aggregate / (cacheable Interests at the edge)` |
| Gateway cache hits | B5 only: calls answered from the gateway cache |
| In-flight duplicates | B5 only: cacheable calls that missed the gateway cache while an identical call was already upstream, and so went upstream too. It is what a PIT would have absorbed |
| Latency | per call, as the consumer observes it; reported as p50, p95 and p99 |
| Producer-link bytes | bytes that cross the link to the producer |
| Crypto overhead | time per canonicalize, sign and verify operation (E1) |
| Stale serves | Data served past its freshness; must be zero |
| Safety violations | tampered Data accepted, plus `private` results served across contexts; must be zero |

The CS hit ratio and the PIT aggregation ratio are reported separately on purpose. They are two different mechanisms: one needs an answer already stored, the other only needs two questions to overlap in time.

## Experiments {#experiments}

### E1: microbenchmarks {#e1}

The cost of `canonicalizeArgs`, `makeName`, `signData` and `verifyData`, for payloads from 1 KB to 1 MB. The output is a distribution of times per operation. It supports H2: it is the price paid on every miss. It was run in Node. The browser half of the experiment has not been run.

### E2: trace-driven simulation {#e2}

The main experiment. `@idem/sim` runs the workloads in modes B0 to B5. Each point is run with 30 seeds and reported as a mean with a 95% confidence interval. Nine sweeps were run, each moving one parameter:

| Sweep | Workload | What moves | Modes |
|---|---|---|---|
| `e2-agents`, `e2-overlap`, `e2-ttl` | W-syn | number of agents; overlap; TTL | B0 to B5 |
| `e2-cs-size`, `e2-think-time` | W-syn | Content Store size; think time | B0, B1, B2, B3, B5 |
| `e2-mixed` | W-mixed | fraction of calls with a side effect | B0, B1, B2, B3, B5 |
| `e2-surface` | W-syn | fraction of URLs written in an equivalent form | B0, B1, B5, B2 |
| `e2-code-burst` | W-code | calls per burst | B0, B1, B5, B2 |
| `e2-code-sync` | W-code | window in which the agents start | B0, B1, B5, B2 |

`e2-surface` isolates what producer-declared canonicalization adds over B5. At zero surface variation every repeat is spelled the same way, so B5 and B2 can differ only by the aggregation of calls in flight. The two W-code sweeps hold surface variation at zero, because arguments built by code vary less in spelling than arguments a model writes.

It supports H1, H2, part (a) of H5, and H6. The rules that decide H5 and H6 were written before the runs. A statistic counts as above zero when its 95% interval is.

- **H5 (a)** is read from B2's upstream reduction over B5. It has to be above zero wherever the surface varies, above zero at the points without surface variation where B5 sent duplicates upstream while an identical call was in flight, and neither above nor below zero where B5 sent none.
- **H5 (b)** is read from E5: each baseline row has to be accepted in at least one trial while the IDEM variant it mirrors is accepted in none.
- **H6** is read from B2's PIT aggregation ratio and from its upstream reduction over B5. Both have to grow as the burst gets larger and as the start window gets shorter.

The simulator runs the real forwarder on a virtual clock, so E2 measures the protocol's logic exactly and models the network. CPU work has no duration on a virtual clock, so the IDEM modes are charged for it explicitly, from the medians of E1. The baselines, B5 included, are charged nothing. The replay of a recorded trace has not run: it waits for E3.

### E3: real-agent traces {#e3}

A small swarm of LLM agents answers a fixed set of research questions with the demo tools over the static corpus, and every tool call is recorded. The budget is fixed, and the model and the prompts are saved verbatim in the run folder. The output is the W-trace files used by E2 and E4. It is the only experiment that calls an LLM; no test and no other experiment does.

**E3 has not been run.** The repository holds no trace of real agents, so every workload of E2 is synthetic and its base point is an assumption. Two ways forward are open. One is the run described above, a real swarm on a fixed budget. The other is a public trace as a stand-in. The traces of DynamicMCPBench [DYNAMICMCPBENCH] record MCP tool calls with their arguments and timestamps under a licence that allows reuse, but each trace is one agent on its own goal, so they cannot show how cooperating agents overlap. A public dataset that has cooperating agents on one task, tool arguments, timestamps and a clear licence was looked for and not found.

### E4: network emulation {#e4}

Real processes over emulated links. The plan named Mini-NDN [MINI-NDN]; the experiment was run instead as a Docker bench on one host, because Mini-NDN needs a Linux host and the author's machine is not one. Each node is a network namespace that holds an NFD forwarder and a Node process running the overlay roles, so **both bindings cross the same interfaces and the same emulated links**. `tc netem` adds the delays of E2 and a packet loss of 0, 1 and 5% to every link.

- **Overlay.** Modes B0, B2 and B3, with the forwarders of `@idem/gateway`.
- **Native NDN.** The same two topologies, with NFD's own PIT and Content Store and the native binding `@idem/ndn`, which exists and is tested against a real NFD.

The workload is W-syn at the base point of E2, with results small enough to fit one NDN packet, because v1 does not segment. Loss is recovered differently, and that is part of what is compared: the overlay rides TCP, and the native consumer asks again for an Interest left unanswered for its lifetime. Measured: producer-link bytes, latency, upstream calls, and where on the path hits happen. It supports H4.

Two limits of the run as it stands. It has three seeds per point, so its confidence intervals are wide; a run with at least ten seeds has not been done. And the native consumer retransmits after a fixed Interest lifetime, not after a time based on the measured round trip; such a timer is an open item.

### E5: safety {#e5}

Adversarial runs against the real forwarder, producer, trust store and verifier, on a virtual clock. Each attempts something the protocol has a rule about:

- tamper with a Data in flight;
- forge a name whose digest does not match its arguments;
- replay a Data that is past its freshness: from an honest cache, from a party on the path, with an understated age, or with a date in the future;
- ask for a `private` result from another authorization context, including by writing the victim's `authContext` into the Interest;
- poison a cache with a Data signed by a key that is not in the manifest.

Every variant is labelled before the run with what the protocol says of it, which gives three kinds of rows, reported apart:

| Kind | What it is | Expected outcome |
|---|---|---|
| **Claim** | an attempt a rule of the protocol must refuse | rejected in every trial |
| **Limit** | something version 1 documents and does not prevent: a replay still inside the clock tolerance of the signed lifetime. The timing side channel is recorded the same way, as a known leak | not rejected; reported as such, never as a claim |
| **Baseline** | the attack of an IDEM variant, run against the unsigned gateway cache of B5 | accepted; shown next to the IDEM variant it mirrors |

A trial counts as rejected only if no victim accepted forged, foreign or out-of-lifetime content and no Content Store kept any. The consumer of the suite decides with `acceptData`, the function every shipped consumer uses. The judge never reuses a node's predicate: it knows which texts the producer made and when, and content made more than the freshness plus 60 seconds before it reached the consumer, or dated more than 60 seconds in the future, is out of its bound [P-8.6]. Each claim also names the layer that must stop it (a forwarder check, the producer, or the consumer), and the suite's test fails if another layer stopped it instead. The limit variant on the producer link also checks the bound: once the replayed copy is outside its lifetime, a later consumer has to get a fresh answer.

The baseline group has three rows: a stored result rewritten inside the gateway cache, a result rewritten between the producer and the gateway, and a per-user tool listed as cacheable in a cache keyed by tool and arguments. They are judged on ground truth the same way. Acceptance is their expected outcome. They are not claims and not findings, and they are not counted with the IDEM rows.

The counts are reported on the [benchmarks](/benchmarks) page. It supports H3 and part (b) of H5. The [Security](/docs/security) page explains the rule behind each rejection.

## What has not been run {#not-run}

- **E3.** No trace of real agents exists yet, so no result on this site comes from a recorded workload.
- **E4 with more seeds.** The emulation has three seeds per point. A run with at least ten has not been done.
- **The browser half of E1.** The microbenchmarks ran in Node only.

## Reporting rules {#reporting}

- Every figure is produced from committed results: by a script under `experiments/plots/`, or by the benchmarks page, which draws its charts from the same run folders. The run ids go under each figure.
- A refuted hypothesis is reported as refuted, with the data.
- Results from simulation are labelled "simulation" and results from emulation "emulation". The two are never combined into one number.
