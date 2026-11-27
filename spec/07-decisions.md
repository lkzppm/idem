# 07 — Decisions (ADRs) and open questions

Format: context → decision → consequences. Add new ADRs at the end; never rewrite an accepted one,
supersede it.

## ADR-001 — TypeScript monorepo with a single core
**Context.** The same forwarder logic must run in production gateways, the simulator, and the browser sandbox.
**Decision.** TypeScript, pnpm + Turborepo, `@idem/core` restricted to Web APIs.
**Consequences.** The sandbox shows real protocol behavior, not a re-implementation. Python is used only for plotting and Mini-NDN orchestration.

## ADR-002 — Name: IDEM
**Context.** Working name was NDMCP (Named Data MCP).
**Decision.** IDEM — Latin "the same"; backronym *Interest-Driven Exchange for Models*. It states the thesis (same request → same answer) and echoes "idempotent".
**Consequences.** Check npm/GitHub name availability for `@idem/*` before publishing (fallback scope: `@idem-protocol/*`).

## ADR-003 — Overlay first, native NDN second
**Context.** Agents speak MCP over HTTP today; native NDN requires NFD.
**Decision.** Ship the HTTP overlay binding first (M3); native NDN in M6.
**Consequences.** Early usable demo; the native binding then validates the same naming/signing over a real ICN stack.

## ADR-004 — Envelope encoding
**Decision.** Overlay: JSON with JCS (RFC 8785) for signed bytes. Native: NDN TLV via NDNts, content = JCS JSON.
**Consequences.** Human-readable overlay packets (good for the sandbox log); exact byte equality across languages via JCS.

## ADR-005 — Ed25519 signatures
**Decision.** Ed25519 everywhere (WebCrypto; documented fallback). Supported by NDN signing as well.
**Consequences.** Small signatures and fast verification; one algorithm to test.

## ADR-006 — Producer-declared normalizers only
**Decision.** Canonicalization uses only normalizers declared in the signed manifest [P-3.3].
**Consequences.** Lower hit rate than aggressive normalization, but no wrong answers from merged names.

## ADR-007 — Forwarders verify before caching
**Decision.** [P-7.1]; disabling is an experiment flag only (B4).
**Consequences.** CPU cost on misses, measured in E1/E2.

## ADR-008 — Pinned dependency versions (resolved 2026-11-16 with `pnpm view`)
| Package | Version | Note |
|---|---|---|
| pnpm / Node (local) | 11.25.0 / 26.7.0 | engines: Node >= 24 (Vercel runs 24 LTS) |
| typescript | 7.0.2 | native compiler; Next 16.4 type-checks through its CLI checker |
| turbo | 2.11.11 | |
| tsdown | 0.23.7 | emits `dist/index.js` + `.d.ts` |
| vitest | 4.1.12 | **kept on 4.x per CLAUDE.md, but Vitest 5 is GA** (5.0.0 on 2026-09-03, `latest` = 5.1.0). The CLAUDE.md note "Vitest 5 is still beta" is stale; upgrade is a separate decision |
| fast-check | 4.10.2 | |
| @biomejs/biome | 2.6.8 | |
| @changesets/cli | 3.0.3 | |
| @modelcontextprotocol/server, /client | 2.4.0 | `createMcpHandler`, `fromJsonSchema` |
| next / react / react-dom | 16.4.6 / 19.3.1 / 19.3.1 | React 19.3 (table said 19.2) |
| tailwindcss, @tailwindcss/postcss | 4.3.5 | |
| geist | 1.9.2 | |
| @webgpu/types | 0.1.74 | |
| fumadocs-core / -ui / -mdx | 16.19.3 / 16.19.3 / 15.6.3 | not installed yet (docs pending) |

pnpm 11 note: `--config.fetch-timeout` on the CLI is passed as a string and crashes; set
`fetchTimeout` (number) in `pnpm-workspace.yaml` instead.

## ADR-009 — `_meta` key prefix
**Decision.** `dev.idem/` until the project has a domain; then migrate with a compatibility window.

## ADR-010 — IDEM is an application-layer overlay; "transport" means MCP transport
**Context.** The spec called IDEM "a content-centric transport layer for MCP", which reads as OSI L4.
**Decision.** Wording: IDEM is a **content-centric overlay at the application layer** in the HTTP
binding (it sits where HTTP caches/CDNs sit, Kurose & Ross ch. 2) and borrows NDN's network-layer
model (named data, PIT, in-network caching). In the native binding the names ride on NDN, which
replaces IP at the network layer. "Transport" only ever means an MCP transport (stdio, Streamable HTTP).
**Consequences.** No segmentation, flow or congestion control is claimed; TCP/QUIC still do that.

## ADR-011 — `lowercase` is the Unicode lowercase mapping, not case folding
**Context.** §3 said "Unicode default case folding". JS has no case folding; a table would be large
and error-prone, and cross-language consumers must agree byte for byte.
**Decision.** `lowercase` = Unicode default lowercase mapping, locale-independent (`toLowerCase`,
Python `str.lower`). A future `casefold` normalizer may be added in v2.
**Consequences.** `ß` stays `ß`. Producers that need caseless matching declare it explicitly later.

## ADR-012 — Fixed JSON Schema subset ([P-3.6], Appendix A)
**Context.** Validation decides IDEM vs passthrough; two implementations with different validators
would disagree on names.
**Decision.** A fixed subset (covers what Zod 4 / MCP SDK v2 emit for flat tools), implemented in core
without dependencies. Tools using other keywords (`$ref`, `if`, ...) are not cacheable.
**Consequences.** Some tools lose caching in v1; no silent disagreement.

## ADR-013 — Hop-by-hop correlation and private partitioning of the PIT
**Context.** With `authContext` stripped beyond the edge, a regional forwarder would aggregate two
users' `private` Interests (same name) and deliver one user's result to the other. Also, Data needs
to be matched to the right PIT entry when entries are partitioned.
**Decision.** (1) Answers carry the downstream Interest's nonce hop by hop (§4.1); Data is accepted
only from the face the Interest went to. (2) `private` PIT entries are keyed by `authContext`; without
one they are keyed by nonce (never aggregated, never cached) [P-8.3]. (3) Data whose signed scope is
`private` against a `public` manifest is rejected [P-8.5].
**Consequences.** "`private` never leaks" holds in multi-hop topologies; tests cover star and tree.

## ADR-014 — Transport-agnostic `Producer` in core; producers also speak IDEM over HTTP
**Context.** The simulator (`sim` depends only on `core`) and the HTTP gateway both need a producer.
**Decision.** `@idem/core` exports `Producer` (names results itself [P-5.1], signs, builds the
manifest) and consumer helpers (`cacheablePolicy`, `buildInterest`). `@idem/gateway` serves it over
the IDEM HTTP endpoints (§9.1 table); `@idem/mcp` serves the same producer over MCP.
**Consequences.** One producer implementation for simulation, HTTP and MCP. Edges prefer the IDEM
endpoint and fall back to MCP for legacy producers (proxy-producer mode: ADR-038).

## ADR-015 — WebGPU rendering for the sandbox and landing (replaces `@xyflow/react`)
**Context.** The showcase spec named `@xyflow/react` for the topology view; the owner asked for
WebGPU-rendered backgrounds and sandbox.
**Decision.** Topology canvas and landing background are drawn with WebGPU (WGSL), with a Canvas2D/
static fallback when `navigator.gpu` is missing, honoring reduced motion. Labels are an HTML overlay.
**Consequences.** One less dependency; we own the renderer. Fallback path must be kept working.

## ADR-016 — Sandbox "Live" mode is real transport and the default (default superseded by ADR-028)
**Context.** The owner requires the sandbox to exercise the real protocol, not only a simulation.
**Decision.** `/sandbox` defaults to **Live**: browser agents send real HTTP Interests to the deployed
edge (`/api/edge`), which forwards over HTTP to the deployed producer (`/api/producer`); the browser
verifies every signature. **Swarm** mode keeps the deterministic simulation (same engine, virtual
links) for scale and for the seeded experiments, and is labeled as simulation. The edge is also
exposed as a plain MCP endpoint (`/api/mcp`) so real agents can use it.
**Consequences.** Live hits depend on serverless instance reuse (stated in the UI).

## ADR-017 — Brand mark, typography and landing structure
**Context.** The landing was redesigned as a modern developer-tool page ("a modern enhancement of
MCP"), and a mark had to be chosen from the `/brand` explorations. §5 of the showcase spec only said
"technical and calm".
**Decision.** (1) The mark is ⇌ (`IdemMark`): upper harpoon = Interest (blue), lower = Data (amber);
it reads as "=" (*idem*, "the same") and is invariant under a 180° rotation. The other concepts stay on
`/brand` as earlier explorations. (2) Outfit for text and headings, JetBrains Mono for names, digests
and packets. (3) Hairline borders, `rounded-xl`/`2xl` cards, no pill badges, scroll reveals, hover and
pointer cursor on every control; explanations are SVG figures. (4) The landing is hero → `#how` →
`#live` → `#forwarder` → `#guarantees` (with the call to action); the hero background follows
ADR-015 (WebGPU edge-network globe, Canvas2D fallback, reduced motion honored). The landing points
only to the protocol and the sandbox. It states no number until `experiments/results` has one.
**Consequences.** Spec 04 §5 describes the layout and vocabulary; the old WebGPU hero field
(`components/canvas/hero-canvas.tsx`, `lib/gpu/hero.ts`) was removed. New landing pieces reuse the
figure kit and the tokens in `globals.css` rather than ad-hoc styles.

**Amendment (2026-11-17).** The site shows the protocol and the sandbox only: no install command and
no "connect your agent" panel (the `claude mcp add` snippet left the landing and the sandbox). Spec and
docs are one nav tab, Docs; `/spec` permanently redirects to `/docs`. The hero became a halftone
backdrop (one WGSL pass: posterized dot waves, a springy swell under the pointer) and half a globe on the right edge drawn in flat
colors with no glow: Autonomous Systems as a spherical Voronoi partition (halftone territories, solid
borders, territories gliding to new shapes every second or two), cores routing AS by AS toward the producer's AS, cartoon motion (pop-in with overshoot,
landing bounce, squash and stretch), and direct manipulation (drag to spin with velocity handoff, hover,
click to ask or to add a node). The nav's selector glides between links instead of jumping.
This flat cartoon style (solid ink shapes with background outlines, halftone dots, dashed lines,
springy pop and bounce motion, no glow and no gradients) is the project's main visual style from here on.

