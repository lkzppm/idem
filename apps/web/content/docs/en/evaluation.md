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

## Modes compared {#modes}

The same workload runs in each mode. Two of them are baselines without IDEM.

::figure[modes] The three main modes. The local cache is the strongest baseline that changes nothing in the network: it catches an agent repeating itself, and misses one agent repeating another.

| Id | Mode | Description |
|---|---|---|
| B0 | `mcp-direct` | each agent calls the producer directly, as MCP 2026-07-28 does: `tools/call` is not cached |
| B1 | `mcp-local-cache` | each agent keeps its own exact-match cache of tool results |
| B2 | `idem` | agents → an edge forwarder with PIT and CS → producer |
| B3 | `idem-tree` | agents → edge → regional forwarder → producer (several hops) |
| B4 | `idem-noverify` | B2 with verification before caching turned off, **only** to isolate what verification costs |

B1 matters. Comparing IDEM only with "no cache at all" would credit the protocol with gains that any cache gives. The interesting difference is between a cache each agent owns and one the path shares. B4 is never a deployment option: [P-7.1] allows turning verification off only as an experiment flag.

## Workloads {#workloads}

- **W-syn, synthetic.** A set of agents, each issuing a number of calls over a catalog of pages. Popularity within the catalog follows a Zipf distribution with exponent α. An explicit **cross-agent overlap** parameter sets the fraction of each agent's requests drawn from a pool shared by all agents; the rest are the agent's own. Sweeps vary the number of agents over 1, 2, 4, 8, 16 and 32, the overlap, the catalog size and α.
- **W-trace, recorded.** Tool-call traces recorded from a real agent swarm in experiment E3, stored as JSON Lines with the time, the agent, the tool, the arguments and the result size of each call. The arguments are kept as the model wrote them, so canonicalization is exercised on real surface variation.
- **W-mixed.** A workload with a fraction of non-cacheable calls (`send_email`) and of `private` calls (`my_notes`), to check that bypass and scope hold under load.

The synthetic workload makes overlap a knob, because overlap is what the result depends on most: with none, a shared cache has nothing to share. The recorded workload says what overlap a real swarm actually has.

## Metrics {#metrics}

All forwarder metrics are computed from the engine's event stream ([Architecture](/docs/architecture#events)), the same stream the sandbox draws.

| Metric | Definition |
|---|---|
| Upstream calls | `tools/call` requests that reach the producer |
| Upstream reduction | `1 − upstream(mode) / upstream(B0)` |
| CS hit ratio | `cs_hit / (cacheable Interests at the edge)` |
| PIT aggregation ratio | `pit_aggregate / (cacheable Interests at the edge)` |
| Latency | per call, as the consumer observes it; reported as p50, p95 and p99 |
| Producer-link bytes | bytes that cross the link to the producer |
| Crypto overhead | time per canonicalize, sign and verify operation (E1) |
| Stale serves | Data served past its freshness; must be zero |
| Safety violations | tampered Data accepted, plus `private` results served across contexts; must be zero |

The CS hit ratio and the PIT aggregation ratio are reported separately on purpose. They are two different mechanisms: one needs an answer already stored, the other only needs two questions to overlap in time.

## Experiments {#experiments}

### E1: microbenchmarks {#e1}

The cost of `canonicalizeArgs`, `makeName`, `signData` and `verifyData`, for payloads from 1 KB to 1 MB, in Node and in a browser. The output is a distribution of times per operation. It supports H2: it is the price paid on every miss.

### E2: trace-driven simulation {#e2}

The main experiment. `@idem/sim` runs W-syn sweeps and W-trace replays in modes B0 to B4. Each point is run with at least ten seeds and reported as a mean with a 95% confidence interval. The planned plots: upstream reduction against the number of agents and against overlap, latency distributions, and sensitivity to the Content Store size and to the TTL. It supports H1 and H2.

The simulator runs the real forwarder on a virtual clock, so E2 measures the protocol's logic exactly and models the network.

### E3: real-agent traces {#e3}

A small swarm of LLM agents answers a fixed set of research questions with the demo tools over the static corpus, and every tool call is recorded. The budget is fixed, and the model and the prompts are saved verbatim in the run folder. The output is the W-trace files used by E2 and E4. It is the only experiment that calls an LLM; no test and no other experiment does.

### E4: network emulation {#e4}

Real processes over emulated links, in two forms:

- **Overlay.** Containers for agents, edge, regional forwarder and producer, with `tc netem` adding delay and packet loss of 0, 1 and 5% to the links. Modes B0, B2 and B3.
- **Native NDN.** The same topologies in Mini-NDN, with NFD's own PIT and Content Store and the native binding, compared with the overlay.

The planned plots: producer-link bytes and completion time against loss, and where on the path hits happen. It supports H4. It depends on the native binding, which is not implemented yet.

### E5: safety {#e5}

Adversarial runs. Each attempts something the protocol must refuse:

- tamper with a Data in flight;
- forge a name whose digest does not match its arguments;
- replay a stale Data;
- ask for a `private` result from another authorization context;
- poison a cache with a Data signed by a key that is not in the manifest.

The expected outcome is that every attempt is rejected; the counts are reported. It supports H3. The [Security](/docs/security) page explains the rule behind each rejection.

## Reporting rules {#reporting}

- Every figure is produced by a script under `experiments/plots/` from committed results. The script's name and the run ids go in the caption.
- A refuted hypothesis is reported as refuted, with the data.
- Results from simulation are labelled "simulation" and results from emulation "emulation". The two are never combined into one number.
