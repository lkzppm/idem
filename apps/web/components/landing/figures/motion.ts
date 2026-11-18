"use client";

import { type DependencyList, type RefObject, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";

/*
 * The landing figures' motion kit. Figures are SVG drawn in the theme's tokens; a frame function
 * writes transforms and attributes straight to the elements (no React render per frame), driven by
 * `useFrames`, which runs only while the figure is on screen and the tab is visible. The vocabulary
 * is the hero's: flat shapes with a background outline, packets that squash and stretch with their
 * speed, nodes that pop in with overshoot and wobble when something lands on them.
 */

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Progress of `t` through the window that starts at `a` and lasts `d` seconds (0 before, 1 after). */
export const seg = (t: number, a: number, d: number): number => clamp01((t - a) / d);
export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
export const easeOut = (x: number): number => 1 - (1 - clamp01(x)) ** 3;
export const easeIn = (x: number): number => clamp01(x) ** 2;
export const easeInOut = (x: number): number => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(x));
/** Cartoon arrival: runs about 10% past the target and settles back (back-out easing). */
export const backOut = (x: number, s = 1.9): number => {
  const u = clamp01(x) - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
};
/** Cartoon exit: a small wind-up, then gone (back-in easing). */
export const backIn = (x: number, s = 1.7): number => {
  const u = clamp01(x);
  return (s + 1) * u * u * u - s * u * u;
};
/**
 * A landing wobble, `dt` seconds after impact: 0 at impact, a quick squash, a smaller rebound,
 * settled within about half a second. Multiply by the amplitude you want.
 */
export const wobble = (dt: number): number =>
  dt < 0 || dt > 0.9 ? 0 : Math.exp(-7 * dt) * Math.sin(19 * dt);

export type Pt = readonly [number, number];

/** A point a fraction `u` along a polyline, and the direction (radians) it is heading there. */
export function along(pts: readonly Pt[], u: number): { x: number; y: number; a: number } {
  let total = 0;
  const lens: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1] as Pt;
    const q = pts[i] as Pt;
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    lens.push(l);
    total += l;
  }
  let d = clamp01(u) * total;
  for (let i = 0; i < lens.length; i++) {
    const l = lens[i] as number;
    const p = pts[i] as Pt;
    const q = pts[i + 1] as Pt;
    if (d <= l || i === lens.length - 1) {
      const k = l > 0 ? Math.min(1, d / l) : 0;
      return { x: lerp(p[0], q[0], k), y: lerp(p[1], q[1], k), a: Math.atan2(q[1] - p[1], q[0] - p[0]) };
    }
    d -= l;
  }
  const p = pts[0] as Pt;
  return { x: p[0], y: p[1], a: 0 };
}

const f = (n: number): string => (Math.round(n * 100) / 100).toString();

/** Move, turn and scale an element in one write. Scale is around the element's own origin. */
export function put(el: Element | null | undefined, x: number, y: number, s = 1, rot = 0, sy = s): void {
  if (!el) return;
  let v = `translate(${f(x)} ${f(y)})`;
  if (rot) v += ` rotate(${f(rot)})`;
  if (s !== 1 || sy !== 1) v += ` scale(${f(Math.max(0.001, s))} ${f(Math.max(0.001, sy))})`;
  if (el.getAttribute("transform") !== v) el.setAttribute("transform", v);
}

/** Set opacity, hiding the element from hit-testing and painting when it is fully transparent. */
export function fade(el: Element | null | undefined, o: number): void {
  if (!el) return;
  const v = f(clamp01(o));
  if (el.getAttribute("opacity") !== v) el.setAttribute("opacity", v);
  const vis = o <= 0.001 ? "hidden" : "visible";
  if (el.getAttribute("visibility") !== vis) el.setAttribute("visibility", vis);
}

