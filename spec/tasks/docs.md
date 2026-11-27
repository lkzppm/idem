# Docs

Status (2026-11-17): everything below is written and passes `tsc --noEmit` and `biome check`. The
author's dev server went down during the night (see "Incident"), so the checks that need the running
site are listed as **pending** and their boxes stay open, per the rule in `README.md`.

- [x] Information architecture per spec 04 §4 (updated), written down here (2026-11-17)
- [ ] Docs layout: sidebar, page table of contents, previous/next, in the project style — built; seen
      once in an offline render (introduction, 1440 px, dark); in-site check pending
- [ ] Pages written from the spec: introduction, concepts, protocol (normative, from
      `spec/01-protocol.md`), architecture, security, API, sandbox guide, evaluation, decisions,
      references — written; in-site check pending
- [ ] Portuguese pages (translations; the English protocol stays normative) — written, including a
      full translation of the protocol; in-site check pending
- [ ] Mobile and keyboard verified — **not verified** (needs the running site)
- [x] Spec 04 §4 (and the §1 route row) and ADR-022 updated (2026-11-17)

## Information architecture (final)

Reading order; it drives the sidebar and the previous / next links (`components/docs/pages.ts`).

| Group | Page | Route | Source |
|---|---|---|---|
| Learn | Introduction | `/docs` | `content/docs/<locale>/introduction.md` |
| Learn | Use cases | `/docs/use-cases` | `content/docs/<locale>/use-cases.md` |
| Learn | Concepts | `/docs/concepts` | `content/docs/<locale>/concepts.md` |
| Learn | Architecture | `/docs/architecture` | `content/docs/<locale>/architecture.md` |
| Specification | Protocol (normative) | `/docs/protocol` | `spec/01-protocol.md`; pt: `content/docs/pt/protocol.md` (translation), `?text=en` shows the normative text |
| Specification | Security | `/docs/security` | `content/docs/<locale>/security.md` |
| Use | API reference | `/docs/api` | `content/docs/<locale>/api.md` |
| Use | Using the sandbox | `/docs/sandbox` | `content/docs/<locale>/sandbox.md` |
| Research | Related work | `/docs/related-work` | `content/docs/<locale>/related-work.md` |
| Research | Evaluation | `/docs/evaluation` | `content/docs/<locale>/evaluation.md` |
| Research | Decisions | `/docs/decisions` | `spec/07-decisions.md` (English in both languages, with a note) |
| Research | References | `/docs/references` | `spec/08-references.md` (English in both languages, with a note) |

`/spec` → `/docs/protocol` (permanent). `/docs/introduction` → `/docs`. Spec 04 §4's Quickstart,
Bindings and FAQ are folded into API reference, Architecture and Security (reasons in spec 04 §4).

## Done

- [x] `lib/markdown.tsx` extended: nested lists, `start` on ordered lists, callouts, figure
      directives, heading anchors and ids (`{#id}`, `#s7`, `#adr-013`), table of contents, rule
      callouts (`**[P-x.y]**`), automatic links for rule ids, ADRs, reference keys and `§n`, bare URLs
- [x] Code blocks with a copy button and ink-only highlighting (`components/docs/code-block.tsx`, `highlight.tsx`)
- [x] Shell: sticky page tree with a gliding, springy indicator; "on this page" rail that tracks the
      heading in view; previous / next; drawer on small screens (`<dialog>`); reduced motion
- [x] Ten figures as inline SVG in the flat cartoon style, labels in both languages (`components/docs/figures.tsx`)
- [x] Dictionary `lib/i18n/messages/docs.ts` (interface, page titles and leads, figure labels)
- [x] Seven written pages in English and in Portuguese; protocol translated to Portuguese with the
      source hash recorded (rule ids, heading numbers and code blocks checked identical to the spec)
- [x] API page checked against `packages/{core,gateway,mcp,sim}/src/index.ts` exports

## Pending (need the running site)

- [ ] Every route returns 200 in English and with the cookie `idem-locale=pt`: `/docs`, `/docs/use-cases`, `/docs/related-work`, `/docs/concepts`,
      `/docs/architecture`, `/docs/protocol`, `/docs/protocol?text=en`, `/docs/security`, `/docs/api`,
      `/docs/sandbox`, `/docs/evaluation`, `/docs/decisions`, `/docs/references`; `/spec` and
      `/docs/introduction` redirect; `/docs/nope` is a 404
- [ ] Screenshots, dark and light, 1440 px and 390 px: layout, tables, code blocks, rule callouts on the protocol page
- [ ] The ten figures: label overlap and legibility at the article's width (their coordinates were
      reasoned, and only the first figure was seen rendered), in both languages
- [ ] Sidebar indicator glide between pages; "on this page" marker while scrolling; anchor targets under the sticky header
- [ ] Drawer on a phone: open, focus, Escape, tap outside, closes on navigation
- [ ] Keyboard pass: tab order, copy button, drawer; reduced motion
- [x] Header height: the header is 65 px (64 + 1 px border); `--docs-top` is now `calc(4rem + 1px)` (fresh-eyes review, 2026-11-17)
- [x] Sandbox guide against the finished observatory (it was written from spec 04 §2 while the sandbox was being rebuilt) — rewritten against the code (fresh-eyes review, 2026-11-17)

## Follow-ups (not mine to do)

- [ ] Deploy: `spec/*.md` and `apps/web/content/docs/**` are read with `node:fs` at request time, so
      they must be traced into the functions (`outputFileTracingIncludes` in `next.config.mts`)
- [x] CLAUDE.md stack table still lists Fumadocs (superseded by ADR-022): updated
- [ ] When `spec/01-protocol.md` changes: update `content/docs/pt/protocol.md` and the hash in its first line
- [ ] When a package's `index.ts` changes: re-check `content/docs/{en,pt}/api.md` (`@idem/sim` was still changing)

