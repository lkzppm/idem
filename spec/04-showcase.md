# 04 — Showcase, sandbox and docs (Vercel)

One Next.js app (`apps/web`) deployed on Vercel serves four things: landing page, interactive
sandbox, library docs, and experiment results. It also hosts the demo producer and edge gateway as
Vercel Functions.

## 1. Routes

| Route | What | Data source |
|---|---|---|
| `/` | Landing: the problem in one scene (N agents fetching the same page), the thesis, one headline result, links | Headline number from `experiments/results` only; if none exists yet, show no number |
| `/sandbox` | Start screen, then the network editor (ADR-028, ADR-029): examples or a blank canvas, run by the simulator (IDEM engine) or by YaNFD routers in WebAssembly (NDN engine) | `@idem/sim` + `@idem/core` (real code, virtual clock); `apps/web/public/ndn/yanfd.wasm` + `@idem/ndn` |
| `/sandbox` (Live example) | Browser agents over real HTTP through the deployed edge to the deployed producer (ADR-016) | `/api/edge/*`, `/api/producer/*`, `@idem/gateway` `IdemClient` |
| `/docs`, `/docs/<slug>` | Docs: the single tab for the protocol and the library docs (§4, ADR-022). `/docs` is the introduction; `/spec` permanently redirects to `/docs/protocol` | Markdown read at render time: `apps/web/content/docs/<locale>/<slug>.md`, and `spec/01-protocol.md`, `spec/07-decisions.md`, `spec/08-references.md` rendered as they are |
| `/benchmarks` | One story about IDEM on real NDN, then the evidence behind it (§1.1). The tab was "Results"; `/results` redirects here | `apps/web/lib/results/data.json`, exported from `experiments/results` by `pnpm sim -- export-web` |
| `/api/producer/*` | Demo producer: IDEM HTTP endpoints + `/api/producer/mcp` (MCP) | static corpus `apps/web/corpus/` |
| `/api/edge/*` | Edge gateway (IDEM HTTP: interest, call, manifest, tools) | `@idem/gateway` |
| `/api/mcp` | Edge gateway as a plain MCP endpoint (any MCP client) | `@idem/mcp` |
| `/api/producer/.well-known/idem.json` | Demo producer manifest | `Producer` |

### 1.1 Benchmarks (`/benchmarks`, ADR-032)

The page tells one story, about IDEM over native NDN, and every number on it is read from
`apps/web/lib/results/data.json` (golden rule 5). A test in `@idem/sim` fails when that file drifts from
the committed run folders; no figure is typed in.

- **Order.** Hero (what kind of result each experiment is: NFD check, E4, E2 and E5, E1), four headline
  tiles, then the sections, each a stop of the mini navbar: **Native NDN** (E4, then the NFD
  conformance check), **Verdicts** (H1 to H4), **Redundancy** and **Latency** (E2), **Sensitivity**
  (E2 sweeps), **Cost** (E1), **Safety** (E5), **Method**. The headline is IDEM over real NDN; the
  simulation and the microbenchmarks are shown as the evidence behind it.
- **Question and verdict.** Every section opens with the question it answers and, when its data allows
  one, a one-line verdict *computed* from that data (`computeVerdicts`, `lib/results/native.ts`, the
  sentence templates in `lib/i18n/messages/results.ts`). A verdict states what was measured, never
  more: it compares numbers and does not call a mode "better".
- **E4 pending state.** While `data.e4` is `null` (no `experiments/results/e4/<run>/` with a
  `summary.csv`), the Native NDN section shows a dashed "has not run yet" frame with the five modes
  and the command, the headline tile reads "Pending", and the hero says so; no chart, no number, no
  placeholder values. When the run folder is committed and exported, the section shows by itself: four
  metrics against loss in tabs (calls answered, median and 95th-percentile latency, bytes over the
  producer link) with 95% intervals over seeds, the latency distribution at each loss level in tabs,
  and a table of every value.
- **NFD check.** Every run of `experiments/results/ndn-nfd/` (the last five) is exported from its
  `summary.json`. The page shows the latest run, one row per scenario (pass or fail, the rules it
  exercises, the number of checks, or the error that stopped it before any check ran) and the pass
  count of the run before it. It is a conformance result, not a measurement.
