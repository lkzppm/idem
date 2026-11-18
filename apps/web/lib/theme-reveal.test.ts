import { describe, expect, it } from "vitest";
import { revealEase } from "./theme-reveal";

describe("revealEase", () => {
  it("runs from 0 to 1 and clamps outside", () => {
    expect(revealEase(-1)).toBe(0);
    expect(revealEase(0)).toBe(0);
    expect(revealEase(1)).toBe(1);
    expect(revealEase(2)).toBe(1);
  });

  it("is a symmetric ease-in-out, like cubic-bezier(0.65, 0, 0.35, 1)", () => {
    expect(revealEase(0.5)).toBeCloseTo(0.5, 6);
    for (const t of [0.1, 0.2, 0.3, 0.4]) {
      expect(revealEase(t) + revealEase(1 - t)).toBeCloseTo(1, 6);
      expect(revealEase(t)).toBeLessThan(t);
    }
  });

  it("never goes backwards", () => {
    let prev = 0;
    for (let i = 1; i <= 100; i++) {
      const v = revealEase(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});
