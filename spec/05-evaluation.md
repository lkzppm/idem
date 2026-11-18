# 05 — Evaluation

Every number published anywhere comes from this pipeline. Results are committed under
`experiments/results/<experiment>/<run-id>/` with `config.json`, `metrics.csv`, `events.jsonl.gz`
(optional), `seed`, `git-sha` and `env.json` (runtime versions, CPU).

One CLI writes that layout (ADR-023): `pnpm sim -- --config experiments/configs/<experiment>.json
[--seed n]`, and `experiments/run-all.sh` runs E1, E2 and E5 in order. Details of a run folder:

- `<run-id>` is `YYYYMMDDTHHMMSSZ-<first 8 hex of the source digest>`; runs are never overwritten, and
  where an experiment has several, the page and the figures use the latest (every run of E1).
- `config.json` is the resolved config (a sweep's processing costs are stored inline with their source).
- `seed` holds one seed or an inclusive range (`1..30`). `git-sha` is `git rev-parse HEAD` (`-dirty`
  with local changes) or `none` outside a repository; `source-digest` is always written: SHA-256 over
  `packages/*/src/**` without tests, sorted by path, so a run names its code even without git.
- `env.json` also records the load average at the start and end of the run (other work shares the
  machine) and the command line.
- A virtual-clock run (E2) is bit-reproducible for a seed on the same platform, not across
  platforms: `Math.log` differs in its last bits between macOS and Linux, and a Data's byte count
  follows the digits of its `producedAt` (ADR-027). Reproduce a committed sweep on the platform in
  its `env.json`; on another one expect close, not identical, numbers.
- A sweep adds `summary.csv` (mean, sd, 95% CI half-width, min, max per mode, value and metric) and
  `latency_cdf.csv` (percentiles 0..100 of every call, pooled over seeds); E5 adds `trials.csv` (one
  line per trial).
- `pnpm sim -- export-web` turns the run folders into `apps/web/lib/results/data.json`, the only
  source of the `/benchmarks` page; a test fails if that file drifts from the folders.

## 1. Modes compared

| Id | Mode | Description |
|---|---|---|
| B0 | `mcp-direct` | Each agent calls the producer directly (MCP 2026-07-28, no cache for `tools/call`) |
| B1 | `mcp-local-cache` | Each agent keeps its own exact-match tool-result cache (the strongest "no network change" baseline) |
| B2 | `idem` | Agents → edge forwarder (PIT + CS) → producer |
| B3 | `idem-tree` | Agents → edge → regional → producer (multi-hop) |
| B4 | `idem-noverify` | B2 with `verifyOnInsert=false`, only to isolate verification cost (E1/E2) |

As run (ADR-023): every mode crosses the same links. In B0 and B1 the edge only relays plain calls and
the producer answers as a plain MCP server (no `_meta["dev.idem/data"]`), so the baselines carry no
IDEM bytes. B1 keys its cache on the canonical name, i.e. it gets IDEM's canonicalization for free;
a cache keyed on the raw arguments would do no better. B3 is two edges and one regional forwarder with
the same end-to-end delay as B2 (5 + 10 + 30 ms against 5 + 40 ms one way). CPU work has no duration
on a virtual clock, so the IDEM modes are charged for it explicitly: canonicalize and name at the
consumer, the digest check at each forwarder, canonicalize, name and sign at the producer, verify at
each forwarder (not in B4) and at the consumer, priced by `experiments/configs/processing.json`, the
medians of E1 interpolated by payload size (`pnpm sim -- calibrate`). The baselines are charged nothing.

## 2. Workloads

- **W-syn (synthetic):** `agents ∈ {1, 2, 4, 8, 16, 32}`, `callsPerAgent`, catalog size, Zipf α over
  the catalog, and an explicit **cross-agent overlap** parameter (fraction of each agent's requests
  drawn from a shared pool). Inter-arrival times from a configurable distribution.
- **W-trace (real):** tool-call traces recorded from a real agent swarm (E3), stored as JSONL:
  `{ t, agent, tool, args, resultBytes }`. Arguments are kept so canonicalization is exercised for real.
- **W-mixed:** a fraction of non-cacheable calls (`send_email`) and `private` calls (`my_notes`) to
  check bypass and scope behavior under load.

Base point of the W-syn sweeps (`experiments/configs/e2-*.json`; each sweep moves one parameter). These
are assumptions about a swarm, to be replaced by W-trace when E3 runs; none was tuned on results:

| Parameter | Value |
|---|---|
| agents, calls per agent | 8, 20 |
| shared catalog | 50 documents, Zipf α = 0.8; calls outside the overlap ask for a document nobody else asks for |
| overlap | 0.5 |
| think time | exponential, mean 2 s (closer to an LLM's pace than the sandbox's 300 ms, and it does not inflate PIT aggregation) |
| surface variation | 0.3 of the URLs written in an equivalent form |
| links (one way) | agent ↔ edge 5 ms, edge ↔ producer 40 ms, no loss |
| service time | log-normal, median 150 ms, σ = 0.5 |
| result size | log-normal, median 6 KiB |
| TTL, CS | 60 s, 8 MiB LRU per forwarder |
| seeds | 1..30 at every point; the same seed plans the same calls and think times in every mode |

## 3. Metrics

| Metric | Definition |
|---|---|
| Upstream calls | `tools/call` requests that reach the producer |
| Upstream reduction | `1 − upstream(mode) / upstream(B0)`, per seed (also reported against B1) |
| Oracle reduction | `1 − (distinct names + passthrough calls) / calls`: a perfect shared cache, the bound for any mode |
| CS hit ratio | `cs_hit / (cacheable interests at the edge)` |
| PIT aggregation ratio | `pit_aggregate / (cacheable interests at the edge)` |
| Latency | per call, consumer-observed; report p50, p95, p99 |
| Producer-link bytes | bytes crossing the producer link |
| Crypto overhead | µs per canonicalize / sign / verify (E1) |
| Stale serves | Data served with `ageMs ≥ min(freshnessMs, ttlMs)` [P-8.1, P-8.2] (must be 0) |
| Late serves | informative: Data handed over when `now − producedAt ≥ min(freshnessMs, ttlMs)` on the simulation's one clock; time in transit is not part of `ageMs` (ADR-025) |
| Safety violations | accepted tampered Data + cross-context `private` serves (must be 0) |

## 4. Experiments

### E1 — Microbenchmarks
Cost of `canonicalizeArgs`, `makeName`, `signData`, `verifyData` for payloads of 1 KB–1 MB, in Node 24
and in a browser (Playwright, headless Chromium). Output: µs distributions. Supports H2.
As run: `e1-node`, six sizes from 1 KiB to 1 MiB, one timed call per iteration after a warm-up,
order statistics per cell; wall-clock, so the whole run is repeated and every repetition is kept. The
browser half has not run.

### E2 — Trace-driven simulation (main result)
`@idem/sim` with W-syn sweeps and W-trace replay, B0–B4. ≥ 10 seeds per point; report mean and 95%
CI. Plots: upstream reduction vs agents; vs overlap; latency CDFs; CS size sensitivity; TTL
sensitivity. Supports H1, H2.
As run: `e2-agents`, `e2-overlap`, `e2-ttl`, `e2-cs-size`, `e2-think-time` (W-syn) and `e2-mixed`
(W-mixed), 30 seeds per point. W-trace replay waits for E3.

### E3 — Real-agent trace collection
A small swarm (AI SDK 7 via AI Gateway) solving a fixed set of research questions with the demo tools
over the static corpus. Record every tool call. Fixed budget; model and prompts recorded verbatim in
the run folder. Output: W-trace files for E2 and E4. This experiment is the only one that calls an LLM.

### E4 — Network emulation
- **Overlay:** containers (Docker) for agents, edge, regional and producer; `tc netem` on links for
  delay and loss `∈ {0, 1, 5}%`; B0 vs B2 vs B3.
- **Native NDN:** Mini-NDN (Docker image), same topologies, NFD's PIT/CS, `@idem/ndn` producer and
  consumers; compare with the overlay.
Plots: producer-link bytes and completion time vs loss; per-hop hit distribution. Supports H4.

Before E4, a functional check of the native binding against a real NFD (not a measurement):
`pnpm exp:ndn` starts three NFD forwarders in Docker (`experiments/ndn/nfd/`, edge1 and edge2 →
regional, image `ghcr.io/named-data/nfd:20261105` pinned by digest), runs nine scenarios over NDNts
TCP, UDP and WebSocket faces (round trip, PIT aggregation, CS and freshness, equivalent spellings,
`private`, tampering, the size limit, the chain, the WebSocket face) and writes
`experiments/results/ndn-nfd/<run-id>/` with the usual files plus `summary.json` (every check with its
expected and actual value), `metrics.csv` (one row per check) and the NFD logs; `env.json` adds the
NFD version, image digest and NDNts versions. Its config is `experiments/ndn/nfd/config.json`
(`kind: "nfd-check"`). `export-web` reads each run's `summary.json` into `nfd` of `data.json` (the last
five runs) and `/benchmarks` shows the latest. It is wall-clock and reports PASS/FAIL, not numbers
for the report. The same scenarios run as `packages/ndn/src/nfd.test.ts` with
`IDEM_NFD=1` against running forwarders; without it they are skipped.

