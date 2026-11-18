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
endpoint and fall back to MCP for legacy producers (proxy-producer mode still pending).

## ADR-015 — WebGPU rendering for the sandbox and landing (replaces `@xyflow/react`)
**Context.** The showcase spec named `@xyflow/react` for the topology view; the owner asked for
WebGPU-rendered backgrounds and sandbox.
**Decision.** Topology canvas and landing background are drawn with WebGPU (WGSL), with a Canvas2D/
static fallback when `navigator.gpu` is missing, honoring reduced motion. Labels are an HTML overlay.
**Consequences.** One less dependency; we own the renderer. Fallback path must be kept working.

## ADR-016 — Sandbox "Live" mode is real transport and the default
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

## ADR-021 — The sandbox is an observatory: sidebar, stage, floating windows
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

## Open questions

- **Q2 — Encrypted `private` content.** Name-based access control would allow shared caching of
  private results. Out of v1.
- **Q3 — Timing side channel.** Cache hit latency reveals prior requests. Measure in E5; mitigation out of v1.
- **Q4 — Semantic matching.** Embedding-based near-duplicate matching (cf. semantic forwarding in
  [NDN-AI]) as future work; must never be used for `private` scope.
- **Q5 — Forwarder ↔ forwarder transport.** HTTP/2 now; evaluate HTTP/3 / WebTransport later.
- **Q6 — Bounding a Data's life by the signed `producedAt`.** The candidate rule of ADR-025 closes
  stale replay. To decide before adopting it: the default tolerance and how it relates to short TTLs;
  the error code (`BAD_SIGNATURE` or a new one); `mustBeFresh: false` across hops; and how a consumer
  with a wrong clock is told apart from an attack. Must land with E5's judge and a new E5 run.
- **Q7 — `authContext` supplied by a consumer.** The engine trusts an `authContext` present on an
  Interest from a consumer face (E5 `private/authcontext-known`, ADR-023); only the HTTP gateway drops
  it. Candidate: the first forwarder always derives its own value and ignores, or rejects, one that
  arrives ([P-8.4] already says who sets it). Must land with a new E5 run.