- **Interactive charts.** Charts stay server-computed SVG; the line chart is a client component
  (`components/results/interactive-chart.tsx`) that adds: a crosshair and a readout card with the exact
  value and its 95% interval (or run range) at the nearest x, or for the nearest point on curves that
  have their own x (the latency distributions); one tab stop with arrow keys, Home, End and Escape and
  a live region that says the same; a legend whose entries highlight a series on hover or focus and
  hide or show it on press (never leaving the chart empty); a table twin under every chart; on touch,
  the readout follows the finger while vertical scroll still works. The per-miss CPU bar and its list
  light each other on hover and focus. With reduced motion nothing animates except what the
  platform does.
- **No C-shaped edges.** A coloured accent never rides a rounded corner: tiles carry a small solid
  square inside their padding, not a thick coloured border on one side (a test checks
  `results.css`).
- **Mini navbar.** The same `SectionNav` as the home page (§5.1): `/` and `/benchmarks` are the routes
  that mount it, and the page only marks its sections with `id`, `data-nav-section` and
  `data-nav-label`.

## 2. Sandbox (`/sandbox`)

Goal: in under a minute, a visitor *sees* aggregation and caching happen and how the numbers change,
on a network they can build.

**Start screen and the editor (ADR-028, ADR-029, ADR-031)**

- `/sandbox` opens on a start screen with nothing loaded: on the left a large plus tile (blank
  canvas) and "continue where you left off" when this browser autosaved edits that are not a saved
  network; on the right "Your networks" (ADR-031) above the examples in a column, one row each with
  its drawing (Swarm: 8 agents, one edge, one producer; Two
  producers: docs and weather, a tool list per agent; Regional tree: three edges under a regional
  forwarder; Live: real HTTP, a fixed network). A shared link (`#n=…`, `?example=<id>`, or the old
  `?mode=swarm` / `?mode=live`) skips the screen.
- Picking plays the start screen out while the workspace comes in (sidebar from the left, player from
  the top, dock from the bottom, nodes popping in). Only the start screen loads networks: the
  sidebar head's back button ("Networks") saves an edited network and returns to it.
- The sidebar head: back, undo / redo (⌘Z, ⇧⌘Z), Share (copies a `#n=` link), then the network's name
  (the saved name, or the example it came from; "edited" once changed) with Save, Export and Delete
  at the end of that row (not on Live, which is not a network).
- **Your networks (ADR-031):** the networks the visitor saved in this browser, newest first, in a
  two-column grid of cards (one column on a phone): drawing, name, date, node count; a click opens
  it; rename (inline), export (a `.idem.json` file) and delete (inline confirm, the card leaves with
  a spring) per card; four shown, "Show all" for the rest (at most 40). An "Import a file" button,
  and a `.json` dropped anywhere on the screen, add a network from a file; what fails is said in an
  inline notice. With none saved, a dashed empty state says how to save one. Save asks for a name
  inline in the head (no browser dialog) the first time and updates the same entry after; a dot on
  the icon marks unsaved changes; Delete is disabled until the network is saved, asks to confirm,
  and returns to the start screen. Storage is `localStorage` only; every read goes through
  `sanitizeNetwork`.
- **Engine (ADR-030):** "IDEM" (the default: NDN routers in WebAssembly) or "Simulation" (seeded,
  compares protocols); each option has its own info bubble. For the simulation, the protocols
  compared (MCP direct, MCP + local cache, IDEM) and the seed.
- **Player bar** (top centre of the stage): restart (R; its icon turns once and the progress bar
  drains back on an ease), play / pause (Space), time, a progress bar of calls answered, and for the
  simulation the speed menu. On the routers, pause holds every agent's next call (calls in flight
  finish), and a network just loaded starts paused. When the network cannot run, the first reason
  (no agent, no producer, an agent without tools, a tool whose producer is unreachable or no longer
  serves it) and the full list on a click.
- **Add:** Agent, Forwarder, Producer. A click adds the node next to the selected one and links it
  (an agent next to an agent, or a producer next to a producer, joins the same forwarder); a drag
  drops it where it is released. An agent linked toward a producer gets that producer's public tools.
