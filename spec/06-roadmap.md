# 06 — Roadmap

Milestones are ordered by dependency. Durations are not fixed until the course deadline is known.
Each milestone ends with its acceptance criteria met and the checklist ticked.

## M0 — Scaffold
- [x] Verify current versions (`pnpm view`) for everything in the CLAUDE.md stack table; record them in ADR-008
- [x] pnpm workspace + Turborepo; `packages/{core,mcp,gateway,sim}`, `apps/web`, `experiments/` (`ndn` added in M6)
- [x] TypeScript 7 strict, tsdown per package, Biome, Vitest, fast-check
- [x] CI (GitHub Actions): lint, typecheck, test, build (workflow written; needs a GitHub repo)
- [ ] `apps/web` boots with Next 16.4 + Tailwind 4 + the in-house docs renderer (ADR-022 replaced Fumadocs); first Vercel preview deploy

**Accept:** `pnpm i && pnpm lint && pnpm test && pnpm build` green; preview URL live.

## M1 — `@idem/core`
- [x] JCS (RFC 8785) with test vectors from the RFC
- [x] Normalizers (§3) + `canonicalizeArgs`, property tests [P-3.5]
- [x] `toolSchemaDigest`, `makeName`, `parseName` [P-2.x]
- [x] Ed25519 via WebCrypto (fallback documented), `signData`/`verifyData`, manifest sign/verify [P-5.x, P-6.x]
- [x] `MemoryContentStore` (lru/lfu/fifo, byte budget), freshness with `ageMs` [P-7.4, P-8.1]
- [x] `Forwarder` engine with PIT, CS, FIB, limits, events [P-4.3, P-4.4, P-7.x]
- [x] `RealClock`, `VirtualClock`
- [x] Q7 closed: the edge derives `authContext` itself and ignores any value in a received Interest, on every face [P-8.4] (ADR-033, 2026-11-27)
- [x] Q6 closed: signed lifetime, two-sided, default tolerance 60 s (`lifetimeState`, `clockToleranceMs`); wire error `EXPIRED`, local error `CLOCK_SKEW` after the plain-call retry [P-8.6, P-8.7] (ADR-034, 2026-11-27). What remains is bounded staleness inside the tolerance
- [ ] Test runs in Node **and** browser mode (proves "one core")

**Accept:** every MUST in protocol §2–§8 has a test citing its id; core has no `node:*` imports (lint rule).

## M2 — `@idem/mcp` + demo producer
- [x] MCP v2 producer that signs results (`createMcpProducer`); manifest at `/.well-known/idem.json` (`server/discover` `_meta` still pending; `withIdem(server)` wrapper still pending)
- [x] `IdemConsumer.verifyToolResult`
- [x] Demo tools + static corpus (`fetch_page`, `search_corpus`, `weather`, `my_notes`, `send_email`)
- [x] Demo producer served in `apps/web` (SDK v2 `createMcpHandler` directly, not `mcp-handler`)
- [x] Interop test: an unmodified MCP v2 client calls the producer and still works (ignores `_meta`)

**Accept:** a plain MCP client and an IDEM-aware client both get correct results; signatures verify.

## M3 — `@idem/gateway`
- [x] Transparent MCP endpoint (`createMcpEdge`, `/api/mcp`) — routes via the SDK, not raw `Mcp-Method` parsing
- [x] Forwarder ↔ forwarder endpoint (`POST /idem/v1/interest`)
- [x] `authContext` derivation (HMAC) and `private` partitioning [P-8.3, P-8.4]
- [x] Proxy-producer mode for legacy servers: `createProxyProducer` in `@idem/mcp`, a producer with its own name and key in front of an unmodified MCP server, operator policy per tool, schema-drift check [P-9.5]–[P-9.8] (ADR-038, 2026-11-27; tests in `packages/mcp/src/proxy.test.ts`)
- [ ] Forwarders and consumers re-read a manifest after `NOT_CACHEABLE`/`DIGEST_MISMATCH`. Today they read it once, so after a proxy refreshes its manifest an edge answers those errors for the changed tool until restarted (ADR-038)
- [x] Integration test: 3 concurrent agents → 1 upstream call; 4th agent → CS hit (real sockets, and via plain MCP clients)

**Accept:** integration test green locally and against the Vercel preview.

