# Review rounds

Each round reviews the areas that changed since the last one, with fresh eyes, and lists findings
here by area. A finding is ticked when it is fixed or explicitly declined (with the reason).

## Incidents

- [ ] **The author's dev server on :3002 went down around 01:50 (2026-11-18) and was not restarted.**
  Most likely cause, per the docs agent: an infinite loop in `lib/markdown.tsx` (one global regex
  re-entered through recursion) ran the server out of memory on the first `/docs` render. Shortly
  before that, every route returned HTTP 500 while the sandbox was mid-edit. The loop is fixed (a new
  regex per call). `apps/web/.next/dev/lock` still names the dead pid 25449; if `pnpm dev` complains
  about another instance, delete that lock file. Nobody restarted the server, by the author's rule.
  To verify in the morning: `pnpm dev`, then visit `/docs`, `/sandbox`, `/results` and `/`.

## Security finding (open, author's decision)

- [ ] **`private` Data substitution on the producer link (not yet tested).** Reading the forwarder, an
  attacker on the edge–producer link could answer Bob's `private` Interest with Alice's genuine Data:
  the name is the same and the signature does not bind the auth context. Only per-hop TLS mitigates it
  today. Proposal: bind the auth context (or its HMAC) into what the producer signs for `private`
  results, add an E5 variant, and a rule in spec 01 §8. Wire-format change, so it needs an ADR.

## Round 1

Findings reported by the build agents (2026-11-18); a fresh-eyes review follows once results lands.

### Spec ↔ code (from the docs agent)
- [x] `[P-4.1]` has no test citing its id — `packages/core/src/p41.test.ts`; all 31 rule ids are now cited by a test
- [x] Spec 03 lags the code: `Forwarder` `authSecret`, `addFace({ consumer })`, `Producer` `extraKeys`, `verifyData`/`verifyManifest` `opts`, `TraceWorkload` `{ records }` vs `{ path }`, the `@idem/sim` section (`idem-noverify`, cost model, experiment exports) — spec 03 rewritten against `packages/*/src/index.ts`; `@idem/ndn` marked as a target
- [x] Spec 01 §7 vs §10 disagree on non-cacheable Interests (pass through vs `NOT_CACHEABLE`) — the engine's `NOT_CACHEABLE` stands; §7 and §10 fixed, §7 now also describes plain calls (ADR-024)
- [x] `[P-5.5]` says retry directly at the producer; `IdemClient` retries through the edge unless `producerUrl` is set — the retry is a plain call (edge or producer) and MUST verify for the same name; `IdemClient` and `createMcpEdge` accepted an unsigned retried result, fixed with tests (`p55.test.ts` in gateway and mcp; ADR-024)
- [x] Spec 01 §9.1 `Mcp-Method` / `Mcp-Name` routing vs `createMcpEdge` (from `docs.md`) — §9.1 now says the MCP edge terminates MCP through the SDK (ADR-024)
- [x] Stale replay (spec 05 E5) has no rule behind it: `ageMs` is unsigned and nothing bounds a Data's life by `producedAt`; decide a rule in spec 01 §11 or record it as a v1 limit — declared a v1 limit in spec 01 §11 and [P-8.1]; the signed-lifetime rule is written down and deferred (ADR-025, Q6), because it must land together with E5's judge and a new E5 run
  - [ ] Follow-up for the results owner: spec 05 §4 E5 still expects "replay stale Data" to be rejected; reword it against ADR-025
  - [ ] Follow-up for the simulator owner: the agent's [P-5.5] retry (`AgentNode.#sendCall`) accepts a retried result with no signed Data; align with the new [P-5.5] text
- [x] CLAUDE.md stack table still lists Fumadocs (ADR-022 replaced it) — Docs row and layout tree updated by the main session

