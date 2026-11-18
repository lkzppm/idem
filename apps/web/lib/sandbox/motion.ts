/**
 * Motion helpers for the sandbox's canvas: a damped spring in Apple's terms (damping ratio and
 * response, `apple-design` §4), a clamp, and the easing curves of the cartoon pops. Pure functions,
 * no DOM.
 */

/** One axis of a spring: position, velocity (units per second) and where it is heading. */
export interface SpringAxis {
  x: number;
  v: number;
  target: number;
}

/**
 * Advance a spring by `dt` seconds. `response` is the period of the undamped spring in seconds;
 * `damping` is the ratio (1 = critically damped, below 1 overshoots). Integrated in small
 * semi-implicit Euler steps, so a long frame never explodes.
 */
export function stepSpring(s: SpringAxis, dt: number, response: number, damping: number): void {
  const k = ((2 * Math.PI) / response) ** 2;
  const c = (4 * Math.PI * damping) / response;
  let left = Math.min(dt, 0.064);
  while (left > 0) {
    const h = Math.min(left, 1 / 240);
    const a = -k * (s.x - s.target) - c * s.v;
    s.v += a * h;
    s.x += s.v * h;
    left -= h;
  }
}

/** True once the spring is visually at rest. */
export function springSettled(s: SpringAxis, eps = 0.3): boolean {
  return Math.abs(s.x - s.target) < eps && Math.abs(s.v) < 6;
}

/** Hard clamp; `hi < lo` pins to `lo`. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(lo, hi), Math.max(lo, v));
}

/** Underdamped settle used for cartoon pops: 0 → 1 with a little overshoot, `a` in seconds. */
export function popIn(a: number): number {
  if (a <= 0) return 0;
  if (a > 1.4) return 1;
  return 1 - Math.exp(-7 * a) * Math.cos(13 * a);
}

/** A quick damped wobble around 1 after an impact, `a` seconds after it. */
export function bounce(a: number, amount = 0.36): number {
  if (a < 0 || a > 1.2) return 1;
  return 1 + amount * Math.exp(-6.5 * a) * Math.sin(15 * a);
}

/** Cubic ease-out on [0, 1]. */
export function easeOut(x: number): number {
  const c = Math.max(0, Math.min(1, x));
  return 1 - (1 - c) ** 3;
}

/** Cosine ease-in-out on [0, 1]. */
export function easeInOut(x: number): number {
  const c = Math.max(0, Math.min(1, x));
  return 0.5 - 0.5 * Math.cos(Math.PI * c);
}
