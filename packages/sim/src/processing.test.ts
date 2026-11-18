import { describe, expect, it } from "vitest";
import { assertProcessingCosts, costUs, type ProcessingCosts } from "./processing";

const COSTS: ProcessingCosts = {
  sizesBytes: [1000, 2000, 4000],
  canonicalizeUs: [10, 20, 60],
  nameUs: [5, 5, 5],
  signUs: [40, 50, 70],
  verifyUs: [60, 70, 90],
};

describe("processing costs", () => {
  it("returns the measured value at a measured size", () => {
    expect(costUs(COSTS, "canonicalizeUs", 1000)).toBe(10);
    expect(costUs(COSTS, "canonicalizeUs", 2000)).toBe(20);
    expect(costUs(COSTS, "canonicalizeUs", 4000)).toBe(60);
  });

  it("interpolates linearly between the bracketing sizes", () => {
    expect(costUs(COSTS, "canonicalizeUs", 1500)).toBeCloseTo(15);
    expect(costUs(COSTS, "canonicalizeUs", 3000)).toBeCloseTo(40);
    expect(costUs(COSTS, "signUs", 2500)).toBeCloseTo(55);
  });

  it("charges the smallest size's cost below the range and extends the last segment above it", () => {
    expect(costUs(COSTS, "verifyUs", 0)).toBe(60);
    expect(costUs(COSTS, "verifyUs", 999)).toBe(60);
    expect(costUs(COSTS, "canonicalizeUs", 6000)).toBeCloseTo(100);
    expect(costUs(COSTS, "nameUs", 1_000_000)).toBe(5);
  });

  it("never returns a negative cost", () => {
    const falling: ProcessingCosts = { ...COSTS, signUs: [50, 10, 1] };
    expect(costUs(falling, "signUs", 1_000_000)).toBe(0);
  });

  it("rejects malformed tables", () => {
    expect(() => assertProcessingCosts(COSTS)).not.toThrow();
    expect(() => assertProcessingCosts({ ...COSTS, sizesBytes: [] })).toThrow(/empty/);
    expect(() => assertProcessingCosts({ ...COSTS, sizesBytes: [1000, 1000, 4000] })).toThrow(/ascending/);
    expect(() => assertProcessingCosts({ ...COSTS, signUs: [1, 2] })).toThrow(/signUs/);
    expect(() => assertProcessingCosts({ ...COSTS, verifyUs: [1, -2, 3] })).toThrow(/verifyUs/);
  });
});
