# Results — benchmarks and the results page

Rule: every number shown comes from `experiments/results/**`, produced by a versioned script with the
seed and the source revision recorded (spec 05).

- [x] `pnpm sim` CLI writing the spec 05 results layout (`config.json`, `metrics.csv`, `seed`, `git-sha`, `env.json`), plus `source-digest` (the checkout is not a git repository), `summary.csv` and `latency_cdf.csv` for sweeps, `trials.csv` for E5. Commands: run (`--config`, `--seed`), `calibrate`, `export-web`, `digest`. One command for everything: `experiments/run-all.sh` (2026-11-17)
- [x] E1 microbenchmarks (Node): canonicalize, makeName, sign, verify for 1 KiB to 1 MiB (`e1-node`, 10 runs kept; 5 of them were taken while the machine was busy, recorded in `env.json`)
- [ ] E1 in a browser (Playwright, headless Chromium): not run. The runner uses Web APIs only, so it can be loaded in a page as is
- [x] E2 sweeps: B0 to B4 over agents and overlap, at least 10 seeds per point, mean and 95% CI (`e2-agents`, `e2-overlap`, 30 seeds), plus TTL, Content Store size, think time (`e2-ttl`, `e2-cs-size`, `e2-think-time`) and W-mixed (`e2-mixed`)
- [x] Simulator support for the evaluation, with tests: CPU costs charged from E1 (`SimConfig.processing`), plain-MCP baselines (`producer.signPlainCalls: false`), `workloadStats()` and the oracle bound, `lateServes`, hits beyond the edge, paired seeds across modes, the consumer's name check, the [P-5.5] retry held to ADR-024
- [x] E5 safety suite, counts recorded: 27 variants × 250 trials. 23 of the 24 claims hold in every trial; `private/authcontext-known` is accepted (open finding, ADR-023, Q7); on-path stale replay is accepted and reported as the documented v1 limit of ADR-025; the timing side channel of Q3 leaks as declared
- [x] Plots (uv + matplotlib) and web charts generated from the committed results (`experiments/plots/make_figures.py` → `experiments/plots/out/*.pdf|png` and `captions.json`)
- [x] `/results` page built from the committed results, in both languages: `lib/results/data.json` (generated, checked by a test against the run folders), verdicts on H1 to H3 computed from the data, charts as server-rendered SVG with a table under each
- [ ] `/results` checked in the running site: `curl` 200 in both locales and a look at the entrance motion. Pending, the author's dev server was down. Done instead: typecheck, lint, and an offline render of the page component in en and pt, dark and light, at 1280 px and 390 px (screenshots reviewed, then discarded)
- [x] Roadmap M4 boxes ticked; spec 05 updated with the pipeline "as run"; ADR-023 recorded; E5 reworded against ADR-025
- [ ] E3 (real-agent traces) and W-trace replay: out of scope, needs a budgeted LLM swarm
- [ ] E4 (Docker / Mini-NDN emulation): out of scope, needs Docker; H4 stays not evaluated
- [x] `pnpm exp:e1` and `pnpm exp:all` wired in the root `package.json` by the main session (was: not wired in the root `package.json`, which this area does not own; the equivalent is `pnpm sim -- --config experiments/configs/e1-node.json`
- [x] (already updated by the spec reconciliation, ADR-024 round) `spec/03-api.md` still shows the old `SimConfig` (no `idem-noverify`, `processing` or `signPlainCalls`); that file belongs to another area
- [ ] Rerun E1 on a quiet machine: half of the kept runs carry a load average far above the core count, which widens the reported spread (the medians barely move the E2 results: a miss costs 272 µs against a 90 ms round trip)
- [ ] Fix for Q7 (the engine should derive `authContext` itself and ignore one that arrives), then rerun E5: `safety.test.ts` fails on purpose when the finding is fixed
- [x] Tab and route renamed: "Results" → "Benchmarks", `/results` → `/benchmarks` (permanent redirect in `next.config.mts`), en + pt labels, links in the landing, sandbox, footer, docs and spec (2026-11-18)

## Benchmarks redesign (ADR-032)

- [x] Mini navbar on `/benchmarks`: the home page's `SectionNav` mounts on both routes (`SECTION_NAV_PATHS`); sections marked with `data-nav-section` and a translated `data-nav-label`
- [x] One story: Native NDN (E4, NFD check) first, then Verdicts, E2 (Redundancy, Latency, Sensitivity), E1 (Cost), E5 (Safety), Method; each section opens with its question and a computed one-line verdict (en and pt)
- [x] Interactive line charts: crosshair and readout card with exact values and 95% interval, nearest-x and nearest-point modes, one tab stop with arrow keys, live region, legend that highlights and toggles; tabs for the E4 metrics and loss levels; the per-miss CPU bar and list light each other
- [x] No C-shaped edges: `.r-tile` uses an inset solid square; a test fails on a thick one-sided border in `results.css`
- [x] `export-web` exports `nfd` (last five `ndn-nfd` runs) and `e4` (`kind: "emulation"`), tested with in-memory fixtures; `data.json` regenerated
- [x] E4 pending state on the page: no E4 data, no number; the headline tile and the hero say it has not run
- [ ] E4 full run committed under `experiments/results/e4/`, then `pnpm sim -- export-web` and a look at the lead section with real numbers (wording of the verdict, axis ranges)
- [ ] Re-run `pnpm exp:ndn` so the latest NFD run is not the one where S8 stopped on a route authorization error
- [ ] Look at `/benchmarks` in the running site (Safari, 390 px, light and dark): readout card placement, legend toggles, tabs, the navbar over the sections
