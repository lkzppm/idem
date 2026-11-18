# IDEM spec

Source of truth for the project. Recommended reading order:

| # | File | Content | Kind |
|---|---|---|---|
| 0 | [00-vision.md](00-vision.md) | Problem, thesis, goals, non-goals, hypotheses | Context |
| 1 | [01-protocol.md](01-protocol.md) | Names, canonicalization, Interest/Data, manifest, forwarder, bindings | **Normative** |
| 2 | [02-architecture.md](02-architecture.md) | Packages, flows, diagrams, dependencies | Design |
| 3 | [03-api.md](03-api.md) | Public API of each package | Design |
| 4 | [04-showcase.md](04-showcase.md) | Site, sandbox, docs, demo routes, Vercel deploy | Product |
| 5 | [05-evaluation.md](05-evaluation.md) | Experiments, baselines, metrics, results format | Method |
| 6 | [06-roadmap.md](06-roadmap.md) | Milestones M0–M7 with acceptance criteria and checklists | Plan |
| 7 | [07-decisions.md](07-decisions.md) | ADRs and open questions | Log |
| 8 | [08-references.md](08-references.md) | Bibliography (ABNT style, for the report) | Log |

Spec conventions:

- **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT** and **MAY** in `01-protocol.md` follow RFC 2119 /
  RFC 8174. Each normative rule has an id `[P-x.y]` so tests can cite it.
- Claims about MCP, NDN and related work cite a key from `08-references.md` (e.g. `[MCP-CACHE]`).
  Unsourced claims don't go in.