- **Selection card** (right of the stage, titled with the node's name and kind): the node's or link's
  settings, each with an info tip: agent (calls, think time,
  shared pages and popularity skew when it fetches pages, its tools per reachable producer with
  weights; stale entries flagged with a remove button), forwarder (CS size), producer (name,
  validated and unique; tools served with their freshness), link (latency, loss); "Connect to…" and
  Delete for every node.
- **Stage gestures:** drag a node to move it (a run never restarts for a move); drag empty space to
  pan; wheel, trackpad pinch or two fingers to zoom; click a node or a link to select it; drag from
  the selected node's handle (or Shift-drag a node) onto another node to link them, the line turning
  blue over a valid target; Delete removes, Escape deselects, arrows move the selected node (Shift:
  further), F fits; zoom buttons and "fit" bottom right of the network's area. Links an agent may not have
  (agent–agent, agent–producer, producer–producer) are refused, and the reason is given.
- **Engines:** the simulation runs the network in `@idem/sim` once per compared protocol, side by side, each
  pane clipped to its frame and the camera shared; every edit but a move restarts it (debounced).
  IDEM on routers runs one YaNFD WebAssembly router per forwarder in the tab, in real time, with `@idem/ndn`
  producers and consumers; its panels show its own log (calls, names, latency) and counters (calls
  answered and verified, CS hits and PIT aggregations read from the traffic, Interests to producers,
  calls kept off NDN, mean latency), and say that routers verify nothing and `private` and
  side-effect calls never travel on NDN.

**Layout: an observatory (ADR-021, ADR-029)**

The sandbox is a full-viewport workspace under the site header (no page header, no footer), modelled
on the GraphMan observatory and drawn in the flat cartoon style (ADR-017 amendment):

- **Sidebar** (left, 264–420 px, resizable by a grip on its edge: drag, ←/→, double click resets;
  width remembered): the network head on top, then the controls in collapsible sections (the editor's
  Engine, Add, Attacks; Live's agents and attacks).
- **Stage** (the rest): the topology canvas fills it, over a halftone of ink dots. Over it: the
  player bar top centre (in a band of its own), the selection card on the right, the legend bottom
  left and the zoom buttons bottom right, both above the dock.
- **Dock** along the bottom of the stage: a tab bar that is always there (Event log, PIT & CS, Packet
  inspector, Metrics, Compare, Safety; `1`–`6`; at its right end "reset the panels" and the keyboard
  cheat sheet, `?`), and above it a drawer that rises when a panel opens and sinks when the last one
  closes. Open panels sit side by side in it (the log wider); its top edge sets its height (drag,
  ↑/↓, double click resets). Closing a panel returns focus to its tab. Live's description and each
  setting's meaning sit in info bubbles (an "i" beside the network head and beside each label; hover,
  focus or tap). No scrollbars in the workspace except the event log's. Open panels (one set for
  Live, one for the editor), the drawer height and the sidebar width are saved in `localStorage`
  (failures ignored). Panels pop up from the tab bar.
- The network is drawn between the player band and the dock, and glides on a spring when the drawer
  opens, closes or changes height. In the editor nodes
  keep the positions the visitor gave them, seen through the camera; Live lays its nodes out.
