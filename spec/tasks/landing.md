# Landing — home sections below the hero

- [x] Audit every section of `app/page.tsx` (what it explains, what moves, what is missing) and list it here (2026-11-17, below)

## Audit (2026-11-17)

What a first-time visitor met below the hero, section by section:

- **Missing: the problem.** Spec 04 §1 asks for "the problem in one scene (N agents fetching the same
  page)". The page jumped from the thesis straight to canonicalization; nothing showed several agents
  asking the same thing, so PIT aggregation and CS hits arrived as vocabulary, not as a picture.
- **`#how`.** Heading, four mono "facts" and the `Steps` tabs (autoplay, 9 s). The four figures
  (`figures/steps.tsx`) moved only through `.hop` (a 7 px dash crawling along a hairline) and `.blink`
  (a box fading in and out): nothing changes shape, nothing arrives, so they read as static flowcharts
  of 10 px mono text. The card used a backdrop blur and a large soft shadow (not flat). Tab labels hide
  on phones.
- **`#live`.** `NameBuilder` is real (`@idem/core` in the browser) but the result swaps silently: the
  verdict is a small mono line in a corner, and nothing shows that two names became one. `PacketsFigure`
  repeats `PacketAnatomy` (two explanations of the same fields) and needs 640 px, so phones scroll it
  sideways. The live JSON's notes sit apart from the lines they explain; "Sign again" changes the nonce
  and signature without pointing at what changed and what did not (the name). It used `.btn-secondary`,
  which has no style.
- **`#forwarder`.** `ForwarderFigure` is an 800-unit flowchart (720 px minimum, sideways scroll on
  phones); one dash runs along the spine while the outcome boxes blink, so no particular Interest is
  ever seen taking a branch. `StackFigure` is still except a blinking outline. "Where it sits" has a
  second eyebrow with a leading line.
- **`#guarantees`.** Four icon cards, all still: no tampered packet is ever rejected, no private
  result is ever refused, no plain call is ever seen passing through. The CTA card has a gradient
  hairline (the style forbids gradients).
- **Everywhere.** Eyebrows in mono tracked capitals with a leading line (the author dislikes them).
  Every string inline in English. No `data-nav-section` contract for the section navigator. Figures
  rely on sideways scrolling on a 390 px phone.

## Build

Status (2026-11-17, night): the code below is written and passes `tsc --noEmit` and `biome check`.
The author's dev server (:3002) went down mid-session and no server may be started, so nothing past
the first draft was seen in a browser. Items are ticked for code; the visual pass is its own item.

- [x] New section label: the IDEM mark in small (harpoons meet with a springy overshoot on reveal) + words in Outfit, sentence case. `SectionLabel` (`components/landing/section-label.tsx`), `.eyebrow` and `.t-eyebrow` (mark via masked pseudo-elements) in `globals.css`; `.t-label` for field labels without the mark
- [x] `#idea` (new): the problem in one scene, plain MCP vs IDEM switch, PIT fold, fan-out, CS hit on a late ask, run marks instead of numbers, beats that light up, click an agent to ask (`figures/swarm.tsx`)
- [x] `#how`: four one-shot step animations that hold an explanatory last frame: canonicalize (lowercase, drop port, drop fragment, sort, merge), name (bytes hashed, real digests fly into slots), sign (Data assembles, seal lands), serve (regional CS hit, agent verifies) (`figures/steps.tsx`, `steps.tsx`); click the open tab to replay
- [x] `#live`: "=" / "≠" seal on the seam of the name builder; digests roll in on a preset (never on typing); packets with signed bytes marked, field ↔ note highlight, "Sign again" flashes what changed and what did not (the name); `PacketsFigure` removed as a duplicate
- [x] `#forwarder`: the §7 pipeline as a sorter, five Interests in turn or picked, each taking its branch, Data's way back for a forwarded one (`figures/sorter.tsx`); stack slabs drop and land on reveal, lift on hover (`figures/stack.tsx`)
- [x] `#guarantees`: four looping vignettes (manifest decides the CS, private partition, tampered answer rejected and retried, side effect passes through) (`figures/vignettes.tsx`); gradient hairline removed from the CTA
- [x] Figures pause offscreen and in hidden tabs; wide/narrow drawings by their own width (no sideways scroll); still informative frames under reduced motion (code path)
- [x] All landing strings (hero text included) in `lib/i18n/messages/landing.ts`, en + pt, type-checked; `data-nav-section` / `data-nav-label` on every top-level section
- [x] Spec 04 §5 updated; ADR-020 recorded
- [ ] **Visual pass in a browser (pending: dev server down).** Both themes, en and pt, 1440 and 390 px, reduced motion: check every figure's layout (text overflow in pt, packet paths, overlaps), timing feel, the eyebrow on docs/sandbox/placeholder/brand/footer, the `.nb-seal` position on phones
- [ ] Delete `components/landing/figures/diagrams.tsx` and `kit.tsx` (no longer imported; deletion was blocked by the session's permissions)
- [x] Sandbox panels that use `.t-eyebrow` for field labels may want `.t-label` (sandbox area's call) — none do (fresh-eyes review, 2026-11-17)
- [x] Hero "built on" row: MCP, NDN, NDNts, Ed25519, JCS, TypeScript with marks (Simple Icons CC0 for MCP and TypeScript, drawn glyphs for the rest) and links, en + pt titles (`components/landing/stack.tsx`)
- [x] Hero halftone was blank: the dual-palette shader redeclared `col` (WGSL compile error, Canvas2D fallback). Renamed; both WGSL shaders validated with naga
