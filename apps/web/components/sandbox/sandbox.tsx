"use client";

import Link from "next/link";
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { useMessages } from "@/lib/i18n/client";
import { editor as editorMessages } from "@/lib/i18n/messages/editor";
import { sandbox } from "@/lib/i18n/messages/sandbox";
import { type ExampleId, example } from "@/lib/sandbox/examples";
import {
  dockHeight,
  networkArea,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  STAGE_MIN,
  WINDOW_IDS,
  type WindowId,
} from "@/lib/sandbox/layout";
import { clamp } from "@/lib/sandbox/motion";
import { Dock } from "./dock";
import { StartScreen } from "./editor/picker";
import { useNetwork } from "./editor/use-network";
import { EditorMode } from "./editor-mode";
import { BackIcon, HelpIcon, LayoutIcon } from "./icons";
import { LiveMode } from "./live-mode";
import { InfoTip } from "./ui";
import { useLayout } from "./window/use-layout";
import { isTyping, type SlotName, type WorkspaceApi, WorkspaceProvider } from "./workspace";

const PHONE_QUERY = "(max-width: 840px)";

/** How long the start screen takes to leave, and the workspace to come in or go (ms). */
const START_LEAVE_MS = 300;
const ENTER_MS = 1100;
const EXIT_MS = 300;

/** Stable (module-level), so React does not resubscribe on every render. */
function subscribePhone(cb: () => void): () => void {
  const q = window.matchMedia(PHONE_QUERY);
  q.addEventListener("change", cb);
  return () => q.removeEventListener("change", cb);
}

/** Phone layout: the stage on top, the panels as tabs below. False on the server and until hydration. */
function usePhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

/**
 * The sandbox as an observatory (ADR-029): a full-viewport workspace under the site header. It opens
 * on a start screen; once a network is picked, a sidebar holds its settings (engine, Add palette,
 * attacks), a player bar over the canvas plays it, a card on the right edits the selected node or
 * link, and a dock along the bottom holds the protocol's panels (event log, PIT and CS tables, packet
 * inspector, metrics, comparison, safety verdicts), rising from its tab bar when one opens.
 *
 * What runs is a network from the editor (ADR-028): an example or a blank canvas the visitor edits,
 * or the Live example over real HTTP. The shell owns the layout, the network and its history, and
 * offers slots; the editor or Live mode portals its controls, canvas, player and panel contents into
 * them. On a phone the stage sits on top and the sidebar and panels become the tabs of a sheet.
 */