- The canvas nodes that act on a click (live: agents and the edge; swarm: forwarders) are also
  invisible buttons over the canvas, one tab stop for all of them (arrow keys, Home, End; focus shows
  the node's path like a hover). If the renderer cannot be made, the stage retries with Canvas2D on
  a fresh canvas, then says so in a card; after a lost WebGPU device the stage, the hero globe and
  the halftone recreate their renderers on the new device (`useGpuGeneration`).
- **Phone (≤ 840 px):** stage on top (player bar on it, no zoom buttons: pinch), a tabbed sheet below
  (Controls plus one tab per panel); the selection card sits along the bottom of the stage.
- `prefers-reduced-motion`: screens, panels and the card fade instead of moving, no packet squash,
  the editor's runs never autoplay.

**Canvas** (WebGPU with Canvas2D fallback, ADR-015): agents → edge → (optional core) → producer, in
the hero globe's vocabulary: solid shapes with a background-coloured outline, dashed agent links,
nodes that pop in with overshoot and bounce when a packet lands, packets that squash and stretch with
their speed and trail two puffs. Blue = Interest / pending PIT entry, yellow = Data / fresh CS entry,
ink = rejection (a × pops over the node). Forwarders show their PIT and CS counts under their label.
Hover a node to see its path to the producer; click a forwarder to open its tables (live: click an
agent to make it ask).

- **Split comparison (IDEM engine):** the same seeded workload runs once per compared protocol, side
  by side on the stage (`mcp-direct` and `idem` by default, `mcp-local-cache` on request); the
  Compare panel puts their counters in one table. Same seed → same agent behavior → the difference
  is the protocol.
- **Live counters (Metrics, Compare):** upstream calls, CS hit ratio, PIT aggregations, bytes on the
  producer link, p50/p95 latency, verify failures (should stay 0). Live mode counts only the calls the
  page made (served by edge CS / edge PIT / producer / plain call, verified here, latency by path).
- **Event log:** the latest `ForwarderEvent`s (bounded list), filterable by run, kind and node; click
  a name to highlight its packets and open it in the inspector. Live mode lists the page's calls.
- **PIT & CS:** a forwarder's pending Interests (name, waiting faces, scope) and Content Store
  (name, freshness left, hits, size, occupancy). Live mode shows what the page can know: its own
  calls in flight grouped by name, and the edge CS entries its `idem-trace` headers revealed.
- **Packet inspector:** the name split into producer / tool / schema digest / args digest, the Data
  meta and signature block, the content digest (and, live, the args digest) recomputed in the page,
  the verification result (live: "verify again", timed), the trace or the name's recent events.
- **"Attack" buttons** (sidebar, IDEM engine, with a target producer when there are several): tamper
  with a Data in flight; send a mismatched digest; request another user's `private` result. Each must be visibly rejected (demonstrates H3): the verdict lands
  in the Safety panel, which opens, and the canvas shows the rejection.

**Rules**

- The sandbox runs the **same** `Forwarder` as production; only faces and clock differ.
- The IDEM engine is deterministic for a given seed (on one platform, ADR-027); a share link carries
  the whole network and its run settings.
- The NDN engine runs in real time: its counters describe this visit only and are never quoted as
  results.
- The page must say plainly what is simulated and what runs for real, and link to `/benchmarks` for
  measured numbers.

## 3. Live mode (`/sandbox/live`)

- Calls the deployed gateway, which forwards to the deployed demo producer. The edge and the
  producer are fixed (they are the deployed ones); the visitor adds agents (up to 16, each with its
  own credential) and sets each agent's tool and argument in its card (a new agent fetches the
  shared page, spelling the URL its own way). Space bursts every agent at once; an agent's card asks
  for it alone (ADR-030).
- **Shared edge (ADR-030):** a "visitors" node stands for everyone else using the edge. The page
  polls `/api/edge/activity` (every 3 s while visible) and replays other visitors' calls from that
  node; the edge's card lists the calls the edge saw (you or "visitor <label>", tool, args-digest
  prefix for public names, how the edge answered). A cache hit or a joined Interest says whether
  another visitor filled that name (`idem-filled-by`, computed by the instance that served it), in
  the log and in the card. Only tool names, digest prefixes and outcomes are recorded, never
  arguments, results or credentials; private names and plain calls carry no digest.
- **Demo tools** (static corpus committed in `apps/web/corpus/`, no internet fetch):
  - `fetch_page(url)` — returns a page from the corpus. Cacheable, `public`, `url:sortQuery`.
  - `search_corpus(query, limit)` — simple ranking over the corpus. Cacheable, `public`, `trim` + `lowercase`.
  - `weather(city)` — deterministic pseudo-data. Cacheable, `public`, short TTL (shows expiry).
  - `my_notes()` — per-user data. Cacheable, `private` (demonstrates scope partitioning).
  - `send_email(to, body)` — fake side effect. Not cacheable (demonstrates bypass).
- Optional **real agent swarm**: N agents with AI SDK 7 through Vercel AI Gateway, only when
  `IDEM_LIVE_LLM=1`. Requires a rate limit (Vercel WAF rule) and a hard budget; off by default.
- The UI must state that the CS lives in function-instance memory (Fluid compute), so hits depend on
  instance reuse.

## 4. Docs (`/docs`)

Rendered by the in-house Markdown renderer (`apps/web/lib/markdown.tsx`), not Fumadocs (ADR-022).

Information architecture (reading order; it drives the sidebar and the previous / next links):

