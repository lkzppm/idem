import { describe, expect, it } from "vitest";
import { mean, median, percentileSorted, sampleSd, summarize, tCritical95 } from "./stats";

describe("stats", () => {
  it("computes mean and sample standard deviation", () => {
    expect(mean([2, 4, 4, 4, 5, 5, 7, 9])).toBe(5);
    expect(sampleSd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 5);
    expect(mean([])).toBeNaN();
    expect(sampleSd([3])).toBe(0);
  });

  it("gives Student's t critical values for a two-sided 95% interval", () => {
    expect(tCritical95(1)).toBeCloseTo(12.706, 3);
    expect(tCritical95(9)).toBeCloseTo(2.262, 3);
    expect(tCritical95(29)).toBeCloseTo(2.045, 3);
    expect(tCritical95(30)).toBeCloseTo(2.042, 3);
    // Beyond the table: published values for 40, 60 and 120 degrees of freedom.
    expect(tCritical95(40)).toBeCloseTo(2.021, 3);
    expect(tCritical95(60)).toBeCloseTo(2.0, 3);
    expect(tCritical95(120)).toBeCloseTo(1.98, 3);
    expect(tCritical95(1e9)).toBeCloseTo(1.96, 3);
    expect(tCritical95(0)).toBeNaN();
  });

  it("summarizes a sample with the 95% CI half-width of its mean", () => {
    const s = summarize([10, 12, 14, 16, 18]);
    expect(s.n).toBe(5);
    expect(s.mean).toBe(14);
    expect(s.sd).toBeCloseTo(3.16228, 5);
    // t(0.975, 4) · sd / √5 = 2.776 · 3.16228 / 2.23607
    expect(s.ci95).toBeCloseTo(3.9259, 3);
    expect(s.min).toBe(10);
    expect(s.max).toBe(18);
  });

  it("skips non-finite values and handles tiny samples", () => {
    expect(summarize([1, Number.NaN, 3]).n).toBe(2);
    expect(summarize([7])).toEqual({ n: 1, mean: 7, sd: 0, ci95: 0, min: 7, max: 7 });
    expect(summarize([]).n).toBe(0);
    expect(summarize([]).mean).toBeNaN();
  });

  it("takes nearest-rank percentiles and the median", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentileSorted(sorted, 0)).toBe(1);
    expect(percentileSorted(sorted, 50)).toBe(5);
    expect(percentileSorted(sorted, 95)).toBe(10);
    expect(percentileSorted(sorted, 100)).toBe(10);
    expect(percentileSorted([], 50)).toBeNaN();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNaN();
  });
});
