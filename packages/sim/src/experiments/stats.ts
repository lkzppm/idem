/**
 * Statistics for the evaluation (05-evaluation §4): per-point mean with a 95% confidence interval
 * over seeds, and percentiles. Small and dependency-free so the same code runs in the CLI and in
 * tests, and so every published aggregate is computed in exactly one place.
 */

/** Arithmetic mean; `NaN` for an empty list. */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

/** Sample standard deviation (n − 1); `0` for fewer than two values. */
export function sampleSd(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const m = mean(values);
  let s = 0;
  for (const v of values) s += (v - m) ** 2;
  return Math.sqrt(s / (n - 1));
}

// Two-sided 95% critical values of Student's t for 1..30 degrees of freedom.
const T975 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131,
  2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];
const Z975 = 1.959964;

/**
 * `t` such that `P(|T| ≤ t) = 0.95` for `df` degrees of freedom: a table up to 30, then the
 * Cornish–Fisher expansion around the normal quantile (error below 1e-4 for df > 30).
 */
export function tCritical95(df: number): number {
  if (!(df >= 1)) return Number.NaN;
  if (df <= 30) return T975[Math.floor(df) - 1] as number;
  const z = Z975;
  return z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df * df);
}

/** Summary of one metric over the seeds of a point. */
export interface Summary {
  n: number;
  mean: number;
  /** Sample standard deviation. */
  sd: number;
  /** Half-width of the 95% confidence interval of the mean (Student's t); `0` when n < 2. */
  ci95: number;
  min: number;
  max: number;
}

/** Mean, spread and 95% CI of `values` (non-finite values are skipped). */
export function summarize(values: readonly number[]): Summary {
  const xs = values.filter((v) => Number.isFinite(v));
  const n = xs.length;
  if (n === 0) return { n: 0, mean: Number.NaN, sd: 0, ci95: 0, min: Number.NaN, max: Number.NaN };
  const sd = sampleSd(xs);
  return {
    n,
    mean: mean(xs),
    sd,
    ci95: n < 2 ? 0 : (tCritical95(n - 1) * sd) / Math.sqrt(n),
    min: Math.min(...xs),
    max: Math.max(...xs),
  };
}

/** Nearest-rank percentile of an ascending list; `NaN` when empty. */
export function percentileSorted(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  const rank = Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1));
  return sorted[rank] as number;
}

/** Median of an unsorted list (mean of the two middle values when the count is even). */
export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}
