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
| B5 | `mcp-gateway-cache` | Plain MCP with one shared, unsigned exact-match response cache at the edge, as MCP gateways ship it (the industry baseline, ADR-036) |

As run (ADR-023): every mode crosses the same links. In B0 and B1 the edge only relays plain calls and
the producer answers as a plain MCP server (no `_meta["dev.idem/data"]`), so the baselines carry no
IDEM bytes. B1 keys its cache on the canonical name, i.e. it gets IDEM's canonicalization for free;
a cache keyed on the raw arguments would do no better. B3 is two edges and one regional forwarder with
the same end-to-end delay as B2 (5 + 10 + 30 ms against 5 + 40 ms one way). CPU work has no duration
on a virtual clock, so the IDEM modes are charged for it explicitly: canonicalize and name at the
consumer, the digest check at each forwarder, canonicalize, name and sign at the producer, verify at
each forwarder (not in B4) and at the consumer, priced by `experiments/configs/processing.json`, the
medians of E1 interpolated by payload size (`pnpm sim -- calibrate`). The baselines are charged nothing.

B5 as run (ADR-036). B5 models a response cache at an MCP gateway the way the products that cache
`tools/call` ship it (FastMCP's response-caching middleware, `mcp-proxy`, IBM ContextForge's plugin;
the large gateways read for the comparison document no `tools/call` cache at all). It is plain MCP end
to end, like B0 and B1: no names, no signatures, no manifest on the wire, and the producer answers as a
plain MCP server. The edge keeps one cache shared by all its agents, keyed by producer, tool and the
arguments as sent, serialized with sorted keys (FastMCP's key): key order does not matter, any other
difference in spelling does, since there is no producer-declared normalization. A miss goes upstream
and its result is stored on the way back; two misses for the same key that are in flight at the same
time both go upstream (cache-aside: FastMCP and ContextForge do not coalesce; `mcp-proxy` can, as an
opt-in its own documentation hedges, and the model takes the common case). Error results are not
stored. The model is generous where the comparison would otherwise be about configuration: the
operator caches exactly the tools the producer's manifest marks cacheable, with the manifest's TTL
counted from the store at the edge, so neither the choice of tools nor the TTL is what differs. A
`public` tool has one entry shared by every agent, keyed without a credential as `mcp-proxy` and
ContextForge key. A `private` tool has one entry per caller credential, the per-token partition
FastMCP's key has, so B5 gets the per-user repeats an IDEM edge gets from its `authContext`
partition [P-8.3] and is not handicapped on per-user tools (ADR-036, amended 2026-11-27); FastMCP
partitions every tool that way, which for `public` tools would share nothing between agents and
would make B5 a per-agent cache, so B5 keeps the shared key for them. Both kinds share one byte budget
with the replacement policy of the IDEM Content Store, and the stored result's JSON bytes count
against it. B5 does no cryptographic work and is charged no CPU. It is a relay in the simulator
(`packages/sim/src/gateway-cache.ts`, in front of the core forwarder relaying plain calls), not part
of `@idem/core`. Adding it did not change any run of B0 to B4: the fingerprints of every run of every
committed sweep (30 seeds) are identical before and after (ADR-036).

## 2. Workloads

- **W-syn (synthetic):** `agents ∈ {1, 2, 4, 8, 16, 32}`, `callsPerAgent`, catalog size, Zipf α over
  the catalog, and an explicit **cross-agent overlap** parameter (fraction of each agent's requests
  drawn from a shared pool). Inter-arrival times from a configurable distribution.
- **W-trace (real):** tool-call traces recorded from a real agent swarm (E3), stored as JSONL:
  `{ t, agent, tool, args, resultBytes }`. Arguments are kept so canonicalization is exercised for real.
- **W-mixed:** a fraction of non-cacheable calls (`send_email`) and `private` calls (`my_notes`) to
  check bypass and scope behavior under load.
- **W-code (calls issued by code, ADR-037):** W-syn where an agent's calls come from a program, as in
  Code Mode and programmatic tool calling, instead of one per model turn. A script step issues the next
  `burst.size` planned calls (all at once if `burst.parallel`, otherwise back to back with no think
  time), waits for all of them, then thinks (`thinkTimeMs`, the model turn) before the next step.
  Agents start uniformly within `startSpreadMs` (0 = an orchestrator spawning its sub-agents at the
  same instant). Without `burst` a step is one call, and without `startSpreadMs` the window is the
  think time: exactly the W-syn workload, with the same random draws. The calls themselves (tools,
  documents, spellings) are planned as in W-syn, so a burst changes when calls are issued, not which.
  A parallel step prepares its calls (names, Interests) one after the other in plan order, then sends
  them all at the same virtual instant, so a run never depends on the order in which concurrent
  WebCrypto operations complete (`determinism.test.ts` perturbs that order and requires identical
  fingerprints).

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

Base point of the W-code sweeps (`e2-code-burst`, `e2-code-sync`), where it differs from the table
above. Also assumptions, none tuned on results; the shape (several calls per model turn, issued in
parallel from code) is documented for Code Mode and programmatic tool calling, how often such calls
repeat across agents is not measured by anyone:

| Parameter | Value |
|---|---|
| calls per agent | 16, held constant in every W-code sweep so that only the shape changes |
| burst | 4 calls sent at once per step (`e2-code-burst` sweeps 1, 2, 4, 8, 16) |
| start window | agents start within 1 s (`e2-code-sync` sweeps 0, 0.1, 1, 5, 20 s) |
| think time | exponential, mean 2 s, between steps (one model turn per step) |
| surface variation | 0: arguments written by code are built mechanically (loop variables, ids copied from an earlier result) and vary less in spelling than model-written ones |

W-code does not model: per-entity fan-out into names nobody else asks for beyond the W-syn private
pool, free-form arguments such as SQL strings, a code runtime replaying recorded results, rate limits,
or server-side Code Mode, where the agent's only visible call is the program itself (ADR-037).

## 3. Metrics

| Metric | Definition |
|---|---|
| Upstream calls | `tools/call` requests that reach the producer |
| Upstream reduction | `1 − upstream(mode) / upstream(B0)`, per seed (also reported against B1 and B5: `upstream_reduction_vs_b1`, `upstream_reduction_vs_b5`) |
| Oracle reduction | `1 − (distinct names + passthrough calls) / calls`: a perfect shared cache, the bound for any mode |
| CS hit ratio | `cs_hit / (cacheable interests at the edge)` |
| PIT aggregation ratio | `pit_aggregate / (cacheable interests at the edge)` |
| Gateway cache hits | B5 only: calls answered from the edge's gateway cache (`gateway_cache_hits`) |
| In-flight duplicates | B5 only: cacheable calls that missed the gateway cache while an identical call was already upstream, and so went upstream too (`gateway_inflight_duplicates`): what a PIT would have absorbed |
| Latency | per call, consumer-observed; report p50, p95, p99 |
| Producer-link bytes | bytes crossing the producer link |
| Crypto overhead | µs per canonicalize / sign / verify (E1) |
| Stale serves | Data served with `ageMs ≥ min(freshnessMs, ttlMs)` [P-8.1, P-8.2] (must be 0) |
| Late serves | informative: Data handed over when `now − producedAt ≥ min(freshnessMs, ttlMs)` on the simulation's one clock; time in transit is not part of `ageMs` (ADR-025). Agents and forwarders also apply the signed lifetime [P-8.6, P-8.7] with the default tolerance; the pinned fingerprints of the honest E2 runs did not change when they started to (ADR-034) |
| Safety violations | accepted tampered Data + cross-context `private` serves (must be 0) |

## 4. Experiments

### E1 — Microbenchmarks
Cost of `canonicalizeArgs`, `makeName`, `signData`, `verifyData` for payloads of 1 KB–1 MB, in Node 24
and in a browser (Playwright, headless Chromium). Output: µs distributions. Supports H2.
As run: `e1-node`, six sizes from 1 KiB to 1 MiB, one timed call per iteration after a warm-up,
order statistics per cell; wall-clock, so the whole run is repeated and every repetition is kept. The
browser half has not run.

### E2 — Trace-driven simulation (main result)
`@idem/sim` with W-syn sweeps and W-trace replay, B0–B5. ≥ 10 seeds per point; report mean and 95%
CI. Plots: upstream reduction vs agents; vs overlap; latency CDFs; CS size sensitivity; TTL
sensitivity; upstream calls vs surface variation, burst size and start window against B5. Supports
H1, H2, H5 (a) and H6.
As run: `e2-agents`, `e2-overlap`, `e2-ttl`, `e2-cs-size`, `e2-think-time` (W-syn) and `e2-mixed`
(W-mixed), each with B5 added to its modes; `e2-surface` (W-syn, `surfaceVariation` ∈ {0, 0.1, 0.3,
0.5, 1}), `e2-code-burst` (W-code, burst size ∈ {1, 2, 4, 8, 16}, parallel) and `e2-code-sync` (W-code,
start window ∈ {0, 100, 1000, 5000, 20000} ms at burst 4), each with B0, B1, B5 and B2; 30 seeds per
point. `e2-surface` isolates what producer-declared canonicalization adds over B5: at 0 every repeat is
spelled the same way, so B5 and B2 can differ only by in-flight aggregation. W-trace replay waits for
E3.

Verdict rules, evaluated from `summary.csv` (a statistic is *above* or *below* zero when its 95%
interval is, as for H1 and H2; *apart* means two 95% intervals do not overlap):
- **H5 (a)**, from `upstream_reduction_vs_b5` of B2. *Surface:* at every value > 0 of `e2-surface`,
  above zero. *In flight:* at every point of the three surface-0 sweeps (`e2-surface` at 0,
  `e2-code-burst`, `e2-code-sync`) where B5's `gateway_inflight_duplicates` is above zero, above
  zero. *Neither:* at every such point where B5's mean `gateway_inflight_duplicates` is 0, neither
  above nor below zero. Supported if every evaluated point agrees and the surface and in-flight sets
  are not empty; refuted if no point of the surface or in-flight sets is above zero; partly otherwise.
- **H5 (b)**, from E5: for each baseline row and the IDEM variant it mirrors, the pair holds when the
  baseline row was accepted in at least one trial and the IDEM variant in none. Supported if every
  pair holds, refuted if none does, partly otherwise. H5 is supported if (a) and (b) are, refuted if
  both are refuted, partly otherwise.
- **H6**, from B2's `pit_aggregation_ratio` and `upstream_reduction_vs_b5`. In `e2-code-burst`
  (increasing burst size) and in `e2-code-sync` (decreasing start window), a metric *grows* when its
  values at the two ends of the sweep are apart in the stated direction and no consecutive pair of
  points is apart in the opposite direction. Supported if both metrics grow in both sweeps; refuted
  if neither metric grows in either sweep; partly otherwise.

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

Run as a Docker bench instead of Mini-NDN (`experiments/ndn/bench`, `pnpm exp:e4`; NFD 24.07 and the
overlay share each node's namespace, so both cross the same `tc netem` links). First full run:
`experiments/results/e4/20261118T141957Z-de2bcf73` (5 modes × loss 0/1/5% × 3 seeds, at 1fe5a88).
Read with H4: native NDN cuts producer-link bytes by 23% against B0 (the overlay by 9.5%) and every
IDEM mode reaches the oracle's upstream reduction at every loss; recovery time is not shorter: with a
1 s Interest lifetime before each retransmission, the native p95 is 0.7–2.5 s at 1–5% loss against at
most 0.7 s over TCP. 4 of 2,880 native calls failed (N3, 5% loss). H4 is therefore supported for
bytes and not for recovery time at these settings; an RTT-based retransmission timer is the open item.

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
- **Status.** The full run is committed (`experiments/results/e4/20261118T141957Z-de2bcf73`, read
  above); a run with at least 10 seeds is an open roadmap item. `export-web` reads `experiments/results/e4/<run-id>/` (`kind: "emulation"`:
  `summary.csv` by mode and loss, `latency_cdf.csv`, `config.json`, `env.json`) into `e4` of
  `data.json`, which is `null` until a run folder with a summary exists; `/benchmarks` then shows E4
  as its lead section (spec 04 §1.1, ADR-032). Tested with an in-memory fixture, never a committed
  result.

### E5 — Safety
Adversarial runs: tamper with Data in flight, forge names (digest mismatch), replay stale Data,
request `private` results across `authContext`s, poison attempts with a non-manifest key.
Expected: every attempt on a claim of spec 01 is rejected; counts reported. Supports H3. Stale Data
has three cases (ADR-034): an honest cache MUST NOT serve a copy past its freshness [P-8.1], a claim;
a party on the path replaying a genuine Data older than its freshness plus the clock tolerance, or
dated beyond the tolerance in the future, MUST be refused [P-8.6, P-8.7], a claim; a replay younger
than that bound is accepted by design (bounded staleness), a documented limit the suite measures.
As run: `e5-safety`, 34 variants (31 IDEM variants and 3 baseline rows) × 250 trials against the real
`Forwarder`, `Producer`, `TrustStore` and `verifyData` on a virtual clock
(`packages/sim/src/experiments/safety.ts`). A trial is rejected
only if no victim accepted forged, foreign or out-of-lifetime content and no Content Store kept any.
The consumer of the suite decides with `acceptData`, the function of `@idem/core` that every shipped
consumer uses (`IdemClient`, `IdemConsumer`, `NdnConsumer`, the simulator's agents), so the suite
exercises the shipped [P-5.5]/[P-8.7] decision; it does not model the plain-call retry: a refusal
ends the trial. The judge never reuses a node's predicate. It works on ground truth from the world:
which texts the producer made, and at what world time it made each one. Content is out of its bound
when it was made at least `ttlMs` + 60 s (`DEFAULT_CLOCK_TOLERANCE_MS`) before it reached the
consumer, or claims a `producedAt` more than 60 s in the future; the honest-cache variant keeps the
stricter reading, made at least `ttlMs` before. Each claim also names the layer that must stop it
(the forwarder's signature, digest, lifetime or partition check, the producer, or the consumer) and
the test of the suite (`safety.test.ts`) requires every trial's mechanism to show that layer, so a
claim held only because another layer caught the attack fails. Every variant carries what spec 01 says of it: `rejected` (28 variants, a claim), `limit` (2:
a replay inside the tolerance window on the producer link and on the agent link, ADR-034) or `leaks`
(the timing side channel of Q3). The replay claims are: expired Data on the producer link and on the
agent link, an old Data with an understated `ageMs` from a malicious regional forwarder (stopped at
the edge's signed-lifetime check), and a Data the producer signed with a far-future `producedAt`
(assumes a producer clock glitch; stopped at the edge). The producer-link limit also checks the bound:
after the replay, a later consumer asking once the copy is outside its lifetime must get a fresh
answer. `private/authcontext-known` (a consumer that puts the victim's `authContext` in its own
Interest) is a claim like the other `private` variants since the edge ignores the field (ADR-033).
The counts of the run that matches this code are reported in the results; earlier runs describe the
engine before ADR-033 and ADR-034.
Baseline rows (ADR-036; supports H5 (b)): three variants run the attack of an IDEM variant against B5,
in a world of plain MCP clients, the same producer answering as a plain MCP server, and the
simulator's gateway cache in front of a core forwarder relaying plain calls.
`baseline/tamper-cache@edge` (mirrors `tamper/content@last-hop`: a compromised, buggy or malicious
gateway or cache backend rewrites a stored result, and every later user of that call is served it);
`baseline/tamper@upstream` (mirrors `tamper/content@upstream`; assumes the attacker controls the
link between the gateway and the producer, with no TLS on that hop or a compromised hop on it: the
result is rewritten there, cached, and served to later users; only the later users, answered from the
gateway cache, are judged, since the first user's own answer crossed the rewritten link and plain MCP
with no cache would take it too, and a trial in which no later user was answered from the cache is a
setup failure); `baseline/private-miskeyed@edge` (mirrors `private/sequential`: the operator lists the
per-user tool as cacheable without a per-credential partition, keyed on tool and arguments as
`mcp-proxy` and ContextForge key, the misconfiguration the MCP SDK's `cacheScope` warning describes,
and a second user receives the first user's result; B5 as run in E2 partitions such a tool per
credential and would not leak here, nor would FastMCP's per-token key). They are judged on ground
truth the same way: a trial is accepted when a client took a text the producer did not make for that
call, another user's result, or a cache holds one. They carry `expected: "baseline"` and the
id of the variant they mirror (`mirrors` in `metrics.csv`): acceptance is the outcome, shown next to
IDEM's rejection of the same attack; they are not claims, not findings, and not part of the IDEM
counts. `export-web` puts them in `e5.baseline`, apart from `e5.rows`.

## 5. Reporting rules

- Every figure is produced by `experiments/plots/*.py` from committed results; the script name and run
  ids go in the figure caption. The `/benchmarks` page draws its own charts from the same run folders
  (through `data.json`) and names the runs under each figure.
- A refuted hypothesis is reported as refuted, with the data.
- Simulation results are labeled "simulation"; emulation results "emulation". They are not mixed in one
  number.
