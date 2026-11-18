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
import { sandbox } from "@/lib/i18n/messages/sandbox";
import {
  clampRect,
  defaultRect,
  freeRect,
  type Rect,
  type SandboxMode,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  STAGE_MIN,
  TITLE_H,
  WINDOW_IDS,
  type WindowId,
} from "@/lib/sandbox/layout";
import { clamp } from "@/lib/sandbox/motion";
import { HelpIcon, LayoutIcon, WindowIcon } from "./icons";
import { LiveMode } from "./live-mode";
import { SwarmMode } from "./swarm-mode";
import { InfoTip, Section, Segmented } from "./ui";
import { useDragToStage } from "./window/drag-to-stage";
import { FloatingWindow } from "./window/floating-window";
import { useLayout } from "./window/use-layout";
import { isTyping, type SlotName, type WorkspaceApi, WorkspaceProvider } from "./workspace";

const PHONE_QUERY = "(max-width: 840px)";

/** Stable (module-level), so React does not resubscribe on every render. */
function subscribePhone(cb: () => void): () => void {
  const q = window.matchMedia(PHONE_QUERY);
  q.addEventListener("change", cb);
  return () => q.removeEventListener("change", cb);
}

/** Phone layout: the stage on top, the windows as tabs below. False on the server and until hydration. */
function usePhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

/** Entrance order of the first layout: the comparison first, the tables, then the log and inspector. */
const ENTER_DELAY: Record<WindowId, number> = {
  metrics: 0,
  compare: 0,
  tables: 45,
  log: 80,
  inspector: 105,
  safety: 0,
};

/**
 * The sandbox as an observatory: a full-viewport workspace under the site header, with a sidebar of
 * controls, the network canvas filling the stage, and floating windows over it for the protocol's
 * state (event log, PIT and CS tables, packet inspector, metrics, comparison, safety verdicts).
 *
 * The shell owns the layout (sidebar width, which windows are open, where they are) and offers slots;
 * the mode that runs (live or swarm) portals its controls, canvas and window contents into them, so
 * switching modes swaps contents without rebuilding the workspace. On a phone the stage sits on top
 * and the sidebar and windows become the tabs of a sheet.
 */
