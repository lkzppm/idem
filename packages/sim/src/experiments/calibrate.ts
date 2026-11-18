import type { ProcessingCosts } from "../processing";
import type { MicrobenchOp } from "./spec";
import { median } from "./stats";

/** The part of an E1 `metrics.csv` line the calibration reads. */
export interface MicrobenchPoint {
  op: string;
  size_bytes: number;
  p50_us: number;
}

/** A processing-cost table with where it came from. Stored in `experiments/configs/`. */
export interface CalibratedCosts extends ProcessingCosts {
  source: {
    experiment: string;
    runs: string[];
    statistic: string;
  };
}

const OP_KEY: Record<MicrobenchOp, keyof ProcessingCosts> = {
  canonicalizeArgs: "canonicalizeUs",
  makeName: "nameUs",
  signData: "signUs",
  verifyData: "verifyUs",
};

/**
 * Turn E1 runs into the table E2 charges: for every operation and payload size, the median over
 * runs of each run's median duration. Throws if a run lacks an (operation, size) cell.
 */
export function calibrate(
  experiment: string,
  runs: readonly { id: string; rows: readonly MicrobenchPoint[] }[],
): CalibratedCosts {
  if (runs.length === 0) throw new Error(`calibrate: no runs of ${experiment}`);
  const sizes = [...new Set(runs.flatMap((r) => r.rows.map((p) => p.size_bytes)))].sort((a, b) => a - b);
  const table = (op: MicrobenchOp): number[] =>
    sizes.map((size) => {
      const medians = runs.map((r) => {
        const p = r.rows.find((x) => x.op === op && x.size_bytes === size);
        if (!p || !Number.isFinite(p.p50_us))
          throw new Error(`calibrate: run ${r.id} has no ${op} at ${size} bytes`);
        return p.p50_us;
      });
      return Math.round(median(medians) * 1000) / 1000;
    });
  const out = { sizesBytes: sizes } as CalibratedCosts;
  for (const op of Object.keys(OP_KEY) as MicrobenchOp[]) out[OP_KEY[op]] = table(op);
  out.source = {
    experiment,
    runs: runs.map((r) => r.id),
    statistic: "median over runs of the per-run median (p50_us), microseconds",
  };
  return out;
}
