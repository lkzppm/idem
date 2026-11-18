import { describe, expect, it } from "vitest";
import { bounce, popIn, type SpringAxis, springSettled, stepSpring } from "./motion";

describe("spring", () => {
  it("settles at its target, and an underdamped one overshoots on the way", () => {
    const s: SpringAxis = { x: 0, v: 0, target: 100 };
    let peak = 0;
    for (let i = 0; i < 240 && !springSettled(s); i++) {
      stepSpring(s, 1 / 60, 0.42, 0.7);
      peak = Math.max(peak, s.x);
    }
    expect(springSettled(s)).toBe(true);
    expect(peak).toBeGreaterThan(100);
    expect(peak).toBeLessThan(115);
  });

  it("a critically damped spring does not overshoot", () => {
    const s: SpringAxis = { x: 0, v: 0, target: 100 };
    let peak = 0;
    for (let i = 0; i < 240; i++) {
      stepSpring(s, 1 / 60, 0.4, 1);
      peak = Math.max(peak, s.x);
    }
    expect(peak).toBeLessThanOrEqual(100.01);
  });

  it("stays stable on a long frame", () => {
    const s: SpringAxis = { x: 0, v: 5000, target: 10 };
    stepSpring(s, 2, 0.3, 0.8);
    expect(Number.isFinite(s.x)).toBe(true);
    expect(Math.abs(s.x)).toBeLessThan(1000);
  });
});
