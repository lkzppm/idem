"use client";

import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { DOCK_DEFAULT, type WindowId } from "@/lib/sandbox/layout";
import { CloseIcon, WindowIcon } from "./icons";
import type { SlotName } from "./workspace";

/** Words the dock needs, in the visitor's language. */
export interface DockLabels {
  panels: string;
  resize: string;
  open: (name: string) => string;
  close: (name: string) => string;
}

/** How long the drawer takes to slide down before its panels unmount (ms). */
const CLOSE_MS = 240;

/**
 * The bottom dock (ADR-029): a tab bar always at the bottom of the stage, one tab per panel, and
 * above it a drawer that rises when a panel opens and sinks when the last one closes. The open
 * panels sit side by side in the drawer; its top edge resizes it (drag, or the arrow keys; a double
 * click restores the default). Each panel's body and title hint are slots the running mode fills.
 */
export function Dock({
  ids,
  isOpen,
  names,
  blurbs,
  height,
  maxHeight,
  onHeight,
  onPreview,
  onToggle,
  onClose,
  slotRef,
  labels,
  end,
}: {
  /** The panels the mode fills, in tab order (their keys are 1, 2, …). */
  ids: readonly WindowId[];
  isOpen: (id: WindowId) => boolean;
  names: Record<WindowId, string>;
  blurbs: Record<WindowId, string>;
  /** The drawer's height (already clamped to the stage). */
  height: number;
  maxHeight: number;
  /** A new height to remember (released drag, a key, a double click). */
  onHeight: (h: number) => void;
  /** The drawer's height while it is being dragged (for things that follow it, like the legend). */
  onPreview: (h: number) => void;
  onToggle: (id: WindowId) => void;
  onClose: (id: WindowId) => void;
  slotRef: (name: SlotName) => (el: HTMLElement | null) => void;
  labels: DockLabels;
  /** Buttons at the right end of the tab bar. */
  end?: ReactNode;
}) {
  const open = ids.filter(isOpen);
  const key = open.join();
  // The panels drawn: the open ones, or the last ones while the drawer slides down.
  const [shown, setShown] = useState<WindowId[]>(open);
  const [closing, setClosing] = useState(false);
  const tabs = useRef(new Map<WindowId, HTMLButtonElement>());

  useEffect(() => {
    const now = ids.filter(isOpen);
    if (now.length > 0) {
      setShown(now);
      setClosing(false);
      return;
    }
    setClosing(true);
    const t = setTimeout(() => {
      setShown([]);
      setClosing(false);
    }, CLOSE_MS);
    return () => clearTimeout(t);
    // `key` is the open set.
  }, [key]);

  const close = (id: WindowId) => {
    onClose(id);
    tabs.current.get(id)?.focus({ preventScroll: true });
  };

  return (
    <>
      {shown.length > 0 && (
        <section
          className="obs-drawer"
          data-closing={closing || undefined}
          style={{ height }}
          aria-label={labels.panels}
        >
          <DrawerGrip
            label={labels.resize}
            height={height}
            max={maxHeight}
            onPreview={onPreview}
            onCommit={onHeight}
          />
          <div className="obs-drawer-panels">
            {shown.map((id, i) => (
              <section
                key={id}
                className="obs-panel"
                data-window={id}
                aria-label={names[id]}
                style={{ "--i": i } as CSSProperties}
              >
                <header className="obs-panel-bar">
                  <span className="obs-win-icon">
                    <WindowIcon id={id} />
                  </span>
                  <h3 className="obs-win-title">{names[id]}</h3>
                  <span ref={slotRef(`hint:${id}`)} className="obs-win-hint" />
                  <button
                    type="button"
                    className="obs-icon-btn obs-panel-close"
                    aria-label={labels.close(names[id])}
                    title={labels.close(names[id])}
                    onClick={() => close(id)}
                  >
                    <CloseIcon />
                  </button>
                </header>
                <div ref={slotRef(`win:${id}`)} className="obs-panel-body" />
              </section>
            ))}
          </div>
        </section>
      )}
      <nav className="obs-tabbar" aria-label={labels.panels}>
        <ul className="obs-tabs">
          {ids.map((id, i) => {
            const on = isOpen(id);
            return (
              <li key={id}>
                <button
                  type="button"
                  ref={(el) => {
                    if (el) tabs.current.set(id, el);
                    else tabs.current.delete(id);
                  }}
                  className="obs-tab"
                  aria-pressed={on}
                  title={`${on ? labels.close(names[id]) : labels.open(names[id])}: ${blurbs[id]} (${i + 1})`}
                  onClick={() => onToggle(id)}
                >
                  <WindowIcon id={id} />
                  <span className="obs-tab-name">{names[id]}</span>
                  <kbd className="obs-kbd">{i + 1}</kbd>
                </button>
              </li>
            );
          })}
        </ul>
        {end && <div className="obs-tabbar-end">{end}</div>}
      </nav>
    </>
  );
}

/**
 * The drawer's top edge. While dragging, the height goes straight to the drawer's style (no React
 * render per move) and is committed on release; the arrow keys step it (Shift for bigger steps).
 */
function DrawerGrip({
  label,
  height,
  max,
  onPreview,
  onCommit,
}: {
  label: string;
  height: number;
  max: number;
  onPreview: (h: number) => void;
  onCommit: (h: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const start = useRef({ y: 0, h: height });
  const live = useRef(height);
  const limit = (h: number) => Math.round(Math.min(max, Math.max(0, h)));
  const drawer = (el: HTMLElement) => el.closest<HTMLElement>(".obs-drawer");
  const end = () => {
    if (!dragging) return;
    setDragging(false);
    onCommit(live.current);
  };
  return (
    <div
      className="obs-drawer-grip"
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuenow={height}
      aria-valuemax={max}
      title={label}
      tabIndex={0}
      data-dragging={dragging || undefined}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { y: e.clientY, h: height };
        live.current = height;
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        const h = limit(start.current.h + start.current.y - e.clientY);
        live.current = h;
        const d = drawer(e.currentTarget);
        if (d) d.style.height = `${h}px`;
        onPreview(h);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => onCommit(DOCK_DEFAULT)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        if (e.key === "ArrowUp") onCommit(limit(height + step));
        else if (e.key === "ArrowDown") onCommit(limit(height - step));
        else return;
        e.preventDefault();
      }}
    />
  );
}