| Group | Page | Route | Source |
|---|---|---|---|
| Learn | **Introduction** — what IDEM is, the thesis, when it applies and when not, what exists today | `/docs` | `content/docs/<locale>/introduction.md` |
| Learn | **Concepts** — names and canonicalization, Interest and Data, PIT/CS/FIB, signatures and the trust manifest, freshness, scope, passthrough | `/docs/concepts` | `content/docs/<locale>/concepts.md` |
| Learn | **Architecture** — topology, packages, the single engine and its events, flows, bindings (HTTP overlay; native NDN planned), deploy | `/docs/architecture` | `content/docs/<locale>/architecture.md` |
| Specification | **Protocol** — normative | `/docs/protocol` | `spec/01-protocol.md` itself (single source, never copied) |
| Specification | **Security** — threat model from protocol §11: each attack and the rule behind its defence; what v1 leaves open | `/docs/security` | `content/docs/<locale>/security.md` |
| Use | **API reference** — the exports of `@idem/core`, `gateway`, `mcp`, `sim`, checked against `packages/*/src`, with a producer / edge / consumer example | `/docs/api` | `content/docs/<locale>/api.md` |
| Use | **Using the sandbox** — what each mode runs, what each control changes, how to read the PIT, CS, log and attacks | `/docs/sandbox` | `content/docs/<locale>/sandbox.md` |
| Research | **Evaluation** — method only (hypotheses, modes, workloads, metrics, E1–E5); no numbers, which live on `/benchmarks` | `/docs/evaluation` | `content/docs/<locale>/evaluation.md` |
| Research | **Decisions** — the ADRs | `/docs/decisions` | `spec/07-decisions.md` itself |
| Research | **References** — the bibliography | `/docs/references` | `spec/08-references.md` itself |

The earlier plan's Quickstart, Bindings and FAQ pages are folded in: the example opens the API
reference (the packages are not published, so there is no install step; `withIdem` is still planned),
bindings are a section of Architecture, and the threat model is the Security page.

- **Layout.** A sticky page tree on the left (the current page marked by a plate that glides between
  items on a spring, and a blue square), the article (a measure of about 70 characters), and an "on
  this page" rail on the right whose yellow marker follows the heading being read. Previous / next
  links, an anchor on every heading, code blocks with a copy button, tables that scroll inside their
  frame. Under 1024 px the tree becomes a drawer opened from a bar under the header (a modal
  `<dialog>`); under 1280 px "on this page" folds into the article. Reduced motion is honored.
- **Spec conventions become navigation.** A rule (`**[P-2.1]** …`) is a callout with its own anchor
  (`/docs/protocol#p-2-1`; the bar is solid for MUST, dashed for SHOULD, dotted for MAY); `[P-x.y]`,
  `ADR-0nn`, `[REF-KEY]` and, inside the protocol, `§n` are links. Numbered sections and ADRs have
  language-independent anchors (`#s7`, `#s9-1`, `#adr-013`, `#appendix-a`).
- **Figures** are inline SVG in the flat cartoon style, drawn from the tokens, with labels from the
  docs dictionary. They show rules and formats, never measurements.
- **Languages (ADR-018).** Interface strings and page titles: `lib/i18n/messages/docs.ts`. Written
  pages exist in `en` and `pt`. Decisions and References are shown in English with a note saying so.
  The Protocol has a Portuguese translation, `content/docs/pt/protocol.md`, which starts with
  `<!-- translated-from: spec/01-protocol.md sha256:<hex> -->`: the page says the English text is
  normative, offers it at `?text=en`, and warns when the spec has changed since the translation
  (whoever edits `spec/01-protocol.md` updates the translation and its hash).

## 5. Visual direction

Technical and calm, in the register of a modern developer tool: dark-first with a light theme,
monospace for names and packets, one accent color for Interests (blue) and one for Data (amber) used
consistently across canvas, figures, charts and docs. Charts follow one palette across `/benchmarks` and
the sandbox. See ADR-017.

- **Mark.** ⇌ (`IdemMark`, `components/brand/mark.tsx`): the upper harpoon is the Interest (blue), the
  lower one the Data (amber). Together they read as "=", *idem*, "the same", and the mark is identical
  when rotated 180°. Monochrome variant in the current text color; `app/icon.svg` is the same drawing
  on a tile. Earlier concepts stay on `/brand` as explorations.
