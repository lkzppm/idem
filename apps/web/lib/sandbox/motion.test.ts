import { describe, expect, it } from "vitest";
import {
  bounce,
  popIn,
  project,
  rubberband,
  type SpringAxis,
  softClamp,
  springSettled,
  stepSpring,
  VelocityTracker,
} from "./motion";

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

describe("edges and throws", () => {
  it("rubber-bands: resists more the further past the edge", () => {
    expect(rubberband(0, 300)).toBe(0);
    expect(rubberband(100, 300)).toBeLessThan(100);
    expect(rubberband(400, 300) - rubberband(300, 300)).toBeLessThan(rubberband(100, 300));
    expect(softClamp(50, 0, 100, 300)).toBe(50);
    expect(softClamp(-50, 0, 100, 300)).toBeGreaterThan(-50);
    expect(softClamp(-50, 0, 100, 300)).toBeLessThan(0);
  });

  it("projects a throw in the direction of the velocity", () => {
    expect(project(0)).toBe(0);
    expect(project(1000)).toBeCloseTo(99, 0);
    expect(project(-1000)).toBeCloseTo(-99, 0);
  });

  it("reads release velocity from recent samples and caps it", () => {
    const t = new VelocityTracker();
    t.add(0, 0, 0);
    t.add(16, 16, 0);
    t.add(32, 32, 8);
    const [vx, vy] = t.velocity(32);
    expect(vx).toBeCloseTo(1000, 0);
    expect(vy).toBeCloseTo(250, 0);
    expect(t.velocity(400)).toEqual([0, 0]);
    t.reset();
    t.add(0, 0, 0);
    t.add(10, 1000, 0);
    expect(t.velocity(10)[0]).toBe(2600);
  });

  it("pops in with a little overshoot and the bounce dies out", () => {
    expect(popIn(0)).toBe(0);
    expect(Math.max(...Array.from({ length: 60 }, (_, i) => popIn(i / 50)))).toBeGreaterThan(1);
    expect(popIn(2)).toBe(1);
    expect(bounce(-1)).toBe(1);
    expect(bounce(2)).toBe(1);
  });
});
