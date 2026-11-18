"use client";

import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { GUTTER, MIN_H, MIN_W, type Rect, TITLE_H, type WindowId } from "@/lib/sandbox/layout";
import {
  clamp,
  project,
  type SpringAxis,
  softClamp,
  springSettled,
  stepSpring,
  VelocityTracker,
} from "@/lib/sandbox/motion";
import { ChevronIcon, CloseIcon, GripIcon } from "../icons";

/** Words a window needs, in the visitor's language. */
export interface WindowLabels {
  move: (title: string) => string;
  collapse: string;
  expand: string;
  close: string;
  resize: string;
}

/** Props of {@link FloatingWindow}. */
export interface FloatingWindowProps {
  id: WindowId;
  title: string;
  /** Small text beside the title (the node or run it shows). */
  hint?: ReactNode;
  icon?: ReactNode;
  /** Where the window should be (already clamped to the stage). */
  rect: Rect;
  /** Stage size: the window never leaves it. */
  bounds: { w: number; h: number };
  z: number;
  open: boolean;
  collapsed: boolean;
  /** The front window draws a stronger outline. */
  front: boolean;
  /** Entrance delay (ms), for the first layout's stagger. */
  enterDelay?: number;
  reduced: boolean;
  labels: WindowLabels;
  onFront: () => void;
  onClose: (viaKeyboard: boolean) => void;
  onCollapse: (collapsed: boolean) => void;
  /** A drag, throw, keyboard move or resize has settled at `rect`. */
  onCommit: (rect: Rect) => void;
  /** The body element, where the mode portals the window's content. */
  bodyRef: (el: HTMLElement | null) => void;
  /** A small element in the title bar, where the mode portals a hint (the node or run shown). */
  hintRef?: (el: HTMLElement | null) => void;
}

type Phase = "open" | "closing" | "closed";

const SPRING_RESPONSE = 0.42;
const SPRING_DAMPING = 0.7;
/** Within this distance of a stage edge, a released window snaps to the gutter. */
const MAGNET = 18;

/**
 * A window floating over the stage. Geometry is written straight to the element (transform, width,
 * height), never through React state, so a drag or a throw re-renders nothing; it is committed to the
 * layout once it settles. Dragged by the title bar: pointer capture, 1:1 from where it was grabbed,
 * rubber-banded past the stage edges, thrown with the release velocity (Apple's momentum projection)
 * and settled by an underdamped spring that starts from that velocity, then a small landing squash.
 * Grabbing it mid-flight takes it from where it is. Opens with a springy pop from its title bar and
 * closes with a quick shrink; `prefers-reduced-motion` turns both into fades and drops the throw.
 */
