# IDEM — LLM tool calls as named data

> Prototype for the **EEL878 — Computer Networks I** project (UFRJ/Poli, 2026/2), Lucas Pacheco.
> **Status:** proposal (awaiting the professor's approval). The `spec/` folder is the source of truth.

## What it is

IDEM (_Interest-Driven Exchange for Models_) is a **content-centric** transport layer for the
Model Context Protocol (MCP). A read-only tool call becomes a **name** derived from the tool and its
canonicalized arguments. The result becomes a **Data object signed** by the producer. Any node on the
path can serve that Data, and whoever receives it verifies the signature. Identical concurrent requests
are aggregated (PIT). It is the Named Data Networking model applied to tool calling.

Thesis in one line: _if the question is the same, the answer is the same, and it does not need to cross the network again._

## Read before coding

| When                                              | Read                                           |
| ------------------------------------------------- | ---------------------------------------------- |
| Always, in the first session                      | `spec/README.md` → `spec/00-vision.md`         |
| Touching names, envelope, signatures, PIT/CS      | `spec/01-protocol.md` (normative, MUST/SHOULD) |
| Creating or changing a package                    | `spec/02-architecture.md` + `spec/03-api.md`   |
| Touching the site, sandbox, docs or deploy        | `spec/04-showcase.md`                          |
| Running or adding an experiment, quoting a number | `spec/05-evaluation.md`                        |
| Picking the next task                             | `spec/06-roadmap.md`                           |
| Making a design decision                          | `spec/07-decisions.md` (record an ADR)         |

## Golden rules

1. **Spec first.** If the implementation must diverge from the spec, update the spec in the same
   commit and record an ADR in `spec/07-decisions.md`. Code and spec never disagree.
2. **One core.** `@idem/core` uses Web APIs only (WebCrypto, TextEncoder, `fetch`, `URL`). No
   `node:*` imports. It runs unchanged in the browser (sandbox), Node 24, Vercel Functions and the simulator.
3. **Cache only with signed authorization.** Only what the producer's signed manifest declares
   cacheable is cacheable. `readOnlyHint` alone is never enough (MCP annotations are untrusted).
4. **`private` never leaks.** A `scope: "private"` result is never served to another authorization
   context. There is a test for this; it must not be removed or skipped.
5. **A stated number is a verified number.** Every number in the README, docs, landing page or report
   comes from `experiments/results/**`, produced by a versioned script with seed and git SHA recorded.
6. **Verified versions, not remembered ones.** Before adding or pinning a dependency, run
   `pnpm view <pkg> version`. The table below was verified on 2026-11-16 and will age.
7. **Determinism.** The simulator and experiments take an explicit seed and a virtual clock (`Clock`).
   Tests never depend on the external network or a real LLM.

## Stack (verified 2026-11-16)

| Layer                     | Choice                                                                 | Note                                        |
| ------------------------- | ---------------------------------------------------------------------- | ------------------------------------------- |
| Runtime                   | Node.js 24 LTS                                                         | GA on Vercel for builds and functions       |
| Language                  | TypeScript 7 (native compiler), `strict`                               | ESM only                                    |
| Monorepo                  | pnpm workspaces + Turborepo                                            | pin `packageManager` in root `package.json` |
| Library build             | tsdown                                                                 | ESM + `.d.ts`                               |
| Tests                     | Vitest 4.x + fast-check (property-based)                               | Vitest 5 is still beta: don't use           |
| Lint/format               | Biome 2.x                                                              | single tool, no ESLint/Prettier             |
| MCP                       | `@modelcontextprotocol/server` and `@modelcontextprotocol/client` v2.x | spec 2026-07-28 (stateless)                 |
| MCP on Vercel             | `mcp-handler` 2.x                                                      | serves 2026-07-28 natively                  |
| Validation                | Zod 4.x                                                                | same major as the MCP SDK v2                |
| Native NDN                | NDNts (`@ndn/*`)                                                       | TypeScript, runs in Node and browser        |
| Emulation                 | NFD in Docker (`experiments/ndn/`) + `tc netem`; Mini-NDN not used     | `experiments/` only                         |
| Web                       | Next.js 16.4.x (>= 16.4.5, security patch) + React 19.2                | App Router                                  |
| UI                        | Tailwind CSS 4.x, `@xyflow/react` for the topology view                |                                             |
| Docs                      | In-house Markdown renderer (`apps/web/lib/markdown.tsx`)               | ADR-022; pages from `spec/` + `content/docs/` |
| LLM (live mode / E3 only) | AI SDK 7 via Vercel AI Gateway                                         | off by default                              |
| Deploy                    | Vercel (Fluid compute, Node 24)                                        | root dir `apps/web`                         |
| Plots/experiments         | Python via `uv` + matplotlib                                           | `experiments/` only                         |

## Repo layout (target)

```
idem/
├── CLAUDE.md                 this file
├── README.md
├── spec/                     source of truth
├── packages/
│   ├── core/                 @idem/core: names, canonicalization, envelope, signatures, PIT, CS, FIB, events
│   ├── mcp/                  @idem/mcp: producer middleware and consumer adapter (MCP SDK v2)
│   ├── gateway/              @idem/gateway: HTTP forwarder (standard Request/Response handler)
│   ├── ndn/                  @idem/ndn: native binding via NDNts
│   └── sim/                  @idem/sim: discrete-event simulator (Node + browser)
├── apps/
│   └── web/                  Next.js: landing, /sandbox, /docs (in-house renderer), /benchmarks, demo MCP routes
└── experiments/
    ├── traces/               tool-call traces (JSONL)
    ├── configs/              experiment configs (JSON)
    ├── results/              run outputs (CSV + config + SHA), committed
    ├── ndn/                  NFD check, Docker bench for E4 (netem), YaNFD on WebAssembly (replaced mininet/)
    └── plots/                Python (uv) scripts that render the figures
```

## Commands (target)

```bash
pnpm i
pnpm dev                 # apps/web on localhost:3000
pnpm test                # vitest across packages
pnpm lint                # biome check
pnpm build               # turbo build
pnpm sim -- --config experiments/configs/e2-swarm.json --seed 42
pnpm exp:e1              # crypto/canonicalization microbenchmarks
uv run experiments/plots/make_figures.py
vercel deploy            # preview; --prod only after M5 is accepted
```

## Conventions

- **Language.** Code, comments, API names, the spec and the docs site are in **English**. Only the
  academic report (see below) is in Portuguese.
- No `default export` in library packages. Typed errors (`IdemError` with a `code`).
- Tests next to the code (`*.test.ts`). Every MUST rule in `spec/01-protocol.md` has at least one
  test citing its id in the name, e.g. `it("MUST recompute args-digest [P-4.3]")`.
- Conventional Commits. Changes to publishable packages ship a changeset.
- MCP `_meta` keys use the `dev.idem/` prefix (change it if the project gets its own domain; see ADR).

## Definition of done (per task)

1. Behavior covered by tests; `pnpm test` and `pnpm lint` green.
2. Spec updated if anything changed; ADR if it was a decision.
3. Public types documented with TSDoc (they feed the API reference in the docs).
4. Item checked off in `spec/06-roadmap.md`.

## Don't

- Don't implement NDN from scratch: use NDNts.
- Don't call a real LLM in tests or CI. The sandbox live mode sits behind `IDEM_LIVE_LLM=1`, with a
  rate limit and a budget.
- Don't fetch internet pages in the demo tools: use the committed static corpus.
- Don't change the wire format without an ADR and a version bump in the name (`/idem/v1` → `/idem/v2`).
- Don't invent results, not even "illustrative values", on any page.

## Academic context

- Course: EEL878, class 15131, Prof. Cláudio Miceli. See `../CONTEXT.md`.
- The final report is written in **Portuguese**, follows `templates/PADRAO-RELATORIOS.md` at the root
  of the UFRJ folder (`../../../templates/` from here), and goes to
  `../listas/YYYY-MM-DD_Projeto-IDEM/` (date = deadline, not yet defined).
- The official EEL878 syllabus (SIGA) does not list the application layer; the course is taught from
  Kurose & Ross (ch. 2: HTTP, caching, CDN, P2P), which the project builds on. Scope depends on the
  professor's approval.
