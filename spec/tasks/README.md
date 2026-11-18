# Tasks

Working task lists, one file per area of the site, so each area is tracked in one place and the
areas can move in parallel without stepping on each other. A box is ticked only when the item works
in the running site and passes typecheck and lint; anything found along the way is added as a new
item, never silently dropped. The roadmap (`../06-roadmap.md`) stays the milestone view; these lists
are the day-to-day view under it.

| File | Area | Owns |
|---|---|---|
| [`i18n.md`](i18n.md) | Bilingual interface (ADR-018) | `lib/i18n/locale.ts`, `server.ts`, `client.tsx` |
| [`chrome.md`](chrome.md) | Header, tab animation, home section nav, language switch, footer | `components/site/*`, `components/brand/*`, `app/styles/chrome.css`, `app/layout.tsx` |
| [`landing.md`](landing.md) | Home sections below the hero, figures, section labels | `app/page.tsx`, `components/landing/*` (not hero/globe/halftone), `app/styles/landing.css` |
| [`sandbox.md`](sandbox.md) | The sandbox as an observatory: sidebar, draggable windows | `app/sandbox/*`, `components/sandbox/*`, `lib/sandbox/*`, `app/styles/sandbox.css` |
| [`docs.md`](docs.md) | Documentation pages | `app/docs/*`, `components/docs/*`, `content/docs/*`, `lib/markdown.tsx`, `app/styles/docs.css` |
| [`results.md`](results.md) | Benchmarks (E1, E2, E5) and the results page | `experiments/*`, `packages/sim` CLI, `app/results/*`, `components/results/*`, `app/styles/results.css` |
| [`review.md`](review.md) | Cross-cutting review rounds and their fixes | findings, by area |
| [`ndn.md`](ndn.md) | Native NDN binding (ADR-026) and its Mini-NDN runs | `packages/ndn/*`, `experiments/mininet/*` |

Paths under `components/`, `app/`, `lib/` are in `apps/web/`.

## Rules

- Tick (`[x]`) an item the moment it is done and verified; add the date when it closes a group.
- Visitor-facing text goes through the area's dictionary in both languages (ADR-018).
- No number appears on any page unless it comes from `experiments/results/**` (CLAUDE.md).
- A decision gets an ADR in `../07-decisions.md`; the showcase spec (`../04-showcase.md`) is updated
  in the same change as the page it describes.
