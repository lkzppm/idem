# 06 — Roadmap

Milestones are ordered by dependency. Durations are not fixed until the course deadline is known.
Each milestone ends with its acceptance criteria met and the checklist ticked.

## M0 — Scaffold
- [x] Verify current versions (`pnpm view`) for everything in the CLAUDE.md stack table; record them in ADR-008
- [x] pnpm workspace + Turborepo; `packages/{core,mcp,gateway,sim}`, `apps/web`, `experiments/` (`ndn` added in M6)
- [x] TypeScript 7 strict, tsdown per package, Biome, Vitest, fast-check
- [x] CI (GitHub Actions): lint, typecheck, test, build (workflow written; needs a GitHub repo)
- [ ] `apps/web` boots with Next 16.4 + Tailwind 4 + Fumadocs; first Vercel preview deploy

**Accept:** `pnpm i && pnpm lint && pnpm test && pnpm build` green; preview URL live.

## M1 — `@idem/core`
- [x] JCS (RFC 8785) with test vectors from the RFC
- [x] Normalizers (§3) + `canonicalizeArgs`, property tests [P-3.5]
- [x] `toolSchemaDigest`, `makeName`, `parseName` [P-2.x]
- [x] Ed25519 via WebCrypto (fallback documented), `signData`/`verifyData`, manifest sign/verify [P-5.x, P-6.x]
- [x] `MemoryContentStore` (lru/lfu/fifo, byte budget), freshness with `ageMs` [P-7.4, P-8.1]
- [x] `Forwarder` engine with PIT, CS, FIB, limits, events [P-4.3, P-4.4, P-7.x]
- [x] `RealClock`, `VirtualClock`
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
- [ ] Proxy-producer mode for legacy servers (optional, flagged)
- [x] Integration test: 3 concurrent agents → 1 upstream call; 4th agent → CS hit (real sockets, and via plain MCP clients)

**Accept:** integration test green locally and against the Vercel preview.

## M4 — Simulator + experiments E1, E2, E5
- [x] `@idem/sim`: event queue, links (delay/loss/bandwidth), workloads W-syn and W-trace, modes B0–B2 + B4 (B3 via `buildTopology({kind:"tree"})`)
- [x] `pnpm sim` CLI writing the results layout from `05-evaluation.md` (ADR-023; also `calibrate`, `export-web`, `digest`)
- [ ] E1 microbenchmarks (Node + Playwright browser). Node half done (`e1-node`, 10 runs kept); the browser half has not run
- [x] E2 sweeps with ≥ 10 seeds (six sweeps, 30 seeds per point, W-syn and W-mixed; W-trace waits for E3); E5 safety suite (27 variants × 250 trials: 23 of 24 claims hold, one open finding, Q7; stale replay measured as the documented limit of ADR-025)
- [x] `experiments/plots` (uv + matplotlib) rendering all figures (`make_figures.py` → `experiments/plots/out/`)

**Accept:** `make`-style one-command reproduction of E1, E2, E5 from a clean checkout: `experiments/run-all.sh`.

## M5 — Showcase + docs on Vercel
- [ ] `/sandbox` per `04-showcase.md` §2 (canvas, split comparison, controls, log, attack buttons)
- [ ] `/docs` IA per §4, protocol page rendered from `spec/01-protocol.md`, API reference checked against `packages/*/src` (ADR-022). Built, typecheck and lint green; the box waits for the in-site checks listed in `tasks/docs.md` (the dev server was down when it was finished)
- [ ] `/results` from committed results. Built in both languages from `lib/results/data.json`; typecheck, lint and an offline render (both locales, both themes) are green; the box waits for the in-site check listed in `tasks/results.md` (the dev server was down when it was finished)
- [ ] `/sandbox/live` against deployed gateway + producer (LLM swarm still off)
- [ ] Rate limits, env vars, production deploy

**Accept:** production URL; sandbox deterministic per seed; no number on any page without a results source.

## M6 — Native NDN + E3, E4
- [x] `@idem/ndn` producer/consumer with NDNts (in-process round trip over `@ndn/fw`); Q1 resolved by ADR-026 (2026-11-18)
- [x] Sandbox: native NDN view of a Live exchange (`apps/web/lib/sandbox/ndn.ts`, `components/sandbox/ndn-packet.tsx`; not wired in yet)
- [ ] `@idem/ndn` against a real NFD (WebSocket/UDP face) and a runnable native producer/consumer for Mini-NDN
- [ ] Mini-NDN topologies (star, tree) + netem scripts. Replaced by a Docker bench (`experiments/ndn/bench`: NFD 24.07 + overlay sidecars per namespace, star and tree, `tc netem` per link, `pnpm exp:e4`); built and smoke-tested, Mini-NDN itself not used (needs a Linux host)
- [ ] E3 real-agent traces (budgeted); E4 overlay vs native under loss (harness, config and figures script ready; the full run has not been executed, so there is no E4 number yet)

**Accept:** same workload runs on overlay and native NDN; E4 figures produced.

## M7 — Report and presentation (Portuguese)
- [ ] Report following `templates/PADRAO-RELATORIOS.md` in `../listas/YYYY-MM-DD_Projeto-IDEM/`
- [ ] Figures from `experiments/plots`, captions citing run ids
- [ ] ABNT reference list from `08-references.md`
- [ ] Slides / live demo of the sandbox for the class

**Accept:** PDF built by the course template script with the standard file name.

## Cut lines (if time runs short)
1. Drop proxy-producer mode (M3).
2. Drop `/sandbox/live` LLM swarm; keep E3 with a smaller budget or a synthetic trace.
3. Reduce M6 to a single Mini-NDN topology without loss sweeps.
Never cut: M1 tests for MUST rules, E5 safety, the "no unsourced numbers" rule.
