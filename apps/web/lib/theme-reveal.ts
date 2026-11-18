"use client";

/**
 * The theme switch's circular reveal, shared between the toggle that runs it and the live canvases
 * that draw it themselves.
 *
 * The switch is a View Transition: the old page is a still snapshot and the new page grows over it
 * as a circle. A still snapshot would freeze an animated canvas until the circle reached it, so the
 * hero globe leaves the snapshots for the length of the switch and paints the reveal into its own
 * frames instead: the old palette outside the circle, the new one inside, kept in step with the
 * page's circle by reading the progress of the very same animation.
 */
export type ThemeName = "dark" | "light";

export interface Reveal {
  /** Centre of the circle, viewport CSS pixels. */
  x: number;
  y: number;
  /** Radius when the new theme covers the viewport. */
  end: number;
  from: ThemeName;
  to: ThemeName;
  /** The page's circle (a CSS animation), once the transition is on screen; `null` until then. */
  anim: Animation | null;
}

/**
 * Length of the reveal (ms) and its curve, an ease-in-out. The page's circle is the CSS animation
 * `theme-reveal` in globals.css; keep these in step with it.
 */
export const REVEAL_MS = 700;
export const REVEAL_EASING = "cubic-bezier(0.65, 0, 0.35, 1)";
const P1 = [0.65, 0] as const;
const P2 = [0.35, 1] as const;

/** `cubic-bezier(0.65, 0, 0.35, 1)` at linear progress `t` (0 to 1), as the browser eases it. */
export function revealEase(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const bez = (a: number, b: number, u: number) =>
    3 * a * u * (1 - u) ** 2 + 3 * b * u * u * (1 - u) + u ** 3;
  // Solve x(u) = t by bisection (x is monotonic for these control points), then return y(u).
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (bez(P1[0], P2[0], mid) < t) lo = mid;
    else hi = mid;
  }
  return bez(P1[1], P2[1], (lo + hi) / 2);
}

let current: Reveal | null = null;

/** Begin a reveal; the circle stays at radius 0 until `anim` is attached. */
export function beginReveal(r: Omit<Reveal, "anim">): Reveal {
  current = { ...r, anim: null };
  return current;
}

/** End `r` (a newer reveal is left alone). */
export function endReveal(r: Reveal): void {
  if (current === r) current = null;
}

/** The reveal in progress, if any. */
export function activeReveal(): Reveal | null {
  return current;
}

/** The circle's radius right now, in CSS pixels, eased exactly as the page's. */
export function revealRadius(r: Reveal): number {
  if (!r.anim) return 0;
  // A CSS animation's progress is linear (its curve sits on the keyframes), so ease it here.
  const p = r.anim.effect?.getComputedTiming().progress;
  if (typeof p === "number") return r.end * revealEase(p);
  return r.anim.playState === "finished" ? r.end : 0;
}
