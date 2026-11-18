# Sandbox — an observatory

Reference: the GraphMan observatory (`~/Desktop/Code/GraphMan/web/src/observatory/`), restyled in this
project's flat cartoon style.

- [x] Study the GraphMan observatory (layout, sidebar, windows, interactions) and write down what carries over (2026-11-17)

## What carries over from GraphMan

GraphMan's observatory (`web/src/observatory/Observatory.tsx`, `Observatory.module.css`, `DESIGN.md`
"Observatory") is a full-height app under the nav (`calc(100dvh - nav)`), no page header of its own:

- **Grid:** `sidebar | stage`, the sidebar width a CSS variable (`--sidebar-width`). Carries over.
- **Sidebar resize:** only a grip pill in the middle of the edge drags (`col-resize`, pointer capture);
  while dragging the width goes straight to the CSS variable (no React render per move) and is
  committed on release; clamped (280–560, stage ≥ 400); double click resets; ←/→ nudge (Shift ×4);
  remembered in `localStorage` inside try/catch. Carries over as is (narrower range here).
- **Sidebar:** a column of panels, each a title row with icon actions on the right; panels rise in
  once with a short stagger. GraphMan's titles are tracked caps; here they are plain Outfit (the
  author dislikes the eyebrow look). GraphMan sheds panels by viewport height instead of scrolling;
  this sandbox has more knobs, so its sections collapse and the sidebar scrolls.
- **Stage:** the canvas fills it; small floating clusters sit in the corners (help/controls top or
  bottom right with a `kbd` cheat sheet popover that closes on Esc, outside click or the button;
  legend bottom left; status/tools top). Carries over.
- **Structure panels follow the replay:** cells keyed by item, linked to the canvas both ways (hover
  a cell lights its vertex, click selects; a hovered vertex lights its cell). Carries over as PIT/CS
  rows ↔ canvas nodes and log names ↔ highlighted packets.
- **Keyboard:** one `keydown` listener on `window` (ignored while typing in a field): Space plays,
  Esc closes popovers and clears the selection, letters for tools. Carries over (Space, Esc, ?, 1–6).
- **Phone (≤ 840 px):** stage on top, the sidebar becomes a bottom sheet with tabs (`sheetTabs`).
  Carries over: the windows become tabs of that sheet.
- **Not in GraphMan:** draggable windows. New here: windows over the stage, dragged by the title bar
  (pointer capture, 1:1 from the grab offset, rubber-band at the edges, thrown with momentum and
  settled by a spring), brought to front on focus, collapsed, closed and reopened from the sidebar,
  clamped to the stage, layout saved, moved with the keyboard.
- [x] Full-viewport workspace: the network canvas behind, a sidebar with the controls, floating windows on top (code, typecheck, lint; visual check pending, see below)
- [x] Draggable, focusable, collapsible windows (log, PIT/CS tables, packet inspector, metrics, compare, safety) with springy motion and saved layout (`components/sandbox/window/*`, `lib/sandbox/layout.ts`; unit-tested: clamping, defaults, persistence, free area)
- [x] Live and swarm modes kept working inside the new layout (ported; runtime check pending)
- [x] All sandbox strings in both languages (`lib/i18n/messages/sandbox.ts`)
- [x] Keyboard access, reduced motion, small screens (windows become tabs of a sheet under the stage) (code; runtime check pending)
- [x] Spec 04 §2 and an ADR updated (ADR-021) (2026-11-17)
- [x] Unit tests for the pure logic: `apps/web/lib/sandbox/{layout,motion,scene}.test.ts` (27 tests; run with
  `pnpm exec vitest run --config apps/web/vitest.config.ts`). Root `pnpm test` only covers `packages/*`; adding
  `apps/web` to the root `vitest.config.ts` projects is left to whoever owns it.
- [x] Fixed by tests/review: corner windows no longer eat the top of the network (free-area heuristic);
  grabbing a window mid-throw no longer jumps back.

## Pending: browser verification (dev server on :3002 was down overnight, none started)

- [ ] Load `/sandbox` (live) and `/sandbox?mode=swarm` at 1440×900, dark and light: no console errors,
  WebGPU and Canvas2D paths draw the cartoon nodes and packets, labels align with nodes
- [ ] Drag a window by its title bar (1:1 tracking, rubber-band at edges, throw and spring settle, landing
  squash), grab it mid-flight, resize from the corner, collapse (double click), close and reopen from the
  sidebar, reload: layout restored; "Tidy up" resets
- [ ] The network relaxes into the free area when windows move/close; swarm runs side by side
- [ ] Live: burst, click an agent, click the edge, the three attacks (verdicts in Safety); swarm: play/pause,
  restart, attacks, log name → highlight + inspector, forwarder click → tables
- [ ] Keyboard: 1–6, Space, R, ?, Esc, arrows and Alt + arrows (resize) on a window grip; Tab into the stage nodes, arrows between them, Enter acts; focus returns to the sidebar toggle on close (keyboard or mouse)
- [ ] WebGPU failure paths: when creating the stage's renderer fails it falls back to Canvas2D on a fresh canvas (or shows its card); after a lost device (e.g. Chrome's GPU process restarting; a deliberate `device.destroy()` is ignored by design) the stage, globe and halftone come back
- [ ] 390 px width: stage on top, tabbed sheet below, no horizontal scroll; reduced motion: fades only
- [ ] Portuguese (cookie `idem-locale=pt`): no English left besides protocol terms, names and code
- [x] Mode description moved from the sidebar into an info bubble beside the mode switch; info bubbles on every setting (live: tool, argument, agents; swarm: run, workload, network), en + pt (2026-11-19)
- [x] Scrollbars hidden in the workspace except the event log (window and phone tab)
- [x] Window buttons in the sidebar drag onto the stage: ghost title bar, landing frame over the stage, opens or moves the window there; click still toggles; Escape cancels (`window/drag-to-stage.tsx`)
- [ ] Author check in Safari: bubbles (hover, focus, tap, Escape), drag a window in from the sidebar, scrollbars

