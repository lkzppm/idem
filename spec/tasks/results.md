# Results — benchmarks and the results page

Rule: every number shown comes from `experiments/results/**`, produced by a versioned script with the
seed and the source revision recorded (spec 05).

- [x] `pnpm sim` CLI writing the spec 05 results layout (`config.json`, `metrics.csv`, `seed`, `git-sha`, `env.json`), plus `source-digest` (the checkout is not a git repository), `summary.csv` and `latency_cdf.csv` for sweeps, `trials.csv` for E5. Commands: run (`--config`, `--seed`), `calibrate`, `export-web`, `digest`. One command for everything: `experiments/run-all.sh` (2026-11-17)
- [x] E1 microbenchmarks (Node): canonicalize, makeName, sign, verify for 1 KiB to 1 MiB (`e1-node`, 10 runs kept; 5 of them were taken while the machine was busy, recorded in `env.json`). Five more were added by the rerun of 2026-11-27 (15 kept; the page pools every run)
- [ ] E1 in a browser (Playwright, headless Chromium): not run. The runner uses Web APIs only, so it can be loaded in a page as is
- [x] E2 sweeps: B0 to B4 over agents and overlap, at least 10 seeds per point, mean and 95% CI (`e2-agents`, `e2-overlap`, 30 seeds), plus TTL, Content Store size, think time (`e2-ttl`, `e2-cs-size`, `e2-think-time`) and W-mixed (`e2-mixed`). History: these were the runs `…-90135038` of 2026-11-17; rerun with B5 on 2026-11-27, see below
- [x] Simulator support for the evaluation, with tests: CPU costs charged from E1 (`SimConfig.processing`), plain-MCP baselines (`producer.signPlainCalls: false`), `workloadStats()` and the oracle bound, `lateServes`, hits beyond the edge, paired seeds across modes, the consumer's name check, the [P-5.5] retry held to ADR-024
- [x] E5 safety suite, counts recorded: 27 variants × 250 trials. 23 of the 24 claims hold in every trial; `private/authcontext-known` is accepted (open finding, ADR-023, Q7); on-path stale replay is accepted and reported as the documented v1 limit of ADR-025; the timing side channel of Q3 leaks as declared. History: run `e5-safety/20261117T133645Z-90135038`, before ADR-033 and ADR-034; superseded by the rerun below
- [x] Plots (uv + matplotlib) and web charts generated from the committed results (`experiments/plots/make_figures.py` → `experiments/plots/out/*.pdf|png` and `captions.json`)
- [x] `/results` page built from the committed results, in both languages: `lib/results/data.json` (generated, checked by a test against the run folders), verdicts on H1 to H3 computed from the data, charts as server-rendered SVG with a table under each
- [ ] `/results` checked in the running site: `curl` 200 in both locales and a look at the entrance motion. Pending, the author's dev server was down. Done instead: typecheck, lint, and an offline render of the page component in en and pt, dark and light, at 1280 px and 390 px (screenshots reviewed, then discarded)
- [x] Roadmap M4 boxes ticked; spec 05 updated with the pipeline "as run"; ADR-023 recorded; E5 reworded against ADR-025
- [ ] E3 (real-agent traces) and W-trace replay: out of scope, needs a budgeted LLM swarm
- [x] E4 run on the Docker bench (2026-11-18, `experiments/results/e4/20261118T141957Z-de2bcf73`); the page's H4 rule is still not written, so H4 shows as not evaluated
- [x] `pnpm exp:e1` and `pnpm exp:all` wired in the root `package.json` by the main session (was: not wired in the root `package.json`, which this area does not own; the equivalent is `pnpm sim -- --config experiments/configs/e1-node.json`
- [x] (already updated by the spec reconciliation, ADR-024 round) `spec/03-api.md` still shows the old `SimConfig` (no `idem-noverify`, `processing` or `signPlainCalls`); that file belongs to another area
- [ ] Rerun E1 on a quiet machine: half of the kept runs carry a load average far above the core count, which widens the reported spread (the medians barely move the E2 results: a miss cost 272 µs against a 90 ms round trip in the export of 2026-11-17, and 251 µs after the rerun of 2026-11-27, `missOverhead.totalUs` in `lib/results/data.json`). Still open: the five runs of 2026-11-27 started with a 1-minute load average between 1.7 and 2.2 on 10 cores, but the page pools all 15 runs, the busy ones included
- [x] Fix for Q7: the engine derives `authContext` itself and ignores one that arrives [P-8.4] (ADR-033). E5 rerun (`e5-safety/20261127T102848Z-4e27e60b`): `private/authcontext-known` rejected in 250 of 250 trials; `safety.test.ts` now asserts every `expected: "rejected"` variant with no exception list (2026-11-27)
- [x] Tab and route renamed: "Results" → "Benchmarks", `/results` → `/benchmarks` (permanent redirect in `next.config.mts`), en + pt labels, links in the landing, sandbox, footer, docs and spec (2026-11-18)

## Benchmarks redesign (ADR-032)

- [x] Mini navbar on `/benchmarks`: the home page's `SectionNav` mounts on both routes (`SECTION_NAV_PATHS`); sections marked with `data-nav-section` and a translated `data-nav-label`
- [x] One story: Native NDN (E4, NFD check) first, then Verdicts, E2 (Redundancy, Latency, Sensitivity), E1 (Cost), E5 (Safety), Method; each section opens with its question and a computed one-line verdict (en and pt)
- [x] Interactive line charts: crosshair and readout card with exact values and 95% interval, nearest-x and nearest-point modes, one tab stop with arrow keys, live region, legend that highlights and toggles; tabs for the E4 metrics and loss levels; the per-miss CPU bar and list light each other
- [x] No C-shaped edges: `.r-tile` uses an inset solid square; a test fails on a thick one-sided border in `results.css`
- [x] `export-web` exports `nfd` (last five `ndn-nfd` runs) and `e4` (`kind: "emulation"`), tested with in-memory fixtures; `data.json` regenerated
- [x] E4 pending state on the page: no E4 data, no number; the headline tile and the hero say it has not run
- [x] E4 full run committed under `experiments/results/e4/`, exported, lead section checked in WebKit; the verdict line adds the p95 tail; the completion axis stops at 100%
- [ ] Re-run `pnpm exp:ndn` so the latest NFD run is not the one where S8 stopped on a route authorization error
- [ ] Look at `/benchmarks` in the running site (Safari, 390 px, light and dark): readout card placement, legend toggles, tabs, the navbar over the sections

## After ADR-033 to ADR-037 (2026-11-27)

- [x] Signed lifetime in the suite (ADR-034): the E5 judge uses `lifetimeState` with the default tolerance; `replay/expired@upstream` and `@last-hop` are claims; new claims `replay/understated-age@core` and `replay/future-dated@upstream`; new limits `replay/in-tolerance@upstream` and `@last-hop` (`safety.test.ts`)
- [x] B5 `mcp-gateway-cache` in the simulator (`gateway-cache.ts`, `gateway-cache.test.ts`), added to the six sweeps; new sweep `e2-surface`; metrics `upstream_reduction_vs_b5`, `gateway_cache_hits`, `gateway_inflight_duplicates`; fingerprints of the committed B0 to B4 runs unchanged (`legacy.test.ts`) (ADR-036)
- [x] W-code: `burst` and `startSpreadMs` (`burst.test.ts`); sweeps `e2-code-burst` and `e2-code-sync` (ADR-037)
- [x] E5 baseline group: three rows against B5 with `expected: "baseline"` and `mirrors`, exported apart in `e5.baseline` (`safety.test.ts`, `export.test.ts`)
- [x] `experiments/run-all.sh` rerun (2026-11-27): five `e1-node` runs (source digest `381e7337`); after the review fixes, the nine E2 sweeps and E5 rerun at source digest `4e27e60b` (`e2-agents/20261127T102434Z-4e27e60b` to `e2-code-sync/20261127T102834Z-4e27e60b`, 30 seeds per point), `e5-safety/20261127T102848Z-4e27e60b`, and `lib/results/data.json` regenerated
- [x] E5 counts of that run, read from its `metrics.csv`: 34 variants × 250 trials. 28 of 28 claims rejected in 250 of 250 trials. 2 limits (`replay/in-tolerance@upstream`, `@last-hop`) accepted in 250 of 250, as ADR-034 documents. 1 leak (`timing/cache-probe`, Q3) in 250 of 250. 3 baseline rows accepted in 250 of 250; the IDEM variants they mirror (`tamper/content@last-hop`, `tamper/content@upstream`, `private/sequential`) accepted in 0
- [x] `/benchmarks` shows B5, the three new sweeps, the H5 and H6 verdicts computed by the rules of spec 05 §4, and the E5 baseline group beside the IDEM variants it mirrors
- [x] `lib/i18n/messages/results.ts`, en and pt: the H3 rule no longer puts expired replay out of scope (it cited ADR-025); the `private/authcontext-known` finding text; the replay texts ("older than freshness plus tolerance"); texts for `replay/in-tolerance@upstream`, `@last-hop`, `replay/understated-age@core`, `replay/future-dated@upstream`
- [x] Figures for the report (`experiments/plots/make_figures.py`) draw B5 and the three new sweeps, with the run ids in the captions
- [ ] `/benchmarks` after those changes, checked in the running site (nobody opened the site on 2026-11-27)
- [ ] E3 with real traces: a budgeted real swarm, or the public DynamicMCPBench traces as a single-agent stand-in (roadmap M6)
- [ ] E4 with at least 10 seeds (the committed run has 3; roadmap M6)