## Spec and code: discrepancies found (reported, not fixed)

- [x] `[P-4.1]` has no test that cites its id (CLAUDE.md: every MUST rule has one); the other 30 rule ids do
- [x] Spec 03: `Forwarder` options omit `authSecret`, `addFace` omits its `{ consumer }` option, `Producer`
      omits `extraKeys`, `verifyData` / `verifyManifest` omit `opts`; the `@idem/sim` section predates
      `idem-noverify`, the processing-cost model and the experiment exports; `TraceWorkload` is
      `{ kind: "trace", records }` in code and `{ kind: "trace", path }` in the spec
- [x] Spec 01 §7 says an Interest for a non-cacheable tool is passed through; the engine answers it with
      `NOT_CACHEABLE` (event `bypass`), as §10 describes. The two sections of the spec disagree with each other
- [x] Spec 01 [P-5.5] says the consumer retries "directly against the producer"; `IdemClient` retries with a
      passthrough call through the edge unless `producerUrl` is set
- [x] Spec 01 §9.1 says the edge decides from the `Mcp-Method` / `Mcp-Name` headers; `createMcpEdge` routes
      through the SDK (already noted in roadmap M3)
- [x] Spec 01 [P-8.1] / spec 05 E5 "replay stale Data": `ageMs` is unsigned and nothing bounds a Data's life
      by the signed `producedAt`, so an on-path node that understates the age is not caught by any rule.
      Documented as a v1 limit on `/docs/security`; proposal: say so in spec 01 §11, or add a rule

Resolved on 2026-11-17 (details in `review.md`, round 1): spec 03 rewritten against the code; spec 01 §5,
§7, §8, §9.1, §10 and §11 fixed, with ADR-024 (reconciliation) and ADR-025 (stale replay is a declared v1
limit, rule deferred, Q6). `content/docs/pt/protocol.md` and its hash follow; the API and security pages
were updated in both languages. (Superseded on 2026-11-27: ADR-034 turned that limit into the rule
[P-8.6], and ADR-033 closed Q7; see the last section.)

## Incident

The dev server on :3002 stopped answering at about 01:50. Most likely cause: an infinite loop in my
first version of `lib/markdown.tsx` (a shared global regex re-entered by recursion), which exhausted
the server's memory on the first `/docs` render after the sandbox's build error cleared. The loop is
fixed (a regex per call). After the fix an offline render (no server) completed for the pages that
existed then: introduction, concepts, architecture and security in English, and the three spec
files. The API, sandbox and evaluation pages, every Portuguese text and the protocol translation
were written later and have **never been rendered**; they were only linted statically (tables,
fences, figure names, and every internal link and anchor in both languages resolve). I did not kill
or restart the server. `apps/web/.next/dev/lock` may still name the dead process.

## `@idem/ndn` pages (2026-11-18)

- [x] API (`#ndn`), Architecture (`#ndn` and the package table) and Introduction status rows updated in
  English and Portuguese for the native binding; the Portuguese protocol translation's §9.2 and its source
  hash refreshed (ADR-026). Not rendered in a browser yet.

## Use cases and Related work (ADR-035, 2026-11-27)

- [x] Use cases and Related work written in en and pt, wired into `components/docs/pages.ts` and the docs
  dictionary, ADR-035; `pages.test.ts`
- [ ] In-site check of both pages: the 7-column comparison table at 390 px, the 11 small tables, reuse of
  the `swarm` and `scope` figures

## Docs sync after ADR-033 to ADR-038 (2026-11-27)

Checked by scripts and by the repository's tests, not in the running site.

- [x] `content/docs/pt/protocol.md` level with `spec/01-protocol.md`: the §4 comment, the §7 pseudo-code,
  [P-8.1], [P-8.4], [P-8.6], [P-8.7], the §9.1 status codes and [P-9.5] to [P-9.8], the loss-recovery
  item of §9.2, §10 and §11; rule ids, heading numbers, section references, ADR ids, reference keys and
  code blocks compared with the spec by script; source hash updated
- [x] Security (en, pt): the replay attack with its two rules, the `authContext` text of ADR-033,
  `EXPIRED` and `CLOCK_SKEW`, what a wrong clock does, the proxy-producer and its trust shift with the
  known gap, the comparison with the unsigned gateway cache (method only)
- [x] Concepts (en, pt): freshness in two parts, the hop-relative age and the signed lifetime
- [x] Evaluation (en, pt): H1 to H6, B0 to B5 and why B5 exists, W-code, the nine sweeps, the three kinds
  of E5 rows, E4 as run on the Docker bench, and a section on what has not been run (E3, E4 with more
  than 3 seeds, the browser half of E1). No result numbers
- [x] API (en, pt): the lifetime exports and the `clockToleranceMs` options, `EXPIRED` and `CLOCK_SKEW`,
  `createProxyProducer` with a usage example that typechecks against `packages/mcp/src`, the new and
  the previously unlisted `@idem/sim` exports; every name exported by the five `index.ts` files appears
  on the page in both languages (checked by script)
- [x] Architecture and sandbox guide (en, pt), `spec/02-architecture.md`: the proxy-producer, B5,
  `CLOCK_SKEW` in Live mode, the package list, the native binding as run against NFD. `README.md` read
  and left as it is (nothing in it is now false). `CLAUDE.md`: the Emulation row and the `experiments/`
  layout no longer name Mini-NDN
- [x] en and pt keep the same headings, anchors and block structure on every written page (script)
- [ ] The pages above, read in the running site in both languages: the new tables on the evaluation and
  API pages at 390 px, the new `#replay`, `#core-lifetime`, `#mcp-proxy` and `#not-run` anchors under the
  sticky header