export function Sandbox() {
  const t = useMessages(sandbox);
  const s = t.shell;
  const te = useMessages(editorMessages);
  const nw = useNetwork();
  const mode = nw.showing.kind === "live" ? "live" : "net";
  const choosing = nw.showing.kind === "none";
  const L = useLayout(mode);
  const [toast, setToast] = useState<string>();
  const phone = usePhone();
  const reduced = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const stageEl = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [slots, setSlots] = useState<Partial<Record<SlotName, HTMLElement>>>({});
  const [help, setHelp] = useState(false);
  const helpRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"controls" | WindowId>("controls");
  // Screen changes: the start screen leaving, the workspace coming in, the workspace going.
  const [leavingStart, setLeavingStart] = useState(false);
  const [entering, setEntering] = useState(false);
  const [exiting, setExiting] = useState(false);
  const timers = useRef<number[]>([]);
  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  useEffect(() => () => timers.current.forEach((id) => clearTimeout(id)), []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(undefined), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  const share = async () => {
    const url = nw.shareUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setToast(te.copied);
    } catch {
      window.history.replaceState(null, "", url);
      setToast(te.copyFailed);
    }
  };

  const enter = useCallback(() => {
    setEntering(true);
    later(reduced ? 200 : ENTER_MS, () => setEntering(false));
  }, [later, reduced]);

  /** From the start screen into a network: the screen leaves while the workspace comes in. */
  const open = (load: () => void) => {
    if (leavingStart || exiting) return;
    setLeavingStart(true);
    load();
    enter();
    later(reduced ? 120 : START_LEAVE_MS, () => setLeavingStart(false));
  };
  const pick = (id: ExampleId) => open(() => nw.load(id));
  const resume = () => open(nw.resume);

  /** Back to the start screen: the workspace goes, then the start screen comes in. */
  const back = () => {
    if (exiting || entering) return;
    setExiting(true);
    setHelp(false);
    later(reduced ? 0 : EXIT_MS, () => {
      nw.back();
      setExiting(false);
      setTab("controls");
    });
  };

  // A network opened straight from the address (a shared link, ?example=): the workspace comes in.
  const introduced = useRef(false);
  useEffect(() => {
    if (!nw.loaded || introduced.current) return;
    introduced.current = true;
    if (nw.showing.kind !== "none") enter();
  }, [nw.loaded, nw.showing.kind, enter]);

  // The header's real height (the workspace fills the rest of the viewport).
  useEffect(() => {
    const header = document.querySelector("body > header, body header");
    const el = root.current;
    if (!header || !el) return;
    const fit = () =>
      el.style.setProperty("--obs-top", `${Math.round(header.getBoundingClientRect().height)}px`);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);

  // Stage size.
  useEffect(() => {
    const el = stageEl.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setStage((p) => {
        const w = Math.round(el.clientWidth);
        const h = Math.round(el.clientHeight);
        return p.w === w && p.h === h ? p : { w, h };
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Slots: one stable callback ref per name.
  const refs = useRef(new Map<SlotName, (el: HTMLElement | null) => void>());
  const slotRef = useCallback((name: SlotName) => {
    let fn = refs.current.get(name);
    if (!fn) {
      fn = (el: HTMLElement | null) =>
        setSlots((cur) => {
          if ((cur[name] ?? null) === el) return cur;
          const next = { ...cur };
          if (el) next[name] = el;
          else delete next[name];
          return next;
        });
      refs.current.set(name, fn);
    }
    return fn;
  }, []);

  // The dock: its drawer is open while any panel is, and the network gets the stage above it.
  const anyOpen = WINDOW_IDS.some((id) => L.isOpen(id));
  const drawer = dockHeight(L.layout.dock, stage.h);
  const drawerMax = dockHeight(Number.POSITIVE_INFINITY, stage.h);
  const area = useMemo(
    () =>
      stage.w === 0
        ? { x: 0, y: 0, w: stage.w, h: stage.h }
        : phone
          ? networkArea(stage.w, stage.h, 0, 0)
          : networkArea(stage.w, stage.h, anyOpen ? drawer : 0),
    [phone, stage.w, stage.h, anyOpen, drawer],
  );
  const setDrawerVar = useCallback((h: number) => {
    stageEl.current?.style.setProperty("--obs-drawer", `${h}px`);
  }, []);

  const reveal = useCallback(
    (id: WindowId) => {
      if (phone) setTab(id);
      else L.open(id);
    },
    [phone, L],
  );

  const api = useMemo<WorkspaceApi>(
    () => ({ mode, phone, stage, area, slots, isOpen: (id) => (phone ? tab === id : L.isOpen(id)), reveal }),
    [mode, phone, stage, area, slots, tab, L, reveal],
  );

  // Keys: 1–6 toggle panels, ? the cheat sheet, Esc closes it.
  useEffect(() => {
    if (choosing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= WINDOW_IDS.length) {
        const id = WINDOW_IDS[n - 1] as WindowId;
        if (phone) setTab(id);
        else L.toggle(id);
        e.preventDefault();
      } else if (e.key === "?") {
        setHelp((h) => !h);
        e.preventDefault();
      } else if (e.key === "Escape" && help) setHelp(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [L, phone, help, choosing]);

  useEffect(() => {
    if (!help) return;
    const onDown = (e: PointerEvent) => {
      if (!helpRef.current?.contains(e.target as Node)) setHelp(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [help]);

  const showing = nw.showing;
  const from = showing.kind === "live" ? "live" : showing.kind === "net" ? showing.net.from : "";
  const fromName = (te.example as Record<string, { name: string }>)[from]?.name ?? from;
  const edited =
    showing.kind === "net" &&
    (from === "blank"
      ? showing.net.nodes.length > 0
      : JSON.stringify(showing.net) !== JSON.stringify(example(from as ExampleId)));

  // The network's head: back to the start screen, undo, redo, share, and the network's name.
  const netHead = (
    <div className="obs-net-head">
      <div className="obs-net-row">
        <button type="button" className="obs-back" title={te.backTitle} onClick={back}>
          <BackIcon />
          <span>{te.back}</span>
        </button>
        <div className="obs-net-actions">
          <button
            type="button"
            className="obs-icon-btn"
            aria-label={te.undo}
            title={`${te.undo} (⌘Z)`}
            disabled={!nw.canUndo}
            onClick={nw.undo}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M6 4L3 7l3 3M3.5 7H10a3 3 0 010 6H8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="obs-icon-btn"
            aria-label={te.redo}
            title={`${te.redo} (⇧⌘Z)`}
            disabled={!nw.canRedo}
            onClick={nw.redo}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M10 4l3 3-3 3M12.5 7H6a3 3 0 000 6h2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="obs-icon-btn"
            aria-label={te.share}
            title={te.shareTitle}
            onClick={() => void share()}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M6.5 9.5l3-3M7 4.5l1.2-1.2a2.6 2.6 0 013.7 3.7L10.7 8.2M9 11.5l-1.2 1.2a2.6 2.6 0 01-3.7-3.7L5.3 7.8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
      <div className="obs-net-title">
        <span className="obs-net-name">{fromName}</span>
        {edited && <span className="obs-net-edited">{te.edited}</span>}
        {showing.kind === "live" && (
          <InfoTip label={s.modeAbout(fromName)}>
            {t.live.intro}{" "}
            <Link href="/benchmarks" className="obs-link">
              /benchmarks
            </Link>
            .
          </InfoTip>
        )}
      </div>
      {toast && (
        <span className="obs-toast" role="status">
          {toast}
        </span>
      )}
    </div>
  );

  const helpButton = (
    <div ref={helpRef} className="obs-help">
      {help && (
        <div className="obs-popover" role="dialog" aria-label={s.help}>
          <p className="obs-popover-title">{s.help}</p>
          <ul className="obs-keys">
            {[...s.keys, ...(mode === "net" ? te.keys : [])].map(([k, does]) => (
              <li key={k}>
                <kbd className="obs-kbd">{k}</kbd>
                <span>{does}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        type="button"
        className="obs-icon-btn"
        aria-label={s.help}
        title={s.help}
        aria-expanded={help}
        onClick={() => setHelp((h) => !h)}
      >
        <HelpIcon />
      </button>
    </div>
  );

  const busy = choosing || exiting;
  return (
    <WorkspaceProvider value={api}>
      <div
        ref={root}
        className="obs"
        data-phone={phone || undefined}
        data-choosing={choosing || undefined}
        data-entering={entering || undefined}
        data-exiting={exiting || undefined}
        style={{ "--obs-sidebar": `${L.layout.sidebar}px` } as CSSProperties}
      >
        {(choosing || leavingStart) && nw.loaded && (
          <StartScreen saved={nw.saved} leaving={!choosing} onPick={pick} onResume={resume} />
        )}
        {!phone && (
          <aside className="obs-sidebar" aria-label={s.controls} inert={busy}>
            <div className="obs-sidebar-head">{netHead}</div>
            <div className="obs-sidebar-scroll">
              <div ref={slotRef("controls")} className="obs-controls" />
            </div>
          </aside>
        )}
        {!phone && (
          <SidebarGrip label={s.resizeSidebar} width={L.layout.sidebar} root={root} onCommit={L.setSidebar} />
        )}

        <div
          ref={stageEl}
          className="obs-stage"
          inert={busy}
          style={{ "--obs-drawer": `${anyOpen && !phone ? drawer : 0}px` } as CSSProperties}
        >
          <div ref={slotRef("stage")} className="obs-stage-layer" />
          <div ref={slotRef("player")} className="obs-hud obs-player" />
          <div ref={slotRef("aside")} className="obs-aside" />
          <Legend labels={s.legend} />
          {!phone && (
            <Dock
              isOpen={L.isOpen}
              names={s.windowNames}
              blurbs={s.windowBlurb}
              height={drawer}
              maxHeight={drawerMax}
              onHeight={(h) => {
                const v = dockHeight(h, stage.h);
                setDrawerVar(v);
                L.setDock(v);
              }}
              onPreview={setDrawerVar}
              onToggle={L.toggle}
              onClose={L.close}
              slotRef={slotRef}
              labels={s.dock}
              end={
                <>
                  <button
                    type="button"
                    className="obs-icon-btn"
                    aria-label={s.tidy}
                    title={s.tidyTitle}
                    onClick={L.reset}
                  >
                    <LayoutIcon />
                  </button>
                  {helpButton}
                </>
              }
            />
          )}
        </div>

        {phone && (
          <div className="obs-dock" inert={busy}>
            <div className="obs-dock-head">{netHead}</div>
            <nav className="obs-dock-tabs" aria-label={s.sections}>
              {(["controls", ...WINDOW_IDS] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  className="obs-dock-tab"
                  aria-pressed={tab === id}
                  onClick={() => setTab(id)}
                >
                  {id === "controls" ? s.controls : s.windowNames[id]}
                </button>
              ))}
            </nav>
            <div className="obs-dock-body" key={tab} data-tab={tab}>
              {tab === "controls" ? (
                <div ref={slotRef("controls")} className="obs-controls" />
              ) : (
                <div ref={slotRef(`win:${tab}`)} className="obs-dock-win" />
              )}
            </div>
          </div>
        )}
      </div>
      {nw.showing.kind === "live" && <LiveMode key="live" />}
      {nw.showing.kind === "net" && <EditorMode key="net" nw={nw} net={nw.showing.net} />}
    </WorkspaceProvider>
  );
}

/**
 * The sidebar's edge: only the grip in its middle drags (pointer capture). While dragging, the width
 * goes straight to a CSS variable on the workspace (no React render per move) and is committed on
 * release. Arrow keys nudge it (Shift for bigger steps); a double click restores the default.
 */
function SidebarGrip({
  label,
  width,
  root,
  onCommit,
}: {
  label: string;
  width: number;
  root: RefObject<HTMLDivElement | null>;
  onCommit: (w: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const live = useRef(width);
  const limit = (w: number) =>
    clamp(w, SIDEBAR_MIN, Math.min(SIDEBAR_MAX, (root.current?.clientWidth ?? 1440) - STAGE_MIN));
  const preview = (w: number) => {
    live.current = w;
    root.current?.style.setProperty("--obs-sidebar", `${w}px`);
  };
  const end = () => {
    if (!dragging) return;
    setDragging(false);
    onCommit(live.current);
  };
  return (
    <div className="obs-grip-rail" data-dragging={dragging || undefined}>
      <div
        className="obs-grip"
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuemin={SIDEBAR_MIN}
        aria-valuemax={SIDEBAR_MAX}
        aria-valuenow={width}
        title={label}
        tabIndex={0}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          live.current = width;
          setDragging(true);
        }}
        onPointerMove={(e) => {
          if (!dragging) return;
          const left = root.current?.getBoundingClientRect().left ?? 0;
          preview(limit(e.clientX - left));
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={() => onCommit(SIDEBAR_DEFAULT)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 64 : 16;
          if (e.key === "ArrowLeft") onCommit(limit(width - step));
          else if (e.key === "ArrowRight") onCommit(limit(width + step));
          else return;
          e.preventDefault();
        }}
      />
    </div>
  );
}

/** The stage's legend, bottom left: the canvas's shapes, drawn the same way. */
function Legend({
  labels,
}: {
  labels: Record<"interest" | "data" | "call" | "pit" | "cs" | "rejected", string>;
}) {
  const item = (svg: ReactNode, text: string) => (
    <li>
      <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden="true" className="obs-legend-swatch">
        {svg}
      </svg>
      {text}
    </li>
  );
  return (
    <ul className="obs-hud obs-legend">
      {item(
        <>
          <rect x="2" y="3" width="18" height="8" rx="4" className="lg-bg" />
          <rect x="4" y="4.6" width="14" height="4.8" rx="2.4" className="lg-i" />
        </>,
        labels.interest,
      )}
      {item(
        <>
          <rect x="2" y="3" width="18" height="8" rx="4" className="lg-bg" />
          <rect x="4" y="4.6" width="14" height="4.8" rx="2.4" className="lg-d" />
        </>,
        labels.data,
      )}
      {item(<rect x="4.5" y="3.8" width="13" height="6.4" rx="3.2" className="lg-ring" />, labels.call)}
      {item(<rect x="5" y="1.5" width="11" height="11" rx="2.6" className="lg-box lg-box-i" />, labels.pit)}
      {item(<rect x="5" y="1.5" width="11" height="11" rx="2.6" className="lg-box lg-box-d" />, labels.cs)}
      {item(<path d="M7 3.5l8 7M15 3.5l-8 7" className="lg-x" />, labels.rejected)}
    </ul>
  );
}