## Native NDN view (ADR-026), built 2026-11-18, not wired in yet

Self-contained new files; no existing sandbox file was touched while the layout is being redesigned.

- [x] `lib/sandbox/ndn.ts`: `ndnExchange({ interest, data, trust, translator? })` builds the real NDN
  Interest and Data (wire bytes, hex, TLV tree, overlay JSON size) from a Live row with `@idem/ndn`, and
  verifies both signatures on the decoded Data bytes (outer NDN by a throwaway translator key under
  `/localhost/idem-sandbox/KEY/<id>`, inner IDEM by the producer's trusted key); `private` rows are never
  encoded; `hexLines`, `tlvRange` helpers. Tested in `lib/sandbox/ndn.test.ts` (7 tests)
- [x] `components/sandbox/ndn-packet.tsx`: `NdnPacket({ name, args, data, trust })`, Interest/Data tabs,
  TLV tree beside a hex dump (pointing at or focusing a field lights its bytes), both signature verdicts,
  the translator note, and a reason when there is no native form (private, plain call, too large)
- [x] Strings in both languages: `lib/i18n/messages/ndn.ts`
- [x] `@idem/ndn` and `@ndn/packet` added to `apps/web/package.json`; `@idem/ndn` in `transpilePackages`
- [x] Mount `NdnPacket` in the Live inspector (`LiveInspector` in `live-mode.tsx`), under the trace field,
  for rows with a `name` (owner: whoever finishes the layout redesign)
- [ ] Browser check (Safari first): the tree and hex dump fit the inspector at 1440×900 and 390 px, light
  and dark; hover/focus highlight; Portuguese strings; `next build` with the component mounted (the NDNts
  keychain's Ed25519 ponyfill uses top-level await in its browser build)

## The network editor (ADR-028), built 2026-11-18

- [x] Model `lib/sandbox/network.ts` (nodes, links, run settings, link rules, reachability, issues,
  sanitize, URL encoding, auto tools, sibling attach) and examples `lib/sandbox/examples.ts`; tested in
  `network.test.ts` (every example runs to the end in every mode; IDEM sends fewer calls upstream than
  MCP direct on the swarm)
- [x] Start screen (examples, blank, Live, continue) and the in-session picker (`editor/picker.tsx`);
  shared links skip it; `?mode=swarm` and `?mode=live` map to examples
- [x] Network state with undo/redo and autosave (`editor/use-network.ts`)
- [x] Stage gestures in `StageCanvas` (`editor` prop): drag, pan, wheel/pinch zoom, select node or
  link, link handle and Shift-drag with a draft line, zoom/fit buttons, empty-canvas note; keys: Delete,
  Esc, arrows, ⌘Z/⇧⌘Z, F
- [x] Sidebar: network head (picker, undo, redo, share), Run (engine, compare, speed, seed, issues),
  Add (click or drag, `useDragToStage` generalized to chips), Selected (`editor/properties.tsx`, info
  tips), Attacks with a target producer
- [x] IDEM engine: `NetworkRun` in `lib/sandbox/run.ts` (`networkToSim`), restart on edits, moves
  without restart, comparison panes clipped (scissor) and fitted
- [x] NDN engine: `lib/sandbox/ndn-net.ts` (YaNFD per forwarder, JS links, `serveNdn` producers,
  `NdnConsumer` agents, CS/PIT read from traffic), tested in `ndn-net.test.ts` against the built wasm;
  `components/sandbox/ndn-engine.tsx`; wasm built by `experiments/ndn/yanfd-wasm/build.sh`
- [x] `@idem/ndn` signs and verifies with WebCrypto directly (the NDNts keychain's ponyfill broke
  signing in WebKit)
- [x] Strings in both languages: `lib/i18n/messages/editor.ts`
- [x] Headless WebKit smoke (2026-11-18): start screen, pick, reload and continue, picker dialog,
  build a network from blank (click and drag from the palette), move, link by handle, delete, undo,
  zoom, NDN engine on the regional example (calls answered and verified), Live, 390 px; no console errors
- [ ] Author check in Safari: start screen, every example, drag/link/configure/delete/undo, share
  link in a new tab, NDN engine (load time on a cold cache), phone width, Portuguese, dark theme

## Chrome (ADR-029), built 2026-11-18

- [x] Start screen redesign: a plus tile for a blank canvas and "continue" on the left, the examples
  in a column on the right (`editor/picker.tsx`)
- [x] No loading over an open network: the in-session picker is gone; a back button ("Networks")
  saves an edited network and returns to the start screen (`use-network.ts` `back()`)
- [x] Transitions between the start screen and the workspace, both ways (CSS, `sandbox.tsx`)
- [x] Player bar over the canvas: restart, play/pause, time, progress, speed menu, issues
  (`player.tsx`); NDN and Live fill it too
- [x] Selection card on the right of the stage, named after the component (`editor/selection-card.tsx`);
  the Selected section is gone
- [x] Bottom dock: tab bar always there, drawer of panels rising from it, resizable (`dock.tsx`); the
  floating windows and the sidebar's window list are gone; layout v2 (`layout.ts`, tested)
- [x] Renderer and seed footnote removed
- [x] Headless WebKit (2026-11-18): start screen, pick with the transition, card, dock panels, speed
  menu, issues, back and continue, blank canvas, NDN engine, phone (dark), desktop dark; no console errors
- [ ] Author check in Safari: the transitions, the dock drawer (open, resize, close), the card, the
  player's menus, phone width, Portuguese