- **Type.** Outfit for text and headings, JetBrains Mono for names, digests, packets and protocol facts.
- **Vocabulary.** Hairline borders, `rounded-xl`/`rounded-2xl` cards, modest-radius buttons, smooth
  scroll reveals, a hover state and pointer cursor on every control. No pill badges (no
  `rounded-full` chips, labels or status capsules). Explanations are SVG figures drawn in the theme's
  tokens, not screenshots.
- **Landing (`/`).** In order: hero (the thesis in a few words, the two calls to action and a "built on"
  row linking the stack: MCP, NDN, NDNts, Ed25519, JCS, TypeScript, with their marks; over a flat halftone backdrop drawn in
  WGSL (posterized dot waves that swell under the pointer), and half a globe on the right edge in flat colors with no glow, per ADR-015 with a Canvas2D
  fallback: Autonomous Systems as halftone territories with solid borders that drift now and then, agents → edge → AS core →
  neighbouring AS cores → producer, the forwarding rules of [01 §7] running on it, cartoon motion;
  visitors drag to spin it, hover a node to see its path or an AS to light it, click a node to make it
  ask and click open globe to add an agent or an edge; no text inside the globe); `#idea` (the
  problem in one scene: four agents ask the same `fetch_page`; a switch between *Plain MCP*, where
  every call crosses to the server and the tool runs once per call, and *With IDEM*, where the edge
  folds the identical Interests into one PIT entry, fans the signed Data out, stores it and answers a
  late ask from its CS; the producer's work is a row of marks, one per run, never a number; three
  beats beside it light up as they happen; click an agent to make it ask); `#how` (the four steps
  Canonicalize / Name / Sign / Serve as tabs, each a short cartoon animation that plays once and
  holds an explanatory last frame: a spelling's host lowercased, port and fragment dropped, query
  sorted, then dropped onto the other spelling; bytes hashed and the digests flying into the name;
  the Data assembling and the producer's seal landing on it; a regional CS answering and the agent
  verifying; beside them the spec's fixed formats: SHA-256 names, JCS / RFC 8785, Ed25519, PIT · CS ·
  FIB); `#live` (the live name builder with an "=" / "≠" seal on the seam between the two calls, and
  the Interest and Data as live JSON signed in the browser: the Data's signed bytes marked, a field and
  its note lighting each other, "Sign again" flashing what changed and what did not, the name);
  `#forwarder` (the pipeline of [01 §7] as a sorter: five Interests in turn, or picked, each visibly
  taking its branch, pass through / drop / reply from the CS / add the face / forward, and for a
  forwarded one the Data's way back, verify / store / satisfy / clear; then the layer stack, whose
  slabs drop and land on reveal: an application-layer overlay over HTTP, native NDN binding planned);
  `#guarantees` (the four guarantees, each with a looping scene: the signed manifest decides what the
  CS keeps, a private result stays in its owner's partition, a tampered answer fails the agent's check
  and is retried at the producer, a call with a side effect passes through as plain MCP; then the
  call to action). Figures are SVG in the flat cartoon style (ADR-017 amendment, ADR-020), drawn
  wide or narrow by their own width so a 390 px phone reads them without sideways scrolling; they run
  only on screen and show a still, informative frame under reduced motion. Each section label is the
  mark in small plus a few words (`SectionLabel`, `.eyebrow`, `.t-eyebrow`). Each top-level section
  carries `id`, `data-nav-section` and a translated `data-nav-label` for the section nav (§5.1).
  Strings live in `lib/i18n/messages/landing.ts`.
  The landing points only to the protocol and the sandbox: the call to action opens the sandbox, with
  the docs as the secondary link. No number appears until one exists in `experiments/results` (§1).

### 5.1 Site chrome: header, section nav, footer (ADR-019)

Code in `apps/web/components/site/*`, styles in `app/styles/chrome.css`, strings in
`lib/i18n/messages/chrome.ts` (both languages; the site title and description are per locale too).

