"use client";

import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { clampRect, type Rect, TITLE_H, type WindowId } from "@/lib/sandbox/layout";

/** Pointer travel (px) before a press on a window button becomes a drag instead of a click. */
const THRESHOLD = 5;
/** Where the pointer holds the ghost's title bar, from its left edge (px). */
const GRAB_X = 28;
/** Widest the ghost gets while it is still over the sidebar (px). */
const CHIP_MAX_W = 240;

/** Options of {@link useDragToStage}. */
export interface DragToStageOptions<Id extends string = WindowId> {
  /** The stage: dropping inside it places the window there. */
  stage: RefObject<HTMLElement | null>;
  /** The window's current size (its landing rectangle keeps it). */
  sizeOf: (id: Id) => { w: number; h: number };
  /**
   * The drag ended over the stage at `rect` (stage coordinates, already clamped); `at` is the
   * pointer's client position.
   */
  onDrop: (id: Id, rect: Rect, at: { x: number; y: number }) => void;
  /** The ghost's title bar contents (icon and name). */
  render: (id: Id) => ReactNode;
  /** The ghost stays a chip under the pointer over the stage too (palette items, not windows). */
  chip?: boolean;
}

/**
 * Drag a window's button from the sidebar onto the stage. A press that travels a few pixels becomes
 * a drag: a ghost title bar follows the pointer, and over the stage it grows into the window's frame
 * exactly where it will land. Releasing there opens (or moves) the window to that spot; releasing
 * anywhere else, or Escape, cancels. A press that does not travel stays a click. The ghost is moved
 * by writing its style directly, so a drag renders nothing per pointer move.
 */
export function useDragToStage<Id extends string = WindowId>(opts: DragToStageOptions<Id>) {
  const o = useRef(opts);
  o.current = opts;
  const press = useRef<{ id: Id; pointer: number; sx: number; sy: number } | null>(null);
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const target = useRef<Rect | null>(null);
  const swallowClick = useRef(false);
  const ghost = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<Id | null>(null);

  const position = (x: number, y: number) => {
    const p = press.current;
    const g = ghost.current;
    if (!p || !g) return;
    last.current = { x, y };
    const st = o.current.stage.current?.getBoundingClientRect();
    const size = o.current.sizeOf(p.id);
    const over = !!st && x >= st.left && x <= st.right && y >= st.top && y <= st.bottom;
    if (st && over && o.current.chip) {
      target.current = { x: x - st.left, y: y - st.top, w: 0, h: 0 };
      g.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      g.style.width = "";
      g.style.height = "";
      g.dataset.over = "";
    } else if (st && over) {
      const r = clampRect(
        { x: x - st.left - GRAB_X, y: y - st.top - TITLE_H / 2, w: size.w, h: size.h },
        st.width,
        st.height,
      );
      target.current = r;
      g.style.transform = `translate3d(${st.left + r.x}px, ${st.top + r.y}px, 0)`;
      g.style.width = `${r.w}px`;
      g.style.height = `${r.h}px`;
      g.dataset.over = "";
    } else {
      target.current = null;
      g.style.transform = o.current.chip
        ? `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`
        : `translate3d(${x - GRAB_X}px, ${y - TITLE_H / 2}px, 0)`;
      g.style.width = o.current.chip ? "" : `${Math.min(size.w, CHIP_MAX_W)}px`;
      g.style.height = o.current.chip ? "" : `${TITLE_H}px`;
      delete g.dataset.over;
    }
  };

  // The ghost mounts on the first move past the threshold: place it before it paints.
  useLayoutEffect(() => {
    if (active) position(last.current.x, last.current.y);
  });

  useEffect(() => {
    const end = (drop: boolean) => {
      const p = press.current;
      press.current = null;
      if (!dragging.current) return;
      dragging.current = false;
      document.documentElement.removeAttribute("data-obs-dragging");
      // The release may land on the button itself, which would then also get a click.
      swallowClick.current = true;
      window.setTimeout(() => {
        swallowClick.current = false;
      }, 0);
      const r = target.current;
      target.current = null;
      setActive(null);
      if (drop && p && r) o.current.onDrop(p.id, r, last.current);
    };
    const move = (e: PointerEvent) => {
      const p = press.current;
      if (!p || e.pointerId !== p.pointer) return;
      if (!dragging.current) {
        if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < THRESHOLD) return;
        dragging.current = true;
        document.documentElement.setAttribute("data-obs-dragging", "");
        last.current = { x: e.clientX, y: e.clientY };
        setActive(p.id);
        return;
      }
      e.preventDefault();
      position(e.clientX, e.clientY);
    };
    const up = (e: PointerEvent) => {
      if (press.current && e.pointerId === press.current.pointer) end(true);
    };
    const cancel = (e: PointerEvent) => {
      if (press.current && e.pointerId === press.current.pointer) end(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !dragging.current) return;
      e.preventDefault();
      e.stopPropagation();
      end(false);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      document.documentElement.removeAttribute("data-obs-dragging");
    };
  }, []);

  return {
    /** Spread on a window's button in the sidebar. */
    bind: (id: Id) => ({
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
        if (e.button !== 0 || !e.isPrimary) return;
        press.current = { id, pointer: e.pointerId, sx: e.clientX, sy: e.clientY };
      },
      // Native drag-and-drop of the button's text or image would steal the gesture.
      onDragStart: (e: { preventDefault: () => void }) => e.preventDefault(),
    }),
    /** True (once) when the click that follows a drag must be ignored. */
    clickWasDrag: () => swallowClick.current,
    ghost:
      active &&
      createPortal(
        <div
          ref={ghost}
          className="obs-drag-ghost"
          data-chip={o.current.chip ? "" : undefined}
          aria-hidden="true"
        >
          <div className="obs-drag-bar">{o.current.render(active)}</div>
        </div>,
        document.body,
      ),
  };
}