## ADR-018 — Bilingual interface (English and Portuguese)
**Context.** The course is taught in Portuguese, and the author asked for a pt/en switch in the nav.
CLAUDE.md had the docs site in English only.
**Decision.** The site's interface reads in English or Brazilian Portuguese, switched in the header.
The choice is a first-party cookie (`idem-locale`, one year) read on the server, so every page renders
in the chosen language with no flash; without a choice, the first language the browser lists that the
site speaks wins (`Accept-Language`), else English. Strings live in per-area dictionaries
(`apps/web/lib/i18n/messages/<area>.ts`, `defineMessages(en, pt)`): `en` is the schema and `pt` must
match it, so a missing translation is a type error. Code, comments, the spec and the normative protocol
stay in English; a Portuguese docs page is a translation and says the English text is normative.
**Consequences.** Reading the cookie makes pages render per request instead of statically (fine on
Fluid compute). Numbers, names, digests and code are never translated. Each part of the site owns its
dictionary and its stylesheet (`app/styles/<area>.css`), so the parts can be worked on independently.

## ADR-019 — Site chrome: the tab story, ink-drop selectors, a top section nav
**Context.** The author asked for a header that reacts to tab changes with the mark, a pt/en switch,
a section navigator on the home page, and a footer with his links, all in the flat cartoon style of
ADR-017 (amendment). The home page is owned separately from the chrome, so the section nav must not
depend on how the landing is written.
**Decision.** (1) *Tab story.* A change of the active tab is told as one protocol exchange with the
mark as the consumer: an Interest leaves the upper harpoon and lands on the new tab as its underline;
a Data returns to the lower harpoon only when the new page has arrived (the pathname changed), so the
return trip doubles as an honest "page loaded" signal. Home is a loop round the mark (⇌). It is driven
by WAAPI on `transform`/`opacity` with all landing pieces scheduled as delays on the same timeline
(compositor-friendly during page loads, no timers), and a ball in the air is re-aimed from its
current position and velocity when navigation changes again. Reduced motion: a cross-fade. The mark
is drawn as two stacked SVG boxes (`IdemMarkSplit`) so each harpoon can move on its own; hover uses
the `translate` property and the story uses `transform`, so they never fight. (2) *One selector
vocabulary.* Hover, the language switch and the section nav share an "ink drop": a clipped layer
whose two edges are registered custom properties with different transitions (lead with overshoot,
trail with anticipation and bounce), with the labels drawn again inside it in the inverse colour.
CSS transitions re-target from the current value, which gives interruptibility for free. (3)
*Language switch* is a two-option radio group (one tab stop, arrows), options named in their own
language. (4) *Section nav at the top, not on the left,* on every width: a floating glass bar under
the header. A left rail would collide with the 72rem content column on 1024–1280 px screens and has
no good phone form; a top bar is one component everywhere (on a phone it spans the width and scrolls
sideways), reads in order after the main nav, and follows a familiar precedent (product pages' local
nav). It is mounted by the root layout for `/` and discovers its stops from the DOM:
`[data-nav-section][id]` with `data-nav-label`, re-read on DOM mutation. (5) *Footer* uses a halftone
band and dashed rules instead of hairlines, carries the author's GitHub and LinkedIn, and is hidden on
`/sandbox` (a full-viewport workspace) through a small client gate so the footer stays a server
component.
**Consequences.** Pages that want a section in the home nav only add three attributes; the chrome
never imports landing code. The ink drop costs a small clip-path repaint per frame on tiny elements;
the travelling packets stay on the compositor. `onNavigate` on the header links starts the story at
the click; every other navigation is caught from the pathname, so the story is right however the
visitor moves.

## ADR-020 — Landing figures: animated SVG scenes in the cartoon style; section labels from the mark
**Context.** Below the hero, the landing's figures were still flowcharts (a dash crawling along
hairlines, boxes blinking), the problem scene that §1 of spec 04 asks for was missing, phones had to
scroll figures sideways, and the author disliked the mono, tracked-capitals eyebrow with a leading line.
**Decision.** (1) Each home section teaches its idea with an SVG scene in the flat cartoon style of
the hero: the same node shapes (agent dot, forwarder square, ringed core, producer square with the
yellow inside), packets that squash and stretch with their speed, pops with overshoot and wobbles on
landing. A frame function writes `transform`/`opacity` straight to the elements on
`requestAnimationFrame` (no React render per frame), only while the figure is on screen and the tab is
visible (`components/landing/figures/motion.ts`). SVG, not the WebGPU shape renderer: the figures
are mostly labelled text, which SVG draws crisply, accessibly and in the theme's tokens, and a page of
canvases would multiply GPU contexts. (2) Scenes are stateful where the visitor acts (the swarm is a
small state machine of the §7 rules: click an agent to ask; the sorter replays a picked Interest)
and scripted where they explain (the step figures play once and hold a last frame drawn to explain on
its own). (3) Each figure picks a wide or a narrow drawing from its own width, so phones keep
readable text without sideways scrolling. (4) Reduced motion shows one still frame per figure chosen
to carry the point (the fan-out, a scenario's finished path); interaction then jumps between frames.
(5) No number appears in a figure: work done is shown as marks (one per tool run), timings are the
drawing's pace. (6) A section label is the IDEM mark in small (its two harpoons meet with a springy
overshoot on reveal) followed by a few words in Outfit, sentence case: `.eyebrow` and the
`SectionLabel` component on the home page, `.t-eyebrow` (the mark drawn with two masked
pseudo-elements) on every other page; `.t-label` is the plain small label for fields in panels.
**Consequences.** Figures own their motion code and must keep a still frame that explains;
`prefers-reduced-motion` is part of each figure's definition, not an afterthought. Text in figures goes
through `lib/i18n/messages/landing.ts`, so a Portuguese string that runs longer must still fit the
narrow drawing. Panels elsewhere that used `.t-eyebrow` for field labels now show the small mark;
they can switch to `.t-label`.