- **Header.** 64 px of translucent material plus a 1 px hairline (65 px in all, what full-height
  pages such as the sandbox and the docs' sticky rails subtract) on every page; pages scroll under it. Left: the logo
  (the mark and the wordmark) and three tabs, Sandbox, Docs, Results. Right: the language switch and
  the theme toggle (the new theme grows out of it as a circle, a View Transition; canvases hold their frames
  while it starts, because a canvas frame in that window put the switched page on screen in Safari). Below 640 px the wordmark folds away and the mark alone is the home link.
- **Tab story.** Whenever the active tab changes, by any navigation (a tab, the logo, a link in a
  page, back and forward), the header tells it as one exchange. An Interest (a blue ball) leaves the
  tip of the mark's upper harpoon, which recoils, and hops to the new tab, stretching with its speed;
  it splats into the tab's underline, half blue and half yellow like the mark (the blob spreads with a damped wobble, a ring ripples out, the
  label dips and lights up). Once the new page has actually arrived (the pathname changed), a Data (a
  yellow ball) pops out of the underline and hops home into the lower harpoon, which pops. Going home
  sends the Interest round the mark and back into the lower harpoon as Data, the ⇌ drawn as motion.
  Each flight is short (a quarter to under half a second), animates only `transform` and `opacity`
  (WAAPI, so it stays smooth while the new page renders), and is interruptible: a new navigation
  re-aims a ball in the air from where it is, at its current speed, so fast clicks never queue or
  jump. With reduced motion the underline only cross-fades.
- **Selectors are ink drops.** The tab hover, the language switch and the section nav share one
  selector: a layer clipped to the chosen item whose two edges move on separate transitions (the edge
  in the direction of travel leads with an overshoot, the other follows a beat later and lands with a
  bounce). Labels are drawn twice, the copy inside the drop in the inverse colour, so a label changes
  colour exactly as the edge passes it.
- **Language switch.** A radio group of two (EN, PT) with one tab stop, arrow keys, Home and End;
  options are named by their visible code and in their own language (`EN, English`,
  `PT, Português`: the visible label is part of the name, WCAG 2.5.3) with a `lang` attribute; the group
  is labelled "Language" / "Idioma". Choosing saves the cookie and re-renders on the server (ADR-018).
- **Section nav (home and benchmarks).** Mounted by the root layout on `/` and `/benchmarks` (`SECTION_NAV_PATHS`), never by the page. A floating bar of
  glass (blur, translucent, a solid offset sliver for a shadow, no glow), centred under the header; on
  a phone it spans the width and scrolls sideways, keeping the current section in view. It appears
  once the hero has mostly scrolled away (the first section below the fold reaches the middle of the
  viewport) and leaves again on the way back up. It tracks the section crossing a thin band 38% down
  the viewport (IntersectionObserver; the last section wins at the very bottom), jumps smoothly on
  click (offset for the header and itself, focus moves to the section), and has a back-to-top button.
  **Contract with pages:** a stop is any element with `data-nav-section`, an `id`, and
  `data-nav-label` holding its already translated label. The nav reads them from the DOM in document
  order and re-reads on DOM changes, so it follows whatever sections the page renders.
- **Footer.** A halftone band instead of a rule; the logo and the thesis; the site's pages; the author
  (Lucas Pacheco) with portfolio (lkzppm.vercel.app), GitHub and LinkedIn (new tab, announced); the course line (research prototype,
  EEL878 Computer Networks I, UFRJ/Poli, 2026/2) and `/idem/v1`. No numbers. Hidden on `/sandbox`,
  which is a full-viewport workspace under the header.

## 6. Deploy (Vercel)

- Monorepo: Vercel project root `apps/web`; Turborepo builds the workspace packages it depends on.
- Runtime: Node.js 24, Fluid compute (default for new projects).
- Environment variables: `IDEM_PRODUCER_KEY` (Ed25519 private JWK, demo only), `IDEM_EDGE_SECRET`
  (HMAC for `authContext`), `IDEM_LIVE_LLM` (0/1), `AI_GATEWAY_API_KEY` (only if live LLM).
- Project `idem-ufrj` (production: `https://idem-ufrj.vercel.app`), created 2026-11-18 at the
  author's request; root directory `apps/web`, Node 24. `IDEM_PRODUCER_KEY` (a fresh Ed25519 JWK) and
  `IDEM_EDGE_SECRET` are set as sensitive variables for production and preview.
- Deploys go from `main` with the CLI (`vercel deploy --prod` from the repository root;
  `.vercelignore` keeps worktrees, `node_modules` and build output out of the upload). Installing the
  Vercel GitHub app on the repository would turn on previews per PR and production on `main`.
- Before production: rate limit on `/api/**`, cache headers on static results, Lighthouse check on
  `/` and `/docs`.
