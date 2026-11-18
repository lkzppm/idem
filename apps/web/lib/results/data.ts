import type { EvalModeId, ResultsData, Stat, SweepData } from "@idem/sim";
import raw from "./data.json";

/**
 * Everything the results page shows. `data.json` is generated from the committed run folders
 * (`experiments/results/**`) by `pnpm sim -- export-web`; a test in `@idem/sim` fails if it drifts
 * from them. Nothing on the page is typed in by hand.
 */
export const RESULTS = raw as unknown as ResultsData;

export type { EvalModeId, ResultsData, Stat, SweepData };

/** The statistic of `metric` for `mode` at swept value `value`, if the sweep has it. */
export function statAt(sweep: SweepData, metric: string, mode: EvalModeId, value: number): Stat | undefined {
  const i = sweep.values.indexOf(value);
  const s = i < 0 ? undefined : sweep.metrics[metric]?.[mode]?.[i];
  return s && s.n > 0 ? s : undefined;
}

/** The series of `metric` for `mode`, aligned with `sweep.values` (missing points left out). */
export function seriesOf(
  sweep: SweepData,
  metric: string,
  mode: EvalModeId,
): { index: number; value: number; stat: Stat }[] {
  const series = sweep.metrics[metric]?.[mode] ?? [];
  const out: { index: number; value: number; stat: Stat }[] = [];
  sweep.values.forEach((value, index) => {
    const stat = series[index];
    if (stat && stat.n > 0) out.push({ index, value, stat });
  });
  return out;
}

/** Does the 95% interval of the mean exclude zero, on the given side? */
export function significantly(stat: Stat | undefined, side: "above" | "below"): boolean {
  if (!stat || stat.n < 2) return false;
  return side === "above" ? stat.mean - stat.ci95 > 0 : stat.mean + stat.ci95 < 0;
}