### Web
- [ ] Deploy: trace `spec/*.md` and `apps/web/content/docs/**` into the functions (`outputFileTracingIncludes` in `next.config.ts`; touch only while the dev server is not running)
- [ ] Unused `components/landing/figures/diagrams.tsx` and `kit.tsx` (the agent's delete was blocked by permissions; the author removes them)
- [x] Leftover English: the WebCrypto Ed25519 fallback error text on the landing (fresh-eyes round, below)
- [x] Footer column titles and `/brand` use `.eyebrow` (new font, no mark); check consistency with `.t-eyebrow` — footer titles are `.footer-head` (plain, by design); `/brand` now uses `.t-eyebrow`
- [x] Docs sandbox guide written while the observatory was being rebuilt: re-read against the finished sandbox (fresh-eyes round, below)
- [x] Docs API page vs the final `@idem/sim` `index.ts` — every name exported by the four `index.ts` files now appears on `content/docs/{en,pt}/api.md` (checked by script on 2026-11-17; re-check if `@idem/sim` changes again)
- [ ] Gateway has no read-only PIT/CS endpoint (live tables are reconstructed from traces); sim keeps its trust store private (swarm inspector cannot re-verify)
- [x] Root `vitest.config.ts` now runs `apps/web` tests too (218 passing)

### Visual checks pending (dev server down overnight)
- [ ] chrome, landing, sandbox, docs, results: see each task list's pending section

### Round 1 review (fresh eyes)

Static review on 2026-11-17 of chrome, landing, sandbox, docs and i18n. No browser and no server was
run. Afterwards: `tsc --noEmit` passed, `biome check app components lib` passed on all 108 files, and
root `pnpm test` passed (223, 2 skipped).

Fixed:
- [x] **High** `lib/markdown.tsx`: nested quotes and list items recursed with no depth limit, so about 2000 nested `>` overflowed the stack. Depth is now capped (`MAX_DEPTH = 12`; deeper content renders as a paragraph).
- [x] **Medium** `lib/markdown.tsx`: the link pattern took quadratic time on runs of unclosed `[` or `[a](`, and the heading pattern on long runs of spaces. Both are now linear (`parseHeading()`), and the output is identical on every line of `spec/*.md` and `content/docs/**`.
- [x] **Low** `components/docs/highlight.tsx`: a module-level global regex was shared across calls. It is now built per call, like the renderer. Removed the unused `KEYWORDS` from `lib/markdown.tsx`.
- [x] **Medium** Header height: the header is 65 px (64 px plus a 1 px border). `--docs-top` was 4rem; it is now `calc(4rem + 1px)`. The sandbox already used 65 px. Spec 04 §5.1 and `header.tsx` now state 65 px.
- [x] **Medium** `content/docs/{en,pt}/sandbox.md` did not match the finished observatory. Fixed the compare modes, added "Calls per agent", split the latency control into two, and added the Retries and Safety violations counters. Added a Windows section (the six windows, drag, collapse, resize, close and reopen, Tidy up, phone sheet). The keyboard table now matches the code (1–6, Space, R, Esc, arrows on the grip, ?).
- [x] **Medium** `components/sandbox/swarm-mode.tsx`: two restarts could race, so a stale run could take over the stage. A newer restart now cancels the older one.
- [x] **Medium** English on pt pages, sandbox: swarm log and inspector details ("age … ms", "waiting", "faces", "fresh", "stale", "hits"), "seed", the Safety verdicts (they were the simulator's English text), and live mode's "n/a" and "Error: …". All now come from `lib/i18n/messages/sandbox.ts`.
- [x] **Medium** English on pt pages, landing: the packet-signing failure showed the browser's raw message. It is now a translated sentence (`cannotSign`), and the raw error goes to the console. The name builder showed `@idem/core`'s English error message; it now shows only the `IdemError` code (`lib/idem-demo.ts` `Named.code`).
- [x] **Low** Sandbox numbers: decimal comma in pt (`fixed()` in `components/sandbox/ui.tsx`), and the "produced" time uses the site's locale.
- [x] **Low** Sandbox live inspector: the "verify again" result carried over between calls that share a name, and a verification that threw left the button disabled for good.
- [x] **Low** Sandbox: duplicate React keys on swarm PIT rows. The live PIT dots had an `aria-label` screen readers ignore; they are now hidden from screen readers and the count is the accessible text. The phone media-query listener was re-attached on every render. The "connecting" dot blinked under reduced motion.
- [x] **Low** Sandbox contrast: the light-theme verdict text (11 px) was yellow `--data` (3.2:1). The text is now ink, and the swatch carries the colour.
- [x] **Medium** `components/landing/figures/swarm.tsx` + `parts.tsx`: the scene's SVG was `role="img"`, which hides its focusable agent buttons from screen readers. `Svg` now has `interactive` (role `group`).
- [x] **Low** Swarm "plain MCP / IDEM" radio group: both options were tab stops and had no arrow keys. It now has one tab stop and arrow keys. The step tabs (`steps.tsx`) gained Home/End.
- [x] **Low** `packet-anatomy.tsx`: the previous packets were read from a ref during render. They are now kept in state.
- [x] **Low** `theme-toggle.tsx` measured the first `<header>` in the document; it now measures `.site-header` explicitly.
- [x] **Low** TSDoc added on exports that lacked it: `IdemMark`, `StoryParts`, `LOCALES`, `DEFAULT_LOCALE`, `isLocale`, `CanonicalizeFigure`, `NameFigure`.
- [x] Checked and fine:
  - The section-nav contract matches `app/page.tsx` (`id`, `data-nav-section`, `data-nav-label`, `aria-labelledby` ids).
  - The footer is hidden on `/sandbox`.
  - Stacking: header z-50, section nav z-40, docs drawer in the top layer (modal `<dialog>`), sandbox windows below the header.
  - The View Transition still finds `.globe-canvas`.
  - Effects and observers clean up, no `localStorage` reads during render, and storage is wrapped in try/catch.
  - `claimContext` ownership and the Canvas2D fallback in `lib/render/shapes.ts` (shared with the globe).
  - No `.t-eyebrow` used as a field label anywhere. No gradients, glow or pills. No numbers that are not protocol values or live counts.

Open (needs the author or a browser):
- [ ] **Contrast, author's call:**
  - In the light theme, `--data` (#b58900) is 3.2:1 on white. It is used for small text such as `text-data` in the landing's name-builder verdict and packet lead, and in sandbox tables, log and stats. That is below AA (4.5:1).
  - The hero's display word in `--data-bright` (#f2ac00) is 2.0:1, below even the large-text 3:1.
  - A darker yellow for text would fix it, but it conflicts with the style rule against a darkened mustard.
- [x] Language switch: the visible labels "EN" / "PT" are not part of the accessible names "English" / "Português" (WCAG 2.5.3 label-in-name). Consider "EN, English" or dropping `aria-label`. Fixed: the names are now "EN, English" and "PT, Português" (`locale-switch.tsx`; spec 04 §5.1 updated).
- [x] Sandbox (`stage-canvas.tsx` ~139): creating the renderer has no error handler. If WebGPU fails after claiming the canvas, the stage stays blank. A lost GPU device (`lib/gpu/device.ts`) is never recreated for a live renderer (sandbox and globe). Fixed: a failed create retries with Canvas2D on a fresh (re-keyed) canvas, then shows a translated card (`sandbox.shell.stageFailed`). `device.ts` now counts unexpected device losses (`gpuGeneration`, `onGpuLost`, at most 3 recoveries) and `useGpuGeneration()` puts the count in the create effects of the stage, the hero globe and the halftone (lifecycle only, plus a `.catch` that logs), so they are rebuilt on the new device. `claimContext`/`releaseContext` unchanged. Not testable without a GPU: browser check pending.
- [x] Sandbox keyboard: canvas agents and forwarders are pointer-only (the sidebar covers most actions), and window corner resize is pointer-only. Focus after a mouse close of a window is unmanaged. Fixed: the nodes that act on a click (live: agents, edge; swarm: forwarders) are invisible buttons over the canvas (`StageCanvas` `nodeAction`), one tab stop, arrows/Home/End, focus shows the path; Alt + arrows on a window's grip resize it (Shift still means bigger steps when moving); closing a window by any means returns focus to its sidebar toggle. Cheat sheet, grip label, docs keyboard table (en, pt) and spec 04 §2 updated. Browser check pending.
- [x] Docs: the title template "%s · IDEM Docs" is also used in pt. The scope figure keeps the pseudo-code "authContext = HMAC(edge secret, credential)" in English. The drawer's indicator may glide from the whole list on first open (it is measured while the dialog is closed). Fixed: `docs.meta.titleTemplate` ("%s · Documentação IDEM" in pt); the figure's "edge secret" comes from `docs.fig.scope.edgeSecret` (identifiers stay English); `use-glide.ts` skips lists that are not rendered and drops `ready` while hidden, so the first real position is placed without a transition. Browser check pending.
- [x] Landing: the sample packet's content text ("Sample page text, signed in your browser.", `lib/idem-demo.ts`) is English inside the JSON on pt pages. It is data, but it could be localized. Fixed: `samplePackets(url, text)` signs `landing.live.sampleText` (still a real Ed25519 signature); switching language signs a new packet.
- [x] `/brand` is linked from the footer but is not translated (i18n.md item). Fixed: `lib/i18n/messages/brand.ts` (en, pt), `generateMetadata` for the title; mark names in code (`IdemMark`, `/idem/v1/…`) unchanged.
- [x] No regression test for `lib/markdown.tsx` (needs `apps/web/vitest.config.ts` to resolve `@/` and pick up `.tsx` tests). Fixed: the config resolves `@/` and includes `{lib,components}/**/*.test.{ts,tsx}`; `lib/markdown.test.tsx` (13 tests: recursive inline tokens and URL punctuation, quote and list depth caps, five adversarial inputs under a time bound, headings and TOC, rule callouts and rule links, tables, code fences). Root `pnpm test`: 240 passed, 2 skipped.
- [ ] 390 px header in pt: by arithmetic the logo mark, the three tabs ("Resultados"), the language switch and the theme toggle fill about 384 of 390 px. Check in a browser.

## Round 3: the author's bug report (2026-11-17, morning)

Checked in headless WebKit (the author browses in Safari) and Chromium against the running dev server on :3002 (screenshots reviewed, then discarded).
- [x] Theme switch flashing the other theme / the globe vanishing: in WebKit a named live (WebGPU) canvas renders blank inside a View Transition, and the circle depended on a script-started animation. The circle is now the CSS animation `theme-reveal` on `::view-transition-new(root)` (present from the snapshot's first frame); the live-globe path runs only in Chromium (`theme-vt-live`), elsewhere the globe stays in the snapshots. The globe eases the CSS animation's linear progress with `revealEase` (`lib/theme-reveal.ts`, tested), so its circle matches the page's. Frame bursts: no flash in either direction in WebKit or Chromium.
- [x] Section nav landing offset: jumps aimed at the section's padded edge. They now land the section label level with the bar (below it where the bar spans the width). WebKit's scroll anchoring crept the page ~8 px after every scroll as reveal animations ran: `overflow-anchor: none` on `html`. The last section stops where the page ends.
- [x] Swarm legend: `.fig { width: 100% }` blew up the packet glyphs; the glyph keeps its own size. PIT/CS boxes widened so the A/B/C chips clear the name.
- [x] Serve step: the producer's key line now draws in as the verification panel arrives (it was always shown, pointing at nothing); the hit ring no longer covers "in its CS" / "regional".
- [x] Forwarding flowchart decluttered (wider gaps, labels off the lines and boxes, own lane for the return path, producer on the divider; narrow layout too).
- [x] "Where it sits" stack empty, and section-label marks missing: the drop keyframes ended without an opacity, so the elements went back to the hidden base `opacity: 0`. Landed state now sets `opacity: 1` (audited all keyframes; only these three).
- [x] Packet "same name" marker: a straight bar with round ends (a `::before`), not an inset shadow bending into a bracket.

## Round 4 (2026-11-18)

- [ ] Theme flash still seen in the author's Safari 27.2 (in the page, not the toolbar band); not reproducible in headless or headed Playwright WebKit. A cover-style switch for Safari was tried and rejected by the author (keep the circle reveal). Now: the reveal everywhere, the static radius-0 clip under the CSS animation, and every canvas holds its frames from the click until the transition is ready (`holdFrames` in `lib/gpu/device.ts`, checked in `currentTexture` and the Canvas2D backend; the globe and halftone redraw on release). Author to confirm in Safari; if it persists, check whether `/docs` (no canvases) flashes too.
- [x] Header tab underline: half blue, half yellow (hard split).
- [x] Footer: portfolio link (lkzppm.vercel.app) first under Author, translated label.
- [x] Theme switch works in Safari outside the hero (author, 2026-11-18). The hero still turned at once: Safari shows a canvas live even over the old page's snapshot, and the halftone is opaque (it paints the hero's background). Both hero canvases now paint the circle into their own frames in every engine (old palette outside, new inside, from `activeReveal`/`revealRadius`): the halftone shader takes a second palette and a circle mask (`lib/landing/halftone.ts`), the globe already did. Author to confirm.
- [x] Globe frozen and in the old colours during the switch in Safari: a canvas left in the snapshots is a still image there. Both hero canvases now leave the snapshots in every engine (`hero-globe`, `hero-dots`) and stay live above them, painting the circle into their own frames; the halftone now paints only its dots (clear between them, premultiplied), so above the page it hides nothing. The engine split (`theme-vt-live`) is gone. Author to confirm.