export function FloatingWindow(p: FloatingWindowProps) {
  const outer = useRef<HTMLElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const pos = useRef({ x: p.rect.x, y: p.rect.y });
  const dims = useRef({ w: p.rect.w, h: p.rect.h });
  const drag = useRef<{
    pointer: number;
    ox: number;
    oy: number;
    sx: number;
    sy: number;
    started: boolean;
    w: number;
    h: number;
  } | null>(null);
  const resize = useRef<{ pointer: number; sx: number; sy: number; w: number; h: number } | null>(null);
  const anim = useRef<{ raf: number; x: SpringAxis; y: SpringAxis } | null>(null);
  const tracker = useRef(new VelocityTracker());
  const [lifted, setLifted] = useState(false);
  const [phase, setPhase] = useState<Phase>(p.open ? "open" : "closed");
  const [entering, setEntering] = useState(p.open);
  const titleId = useId();
  const props = useRef(p);
  props.current = p;

  const apply = useCallback(() => {
    const el = outer.current;
    if (!el) return;
    el.style.transform = `translate3d(${pos.current.x}px, ${pos.current.y}px, 0)`;
  }, []);
  const applySize = useCallback(() => {
    const el = outer.current;
    if (!el) return;
    el.style.width = `${dims.current.w}px`;
    el.style.height = `${props.current.collapsed ? TITLE_H : dims.current.h}px`;
  }, []);

  // Follow the layout's rectangle unless the window is being moved, thrown or resized right now.
  useLayoutEffect(() => {
    if (drag.current || anim.current || resize.current) return;
    pos.current = { x: p.rect.x, y: p.rect.y };
    dims.current = { w: p.rect.w, h: p.rect.h };
    apply();
    applySize();
  });

  // Open / close: keep the window mounted while it animates out.
  useEffect(() => {
    if (p.open) {
      setPhase((ph) => {
        if (ph !== "open") setEntering(true);
        return "open";
      });
    } else setPhase((ph) => (ph === "open" ? "closing" : ph));
  }, [p.open]);
  useEffect(() => {
    if (phase !== "closing") return;
    const t = setTimeout(() => setPhase("closed"), 400);
    return () => clearTimeout(t);
  }, [phase]);

  const stopAnim = () => {
    if (anim.current) cancelAnimationFrame(anim.current.raf);
    anim.current = null;
  };
  useEffect(() => stopAnim, []);

  const bounds = (w: number, h: number) => ({
    maxX: props.current.bounds.w - GUTTER - w,
    maxY: props.current.bounds.h - GUTTER - h,
  });

  const land = () => {
    if (props.current.reduced) return;
    card.current?.animate(
      [{ scale: "1 1" }, { scale: "1.012 0.982" }, { scale: "0.996 1.006" }, { scale: "1 1" }],
      { duration: 340, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
    );
  };
  const commit = () => {
    props.current.onCommit({ ...pos.current, ...dims.current });
  };

  /** Spring from the current position (and velocity) to (tx, ty). */
  const settle = (tx: number, ty: number, vx: number, vy: number) => {
    stopAnim();
    const x: SpringAxis = { x: pos.current.x, v: vx, target: tx };
    const y: SpringAxis = { x: pos.current.y, v: vy, target: ty };
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      stepSpring(x, dt, SPRING_RESPONSE, SPRING_DAMPING);
      stepSpring(y, dt, SPRING_RESPONSE, SPRING_DAMPING);
      pos.current = { x: x.x, y: y.x };
      apply();
      if (springSettled(x) && springSettled(y)) {
        pos.current = { x: tx, y: ty };
        apply();
        anim.current = null;
        land();
        commit();
        return;
      }
      if (anim.current) anim.current.raf = requestAnimationFrame(step);
    };
    anim.current = { raf: requestAnimationFrame(step), x, y };
  };

  // ------------------------------------------------------------------ drag by the title bar

  const onBarDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || drag.current) return; // one pointer at a time
    if ((e.target as Element).closest("button:not([data-grip])")) return;
    if (anim.current) {
      // Caught mid-flight: it stays where it is, and that becomes its place.
      stopAnim();
      commit();
    }
    const el = outer.current;
    if (!el) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      pointer: e.pointerId,
      ox: e.clientX - pos.current.x,
      oy: e.clientY - pos.current.y,
      sx: e.clientX,
      sy: e.clientY,
      started: false,
      w: el.offsetWidth,
      h: el.offsetHeight,
    };
    tracker.current.reset();
    tracker.current.add(e.timeStamp, e.clientX, e.clientY);
  };
  const onBarMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    if (!d.started) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 3) return;
      d.started = true;
      setLifted(true);
    }
    const { maxX, maxY } = bounds(d.w, d.h);
    pos.current = {
      x: softClamp(e.clientX - d.ox, GUTTER, maxX, d.w),
      y: softClamp(e.clientY - d.oy, GUTTER, maxY, d.h),
    };
    apply();
    tracker.current.add(e.timeStamp, e.clientX, e.clientY);
  };
  const onBarUp = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    drag.current = null;
    if (!d.started) return;
    setLifted(false);
    const reduced = props.current.reduced;
    const [vx, vy] = reduced || e.type === "pointercancel" ? [0, 0] : tracker.current.velocity(e.timeStamp);
    const { maxX, maxY } = bounds(d.w, d.h);
    let tx = clamp(pos.current.x + project(vx), GUTTER, maxX);
    let ty = clamp(pos.current.y + project(vy), GUTTER, maxY);
    if (tx - GUTTER < MAGNET) tx = GUTTER;
    else if (maxX - tx < MAGNET) tx = Math.max(GUTTER, maxX);
    if (ty - GUTTER < MAGNET) ty = GUTTER;
    else if (maxY - ty < MAGNET) ty = Math.max(GUTTER, maxY);
    if (reduced) {
      pos.current = { x: tx, y: ty };
      apply();
      commit();
      return;
    }
    settle(tx, ty, vx, vy);
  };

  // Keyboard: arrows move the window (no animation for keyboard moves), Alt + arrows resize it from
  // its bottom-right corner (as the corner grip does), Escape closes it.
  const onGripKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 64 : 16;
    const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
    const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      props.current.onClose(true);
      return;
    }
    if (!dx && !dy) return;
    e.preventDefault();
    e.stopPropagation();
    stopAnim();
    const el = outer.current;
    if (!el) return;
    if (e.altKey) {
      if (props.current.collapsed) return;
      const b = props.current.bounds;
      dims.current = {
        w: Math.round(clamp(dims.current.w + dx, MIN_W, b.w - GUTTER - pos.current.x)),
        h: Math.round(clamp(dims.current.h + dy, MIN_H, b.h - GUTTER - pos.current.y)),
      };
      applySize();
      commit();
      return;
    }
    const { maxX, maxY } = bounds(el.offsetWidth, el.offsetHeight);
    pos.current = { x: clamp(pos.current.x + dx, GUTTER, maxX), y: clamp(pos.current.y + dy, GUTTER, maxY) };
    apply();
    commit();
  };

  // ------------------------------------------------------------------ resize by the corner

  const onResizeDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || resize.current) return;
    e.preventDefault();
    e.stopPropagation();
    stopAnim();
    e.currentTarget.setPointerCapture(e.pointerId);
    resize.current = {
      pointer: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      w: dims.current.w,
      h: dims.current.h,
    };
    outer.current?.setAttribute("data-resizing", "");
  };
  const onResizeMove = (e: PointerEvent<HTMLElement>) => {
    const r = resize.current;
    if (!r || e.pointerId !== r.pointer) return;
    const b = props.current.bounds;
    dims.current = {
      w: Math.round(clamp(r.w + e.clientX - r.sx, MIN_W, b.w - GUTTER - pos.current.x)),
      h: Math.round(clamp(r.h + e.clientY - r.sy, MIN_H, b.h - GUTTER - pos.current.y)),
    };
    applySize();
  };
  const onResizeUp = (e: PointerEvent<HTMLElement>) => {
    const r = resize.current;
    if (!r || e.pointerId !== r.pointer) return;
    resize.current = null;
    outer.current?.removeAttribute("data-resizing");
    commit();
  };

  if (phase === "closed") return null;
  const l = p.labels;
  return (
    <section
      ref={outer}
      className="obs-win"
      aria-labelledby={titleId}
      data-window={p.id}
      data-front={p.front || undefined}
      data-collapsed={p.collapsed || undefined}
      style={{ zIndex: p.z }}
      onPointerDownCapture={() => {
        if (!p.front) p.onFront();
      }}
      onFocusCapture={() => {
        if (!p.front) p.onFront();
      }}
    >
      <div
        ref={card}
        className="obs-win-card"
        data-phase={phase}
        data-entering={(entering && phase === "open") || undefined}
        data-lifted={lifted || undefined}
        style={entering && p.enterDelay ? { animationDelay: `${p.enterDelay}ms` } : undefined}
        onAnimationEnd={(e) => {
          if (e.target !== e.currentTarget) return;
          if (phase === "closing") setPhase("closed");
          else setEntering(false);
        }}
      >
        <header
          className="obs-win-bar"
          onPointerDown={onBarDown}
          onPointerMove={onBarMove}
          onPointerUp={onBarUp}
          onPointerCancel={onBarUp}
          onDoubleClick={(e) => {
            if ((e.target as Element).closest("button:not([data-grip])")) return;
            p.onCollapse(!p.collapsed);
          }}
        >
          <button
            type="button"
            data-grip
            className="obs-win-grip"
            aria-label={l.move(p.title)}
            onKeyDown={onGripKey}
          >
            <GripIcon />
          </button>
          {p.icon && <span className="obs-win-icon">{p.icon}</span>}
          <h2 id={titleId} className="obs-win-title">
            {p.title}
          </h2>
          <span className="obs-win-hint" ref={p.hintRef}>
            {p.hint}
          </span>
          <span className="obs-win-actions">
            <button
              type="button"
              className="obs-icon-btn"
              aria-label={p.collapsed ? l.expand : l.collapse}
              title={p.collapsed ? l.expand : l.collapse}
              aria-expanded={!p.collapsed}
              data-turn={p.collapsed || undefined}
              onClick={() => p.onCollapse(!p.collapsed)}
            >
              <ChevronIcon />
            </button>
            <button
              type="button"
              className="obs-icon-btn"
              aria-label={l.close}
              title={l.close}
              onClick={(e) => p.onClose(e.detail === 0)}
            >
              <CloseIcon />
            </button>
          </span>
        </header>
        <div
          className="obs-win-body"
          ref={p.bodyRef}
          inert={p.collapsed || phase === "closing" ? true : undefined}
        />
        {!p.collapsed && (
          <span
            className="obs-win-resize"
            role="presentation"
            title={l.resize}
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
            onPointerCancel={onResizeUp}
          />
        )}
      </div>
    </section>
  );
}