export function Sandbox() {
  const t = useMessages(sandbox);
  const s = t.shell;
  const [mode, setModeState] = useState<SandboxMode>("live");
  const L = useLayout(mode);
  const phone = usePhone();
  const reduced = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const stageEl = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [slots, setSlots] = useState<Partial<Record<SlotName, HTMLElement>>>({});
  const [help, setHelp] = useState(false);
  const helpRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"controls" | WindowId>("controls");
  const [booted, setBooted] = useState(false);
  const toggles = useRef(new Map<WindowId, HTMLButtonElement>());

  // Mode from the URL once (`?mode=swarm`), then mirrored back.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mode") === "swarm") setModeState("swarm");
  }, []);
  const setMode = (m: SandboxMode) => {
    setModeState(m);
    const q = new URLSearchParams(window.location.search);
    if (m === "swarm") q.set("mode", "swarm");
    else q.delete("mode");
    const qs = q.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  };

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

  // The first layout pops in with a short stagger; after that, windows open on their own.
  useEffect(() => {
    if (!L.loaded || stage.w === 0) return;
    const id = setTimeout(() => setBooted(true), 900);
    return () => clearTimeout(id);
  }, [L.loaded, stage.w]);

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

  const rectOf = useCallback(
    (id: WindowId): Rect =>
      clampRect(L.layout.rects[id] ?? defaultRect(id, stage.w, stage.h), stage.w, stage.h),
    [L.layout.rects, stage.w, stage.h],
  );
  const openIds = WINDOW_IDS.filter((id) => L.isOpen(id));
  const area = useMemo(() => {
    if (phone || stage.w === 0) return { x: 0, y: 0, w: stage.w, h: stage.h };
    return freeRect(
      stage.w,
      stage.h,
      openIds.map((id) => {
        const r = rectOf(id);
        return L.isCollapsed(id) ? { ...r, h: TITLE_H } : r;
      }),
    );
    // openIds is derived from the layout.
  }, [phone, stage.w, stage.h, rectOf, L, openIds.join()]);

  const reveal = useCallback(
    (id: WindowId) => {
      if (phone) setTab(id);
      else if (L.isOpen(id)) {
        L.front(id);
        if (L.isCollapsed(id)) L.setCollapsed(id, false);
      } else L.open(id);
    },
    [phone, L],
  );

  const api = useMemo<WorkspaceApi>(
    () => ({ mode, phone, stage, area, slots, isOpen: (id) => (phone ? tab === id : L.isOpen(id)), reveal }),
    [mode, phone, stage, area, slots, tab, L, reveal],
  );

  // Keys: 1–6 toggle windows, ? the cheat sheet, Esc closes it.
  useEffect(() => {
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
  }, [L, phone, help]);

  useEffect(() => {
    if (!help) return;
    const onDown = (e: PointerEvent) => {
      if (!helpRef.current?.contains(e.target as Node)) setHelp(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [help]);

  // However the window was closed, focus goes back to its toggle in the sidebar: the close button
  // that had it is gone, and focus would otherwise fall to the document.
  const closeWindow = (id: WindowId) => {
    L.close(id);
    toggles.current.get(id)?.focus({ preventScroll: true });
  };

  // A window's button can be dragged onto the stage: it opens (or moves) where it is dropped.
  const drag = useDragToStage({
    stage: stageEl,
    sizeOf: rectOf,
    onDrop: (id, r) => {
      L.place(id, r);
      if (!L.isOpen(id)) L.open(id);
      else {
        L.front(id);
        if (L.isCollapsed(id)) L.setCollapsed(id, false);
      }
    },
    render: (id) => (
      <>
        <span className="obs-win-icon">
          <WindowIcon id={id} />
        </span>
        <span className="obs-drag-name">{s.windowNames[id]}</span>
      </>
    ),
  });

  const modeSwitch = (
    <Segmented
      label={s.modeLabel}
      size="md"
      value={mode}
      onChange={setMode}
      options={[
        {
          value: "live",
          label: (
            <span className="obs-mode">
              {s.live}
              <span className="obs-mode-hint">{s.liveHint}</span>
            </span>
          ),
        },
        {
          value: "swarm",
          label: (
            <span className="obs-mode">
              {s.swarm}
              <span className="obs-mode-hint">{s.swarmHint}</span>
            </span>
          ),
        },
      ]}
    />
  );

  // The current mode's description, in an info bubble beside the switch.
  const modeHead = (
    <div className="obs-mode-head">
      <div className="min-w-0 flex-1">{modeSwitch}</div>
      <InfoTip label={s.modeAbout(mode === "live" ? s.live : s.swarm)}>
        {mode === "live" ? (
          t.live.intro
        ) : (
          <>
            {t.swarm.intro}{" "}
            <Link href="/benchmarks" className="obs-link">
              /benchmarks
            </Link>
            .
          </>
        )}
      </InfoTip>
    </div>
  );

  const windowList = (
    <Section
      title={s.windows}
      aside={
        <button type="button" className="obs-link-btn" title={s.tidyTitle} onClick={L.reset}>
          <LayoutIcon />
          {s.tidy}
        </button>
      }
    >
      <ul className="obs-winlist">
        {WINDOW_IDS.map((id, i) => {
          const on = L.isOpen(id);
          const name = s.windowNames[id];
          return (
            <li key={id}>
              <button
                type="button"
                ref={(el) => {
                  if (el) toggles.current.set(id, el);
                  else toggles.current.delete(id);
                }}
                aria-pressed={on}
                title={`${on ? s.closeWindow(name) : s.openWindow(name)} · ${s.dragHint}`}
                {...drag.bind(id)}
                onClick={() => {
                  if (!drag.clickWasDrag()) L.toggle(id);
                }}
                className="obs-winlist-btn"
              >
                <span className="obs-winlist-icon">
                  <WindowIcon id={id} />
                </span>
                <span className="obs-winlist-text">
                  <span>{name}</span>
                  <span className="obs-winlist-blurb">{s.windowBlurb[id]}</span>
                </span>
                <kbd className="obs-kbd">{i + 1}</kbd>
                <span className="obs-tick" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </Section>
  );

  return (
    <WorkspaceProvider value={api}>
      <div
        ref={root}
        className="obs"
        data-phone={phone || undefined}
        style={{ "--obs-sidebar": `${L.layout.sidebar}px` } as CSSProperties}
      >
        {!phone && (
          <aside className="obs-sidebar" aria-label={s.controls}>
            <div className="obs-sidebar-head">{modeHead}</div>
            <div className="obs-sidebar-scroll">
              <div ref={slotRef("controls")} className="obs-controls" />
              {windowList}
            </div>
          </aside>
        )}
        {!phone && (
          <SidebarGrip label={s.resizeSidebar} width={L.layout.sidebar} root={root} onCommit={L.setSidebar} />
        )}

        <div ref={stageEl} className="obs-stage">
          <div ref={slotRef("stage")} className="obs-stage-layer" />
          <div ref={slotRef("status")} className="obs-hud obs-hud-top" />
          <Legend labels={s.legend} />
          {!phone && (
            <div ref={helpRef} className="obs-hud obs-hud-help">
              {help && (
                <div className="obs-popover" role="dialog" aria-label={s.help}>
                  <p className="obs-popover-title">{s.help}</p>
                  <ul className="obs-keys">
                    {s.keys.map(([k, does]) => (
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
                className="obs-round-btn"
                aria-label={s.help}
                title={s.help}
                aria-expanded={help}
                onClick={() => setHelp((h) => !h)}
              >
                <HelpIcon />
              </button>
            </div>
          )}
          {!phone && L.loaded && stage.w > 0 && (
            <div className="obs-windows">
              {WINDOW_IDS.map((id) => (
                <FloatingWindow
                  key={id}
                  id={id}
                  title={s.windowNames[id]}
                  icon={<WindowIcon id={id} />}
                  rect={rectOf(id)}
                  bounds={stage}
                  z={10 + L.z(id)}
                  open={L.isOpen(id)}
                  collapsed={L.isCollapsed(id)}
                  front={L.frontmost() === id}
                  enterDelay={booted ? 0 : ENTER_DELAY[id]}
                  reduced={reduced}
                  labels={s.win}
                  onFront={() => L.front(id)}
                  onClose={() => closeWindow(id)}
                  onCollapse={(v) => L.setCollapsed(id, v)}
                  onCommit={(r) => L.place(id, r)}
                  bodyRef={slotRef(`win:${id}`)}
                  hintRef={slotRef(`hint:${id}`)}
                />
              ))}
            </div>
          )}
        </div>

        {phone && (
          <div className="obs-dock">
            <div className="obs-dock-head">{modeHead}</div>
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
      {drag.ghost}
      {mode === "live" ? <LiveMode key="live" /> : <SwarmMode key="swarm" />}
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