As built (`experiments/ndn/bench`, `pnpm exp:e4`, config `experiments/ndn/bench/configs/e4.json`):
- **Topology.** Docker on one host instead of Mini-NDN (it needs a Linux host with Open vSwitch;
  the author's machine is macOS). Each node is one network namespace holding an NFD 24.07 container
  (`ghcr.io/named-data/nfd:20261105`, pinned by digest) and a Node 24 sidecar that runs the overlay
  roles, so **both bindings cross the same interfaces and the same netem qdiscs**. One Docker network
  per link: agents–edge1 (`a1`), agents–edge2 (`a2`), edge1–producer (`e1p`), edge1–regional (`e1r`),
  edge2–regional (`e2r`), regional–producer (`rp`). `tc netem` on both ends of every link: the
  link's one-way delay (as E2: 5 ms agent links, 40 ms in the star, 10 + 30 ms in the tree), the
  run's loss on every link in each direction, no rate limit.
- **Modes.** B0, B2, B3 on the overlay (`@idem/gateway` edge/regional, `createProducerHandler`;
  B0 relays plain `/idem/v1/call` and the producer strips `_meta`), and **N2/N3**, the star and the
  tree on native NDN: `NdnConsumer` per agent over its own UDP face to the edge NFD, permanent UDP
  faces and static routes between NFDs, `serveNdn` on the producer's own NFD (registered over a
  local TCP face; its CS stays on, as on any NDN host). B1 and B4 are not run (no network effect).
