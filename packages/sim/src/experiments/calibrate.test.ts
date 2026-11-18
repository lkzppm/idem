import { describe, expect, it } from "vitest";
import { assertProcessingCosts } from "../processing";
import { calibrate, type MicrobenchPoint } from "./calibrate";

const OPS = ["canonicalizeArgs", "makeName", "signData", "verifyData"];
/** A run in which every operation takes `base + i·10` µs at 1 KiB and twice that at 4 KiB. */
function run(id: string, base: number): { id: string; rows: MicrobenchPoint[] } {
  return {
    id,
    rows: OPS.flatMap((op, i) => [
      { op, size_bytes: 4096, p50_us: 2 * (base + i * 10) },
      { op, size_bytes: 1024, p50_us: base + i * 10 },
    ]),
  };
}

describe("calibration of processing costs from E1", () => {
  it("takes, per operation and size, the median over runs of each run's median", () => {
    const costs = calibrate("e1-node", [run("r1", 10), run("r2", 30), run("r3", 14)]);
    expect(costs.sizesBytes).toEqual([1024, 4096]);
    expect(costs.canonicalizeUs).toEqual([14, 28]);
    expect(costs.nameUs).toEqual([24, 48]);
    expect(costs.signUs).toEqual([34, 68]);
    expect(costs.verifyUs).toEqual([44, 88]);
    expect(costs.source).toEqual({
      experiment: "e1-node",
      runs: ["r1", "r2", "r3"],
      statistic: "median over runs of the per-run median (p50_us), microseconds",
    });
    expect(() => assertProcessingCosts(costs)).not.toThrow();
  });

  it("averages the two middle runs when their count is even, to the nanosecond", () => {
    const costs = calibrate("e1-node", [run("r1", 10), run("r2", 11.0007)]);
    expect(costs.canonicalizeUs[0]).toBe(10.5);
    expect(costs.canonicalizeUs[1]).toBe(21.001);
  });

  it("refuses to calibrate from nothing or from an incomplete run", () => {
    expect(() => calibrate("e1-node", [])).toThrow(/no runs/);
    const partial = run("r2", 10);
    partial.rows = partial.rows.filter((p) => !(p.op === "signData" && p.size_bytes === 4096));
    expect(() => calibrate("e1-node", [run("r1", 10), partial])).toThrow(/r2 has no signData at 4096/);
  });
});