## M4 — Simulator + experiments E1, E2, E5
- [x] `@idem/sim`: event queue, links (delay/loss/bandwidth), workloads W-syn and W-trace, modes B0–B2 + B4 (B3 via `buildTopology({kind:"tree"})`)
- [x] `@idem/sim` on arbitrary graphs (ADR-027): several producers with their own tools and keys, latency-shortest routes per producer, multi-homed agents, per-agent tool mixes (`search_corpus`, `weather` added), per-forwarder CS size; every committed config runs unchanged (fingerprint test)
- [x] `pnpm sim` CLI writing the results layout from `05-evaluation.md` (ADR-023; also `calibrate`, `export-web`, `digest`)
- [ ] E1 microbenchmarks (Node + Playwright browser). Node half done (`e1-node`, 15 runs kept, the last five from the rerun of 2026-11-27); the browser half has not run
- [x] E2 sweeps with ≥ 10 seeds (six sweeps, 30 seeds per point, W-syn and W-mixed; W-trace waits for E3); E5 safety suite (27 variants × 250 trials: 23 of 24 claims hold, one open finding, Q7; stale replay measured as the documented limit of ADR-025). History: that was run `e5-safety/20261117T133645Z-90135038`, before ADR-033 and ADR-034; the rerun below supersedes it
- [x] B5 `mcp-gateway-cache`, the industry baseline: plain MCP with one shared, unsigned exact-match cache at the edge (`packages/sim/src/gateway-cache.ts`), added to the six sweeps; new sweep `e2-surface`; metrics `upstream_reduction_vs_b5`, `gateway_cache_hits`, `gateway_inflight_duplicates`; three baseline rows in E5 (ADR-036, 2026-11-27)
- [x] W-code, calls issued by code in bursts: `burst` and `startSpreadMs` in the workload; sweeps `e2-code-burst` and `e2-code-sync` (ADR-037, 2026-11-27)
- [x] H5 (what the protocol adds to a shared cache) and H6 (code-driven bursts) stated in spec 00 §6, with verdict rules written before the runs in spec 05 §4 (ADR-035, ADR-036, ADR-037). The verdicts are computed from `summary.csv` on `/benchmarks`, not stated here
- [x] E1, E2 and E5 rerun with `experiments/run-all.sh` (2026-11-27; five new `e1-node` runs at source digest `381e7337`), then E2 and E5 rerun once more after the review fixes below (source digest `4e27e60b`, 30 seeds per E2 point; the first rerun's E2 and E5 folders were superseded before any commit and are not kept). E2 runs: `e2-agents/20261127T102434Z-4e27e60b`, `e2-overlap/20261127T102522Z-4e27e60b`, `e2-ttl/20261127T102600Z-4e27e60b`, `e2-cs-size/20261127T102640Z-4e27e60b`, `e2-think-time/20261127T102713Z-4e27e60b`, `e2-mixed/20261127T102745Z-4e27e60b`, `e2-surface/20261127T102802Z-4e27e60b`, `e2-code-burst/20261127T102820Z-4e27e60b`, `e2-code-sync/20261127T102834Z-4e27e60b`. E5 run `e5-safety/20261127T102848Z-4e27e60b`, 34 variants × 250 trials, read from its `metrics.csv`: all 28 claims rejected in 250 of 250 trials, `private/authcontext-known` and `replay/expired@upstream`/`@last-hop` among them; the 2 limits (`replay/in-tolerance@upstream`, `@last-hop`) accepted in 250 of 250, as documented (ADR-034); the 1 leak (`timing/cache-probe`, Q3) in 250 of 250; the 3 baseline rows (B5) accepted in 250 of 250 while the IDEM variants they mirror were accepted in 0
- [x] Review fixes (2026-11-27, an independent review of the changes of ADR-033 to ADR-038; amendments in those ADRs): [P-9.7] the proxy chooses the credential by the operator's declared policy; parallel bursts are deterministic for a seed (`determinism.test.ts`); a waiter that asked for fresh Data receives only fresh Data, passthrough included [P-8.6]; one consumer decision, `acceptData`, shared by every consumer and the E5 harness; the E5 judge works on ground truth and each claim names the layer that must stop it; B5 caches `private` tools per credential
- [ ] Confirm the re-pinned `tree-loss/idem` fingerprint on Linux (CI): its darwin value was recorded after the determinism fix and copied to the linux entry unverified
- [x] `experiments/plots` (uv + matplotlib) rendering all figures (`make_figures.py` → `experiments/plots/out/`)

**Accept:** `make`-style one-command reproduction of E1, E2, E5 from a clean checkout: `experiments/run-all.sh`.

## M5 — Showcase + docs on Vercel
- [ ] `/sandbox` per `04-showcase.md` §2 (canvas, split comparison, controls, log, attack buttons)
- [ ] `/docs` IA per §4, protocol page rendered from `spec/01-protocol.md`, API reference checked against `packages/*/src` (ADR-022). Built, typecheck and lint green; the box waits for the in-site checks listed in `tasks/docs.md` (the dev server was down when it was finished)
- [ ] `/benchmarks` (was `/results`) from committed results. Built in both languages from `lib/results/data.json`; typecheck, lint and an offline render (both locales, both themes) are green; the box waits for the in-site check listed in `tasks/results.md` (the dev server was down when it was finished)
- [ ] `/sandbox/live` against deployed gateway + producer (LLM swarm still off)
- [x] Related work and the novelty claim restated; docs pages `use-cases` and `related-work` in en and pt; [ARCTICSWARM] pinned to v1 (ADR-035, 2026-11-27). Their in-site check is an open box in `tasks/docs.md`
- [x] Docs brought level with ADR-033 to ADR-038: security, concepts, evaluation, API, architecture and sandbox pages in en and pt, and the Portuguese protocol translation with its hash (2026-11-27; `pages.test.ts` and the docs loader tests green, not opened in the site)
- [ ] `/benchmarks` and the sandbox's Live mode after ADR-033 to ADR-037: B5, the W-code sweeps, H5 and H6, the E5 baseline group and the new replay variants on the page; `EXPIRED` retries and `CLOCK_SKEW` in Live mode (see `tasks/results.md` and `tasks/sandbox.md`)
- [ ] Rate limits, env vars, production deploy

**Accept:** production URL; sandbox deterministic per seed; no number on any page without a results source.

## M6 — Native NDN + E3, E4
- [x] `@idem/ndn` producer/consumer with NDNts (in-process round trip over `@ndn/fw`); Q1 resolved by ADR-026 (2026-11-18)
- [x] Sandbox: native NDN view of a Live exchange (`apps/web/lib/sandbox/ndn.ts`, `components/sandbox/ndn-packet.tsx`; not wired in yet)
- [x] `@idem/ndn` against a real NFD: TCP, UDP and WebSocket faces, 9 scenarios, `pnpm exp:ndn` (2026-11-18)
- [ ] Runnable native producer/consumer (CLI) for Mini-NDN
- [ ] Mini-NDN topologies (star, tree) + netem scripts. Replaced by a Docker bench (`experiments/ndn/bench`: NFD 24.07 + overlay sidecars per namespace, star and tree, `tc netem` per link, `pnpm exp:e4`); built and smoke-tested, Mini-NDN itself not used (needs a Linux host)
- [ ] E3 real-agent traces (budgeted); E4 overlay vs native under loss: full run committed (`experiments/results/e4/20261118T141957Z-de2bcf73`, 2026-11-18), on `/benchmarks`; E3 not run
- [ ] E3 with real traces. Options: a budgeted real swarm (the plan above); the public DynamicMCPBench traces [DYNAMICMCPBENCH] as a single-agent stand-in (no public trace found with cooperating agents, arguments, timestamps and a clear licence)
- [ ] E4 with at least 10 seeds (the committed run has 3; about 2.5 h of Docker)
- [ ] RTT-based retransmission timer for the native consumer (today a fixed InterestLifetime before each retransmission, spec 05 E4)
- [x] YaNFD (ndnd's forwarder) compiled to WebAssembly with a JS face bridge: PIT aggregation, Content Store and a 3-router chain pass on real NDN packets (`experiments/ndn/yanfd-wasm/`, 2026-11-18)
- [x] Sandbox as a network editor (start screen; examples or a blank canvas; draggable, configurable agents, forwarders and producers); NDN routers in the editor are YaNFD on WebAssembly, one per forwarder node, in the visitor's browser (ADR-028, 2026-11-18; the author's Safari check is in `spec/tasks/sandbox.md`)
- [x] Docker benchmarks of the native version (E4 and native-only measurements, NFD containers + netem): `pnpm exp:e4`, full run 2026-11-18 (45 runs, 44.6 min); the agents' handshake now retransmits (a lost Interest at startup ended the first attempt)

**Accept:** same workload runs on overlay and native NDN; E4 figures produced.

## M7 — Report and presentation (Portuguese)
- [ ] Report following `templates/PADRAO-RELATORIOS.md` in `../listas/YYYY-MM-DD_Projeto-IDEM/`
- [ ] Figures from `experiments/plots`, captions citing run ids
- [ ] ABNT reference list from `08-references.md`
- [ ] Slides / live demo of the sandbox for the class
- [ ] Option, not a commitment: a paper for the SBRC 2027 main track (registration 11 Jan 2027, submission 18 Jan 2027, 14 pages)

**Accept:** PDF built by the course template script with the standard file name.

## Future (after the course)
- [ ] Sandbox: "connect to the NDN testbed". Agents and producers in the editor reach the public NDN testbed (NFD routers over WebSocket, e.g. through NDN-FCH) instead of in-browser routers; producing a prefix needs a testbed certificate (NDNCERT). Kept out of the course scope: it depends on community infrastructure and certificates.
- [ ] Offer the YaNFD WebAssembly face bridge upstream to named-data/ndnd.

## Cut lines (if time runs short)
1. Drop `/sandbox/live` LLM swarm; keep E3 with a smaller budget, a public trace as a stand-in, or a synthetic trace.
2. Keep E4 at its committed 3-seed run and skip the 10-seed rerun. (The earlier cut line, a single Mini-NDN topology without loss sweeps, is moot: E4 ran on the Docker bench with both topologies and the loss sweep.)
Never cut: M1 tests for MUST rules, E5 safety, the "no unsourced numbers" rule.