- **Workload.** W-syn at the E2 base point (8 agents × 20 calls, think time 2 s), planned by
  `planWorkload` with seed-derived think times, so every mode of a seed replays the same calls. The
  plan is not the one E2 draws for the same seed (different RNG forks). Pages are log-normal around
  2 KiB (σ = 0.7) clamped to [512, 7168] bytes so every result fits one NDN packet (v1 does not
  segment, §9.2 of spec 01); B0–B3 serve the same pages.
- **Loss recovery.** The overlay rides TCP. The native consumer re-expresses an unanswered Interest
  with a fresh Nonce after its InterestLifetime (1 s, up to 4 retransmissions; NFD drops a name +
  Nonce it has seen). Both are part of what is compared.
- **Measured per run** (`metrics.csv`): calls answered/failed/timed out, upstream calls (tool
  handler invocations) and repeats of a name, the oracle, latency p50/p95/p99 of answered calls,
  requests sent and retransmissions, bytes and frames received over the producer link and over all
  links (`/proc/net/dev` of both ends, Ethernet frames), TCP retransmitted segments of every
  namespace, consumer verification time (native: both signatures, [P-9.3]; overlay: `verifyData`
  timed once more on the same Data) and the forwarders' `verify_ok` time; per hop (`hops.csv`):
  Interests in, CS hits, absorbed (PIT aggregation and suppressed retransmissions), sent upstream,
  from the gateways' events or NFD's face and CS counters. Reductions are paired with B0 of the
  same (seed, loss). Also `calls.csv` (every call), `summary.csv`, `latency_cdf.csv`.
- **Validity guard.** Wall-clock: an agent-side 100 ms timer records its largest delay; a run where
  it exceeds 250 ms (a suspended host or VM) is discarded and repeated up to twice, and the
  experiment fails if it keeps happening. `env.json` records NFD, image digests, NDNts, `tc`, the
  netem qdisc of every interface, Docker VM, the harness digest and the discarded runs.
- Seeds 1..3 × loss {0, 1, 5} % × 5 modes = 45 runs of about a minute each. Three seeds keep the
  run under the 45-minute target; the CIs are wide accordingly.
- **Status.** Harness built and smoke-tested; the full run has not been executed (see roadmap M6).
  No E4 number exists yet. `export-web` reads `experiments/results/e4/<run-id>/` (`kind: "emulation"`:
  `summary.csv` by mode and loss, `latency_cdf.csv`, `config.json`, `env.json`) into `e4` of
  `data.json`, which is `null` until a run folder with a summary exists; `/benchmarks` then shows E4
  as its lead section (spec 04 §1.1, ADR-032). Tested with an in-memory fixture, never a committed
  result.

### E5 — Safety
Adversarial runs: tamper with Data in flight, forge names (digest mismatch), replay stale Data,
request `private` results across `authContext`s, poison attempts with a non-manifest key.
Expected: every attempt on a claim of spec 01 is rejected; counts reported. Supports H3. Stale Data
has two cases (ADR-025): an honest cache MUST NOT serve an expired copy, which is a claim and is
expected to be rejected; a party on the path replaying a genuine, expired Data is a documented limit
of v1, which the suite measures and expects to be accepted until the rule of Q6 is adopted.
As run: `e5-safety`, 27 variants × 250 trials against the real `Forwarder`, `Producer`, `TrustStore`
and `verifyData` on a virtual clock (`packages/sim/src/experiments/safety.ts`). A trial is rejected
only if no victim accepted forged, foreign or expired content and no Content Store kept any. Every
variant carries what spec 01 says of it: `rejected` (24 variants, a claim), `limit` (on-path replay
on the producer link and on the agent link, ADR-025) or `leaks` (the timing side channel of Q3).
One claim does not hold and stays in the suite, failing, until the engine changes: a `private` read
by a consumer that puts the victim's `authContext` in its own Interest (ADR-023, Q7).

## 5. Reporting rules

- Every figure is produced by `experiments/plots/*.py` from committed results; the script name and run
  ids go in the figure caption. The `/benchmarks` page draws its own charts from the same run folders
  (through `data.json`) and names the runs under each figure.
- A refuted hypothesis is reported as refuted, with the data.
- Simulation results are labeled "simulation"; emulation results "emulation". They are not mixed in one
  number.