## ADR-021 — The sandbox is an observatory: sidebar, stage, floating windows (amended by ADR-028; windows replaced by ADR-029)
**Context.** The sandbox was a long scrolling page of panels (header, mode tabs, canvas, attacks,
tables). The author asked for "something like the observatory I got in GraphMan, with a sidebar,
draggable windows", in this project's flat cartoon style. GraphMan's observatory has the full-height
sidebar + stage layout, a resizable sidebar edge, floating corner clusters and a phone sheet, but no
draggable windows.
**Decision.** (1) `/sandbox` is a full-viewport workspace under the header: a resizable sidebar
(mode switch, the mode's controls in collapsible sections, attack buttons, the window list) and a
stage whose canvas fills it. (2) The protocol's state lives in six floating windows over the stage
(Event log, PIT & CS, Packet inspector, Metrics, Compare, Safety), written from scratch: geometry is
written to the element, never through React state, so dragging re-renders nothing; title-bar drag with
pointer capture and 1:1 tracking, rubber-band at the stage edges, momentum projection on release and
an underdamped spring that starts at the release velocity; focus brings to front; collapse, close,
reopen, corner resize, keyboard moves; layout and per-mode open sets saved in `localStorage`. (3) The
shell owns the layout and exposes slots; the running mode (live or swarm) portals its controls,
canvas and window contents into them, so switching modes swaps contents without rebuilding the
workspace. (4) One canvas draws every pane (the swarm runs side by side), laid out in the area the
windows leave free and moved there on a spring. (5) The canvas adopts the hero globe's drawing
(background-outlined shapes, dashed links, pop-in, landing bounce, squash and stretch, no glow).
(6) Live mode shows only what the page can know: the edge exposes no table endpoint, so its PIT/CS
window is built from the page's own calls and `idem-trace` headers, and says so. (7) On a phone the
windows become tabs of a sheet under the stage.
**Consequences.** Spec 04 §2 describes the layout. No new dependency (no drag or animation library).
The swarm inspector cannot re-verify a signature in the page because `@idem/sim` keeps its trust store
private; it shows the forwarders' own `verify_ok`/`verify_fail` events and recomputes the content
digest instead. Window positions are per browser, not in the shareable URL (the URL keeps the run
configuration).

## ADR-022 — Docs: in-house Markdown renderer, pages from the spec, no Fumadocs
**Context.** CLAUDE.md and spec 04 §4 named Fumadocs (MDX, `AutoTypeTable`) for `/docs`; it was never
installed, and `/docs` rendered `spec/01-protocol.md` with a small in-house renderer
(`apps/web/lib/markdown.tsx`). The docs needed a real structure, both languages (ADR-018), and the
project's own look. Fumadocs would bring its own layout and theme to restyle, an MDX build step in
`next.config`, and a second source for text the spec already holds.
**Decision.** (1) Keep and extend the in-house renderer; add no dependency. It renders the subset the
spec is written in (headings, nested lists, tables, fenced code, callouts, figure directives) and
turns the spec's conventions into navigation: rule ids, ADR numbers, reference keys and section
signs become links, a rule's definition becomes a callout with an anchor, and numbered sections and
ADRs get anchors that do not depend on the wording (`#s7`, `#adr-013`). (2) Ten pages in four groups
(spec 04 §4): `/docs` is the introduction, the rest are `/docs/<slug>`; `/spec` redirects to
`/docs/protocol`. (3) Markdown is read from disk when a page renders. Protocol, Decisions and
References render the files in `spec/` themselves, so the site cannot show a protocol the spec does
not say; the other pages are written in `apps/web/content/docs/<locale>/<slug>.md`, in English and
Portuguese. (4) Decisions and References stay in English in both languages, with a note that says so:
one is a living log, the other a bibliography. The Protocol has a Portuguese translation
(`content/docs/pt/protocol.md`). A translation records the SHA-256 of the spec text it was made
from; its page states that the English text is normative and offers it at `?text=en`, and warns when
the spec has changed since. Code, names, rule ids and the RFC 2119 keywords are not translated.
(5) The API reference is written by hand against `packages/*/src` instead of
generated from TSDoc. (6) Code blocks are highlighted in ink only (comments, strings, keywords): blue
and yellow keep meaning Interest and Data. Figures are inline SVG with labels from the docs dictionary.
**Consequences.** No MDX and no docs framework to keep in step with Next; the renderer is ours to
maintain and deliberately small (it is not CommonMark: nested emphasis, HTML and reference links are
out). The API page can drift from the code, so it lists exports rather than restating signatures and
must be re-checked when a package's `index.ts` changes; generating it from TSDoc remains possible
later. Pages render per request (the locale cookie), and the deployment has to ship `spec/*.md` and
`apps/web/content/docs/**` with the functions that render them (`outputFileTracingIncludes`). The
CLAUDE.md stack row and the ADR-008 row for Fumadocs are superseded by this ADR.

## ADR-024 — Spec 01 reconciled with the engine: non-cacheable Interests, the retry, the MCP edge
**Context.** The first review round found three places where spec 01 disagreed with itself or with
the code. (a) §7 said an Interest for a non-cacheable tool is passed through as MCP; §10 defined
`NOT_CACHEABLE` for exactly that Interest, and the engine answers with it. (b) [P-5.5] said the
consumer retries "directly against the producer (no cache, `mustBeFresh: true`)"; `IdemClient`
retries with a plain call through its edge unless it is given `producerUrl`, and a plain call has no
`mustBeFresh`. Reading that path showed a gap: the retried result was accepted when it carried no
signed Data, or Data for another name, so an attacker on the consumer's link could spoil the first
answer and then hand over an unsigned one. (c) §9.1 said the edge is a transparent MCP proxy that
decides from the `Mcp-Method` / `Mcp-Name` headers; `createMcpEdge` is an MCP server built on the SDK,
which parses and routes requests itself (already noted in roadmap M3).
**Decision.** (1) *The engine's answer stands.* An Interest for a tool the manifest does not mark
cacheable, or whose `schema-digest` is not the manifest's, is answered `NOT_CACHEABLE`. A forwarder
never converts an Interest into a call: [P-4.2] already forbids sending that Interest, the Nack tells
a consumer with an outdated manifest what happened, and a silent conversion would hide the
disagreement. The sender MAY repeat the request as a plain call. §7 now also states what the engine
does with plain calls (stateless passthrough, event `bypass`). The event kind for the Nack stays
`bypass` with reason `not_cacheable`: the sandbox and the experiments read that stream. (2) *The
retry is a plain call, wherever the consumer can send one.* Most consumers know only their edge (a
browser cannot reach the producer across origins), so "directly" was not implementable as a MUST. A
passthrough call creates no PIT entry and is never answered from a CS, which is what the retry needs;
`producerUrl` remains for consumers that can reach the producer. In exchange the retry is held to
the first answer's standard: it MUST carry Data signed for the same name and verify, or the call
fails with `BAD_SIGNATURE` and no content reaches the agent. `IdemClient` and `createMcpEdge` were
fixed to do so (`p55.test.ts` in `packages/gateway/src` and `packages/mcp/src`). (3) *The MCP edge terminates MCP.* v1 specifies
what the code does: an MCP endpoint that lists the producer's tools and feeds each `tools/call` to
the engine as a consumer request, verifying on the client's behalf. Header routing was an
optimization for a proxy that forwards bytes untouched; the SDK already parses the request, and the
edge has to read the arguments anyway to name the call.
**Consequences.** Spec 01 §5, §7, §8.5, §9.1, §10 and §11 changed, with no change to the wire format
(§12): no `/idem/v2`. The MCP edge exposes tools only; a client that needs the producer's resources
or prompts talks to the producer. A byte-transparent, header-routed proxy stays possible later
without a protocol change. `@idem/sim`'s agent model retries with a plain call too, but still accepts
a retried result that carries no signed Data: harmless in the simulations (no attacker sits on an
agent link there), to be aligned by the simulator's owner.

## ADR-025 — Stale replay is a declared v1 limit; the signed-lifetime rule is deferred
**Context.** Spec 05 E5 lists "replay stale Data" among the attacks to reject, but no rule of spec 01
stood behind it. Freshness is relative: each node counts age from its own receipt and adds the
unsigned `ageMs` it was handed ([P-8.1], after the HTTP `Age` header). The producer signs
`producedAt` and `freshnessMs`, yet nothing compares them with a clock. So a party on the path of an
Interest can answer with a genuine Data of any age, either recorded earlier or with `ageMs`
understated: the signature verifies, a forwarder caches it as new and serves it for another freshness
period, and the consumer's check passes. E5 confirms it on the producer link and on the agent link;
an honest cache does not serve expired Data, and an off-path party cannot inject any (§4.1).
**Decision.** v1 states this as a limit in spec 01 §11 and in [P-8.1] instead of adding a rule now.
The rule that would close it is known, and is recorded here as the candidate for the next revision:
*a Data is expired at node N when `now_N − producedAt ≥ min(freshnessMs, ttlMs) + tolerance`; a
forwarder treats expired Data from upstream as invalid (not cached, not delivered, `BAD_SIGNATURE` to
waiters as in [P-8.5]) and never serves an expired CS entry as fresh; a consumer does not hand
expired Data to the agent.* It is RFC 9111's `apparent_age` (§4.2.3), which spec 01 left out when it
borrowed `Age`, made stronger because `producedAt` is signed where HTTP's `Date` is not. It is
deferred, not rejected, for three reasons. (1) *Clocks.* v1 needs no clock agreement between nodes;
this rule needs it between the producer and every verifier, including consumers in browsers, and
fails closed: a consumer whose clock runs ahead by more than the freshness plus the tolerance
rejects every answer, the direct retry included. Tool results live for seconds to minutes, far less
than the validity windows this kind of check usually guards. (2) *Open parameters.* The tolerance
has to cover clock skew plus transit time (E2 already counts honest answers that arrive past their
freshness on the producer's clock, `lateServes`, because transit is not part of `ageMs`); a
tolerance that is large next to a short TTL protects little, and a small one rejects honest Data.
Whether rejection reuses `BAD_SIGNATURE` or gets its own code in §10, and what `mustBeFresh: false`
means across hops, are also undecided (Q6). (3) *One step with the evidence.* The rule changes what
the engine accepts, so it must land together with E5's judge (which needs the same tolerance) and a
new E5 run; adding it alone would leave committed results describing another engine.
Alternatives: signing `ageMs` (impossible: only caches know it, and they hold no producer key); a
SHOULD that is off by default (rejected: a defence the reference gateway does not apply is not one).
**Consequences.** H3 holds for content, names, keys and scope, not for staleness under an on-path
attacker; spec 01 and the security page of the docs say so, and the results report the two E5 replay
variants as accepted. In v1 the exposure is
bounded by deployment, not by the protocol: TLS per hop leaves only the forwarders themselves able to
replay, and `producedAt` is signed and delivered, so an application that cares can look at it. Spec
05 §4 still says every E5 attempt is expected to be rejected; its owner should reword the replay
clause to match (honest caches never serve expired Data; on-path replay is this limit). Adopting the
candidate rule later is a change to §8 and §10, not to the wire format of §2, §4, §5 or §6.

## ADR-023 — The evaluation pipeline as built: one CLI, source digests, charged CPU, an E5 judged on ground truth
**Context.** Spec 05 named the experiments and the results layout but not how they run. Building E1,
E2 and E5 forced choices that change what the published numbers mean, and E5 found three variants
the engine does not stop.
**Decision.** (1) *One CLI, one layout.* `pnpm sim -- --config experiments/configs/<x>.json` runs a
microbenchmark (E1), a sweep (E2) or the safety suite (E5) and writes
`experiments/results/<experiment>/<run-id>/`; `experiments/run-all.sh` is the one-command
reproduction of M4. The runners live in `packages/sim/src/experiments` (Web APIs only, tested); only
`cli.ts` and `node-io.ts` touch Node. The sources run directly under Node's type stripping through a
20-line resolve hook (`packages/sim/scripts/ts-resolve.mjs`), so no build step and no new dependency.
(2) *A run names its code without git.* The checkout is not a repository yet, so `git-sha` is `none`
and every run also writes `source-digest` (SHA-256 over `packages/*/src/**` without tests); the run
id carries its first 8 hex digits. A run is never overwritten. (3) *Baselines are plain MCP.* In B0
and B1 the simulated producer answers without `_meta["dev.idem/data"]` (`producer.signPlainCalls:
false`), otherwise the baseline's bytes would be inflated by IDEM's own metadata; B1 keeps the
canonical name as its cache key, the generous reading of "exact-match". (4) *CPU is charged, not
ignored.* A virtual clock gives crypto no duration, which would make B4 identical to B2 and hide the
cost H2 asks about. `SimConfig.processing` prices canonicalize, name, sign and verify by payload size
from E1's medians (`pnpm sim -- calibrate` writes `experiments/configs/processing.json` with the runs
it came from) and the simulator adds those delays at the node that does the work, in the IDEM modes
only. E2 stays deterministic: the table is data in the config. (5) *Paired seeds.* The same seed plans
the same calls and draws the same think times in every mode and topology (nonces come from their own
stream), so reductions and latency changes are computed per seed and summarized as mean and 95% CI
(Student's t) over 30 seeds. (6) *Two notions of stale.* `staleServes` follows [P-8.1] and must be 0;
`lateServes` counts answers handed over past their freshness on the producer's clock, which [P-8.1]
does not see because transit is not part of `ageMs`. (7) *E5 is judged on ground truth, and failing
variants stay.* Each trial builds a fresh world from its seed on the real `Forwarder`, `Producer`,
`TrustStore` and `verifyData`; it counts as rejected only if no victim accepted forged, foreign or
expired content and no Content Store kept any, whatever the engine reported. Every variant carries
what spec 01 says of it: `rejected` (a claim), `limit` (documented and not stopped in v1) or `leaks`
(an accepted risk); limits are run and counted like the rest, so a limit is a number. A variant that
is accepted is recorded as accepted: nothing in the engine was changed to make the table clean, and
`safety.test.ts` names the open finding and the limits so that a fix fails the test until the results
are rerun. The simulator's own agent follows ADR-024: the [P-5.5] retry must carry Data signed for
the same name.
(8) *The page is generated.* `/benchmarks` (then `/results`) imports `apps/web/lib/results/data.json`, produced by
`pnpm sim -- export-web` from the run folders; a test compares the file with the folders. Verdicts
on H1 to H3 are computed from that data by stated rules, not written by hand. The matplotlib figures
for the report come from the same folders (`experiments/plots/make_figures.py`, uv).
**Findings recorded by this decision.** The first E5 run had three accepted variants. Two are stale
replay by a party on the path (on the producer link and on the agent link): ADR-025 states that as a
limit of v1, the suite now labels them `limit`, and they are reported as a documented limit, neither
as a pass nor as a claim that failed. The third is a claim that fails and is open: the core `Forwarder` uses an
`authContext` that already sits in an Interest arriving on a consumer face instead of deriving its
own, so a consumer that knows another user's value reads that user's `private` partition. The value
is an HMAC the edge never sends out, and the HTTP gateway rebuilds incoming Interests without the
field, so the deployed overlay is not exposed; the engine, the simulator's links and any future
binding that passes Interests through are (Q7). H3 therefore holds for tampering, forging and
foreign keys, and for `private` scope only where the first hop strips the field.
**Consequences.** Spec 05 states the pipeline, the base workload and the parameters "as run". E1 is
wall-clock on a shared machine: `env.json` records the load average and every repetition is kept, so
noisy runs widen the reported spread instead of disappearing. E3, E4 and the browser half of E1 have
not run; H4 is not evaluated and W-syn's parameters remain assumptions until traces exist. Any change
under `packages/*/src` changes the source digest: results are rerun (minutes) rather than relabeled.

## ADR-026 — Native NDN binding: names keep `args-digest`, the envelope keeps the IDEM signature, `private` stays off NDN (resolves Q1)
**Context.** M6 needs the native binding (`@idem/ndn`, NDNts). Q1 asked how the IDEM `args-digest`
relates to NDN's ParametersSha256DigestComponent (PSDC), which NDN appends to any Interest carrying
ApplicationParameters and computes over the ApplicationParameters TLV (type and length included)
through the end of the Interest, not over our JCS bytes. An NDN Data answers an Interest only if its
name equals the Interest name, PSDC included, so the PSDC is in every native Data name whatever
we choose. Three more questions came up writing the binding: what the Content carries (§9.2 said
`JCS({ content, meta })`), what to do with `private` results on a network whose PIT and CS know no
`authContext`, and how a browser can show a native Data without the producer's private key.
**Decision.** (1) *Q1: keep `args-digest` as an explicit GenericNameComponent; let NDN append its
PSDC after it.* The native name is the IDEM name plus one component, and the IDEM name of a native
packet is its NDN name without the trailing PSDC. Two calls get the same native name iff they get
the same IDEM name, because ApplicationParameters are exactly `JCS(canonical args)` and native
Interests are never signed [P-9.1] (a signature would change the PSDC per request and defeat NFD's
aggregation). The producer checks the bytes against `args-digest` [P-9.2] and then recomputes the
name [P-5.1]; NFD checks the PSDC on its own. The rejected option, dropping `args-digest` in native
mode and relying on the PSDC, would make the name depend on TLV framing instead of JCS, leave the
name the IDEM signature covers off the native wire, and force any translator to hold the arguments
to map a name. Cost: one 43-byte component per name. Tests: `packages/ndn/src/name.test.ts` (Q1
block), `e2e.test.ts`, `apps/web/lib/sandbox/ndn.test.ts`. (2) *Content =
`JCS({ content, meta, signature })`.* Keeping the IDEM signature in the envelope lets `@idem/core`'s
`verifyData` check a native Data unchanged (same trust store, same [P-5.2] key binding, same
content digest), so naming, signing and verification exist once (ADR-014). The NDN Ed25519
signature, by the same producer key with KeyLocator = the IDEM key locator, is checked too
[P-9.3]. (3) *`private` never travels natively* [P-9.4]: NFD would aggregate two users' Interests
for the same name and could serve one user's Data to the other. The consumer does not express
them, the producer answers `NOT_CACHEABLE` without running the tool, and a consumer rejects a
native Data signed `private`. (4) Errors are application Nacks (ContentType NACK, freshness 0); the
manifest and tool list are served as `_manifest/<version>` and `_tools/<version>` so a native
consumer bootstraps with no overlay; results over 8800 bytes are not segmented (`UPSTREAM_ERROR`).
(5) The sandbox's NDN view translates overlay packets in the page. It cannot sign as the producer, so
the NDN-level signature on its Data is made by a throwaway translator key under
`/localhost/idem-sandbox/KEY/<id>`, and the page says so; the inner IDEM signature is the producer's
and is verified against the producer's trusted key. This is the proxy-producer idea of §9.1 applied
to the outer signature only.
**Consequences.** Spec 01 §9.2 rewritten with rules [P-9.1]–[P-9.4]; no change to §2, §4, §5 or §6,
so no `/idem/v2`. `@idem/ndn` depends on `core` and `@ndn/{packet,tlv,keychain,endpoint,fw}`
0.0.20260427 (verified with `pnpm view` on 2026-11-18); `apps/web` depends on it for the sandbox
view. The NDN keychain pulls `@yoursunny/webcrypto-ed25519`, deprecated and using top-level await in
its browser build, which Turbopack handles; WebCrypto Ed25519 is required anyway (ADR-005). In-process
tests use `@ndn/fw`, which has no aggregation and no CS, so they show the round trip, not NFD's
behaviour; that is E4's job in Mini-NDN (still open). A native-only consumer cannot perform the
plain-call retry of [P-5.5] and fails closed instead. A native forwarder that is not NFD (none in
v1) would have to apply [P-7.1]; NFD does not verify Data signatures, so on the native binding
cache poisoning is stopped at the consumer [P-9.3], not at the forwarder.
*Checked against NFD 24.07 (2026-11-18, `pnpm exp:ndn`, `experiments/results/ndn-nfd/`):* nine
scenarios pass over TCP, UDP and WebSocket faces, including aggregation of 8 concurrent calls into
one tool run, CS hits and MustBeFresh past the TTL, and a two-forwarder chain. What the check showed:
(a) an altered Data stays in NFD's CS and every consumer of that name rejects it until the entry goes
stale or is evicted, so tampering costs availability, never integrity; (b) NFD likewise caches a
`private` Data a non-conforming producer sends and serves it to the next user of the name, which is
why [P-9.4] has a consumer-side check; (c) `NdnConsumer` reported every verification failure as
`BAD_SIGNATURE`; it now reports `UNTRUSTED_KEY` and `NOT_CACHEABLE` as [P-9.3] and [P-9.4] say
(test in `e2e.test.ts`). The §9.2 text on nonces and MustBeFresh records NFD behaviour the binding
already relied on; no rule changed.

## ADR-027 — Sim: arbitrary graphs, multiple producers, per-agent workloads
**Context.** The sandbox is becoming a network editor: any graph of agents, forwarders and
producers, several producers each with its own tools, a tool list per agent. `@idem/sim` assumed one
producer (`SIM_PRODUCER`, routes by hop-count BFS toward the first producer node only, other producer
nodes silently dropping packets), agents on their first link only, three fixed tools, plans matched to
agents by index, and upstream calls counted only toward a node literally called `producer`.
**Decision.** (1) *Producers are configuration.* `SimConfig.producers?: SimProducerConfig[]` puts
one `Producer` on each listed producer-kind node, with its own name, tools and key (derived from the
run seed and the node id, so reordering the list changes no key); every manifest goes into the shared
`TrustStore`. Absent, the configuration means what it always meant: one producer named
`SIM_PRODUCER` on the first producer-kind node, serving `fetch_page`, `my_notes`, `send_email` with
`producer.ttlMs`, keyed and timed from the same random streams as before. (2) *Routing is shortest
latency, per producer.* Dijkstra on link latency, one tree per producer node, ties broken by next-hop
id then link index (deterministic, loop-free). Only forwarders relay: never an agent, never another
producer. Each forwarder gets `fib.addProducer(name, face)` for every producer it reaches; an agent
with several links sends each call on the link of its shortest path to that call's producer. A call
to a producer the agent cannot reach fails at once, recorded with `error: "NO_ROUTE"` and counted in
`Metrics.noRoute`, instead of vanishing on a link. (3) *Tools live in `tools.ts`* with a
`TOOL_CATALOG` that mirrors the live demo producer: `search_corpus` (normalizers `trim`,
`lowercase`) and `weather` (`trim`, `lowercase`, `nfc`; 15 s TTL, 15 s buckets) are added, their
results generated from the seed and the canonical arguments (no corpus, no network). Explicit
producers take each tool's TTL from the config or the catalog, not from `producer.ttlMs`. (4) *A
per-agent workload* (`kind: "per-agent"`) gives each agent node a call count, think time and a
weighted mix of `{producer, tool}`; `fetch_page` keeps overlap, Zipf and catalog per agent;
`search_corpus` and `weather` draw from small fixed catalogs with surface variation, so the
normalizers decide which calls share a name. (5) `Metrics.upstreamCalls` counts calls reaching any
producer-kind node; attacks take an optional target producer (default: the first). (6) A forwarder
node may set `csMaxBytes` to size its own Content Store (default `cs.maxBytes`). (7) A configuration
error is a `SimConfigError` (`code: "BAD_CONFIG"`, with the path of the field). There is no
live-mutation API: the editor restarts a run on every edit.
**Consequences.** Every configuration without `producers` runs exactly as before: a fingerprint of
every run (metrics, call records, transmissions, forwarder events) of every E2 sweep in
`experiments/configs/` was recorded on the old code and matches for all 4620 runs (30 seeds) on
macOS and on Linux, and a one-seed subset plus the default, tree-with-loss, attack and trace runs is
a test (`legacy.test.ts`); `pnpm --filter @idem/sim run fingerprint` reprints the full set. *Runs are
reproducible per platform, not across platforms:* V8's `Math.log` is not correctly rounded and
differs in the last bits between macOS and Linux, think and service times inherit that, and since a
Data's JSON carries `producedAt`, a packet's byte count (and the CPU time charged for it) follows the
decimal digits of a virtual timestamp. So the same seed gives slightly different times and byte
counts on macOS and on Linux (in the one-seed pinned set, 59 of 162 runs are bit-identical across
the two). The test therefore pins one set of hashes per `process.platform`, each recorded from the
pre-change code on that platform. The committed results were produced on macOS and reproduce
exactly there; a rerun on Linux would give close but not identical numbers. Making them portable
(a pure-JS `log` in `Rng`, timestamps rounded before they are serialized) changes every number and
needs its own decision and a rerun. The only
behaviour differences are on graphs no committed config uses: a cyclic topology without `producers`
now routes by latency rather than hop count, an agent whose producer is unreachable fails its calls
with `NO_ROUTE` instead of retrying against a Nack, and a producer node not named `producer` is now
counted as upstream (a fix). The source digest of `packages/*/src` changes, so by ADR-023 a run made
after this change carries a new run id; the committed E1, E2 and E5 results are not relabeled. Their
numbers would come out identical (the fingerprints show it for E2; E1 and E5 do not run the
`Simulation`), so no rerun is required for correctness, only to name the current code.

## ADR-028 — The sandbox is a network editor; NDN routers in the page are YaNFD on WebAssembly (chrome amended by ADR-029)
**Context.** The author asked for the sandbox to let visitors build agent networks (several edges and
producers, every node draggable and configurable, a tool list per agent), to open on a screen that
picks what to load (examples or a blank canvas) rather than on a network, to drop the Live / Swarm
switch (the swarm becomes one example), and to run the native NDN binding in the page. NDNts' in-page
forwarder neither aggregates nor caches, and nothing hosts a persistent shared NFD for free (Vercel
functions are per request; Vercel Sandbox sessions end after 45 min on the free tier, checked
2026-11-18). ndnd's forwarder (YaNFD, MIT) builds for `js/wasm` with a small JS face bridge, and its
PIT aggregation, Content Store and a 3-router chain were shown on real packets
(`experiments/ndn/yanfd-wasm/`).
**Decision.** (1) *Start screen.* `/sandbox` opens on a screen of cards: the examples (Swarm, Two
producers, Regional tree), a blank canvas, Live (real HTTP), and "continue where you left off" when
this browser saved a network. A shared link opens its network directly (`#n=` carries the network as
base64url JSON, validated and repaired on read; `?example=<id>`; the old `?mode=swarm` and
`?mode=live` map to their examples). (2) *The editor.* A network is plain data
(`lib/sandbox/network.ts`): agents (calls, think time, shared-page overlap, Zipf, a weighted list of
`{producer, tool}`), forwarders (CS size), producers (name, tools served with their TTL, service
time), links (latency, loss) and run settings (seed, speed, compared protocols, engine). Agents link
only to forwarders, never to producers or each other (where IDEM aggregates and caches is the point);
an agent's tool list offers what the producers it reaches serve; what stops a network from running is
listed. The stage edits it: drag a node (no restart), drag empty space to pan, wheel or pinch to
zoom, click a node or a link to select it, drag from the selected node's handle (or Shift-drag) onto
another node to link them, Delete, arrow keys, undo and redo. The sidebar is the network head
(example name, undo, redo, Share), Run, Add (chips to click, linking the new node to the selection,
or to drag onto the stage), Selected (the properties form, an info tip on every field), Attacks
(target producer), Windows. The network autosaves in `localStorage`. (3) *Two engines.* **IDEM**:
`@idem/sim` (ADR-027) runs the network once per compared protocol, side by side, seeded, on the
virtual clock; every edit but a move restarts it (debounced). **NDN**: one YaNFD instance per
forwarder node, each its own WebAssembly instance (own memory, one realm, no workers needed), JS
links with the network's latency and loss, producers as `@idem/ndn` `serveNdn` over the simulator's
deterministic tools, agents as `NdnConsumer`s replaying the simulator's plan for the seed. It runs in
real time (Go timers), one network, no protocol comparison; routers verify nothing (agents verify
both signatures) and `private` and side-effect calls stay off NDN (ADR-026). Cache hits and
aggregation are read from the traffic the links carry, since the routers report nothing. The router
is built by `experiments/ndn/yanfd-wasm/build.sh` from a pinned ndnd commit into
`apps/web/public/ndn/` with a `build.json` record, and loaded only when the NDN engine is chosen
(9.7 MB, 2.6 MB gzipped). (4) *Live* stays as the example over real HTTP, with its own runner,
unchanged. (5) Connecting the editor to the public NDN testbed is future work (roadmap).
**Consequences.** Supersedes ADR-016's "Live is the default" (Live is one choice on the start screen)
and amends ADR-021 (the mode switch is gone; the shell keeps one window set for Live and one for the
editor, old saved layouts carry over). The swarm's URL parameters (`?a=8&ov=60…`) are gone; links
carry the whole network instead. The NDN engine's numbers are wall-clock, per visit and not seeded
end to end, so they are shown as live counters only and never quoted as results. Signing through
the NDNts keychain failed in WebKit (its Ed25519 ponyfill cannot use a native `CryptoKey`), so
`@idem/ndn` now signs and verifies with WebCrypto directly. Comparison panes are clipped to their
frames (scissor rectangles), since a shared camera can carry a network past its pane.

## ADR-029 — Sandbox chrome: start screen, back button, player bar, selection card, bottom dock (start screen amended by ADR-031)
**Context.** After using the editor, the author asked for: a better start screen (a simple plus for a
blank canvas, the examples in their own column); no loading of another network while one is open
(a way back to the start screen instead of the in-session picker); a smoother change between the two
screens; a cleaner sidebar (play and restart out of it, as a media player over the canvas; no
"Selected" section, but a card named after the clicked component on the right; no renderer and seed
footnote); and the windows as tabs fixed along the bottom that open upward.
**Decision.** (1) *Start screen*: a heading, then two columns: on the left a large plus tile (blank
canvas) and, when this browser saved a network, "continue where you left off"; on the right the
examples, one row each (drawing, name, blurb), Live last. (2) *One network per visit to the editor*:
networks load only from the start screen (each with an empty history); the sidebar head has a back
button ("Networks") that saves the network if it was edited and returns to the start screen. The
in-session picker is gone. (3) *Transitions*: picking plays the start screen out (fade, slight
scale up, 0.28 s) while the workspace comes in (sidebar from the left, player from the top, tab bar
and drawer from the bottom, nodes popping in); back plays the workspace out, then the start screen
in. Reduced motion: short fades only. (4) *Player bar* (top centre of the stage, in its own band
the network never enters): restart, play or pause, virtual time, a progress bar of calls answered,
the speed menu; when the network cannot run, the first reason (all of them on a click) instead.
The NDN engine shows restart, its status and progress; Live shows its burst and single-call actions
and the edge status. (5) *Selection card*: selecting a node or a link pops a card in at the right of
the stage, titled with its name (a producer's host name, a node's id, a link's ends) and kind, with
its settings; Escape, a click on empty canvas or its close button dismiss it. (6) *Bottom dock*: the
six windows become panels: a tab bar always along the bottom of the stage (`1`–`6`), and above it a
drawer that rises when a panel opens and sinks when the last one closes, the open panels side by
side, its height set by dragging its top edge (arrow keys; double click resets). The network gets
the stage between the player band and the dock. Floating windows (drag, throw, collapse, z-order,
drag-in from the sidebar) are removed. (7) The sidebar keeps the network head, the engine (with the
compared protocols and the seed), Add and Attacks.
**Consequences.** Amends ADR-021 (no floating windows; the layout saves open panels per mode, the
sidebar width and the drawer height; v1 layouts keep their open windows and sidebar width) and
ADR-028 (no in-session picker; the Selected section becomes the card). The zoom buttons move to the
bottom right of the network's area, the help button to the tab bar. Fewer controls compete for the
sidebar, and the run's transport sits where the run is.

## ADR-030 — The routers are the main engine; Live edits its agents and shows the shared edge
**Context.** The author asked for NDN to be the main mode, named "IDEM" (NDN wasm routers) beside
"Simulation", with a way to pause it (holding the agents' requests), and starting paused when a
network is loaded; and for Live to configure each agent and add agents while the edge and producer
stay fixed (no Scenario section), with a way to see at the edge that another user's tool call
filled the cache, to show it is truly shared.
**Decision.** (1) *Engines.* The default engine is the routers (`run.engine: "ndn"`, shown as
"IDEM"); the simulator is "Simulation" (`"idem"`, the value kept so shared links keep working; an
unknown value reads as the routers). Each option has an info bubble; the selector has no subtitles.
(2) *Pause on routers.* `NdnNetwork.pause()` holds each agent's next call until `resume()` (calls in
flight finish; real time goes on, so freshness keeps running); the player's play button and Space
drive it, and a network just loaded starts paused. (3) *Live's agents.* Each agent is `{n, tool,
arg}`, with credential `token-agent-<n>`; the sidebar adds agents; an agent's card sets its tool and
argument, asks once or removes it; the edge and the producer cannot be changed. (4) *The shared
edge.* The edge route records each Interest and call: an anonymous per-tab id the page sends
(`idem-visitor`, random, in `sessionStorage`), the tool, the first 8 characters of the args digest
for public names, and the edge's outcome read from its trace; a name's owner is the visitor whose
call went upstream (or who asked first while it is pending). A hit or an aggregation answers with
`idem-filled-by: other|self`, and every response with `idem-edge-instance`. `GET
/api/edge/activity?after=<seq>` lists the last ten minutes (at most 200 calls) as the asking visitor
sees them: own calls marked, others as a short salted label, never their ids. Arguments, results
and credentials are never recorded; private names and plain calls carry no digest and no owner. It
lives on the same route and in the same memory as the edge's CS, so it is true of the instance that
answered; when the poll and the calls are answered by different instances, the page says so.
**Consequences.** The default is real time and not seeded: the sandbox's opening network is no
longer replayable event for event (Simulation still is). The activity feed costs one function call
per visitor every 3 s while the page is visible. What other visitors did is shown only as tool,
digest prefix and outcome; even so, a digest of a low-entropy argument could be guessed, which is
the price of showing that two visitors asked the same question.

## ADR-031 — The visitor's networks: a library in this browser, with file export and import
**Context.** The author asked for two buttons in the editor, one to save a network the visitor made
and one to delete it, kept in the browser or exported and imported as a file, and a start screen
that reflects it. Until now the sandbox remembered only the last network edited (one autosave).
**Decision.** (1) *Library.* `lib/sandbox/library.ts` keeps entries `{id, name, savedAt, net}` in
`localStorage` under `idem.sandbox.library.v1` as `{v: 1, items}`. Names are 1 to 60 characters;
at most 40 entries; a network of at most 200,000 characters of JSON; an import file of at most
1,000,000. Beyond the count a new entry is refused with a message (an update still works). Every
storage access is in try/catch, and a read drops what is not an entry or whose network
`sanitizeNetwork` rejects. (2) *File.* `{format: "idem-network", v: 1, name, savedAt, network}`,
named `<slug>.idem.json`; an import also accepts a bare network. Every import goes through
`sanitizeNetwork`; the file is never trusted and nothing is sent to a server. (3) *Editor.* Save,
Export and Delete sit at the end of the name row of the sidebar head, not in the top row (which is
full): Save updates the entry the network was opened from or saved to, and otherwise asks for a name
in the row itself (Enter saves, Escape cancels); a dot on Save marks changes since the last save;
Delete is disabled until the network is saved, asks to confirm in the row, deletes the entry and
returns to the start screen. Live has none of the three. (4) *Autosave kept.* The single autosave
(`idem.sandbox.network.v1`) stays, now also noting which entry it came from (`lib`); "Continue where
you left off" shows only when the autosave differs from that entry (or has none), and deleting the
entry deletes its autosave. (5) *Start screen.* A "Your networks" section above the examples in the
right column: cards with rename, export and delete, import by button or by dropping a file, an empty
state, four shown and "Show all" for more. The file's size is checked before it is read.
**Consequences.** Amends ADR-029's start screen (the left column keeps the plus tile and Continue;
the right column gains a section). The library lives and dies with the site's storage (a private
window or cleared data loses it), which the docs say, with Export as the way to keep one. No server
state and no new dependency. The names a visitor types are stored as text and shown as text.

## ADR-032 — Benchmarks tells one story about IDEM over native NDN; charts are interactive; no C-shaped edges
**Context.** The author found the Benchmarks tab weak: no mini navbar like the home page, charts that
could only be looked at, and stat tiles whose thick coloured top border bends into a C on the rounded
corners. He then asked for the whole benchmark to make sense around the protocol itself, "the real
NDN version". E4 (overlay against native NDN under loss) was running and had no result yet; the NFD
conformance check already had committed runs that the page ignored.
**Decision.** (1) *Story.* `/benchmarks` leads with IDEM on real NDN (E4, then the NFD check), then
the hypotheses' verdicts, then the evidence: E2 sweeps, E1 costs, E5 safety, method. Each section
opens with its question and a verdict computed from its data (spec 04 §1.1). (2) *Data.* `export-web`
exports `e4` (a run of `kind: "emulation"` in `experiments/results/e4/`, `null` until one exists) and
`nfd` (the last five runs of `ndn-nfd`, from `summary.json`); the page has an honest pending state for
E4 and never shows a placeholder number. The E4 fixture lives only in tests. (3) *Navbar.* The home
page's `SectionNav` also mounts on `/benchmarks`; sections are marked, not duplicated. (4) *Charts.*
The line chart becomes a client component with a readout (crosshair, card, keyboard, live region),
legend toggles and highlight; it stays SVG and React, no chart library. Everything it shows is passed
in from the server. (5) *Edges.* A coloured accent never follows a rounded corner: tiles use an
inset solid square. The thick left bars on the docs' rule and quote plates stay: their corners on
that side are square.
**Consequences.** `ResultsData` gains `e4` and `nfd`. The page is no longer a pure server render:
charts hydrate, so the readout works, and the marks' entrance animation is unchanged. The NFD run of
2026-11-18 05:25 stopped on scenario S8 (`nfdc route add` rejected, an environment error, no check
ran) and is shown as it is, beside the run before it that passed 9 of 9. When E4 is committed,
nothing in the page changes; only its verdict wording may need a second look.

## ADR-033 — `authContext` is never taken from an Interest (resolves Q7)
**Context.** E5 variant `private/authcontext-known` was the one claim the engine did not keep
(ADR-023): `Forwarder` used an `authContext` already present in an Interest that arrived on a
consumer face as the partition key of `private` PIT and CS entries, so a consumer that knew another
user's value read that user's cached `private` result. [P-8.4] already said the edge derives the
value; the HTTP gateway happened to rebuild incoming Interests without the field, so the deployed
overlay was not exposed, but the engine, the simulator's links and any binding that passes Interests
through were.
**Decision.** A forwarder never honours an `authContext` carried by a received Interest, on any face.
On a consumer face it derives its own, `HMAC(authSecret, credential)`, or has none (no credential, no
secret); on other faces there is none. [P-8.4] now states both MUSTs ("derive", "ignore any present
in a received Interest") and a test cites it (`forwarder.test.ts`: a consumer carrying the victim's
value, with and without its own credential, gets its own or the anonymous result; a garbage value
does not move a user out of their own partition). The field stays in the `Interest` of §4, documented
as never set by a sender and ignored on receipt: removing it would change §4, the wire format.
Alternatives: rejecting an Interest that carries the field (rejected: it would turn an ignored,
harmless value into an error path and gains nothing, since the value is never used); removing the
field (rejected: a §4 change needs `/idem/v2`, §12).
**Consequences.** `private/authcontext-known` is a claim like the other `private` variants and the
E5 test asserts every `expected: "rejected"` variant holds, with no exception list. No change to §2,
§4, §5 or §6: no `/idem/v2`. The gateway, the NDN codec and the sandbox's NDN view already dropped
the field; nothing else in the repository set it. E5 must be rerun for the results to show the fix.

## ADR-034 — Signed lifetime: Data is bounded by `producedAt`, two-sided, with a 60 s tolerance (resolves Q6)
**Context.** Freshness in v1 was hop-relative only ([P-8.1], the unsigned `ageMs`). A party on the path
could replay a genuine Data of any age: the signature verified, a forwarder cached it as new and the
consumer accepted it (ADR-025; E5 `replay/expired@upstream` and `@last-hop`, both `limit`). ADR-025
recorded the candidate rule and left open the tolerance, the error code, `mustBeFresh: false` across
hops, and how a consumer with a wrong clock is told apart from an attack.
**Decision.** (1) *Rule [P-8.6].* At node N, `apparentAge = now_N − producedAt`. A Data is outside its
signed lifetime when it is expired, `apparentAge ≥ min(freshnessMs, ttlMs) + clockToleranceMs`, or
dated in the future, `producedAt − now_N > clockToleranceMs`. IDEM takes `apparent_age` from RFC 9111
§4.2.3 with the signed `producedAt` in place of `Date`, and does not clamp it at 0: RFC 9111 can clamp
because its caches are trusted, while with a signed timestamp a clamp would let a future-dated Data
live for its freshness plus the offset. One predicate, `lifetimeState` in `@idem/core`, is used by the
forwarder, every consumer and the E5 judge; it fails closed on values that are not numbers.
(2) *Tolerance.* A node-local option, default `DEFAULT_CLOCK_TOLERANCE_MS` = 60 000 ms. Precedents: 60 s
is the grace period the NDN packet specification recommends for signed-Interest timestamps, and the
default clock skew of MCPS, applied additively to its window with one error for "outside the window";
Signed HTTP Exchanges use no tolerance but a window of days (signers backdate instead). Tool results
live for seconds to minutes, so a minute is large next to short TTLs; the spec says so (§11), and E4
saw honest deliveries delayed by seconds under loss, which a smaller value would reject.
(3) *Forwarder.* Data from upstream outside its lifetime is never stored; every downstream whose
Interest had `mustBeFresh: true` gets the new wire error `EXPIRED` (HTTP 502), the others get the
Data. A CS entry is served to a fresh Interest only if fresh by [P-8.1]/[P-8.2] AND within its signed
lifetime, whatever its `ageMs` says. Hop-relative freshness stays: it needs no clock agreement and is
what honest caches use; the signed bound is added, not substituted. (4) *`mustBeFresh: false`* keeps
its meaning (any CS entry may answer) and extends to the lifetime: such a waiter may receive Data
outside it and its consumer skips the check; nothing outside it is ever stored. The smallest engine
change that keeps "a fresh waiter never receives Data outside its lifetime" is one boolean per PIT
in-record, so Interests with different flags still aggregate. (5) *Consumer [P-8.7].* After
verification, a consumer that asked for fresh Data refuses Data outside its lifetime on its own clock
and retries once as a plain call (the [P-5.5] retry, also on an `EXPIRED` Nack). The retry must carry
Data for the same name, verify, and be within its lifetime; if it verifies but is not, the call fails
with the new local code `CLOCK_SKEW`, whose message carries `producedAt`, the local time and the side
missed. A Data the producer has just made that looks expired or future-dated means the two clocks
disagree beyond the window, or the retry's path replays too: they cannot be told apart, so the call
fails closed and reports the offset, as the Signed Exchanges notes recommend (a clock-suspect
diagnostic, not an integrity alarm). A native-only consumer has no plain call and fails closed with
`EXPIRED`. Signature and lifetime stay distinct verdicts: `verifyData` is unchanged, `IdemClient`
returns `verify.ok` with `error.code` `EXPIRED`.
Alternatives: one wire code per side (expired, from the future), as both the Signed Exchanges and the
NDN notes recommend because the remedies differ (rejected by decision: one code `EXPIRED` for
"outside its signed lifetime", the message says which side, and the remedy at the consumer is the same
plain-call retry either way); clamping future-dated Data at age 0 (rejected: a producer clock glitch
signing a far-future `producedAt` could be replayed by an on-path party until that date; Signed
Exchanges and JWT `nbf` refuse future-dated signatures the same way); a manifest cap on
`expires − date` as Signed Exchanges have (already [P-8.2]: freshness is capped by the manifest
`ttlMs`); partitioning the PIT by `mustBeFresh`, as NFD matches PIT entries on it (rejected: the PIT key
and the CS key would diverge, a larger change for the same invariant); reusing `BAD_SIGNATURE`
(rejected: the signature is valid, and the verdicts must stay distinguishable).
**Consequences.** No change to §2, §4, §5 or §6 (only §7, §8, §9.1 status codes, §10, §11): no
`/idem/v2`. The residual limit is bounded staleness: a replay younger than `min(freshnessMs, ttlMs) +
60 s` is accepted and may be served by a cache until that bound, never later; E5 measures it as
`replay/in-tolerance@upstream` and `@last-hop` (`limit`), while `replay/expired@*`,
`replay/understated-age@core` (a malicious regional sets `ageMs: 0`; stopped at the edge) and
`replay/future-dated@upstream` (assumes a producer clock glitch) are claims. Clocks must now agree
within the tolerance: a node ahead by more than freshness + tolerance, or behind by more than the
tolerance, fails closed (`EXPIRED`, then `CLOCK_SKEW`); this includes browsers in the sandbox's Live
mode. Honest simulator runs are unchanged (the pinned E2 fingerprints pass as they were; the largest
honest late serve in the committed E2 runs is under 50 ms). E5 must be rerun. H3 can now cover
staleness, up to the stated bound. Supersedes the deferral of ADR-025.
**Amended 2026-11-27 (review).** Three defects. (1) A fresh Interest aggregated onto a PIT entry
opened by a `mustBeFresh: false` Interest was handed whatever the next hop answered: in a tree, a
copy past its freshness by `ageMs` but inside its signed lifetime reached the fresh waiter, which
gave an ordinary off-path consumer the stale-replay ability §11 gives only to on-path parties. The
forwarder now answers every fresh in-record `EXPIRED` when the Data is stale by its `ageMs`
(`staleByAge`: `ageMs` present and at least `min(freshnessMs, ttlMs)`; a Data without `ageMs` comes
from its producer and is not stale on arrival, so error results with freshness 0 still reach fresh
waiters) and delivers it to the others; [P-8.6] states the invariant ("a downstream that asked for
fresh Data receives only Data fresh by [P-8.1]/[P-8.2] and within its signed lifetime, whatever the
flags of the other Interests") and [P-8.7] adds the same age rule at the consumer. (2) The `pit_full`
passthrough relayed Data with no check; its entry now keeps `mustBeFresh` and the TTL and applies
both checks ([P-7.3]). (3) The E5 claim `replay/expired@last-hop` was decided by the harness: its
consumer refused with `lifetimeState` and its judge tested the same predicate, so the row read 250 of
250 even with no shipped consumer check. The consumer decision is now one exported function,
`acceptData` (name, `verifyData`, signed lifetime, age), used by `IdemClient`, `IdemConsumer`,
`NdnConsumer`, the simulator's agents and the E5 harness; the judge works on ground truth (the world
records when the producer made each text) and no longer calls `lifetimeState`; `safety.test.ts`
requires each claim's mechanism to show the layer that must stop it, and fails when the consumer's
[P-8.7] check or the forwarder's [P-8.6] check is removed. No wire change.

## ADR-035 — Related work and the novelty claim, restated; the ArcticSwarm citation pinned to v1
**Context.** Until 2026-11-26 spec 00 §3 claimed novelty against the NDN lineage only (RICE, NFN,
NFaaS, one NDNComm talk) and motivated the project with one number, [ARCTICSWARM] Table 21. A
full-text read of about forty sources found four things. (1) Prior work caches tool-call results and
none of it was cited: a digest of canonicalized arguments as the key (ToolCaching, TwinHash,
ArcticSwarm's own harness), one execution for concurrent identical calls (TwinHash, `mcp-proxy`, HTTP
request collapsing), a cache shared across agents (proposed and replayed over production traces by
the AgentSysBench paper; TVCache in training), and shipping middleware that caches `tools/call`
unsigned. (2) Signing around MCP is an active area (MCPS, signed receipts drafts, signed manifests
named as a known mechanism by the misbinding paper), signed objects that any cache may serve inside a
signed window exist on the web (Signed HTTP Exchanges), and Codexproof (AgentNet 2026) already brings
NDN's signed named objects to tool results, naming the answer and not the request. (3) The cited
number had been withdrawn: Table 21 exists only in arXiv:2609.01870v1; v2 (11 Nov. 2026) removed it,
and the old wording ("almost all from a different subagent") matched the paper's prose, not its
table, which gives 30.7% and 27.6% of all calls as cross-agent. (4) The [NDN-AI] entry had the wrong
title and one author of three, and the talk lists its two items as "Future works", about split DNN
inference, not as open problems about LLM tool results.
**Decision.** (1) *The claim.* IDEM claims no mechanism as new. Spec 00 §3 now reads: "No single
mechanism in IDEM is new. Its contribution is their combination into one protocol for tool calls, and
its measurement: a call is named by its request, so a repeat is recognised before anyone answers; the
result is signed by its producer with a scope and a bounded lifetime, so a cache the receiver does
not trust may serve it; the producer, not an annotation or a gateway operator, authorizes caching;
and the same objects run over an MCP-compatible HTTP overlay and over native NDN." The words "first"
and "novel" are not used for tool-result caching, for in-flight aggregation or for signing MCP
messages. Where the project said "provenance" it now says origin authenticity: the signature proves
which producer answered, not that the answer is true, and records no lineage. (2) *Related work* is
grouped in five families (the ICN lineage; caches for tool results; signing in MCP and signed caching
on the web; agent networking; tool calls issued by code), each with what it does and what it leaves
open. (3) *Citation rule.* An arXiv reference whose claim depends on a table or a number carries the
version that was read, and the entry says so when a later version dropped the material; a source read
in part is marked as such; a bibliographic detail the reading could not verify is left out.
[ARCTICSWARM] is pinned to v1 and its entry states that v2 removed the table. (4) *The measured
problem* is restated with both sources and their limits: duplicates and the cross-agent share per
tool, with the 0.4% for free-text search (ArcticSwarm v1); recurrence across sessions in 24-hour
production traces and what a 10-minute TTL keeps of it (AgentSysBench); and the drift of re-executed
live MCP calls (DynamicMCPBench), which bounds the thesis to the period the producer signs. (5) Two
hypotheses, H5 (what the protocol adds to a shared unsigned cache, B5) and H6 (code-driven bursts,
W-code), and four non-goals (model outputs and tokens, lineage, long-running tools in the native
binding, discovery and delegation) enter spec 00. (6) Two docs pages carry this to readers: Use cases
(Learn, after Introduction) and Related work (Research, before Evaluation). Their rule: every
statement about the outside world has a key in spec 08 and says no more than the source; each
scenario states the strength of its outside evidence; no IDEM result number appears on them.
Alternatives: keeping a narrower "first to apply NDN to MCP tool calls" claim (rejected: Codexproof
applies NDN's signed objects to tool results, and the claim would rest on the distinction between
naming the request and naming the answer, which is better stated than hidden); citing ArcticSwarm v2
(rejected: it has no count of duplicates); dropping the ArcticSwarm figure (rejected: it is the only
measurement of cross-agent overlap inside one task, and v1 remains a citable version; the entry says
what happened); leaving ToolCacheAgent in (rejected: withdrawn from ICLR 2026 and not readable in
full).
**Consequences.** Changed: `spec/00-vision.md` (§1, §2, §3, §5, §6), `spec/08-references.md` (grouped;
about sixty new entries; [ARCTICSWARM], [NDN-AI], [CFN], [NDN-CACHE-SURVEY] and [IETF-AGENTS]
corrected; the [MCP-CHANGELOG] URL fixed), `spec/04-showcase.md` §4, the Introduction in both
languages, and the new pages `use-cases` and `related-work` in both languages with their entries in
`components/docs/pages.ts` and the docs dictionary. Q4 in the open questions cites [NDN-AI] for
"semantic forwarding", which is accurate for the talk; its wording can also cite [FUZZY-FWD]. The
security, evaluation and concepts pages still describe the protocol before ADR-033 and ADR-034 and
the evaluation before B5 and W-code; they are updated by the docs-sync step, not here. The claim now
depends on the comparison with B5: if IDEM does no better than a shared unsigned cache where neither
surface variation nor concurrency occurs, H5(a) says so in advance, and what remains is H5(b).

## ADR-036 — B5, the industry baseline: a shared, unsigned exact-match cache at the gateway
**Context.** The evaluation compared IDEM with direct MCP (B0) and a per-agent cache (B1). B4
(`idem-noverify`) is not what is deployed: it still names, canonicalizes and aggregates. A
reviewer's first question is what IDEM gives that a cache at the gateway does not. The read of
shipping products (`gateway-caching-products` notes) found that the large MCP gateways (Kong,
LiteLLM, Agent Router, agentgateway; Cloudflare's AI Gateway caches LLM responses) document no
`tools/call` cache, and that the products that do cache tool results (FastMCP's response-caching
middleware, the `mcp-proxy` crate, IBM ContextForge's plugin) do it as an unsigned add-on the caller
cannot check.
**Decision.** (1) *What B5 is.* A new simulator mode `mcp-gateway-cache` (evaluation mode B5) that
models that add-on as shipped, neither weakened nor improved. Plain MCP end to end, as B0 and B1
(ADR-023): no names, no signatures, no manifest on the wire, the producer answers as a plain MCP
server, and nothing is verified ("every cache here is trusted"). The edge keeps one cache shared by
every agent behind it, as a gateway does (in-process or a shared store such as Redis, which
`mcp-proxy` offers and the Gravitee guidance names). (2) *Key.* Producer, tool and the arguments as
sent, serialized with sorted keys: FastMCP's `json.dumps(sort_keys=True)`; `mcp-proxy` keys on
"request type, name/URI, and arguments", ContextForge on the tool name and selected argument fields.
None applies a producer-declared normalization, so two spellings of one URL are two keys. The key
holds no credential: `mcp-proxy` and ContextForge key without one. FastMCP partitions per access
token, which removes sharing between users; a cache partitioned that way is B1 keyed on raw
arguments, not B5. (3) *No coalescing.* Two misses for the same key that are in flight at the same
time both go upstream (cache-aside). FastMCP does get, call, put with no in-flight map; ContextForge
has none; Cloudflare documents the same race for its LLM cache. `mcp-proxy` has an opt-in
`coalesce_requests`, with the caution to enable it "only when sharing identical concurrent tool
calls [...] is appropriate": the model takes the common case and the spec names the exception. (4)
*What is stored.* Error results (`isError`) are not stored, as FastMCP and `mcp-proxy` refuse them.
(5) *Generous where the comparison would otherwise be about configuration.* The operator caches
exactly the tools the producer's manifest marks cacheable and `public`, with the manifest's TTL
counted from the store at the edge, so neither TTL nor the choice of tools is what differs (the
products decide by tool name, and FastMCP's default caches every tool for an hour); the cache has
the byte budget and the replacement policy of the IDEM Content Store and counts the stored result's
JSON bytes against it. B5 does no cryptographic work and is charged no CPU, like B0 and B1. (6)
*Where it lives.* In `@idem/sim` (`gateway-cache.ts`: `GatewayCache`, and `GatewayRelay`, which
wraps each client face of the core forwarder that relays plain calls as in B0), not in `@idem/core`:
core implements the protocol and must not grow a baseline. (7) *E5 baseline rows.* Three variants
run the attack of an IDEM variant against B5 with the same judge on ground truth:
`baseline/tamper-cache@edge` (a compromised, buggy or malicious cache rewrites a stored result;
mirrors `tamper/content@last-hop`, the IDEM position with the same relation to the consumer),
`baseline/tamper@upstream` (mirrors `tamper/content@upstream`) and `baseline/private-miskeyed@edge`
(the operator lists a per-user tool as cacheable in a gateway keyed by tool and arguments; mirrors
`private/sequential`). Precedents for that misconfiguration are the MCP Python SDK's warning that
`cacheScope` "is a label, not a lock" and the `share_public` leak it describes, and Kong's
CVE-2026-92443 (a shared cache serving a credentialed response to a caller with none). They carry
`expected: "baseline"` and `mirrors`; acceptance is their expected outcome; they are not claims or
findings and are kept apart from the IDEM rows (`SafetyData.baseline`).
Alternatives: modelling FastMCP's server-side placement (rejected as the baseline: a hit there saves
the tool's work but every request still crosses the network to the server, and its per-token
partition shares nothing across users; it is closer to B1); modelling `mcp-proxy` with coalescing on
(rejected as the common case; it is a steelman, and with it B5 differs from IDEM only by
canonicalization and signatures, which `e2-surface` at 0 already isolates); extending B4 (rejected:
B4 is IDEM with one check off, not a product); putting the relay in core (rejected, see (6)).
**Consequences.** Spec 05 §1 has B5 with an "as run" paragraph, §3 the metrics
`upstream_reduction_vs_b5`, `gateway_cache_hits` and `gateway_inflight_duplicates`, §4 the sweep
`e2-surface` (B0, B1, B5, B2 over surface variation), B5 in the six existing sweeps, the verdict
rule for H5 and the baseline group of E5 (34 variants: 31 IDEM, 3 baseline). Adding a mode perturbs
no other run: the fingerprints of all 4,620 runs of B0 to B4 in the committed sweeps (30 seeds,
macOS) are identical before and after, and `legacy.test.ts` now compares exactly the cases it
pinned, since a new case has no recorded hash. The source digest changes, so the orchestrator reruns
E2 and E5; the committed numbers stay valid for B0 to B4. What B5 does not capture: an operator who
caches tools that are not read-only (FastMCP's default), a cache whose key includes headers or
session state, and a gateway running several instances with separate in-process caches.
**Amended 2026-11-27 (review).** Two defects. (1) B5 cached `public` tools only, so in `e2-mixed`
the per-user `my_notes` went upstream on every call in B5 while IDEM's edge served its repeats from
the `authContext` partition: part of the gap was a handicap, not the protocol. FastMCP, one of the
products cited, keys per access token, so a per-credential partition is a shipped key design. B5 now
caches every tool the manifest marks cacheable: `public` ones under the shared key (as `mcp-proxy`
and ContextForge key), `private` ones in a partition per caller credential (FastMCP's), with the same
TTL and the same byte budget (`GatewayRelayOptions.perCredential`). Runs with no `private` cacheable
call are unchanged; B5 in `e2-mixed` and any sweep with `privateFraction` above 0 must be rerun. The
E5 row `baseline/private-miskeyed@edge` stays as what it is, a misconfiguration (a per-user tool
listed as cacheable without a partition), and its `assumes` says so. (2) `baseline/tamper@upstream`
judged the first user's own answer, which crossed the rewritten link directly, so plain MCP with no
cache would have scored the same. Only later users answered from the gateway cache are judged now (a
trial with none is a setup failure), and the row assumes what the attacker needs: control of the
gateway-producer link, with no TLS on it or a compromised hop.

## ADR-037 — W-code: tool calls issued by code, in bursts
**Context.** Agents increasingly issue tool calls from code instead of one per model turn:
Cloudflare's Code Mode and Anthropic's programmatic tool calling run a program the model wrote,
which calls tools as functions, in loops or in parallel (`asyncio.gather`), and returns only the
final output to the model ("reduces model round trips from N [...] to 1"; strong fit for "fan-out or
parallel operations across many items"; `code-mode` notes). In every design a host-side MCP client
performs the calls, so IDEM's attachment point is unchanged. W-syn draws one call per model turn
with an exponential think time and starts each agent at a random point of one think time: it cannot
say "several calls at once, then a turn", nor "sub-agents spawned at the same instant". No source
measures how often code-issued calls repeat across agents (the notes say so); ArcticSwarm runs about
8 agents per task, the production characterization reports no inter-arrival or burst distribution.
**Decision.** (1) `SyntheticWorkload.burst = { size, parallel? }`: a script step issues the next
`size` planned calls, all at once (`parallel`, the default) or back to back with no think time,
waits for all of them, then thinks (`thinkTimeMs`, the model turn) before the next step. (2)
`startSpreadMs`: the first step starts uniformly within `[0, startSpreadMs)`; 0 starts every agent
at the same instant. (3) *Today is a special case.* Without `burst` a step is one call, and without
`startSpreadMs` the window is the think time; the start uses the same single uniform draw, scaled,
and think times are drawn only between steps, so a configuration without the fields runs exactly as
before (fingerprints of all committed sweeps identical) and `burst: { size: 1 }` equals it call for
call (a test). (4) *The plan does not change, only its timing.* Bursts take consecutive calls of the
agent's W-syn plan, so `callsPerAgent` held constant means the same calls at every burst size; the
W-code sweeps hold it at 16. (5) *Concurrency inside one agent.* Each call keeps its own waiter
(keyed by its nonce or call id), its own [P-5.5] retry and lifetime checks, and its own `private`
check, so concurrent calls of one agent behave as independent calls; tested with `private` and
side-effect calls in a burst and a tampered Data in the middle of one. (6) *Configs.*
`e2-code-burst` (burst size 1 to 16 at a 1 s start window) and `e2-code-sync` (start window 0 to 20
s at burst 4), modes B0, B1, B5, B2, surface variation 0 because code builds arguments mechanically;
every base value is stated as an assumption in the config and in spec 05 §2; nothing is tuned on
results. H6 is read from B2's `pit_aggregation_ratio` and `upstream_reduction_vs_b5`, with B5's
`gateway_inflight_duplicates` as the calls the PIT absorbs.
Alternatives: a Poisson or bursty arrival process per agent (rejected: it cannot express "wait for
all, then a turn", which is what bounds a step); grouping calls in `planWorkload` (rejected: it
would change the plan's random draws for every configuration); scaling calls per agent with the
burst size (rejected: it would confound the shape with the volume); bursts in the per-agent workload
(deferred: no committed experiment needs it).
**Consequences.** Spec 05 §2 has W-code and its base point, §4 the two sweeps and the H6 rule.
W-code does not model: per-entity fan-out into names nobody else asks for beyond W-syn's private
pool, often user-specific and `private`; free-form arguments such as SQL strings that JSON
canonicalization does not normalize; a code runtime replaying a recorded result (Cloudflare's
durable runtime), which never reaches IDEM; per-call rate limits and the per-call pause and resume
of Anthropic's API; sandbox deadlines (none is reached at these settings); server-side Code Mode,
where the agent's only visible call is the program and IDEM can sit only on the server's upstream
leg. Inside a parallel step B1 gets no hit for a repeated call, since both copies miss before either
returns, which is what a per-agent cache without coalescing does.
**Amended 2026-11-27 (review).** Parallel steps were not deterministic in B1 to B4: the step started
every call's preparation at once (`Promise.all`), so several WebCrypto digests (B1's names, the
Interests' args digests) were in flight inside one timer callback and finished in thread-pool order,
which decided the send order and with it CPU-charged send times and which call got which service-time
draw (reruns of one seed gave 16 to 22 distinct metric sets at burst 4 and 16). A step now prepares
its calls one after the other in plan order and then sends them all at the same virtual instant. The
same fault existed outside bursts: the timer that retries an unanswered Interest did not return the
retry's promise, so the clock moved on while its digest ran; it returns it now. A test perturbs the
completion order of every WebCrypto call and requires identical full fingerprints for both burst
sweeps' first seed in every mode and for the pinned lossy tree run. Runs without bursts and without an
Interest timeout are byte-identical; the pinned `tree-loss/idem` hash, recorded from a run whose
retry time depended on digest timing, was re-recorded. The W-code sweeps must be rerun.

## ADR-038 — Proxy-producer mode: the proxy is a producer with its own name and key
**Context.** IDEM pays off only when producers sign, and almost no MCP server does. §9.1 said only
that an edge MAY run in proxy-producer mode with the gateway's key and that the Data must say so
(roadmap M3, "optional, flagged"). The products that cache `tools/call` today do it at a proxy with an
operator-chosen list of tools and a trusted cache: FastMCP caches every tool once its middleware is
added and reads no annotation, `mcp-proxy` caches per backend TTL and never forwards inbound tokens,
and a shared trusted cache that keys badly leaks across users (Kong CVE-2026-92443)
(`gateway-caching-products.md`). The adoption path for IDEM is the same proxy, minus the trusted cache.
**Decision.** `createProxyProducer({ upstream, name, key, tools })` in `@idem/mcp` returns a
`ProxyProducer`, a subclass of the core `Producer` (ADR-014) whose tool handlers call the origin over
plain MCP (SDK v2 client, one client per credential). It is served like any producer
(`createProducerHandler`, `createMcpProducer`), so nothing existing changes unless it is called.
(1) *Own name, own key* [P-9.5]: names are `/idem/v1/<proxy>/…`, the key locator is the proxy's, and
a proxy configured with the origin's host as its name is refused. The origin is recorded per tool in
the tool list, `_meta["dev.idem/origin"] = { origin, readOnlyHint }`, not in the Manifest or Data,
whose wire objects (§5, §6) stay unchanged; the record is unsigned, like the tool list. (2) *Operator
policy* [P-9.6]: nothing is cacheable by default; a declared tool is offered as cacheable only if the
origin says `readOnlyHint: true`, or if it says nothing and the operator sets
`operatorAssertsReadOnly`. An explicit `false` cannot be overridden. A missing hint is the common case
for legacy servers, so requiring it outright would block adoption; accepting the operator's word
silently would empty [P-6.1](b). The option's name puts the responsibility on the operator, and the
origin record shows `"operator"` to consumers. Declared tools that cannot be cached make creation fail
with `BAD_POLICY`. (3) *Credentials* [P-9.7]: `public` tools are called with the proxy's own
credential or none, never the end user's, so a shared answer cannot depend on who asked (this is
`mcp-proxy`'s rule, kept for the shared case only); `private` tools get the end user's credential and
are signed `private`; relayed tools get the end user's credential. (4) *Schema drift* [P-9.8]: the
proxy re-reads the origin's `tools/list` after each origin call it would sign and compares the tool's
schemas and `readOnlyHint` with those its manifest was built from. On a change the result is not
signed (`NOT_CACHEABLE` to the Interest, the unsigned result to a plain call), every changed tool is
held not cacheable under a new manifest version, `onSchemaChange` fires, and `refresh()` re-reads the
list and bumps the version again. Manifest versions default to the clock in seconds so a restart never
rolls back [P-6.3]. (5) Origin errors and `isError` are error results with freshness 0 ([P-5.3],
[P-7.2]); `input_required` is not named [P-5.4] and is not relayed.
*The trust shift, plainly.* A consumer that verifies proxy-signed Data learns that the holder of the
proxy's key vouches that this content answered this call at `producedAt`, with this freshness and
scope, and that no node on the path changed it. It learns nothing the proxy could not have invented:
not that the origin produced the content, nor that the origin's tool is really read-only. A consumer
that trusts the origin's name or key does not accept the Data as the origin's (`UNTRUSTED_KEY`, or
`BAD_SIGNATURE` once relabelled); trusting the proxy is a separate, visible decision.
*Alternatives.* The gateway signing under the origin's name: rejected, the Data would claim an author
that never saw it, and the first time the origin adopts IDEM two keys would sign one name. An
attestation of the origin's TLS session (TLSNotary-style proofs that the bytes came from the origin):
out of scope for v1. Checking the schema on a timer instead of after each signed call: rejected, a
window in which results are signed under a stale digest; the cost is one `tools/list` per miss, and
hits never reach the proxy. Relaying multi-round-trip calls: deferred, `Producer.handleCall` carries
no `inputResponses`/`requestState`.
**Consequences.** §9.1 "Legacy producer" now holds [P-9.5]–[P-9.8], each cited by a test in
`packages/mcp/src/proxy.test.ts` (an unmodified MCP v2 server behind the proxy behind an edge; three
plain MCP clients reach the origin once and a fourth call is a CS hit). No change to §2, §4, §5 or
§6: no `/idem/v2`. `@modelcontextprotocol/client` 2.4.0 moves from dev to runtime dependency of
`@idem/mcp`. Forwarders and consumers read a manifest once, so after an origin schema change they see
the refreshed manifest only after a restart; until then the changed tool answers `NOT_CACHEABLE` or
`DIGEST_MISMATCH`, and Data signed before the change is servable until its freshness ends. Re-reading
a manifest on those errors is left open.
**Amended 2026-11-27 (review).** The proxy chose the credential from the tool's current cacheable
state, not from the operator's declaration: once the origin changed its `tools/list` entry for a tool
declared `{ cacheable: true, scope: "public" }`, the held tool was relayed with the end user's bearer
token, and the same after a `refresh()` that refused it, so an origin could harvest user tokens by
editing its tool list. The credential now follows the declared policy only: a tool declared public
always gets the proxy's credential or none, offered, held or refused; an undeclared tool, or one
declared not cacheable, is relayed with the end user's credential, because the operator made no
promise for it. [P-9.7] says all three cases, and the [P-9.7] and [P-9.8] tests assert the bearer
the origin sees on held and refused calls.

## Open questions

- **Q2 — Encrypted `private` content.** Name-based access control would allow shared caching of
  private results. Out of v1.
- **Q3 — Timing side channel.** Cache hit latency reveals prior requests. Measure in E5; mitigation out of v1.
- **Q4 — Semantic matching.** Embedding-based near-duplicate matching (cf. semantic forwarding in
  [NDN-AI] and [FUZZY-FWD]) as future work; must never be used for `private` scope.
- **Q5 — Forwarder ↔ forwarder transport.** HTTP/2 now; evaluate HTTP/3 / WebTransport later.
- **Q6 — Bounding a Data's life by the signed `producedAt`.** Resolved by ADR-034: two-sided signed
  lifetime [P-8.6] with a 60 s default tolerance, `EXPIRED` on the wire, `CLOCK_SKEW` at the consumer
  [P-8.7]. Remaining limit: bounded staleness inside the tolerance (E5 `replay/in-tolerance@*`).
- **Q7 — `authContext` supplied by a consumer.** Resolved by ADR-033: the edge always derives its own
  and ignores any `authContext` in a received Interest [P-8.4].
