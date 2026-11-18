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

/** Pointer travel (px) before a press on a palette chip becomes a drag instead of a click. */
const THRESHOLD = 5;

/** Options of {@link useDragToStage}. */
export interface DragToStageOptions<Id extends string> {
  /** The stage: dropping inside it places the item there. */
  stage: RefObject<HTMLElement | null>;
  /** The drag ended over the stage; `at` is the pointer's client position. */
  onDrop: (id: Id, at: { x: number; y: number }) => void;
  /** The ghost chip's contents (icon and name). */
  render: (id: Id) => ReactNode;
}

/**
 * Drag a chip from the sidebar onto the stage (the editor's Add palette). A press that travels a few
 * pixels becomes a drag: a ghost chip follows the pointer, and releasing it over the stage drops the
 * item there; releasing anywhere else, or Escape, cancels. A press that does not travel stays a
 * click. The ghost is moved by writing its style directly, so a drag renders nothing per pointer move.
 */
export function useDragToStage<Id extends string>(opts: DragToStageOptions<Id>) {
  const o = useRef(opts);
  o.current = opts;
  const press = useRef<{ id: Id; pointer: number; sx: number; sy: number } | null>(null);
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const over = useRef(false);
  const swallowClick = useRef(false);
  const ghost = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<Id | null>(null);

  const position = (x: number, y: number) => {
    const p = press.current;
    const g = ghost.current;
    if (!p || !g) return;
    last.current = { x, y };
    const st = o.current.stage.current?.getBoundingClientRect();
    over.current = !!st && x >= st.left && x <= st.right && y >= st.top && y <= st.bottom;
    g.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    if (over.current) g.dataset.over = "";
    else delete g.dataset.over;
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
      const landed = over.current;
      over.current = false;
      setActive(null);
      if (drop && p && landed) o.current.onDrop(p.id, last.current);
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
    /** Spread on a chip in the sidebar. */
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
        <div ref={ghost} className="obs-drag-ghost" data-chip="" aria-hidden="true">
          <div className="obs-drag-bar">{o.current.render(active)}</div>
        </div>,
        document.body,
      ),
  };
}