/** Toggle a class only when it changes (no style invalidation on unchanged frames). */
export function flag(el: Element | null | undefined, cls: string, on: boolean): void {
  if (!el) return;
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

/** Set an attribute only when it changes. */
export function attr(el: Element | null | undefined, name: string, v: string): void {
  if (el && el.getAttribute(name) !== v) el.setAttribute(name, v);
}

/**
 * Draw a packet (see `Packet`): a solid capsule heading `a` radians, stretched by `speed` (0 at
 * rest, 1 at full speed) and trailing two puffs while it moves.
 */
export function putPacket(
  g: Element | null | undefined,
  x: number,
  y: number,
  a: number,
  speed: number,
  o = 1,
): void {
  if (!g) return;
  fade(g, o);
  if (o <= 0) return;
  put(g, x, y, 1, (a * 180) / Math.PI);
  const body = g.firstElementChild?.nextElementSibling?.nextElementSibling;
  put(body, 0, 0, 1 + 0.9 * speed, 1 - 0.26 * speed);
  const puffs = g.firstElementChild;
  fade(puffs, speed > 0.08 ? Math.min(1, speed * 1.6) : 0);
  const p2 = puffs?.nextElementSibling;
  fade(p2, speed > 0.08 ? Math.min(1, speed * 1.6) : 0);
}

/** A packet travelling from `a` to `b` (or along a polyline), eased, between `t0` and `t0 + dur`. */
export function travel(
  g: Element | null | undefined,
  pts: readonly Pt[],
  t: number,
  t0: number,
  dur: number,
  hold = false,
): void {
  const u = (t - t0) / dur;
  if (u < 0 || (u > 1 && !hold)) {
    fade(g, 0);
    return;
  }
  const e = easeInOut(u);
  const p = along(pts, e);
  putPacket(g, p.x, p.y, p.a, u >= 1 ? 0 : Math.sin(Math.PI * clamp01(u)));
}

/**
 * Drives a figure's frame function. Runs `paint(t)` on every animation frame while `ref` is on
 * screen and the tab is visible; `t` (seconds) advances only while running, so a figure scrolled
 * away resumes where it stopped instead of having played unseen. With `end`, the timeline plays once
 * and holds its last frame (the loop stops). The clock restarts at 0 when `deps` change.
 *
 * Reduced motion paints one still, informative frame (`poster`) and never loops; a figure that is
 * interactive repaints that frame when it calls the returned `repaint`.
 */
export function useFrames(
  ref: RefObject<Element | null>,
  paint: (t: number, dt: number) => void,
  { poster, end, deps = [] }: { poster: number; end?: number; deps?: DependencyList },
): { repaint: () => void; restart: () => void; reduced: boolean } {
  const reduced = useReducedMotion();
  const paintRef = useRef(paint);
  paintRef.current = paint;
  const clock = useRef({ t: 0, raf: 0, last: 0, running: false, onScreen: false, kick: () => {} });

  useEffect(() => {
    const el = ref.current;
    const c = clock.current;
    c.t = 0;
    if (!el) return;
    if (reduced) {
      paintRef.current(poster, 0);
      c.kick = () => paintRef.current(poster, 0);
      return;
    }
    let visible = document.visibilityState === "visible";
    const frame = (now: number) => {
      const dt = c.last ? Math.min(0.05, (now - c.last) / 1000) : 0;
      c.last = now;
      c.t += dt;
      const done = end !== undefined && c.t >= end;
      paintRef.current(done ? end : c.t, dt);
      if (done) {
        c.running = false;
        return;
      }
      c.raf = requestAnimationFrame(frame);
    };
    const sync = () => {
      const want = c.onScreen && visible && !(end !== undefined && c.t >= end);
      if (want && !c.running) {
        c.running = true;
        c.last = 0;
        c.raf = requestAnimationFrame(frame);
      } else if (!want && c.running) {
        c.running = false;
        cancelAnimationFrame(c.raf);
      }
    };
    c.kick = () => {
      if (end !== undefined && c.t >= end) c.t = 0;
      sync();
    };
    paintRef.current(0, 0);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) c.onScreen = e.isIntersecting;
        sync();
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    const onVis = () => {
      visible = document.visibilityState === "visible";
      sync();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      cancelAnimationFrame(c.raf);
      c.running = false;
    };
  }, [reduced, ref, end, poster, ...deps]);

  return {
    reduced,
    repaint: () => {
      if (reduced) paintRef.current(poster, 0);
    },
    restart: () => {
      clock.current.t = 0;
      if (reduced) paintRef.current(poster, 0);
      else clock.current.kick();
    },
  };
}

/**
 * True when the element is at least `min` CSS pixels wide. Figures pick a wide or a narrow drawing
 * with it, so text stays readable on a phone instead of shrinking with the viewBox.
 */
export function useWide(ref: RefObject<Element | null>, min = 560): boolean {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWide(el.clientWidth >= min));
    ro.observe(el);
    setWide(el.clientWidth >= min);
    return () => ro.disconnect();
  }, [ref, min]);
  return wide;
}
