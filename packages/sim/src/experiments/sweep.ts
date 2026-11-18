import type { ProcessingCosts } from "../processing";
import { Simulation } from "../simulation";
import { applyParam, EVAL_MODES, type EvalModeId, type SweepConfig, simConfigFor } from "./spec";
import { percentileSorted, summarize } from "./stats";

/** One simulation run: a mode at a point with a seed. One line of `metrics.csv`. */
export interface SweepRow {
  mode: EvalModeId;
  mode_name: string;
  param: string;
  value: number;
  seed: number;
  calls: number;
  completed: number;
  failed: number;
  cacheable_calls: number;
  distinct_names: number;
  /** `1 − (distinct_names + passthrough calls) / calls`: the reduction of a perfect shared cache. */
  oracle_reduction: number;
  upstream_calls: number;
  /** `1 − upstream(mode) / upstream(B0)` for the same point and seed (05-evaluation §3). */
  upstream_reduction: number;
  /** `1 − upstream(mode) / upstream(B1)` for the same point and seed. */
  upstream_reduction_vs_b1: number;
  producer_link_bytes: number;
  /** `1 − bytes(mode) / bytes(B0)` for the same point and seed. */
  bytes_reduction: number;
  edge_interests: number;
  cs_hits: number;
  pit_aggregations: number;
  cs_hit_ratio: number;
  pit_aggregation_ratio: number;
  core_cs_hits: number;
  local_cache_hits: number;
  bypasses: number;
  cs_evictions: number;
  latency_mean_ms: number;
  latency_p50_ms: number;
  latency_p95_ms: number;
  latency_p99_ms: number;
  /** `latency(mode) − latency(B0)` for the same point and seed, ms (negative = faster than B0). */
  latency_mean_vs_b0_ms: number;
  latency_p50_vs_b0_ms: number;
  latency_p95_vs_b0_ms: number;
  latency_p99_vs_b0_ms: number;
  /** `mean latency(mode) − mean latency(B2)` for the same point and seed, ms (B4: verification at forwarders). */
  latency_mean_vs_b2_ms: number;
  verify_failures: number;
  stale_serves: number;
  late_serves: number;
  max_late_ms: number;
  safety_violations: number;
  retries: number;
  duration_ms: number;
}

/** Column order of `metrics.csv` for a sweep. */
export const SWEEP_COLUMNS = [
  "mode",
  "mode_name",
  "param",
  "value",
  "seed",
  "calls",
  "completed",
  "failed",
  "cacheable_calls",
  "distinct_names",
  "oracle_reduction",
  "upstream_calls",
  "upstream_reduction",
  "upstream_reduction_vs_b1",
  "producer_link_bytes",
  "bytes_reduction",
  "edge_interests",
  "cs_hits",
  "pit_aggregations",
  "cs_hit_ratio",
  "pit_aggregation_ratio",
  "core_cs_hits",
  "local_cache_hits",
  "bypasses",
  "cs_evictions",
  "latency_mean_ms",
  "latency_p50_ms",
  "latency_p95_ms",
  "latency_p99_ms",
  "latency_mean_vs_b0_ms",
  "latency_p50_vs_b0_ms",
  "latency_p95_vs_b0_ms",
  "latency_p99_vs_b0_ms",
  "latency_mean_vs_b2_ms",
  "verify_failures",
  "stale_serves",
  "late_serves",
  "max_late_ms",
  "safety_violations",
  "retries",
  "duration_ms",
] as const satisfies readonly (keyof SweepRow)[];

/** Metrics aggregated over seeds in `summary.csv`. */
export const SUMMARY_METRICS = [
  "calls",
  "failed",
  "cacheable_calls",
  "distinct_names",
  "oracle_reduction",
  "upstream_calls",
  "upstream_reduction",
  "upstream_reduction_vs_b1",
  "producer_link_bytes",
  "bytes_reduction",
  "cs_hit_ratio",
  "pit_aggregation_ratio",
  "core_cs_hits",
  "local_cache_hits",
  "bypasses",
  "cs_evictions",
  "latency_mean_ms",
  "latency_p50_ms",
  "latency_p95_ms",
  "latency_p99_ms",
  "latency_mean_vs_b0_ms",
  "latency_p50_vs_b0_ms",
  "latency_p95_vs_b0_ms",
  "latency_p99_vs_b0_ms",
  "latency_mean_vs_b2_ms",
  "verify_failures",
  "stale_serves",
  "late_serves",
  "max_late_ms",
  "safety_violations",
  "retries",
] as const satisfies readonly (keyof SweepRow)[];

/** One line of `summary.csv`: a metric of a mode at a point, over the seeds. */
export interface SummaryRow {
  mode: EvalModeId;
  mode_name: string;
  param: string;
  value: number;
  metric: string;
  n: number;
  mean: number;
  sd: number;
  ci95: number;
  min: number;
  max: number;
}
export const SUMMARY_COLUMNS = [
  "mode",
  "mode_name",
  "param",
  "value",
  "metric",
  "n",
  "mean",
  "sd",
  "ci95",
  "min",
  "max",
] as const satisfies readonly (keyof SummaryRow)[];

/** One line of `latency_cdf.csv`: a percentile of every call latency of a mode at a point, pooled over seeds. */
export interface CdfRow {
  mode: EvalModeId;
  param: string;
  value: number;
  /** Percentile, 0..100. */
  q: number;
  latency_ms: number;
  /** Calls pooled. */
  n: number;
}
export const CDF_COLUMNS = [
  "mode",
  "param",
  "value",
  "q",
  "latency_ms",
  "n",
] as const satisfies readonly (keyof CdfRow)[];

/** Output of {@link runSweep}. */
export interface SweepResult {
  rows: SweepRow[];
  summary: SummaryRow[];
  cdf: CdfRow[];
}

/** A sweep whose processing costs are resolved: a table, not the name of a file. */
export type ResolvedSweep = Omit<SweepConfig, "processing"> & { processing?: ProcessingCosts };

/** The seeds of a sweep, in order. */
export function sweepSeeds(cfg: Pick<SweepConfig, "seeds">): number[] {
  return Array.from({ length: cfg.seeds.count }, (_, i) => cfg.seeds.first + i);
}

/** Aggregate rows into `summary.csv` lines: one per (mode, value, metric), in input order. */
export function summarizeRows(rows: readonly SweepRow[]): SummaryRow[] {
  const groups = new Map<string, SweepRow[]>();
  for (const r of rows) {
    const k = `${r.mode}|${r.value}`;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const out: SummaryRow[] = [];
  for (const g of groups.values()) {
    const first = g[0] as SweepRow;
    for (const metric of SUMMARY_METRICS) {
      const s = summarize(g.map((r) => r[metric]));
      out.push({
        mode: first.mode,
        mode_name: first.mode_name,
        param: first.param,
        value: first.value,
        metric,
        ...s,
      });
    }
  }
  return out;
}

/** Percentiles 0, 1, …, 100 (nearest rank) of `latencies`. */
export function latencyPercentiles(latencies: readonly number[]): number[] {
  const sorted = Float64Array.from(latencies).sort();
  return Array.from({ length: 101 }, (_, q) => percentileSorted(sorted, q));
}

/**
 * Run a sweep (E2): every mode at every value with every seed, on the virtual clock. The same
 * seed gives every mode the same planned workload and the same think-time draws, so the
 * per-seed reductions are paired comparisons.
 */
export async function runSweep(
  cfg: ResolvedSweep,
  opts: { onProgress?: (done: number, total: number) => void } = {},
): Promise<SweepResult> {
  const seeds = sweepSeeds(cfg);
  const total = cfg.sweep.values.length * seeds.length * cfg.modes.length;
  const rows: SweepRow[] = [];
  const cdf: CdfRow[] = [];
  let done = 0;
  for (const value of cfg.sweep.values) {
    const base = applyParam(cfg.base, cfg.sweep.param, value);
    const pooled = new Map<EvalModeId, number[]>(cfg.modes.map((m) => [m, []]));
    const point: SweepRow[] = [];
    for (const seed of seeds) {
      const bySeed: SweepRow[] = [];
      for (const mode of cfg.modes) {
        const sim = await Simulation.create(simConfigFor(base, mode, cfg.processing), { seed });
        const w = await sim.workloadStats();
        const { metrics: m } = await sim.run();
        (pooled.get(mode) as number[]).push(...sim.metrics.latencies);
        bySeed.push({
          mode,
          mode_name: EVAL_MODES[mode].name,
          param: cfg.sweep.param,
          value,
          seed,
          calls: m.calls,
          completed: m.completed,
          failed: m.failed,
          cacheable_calls: w.cacheableCalls,
          distinct_names: w.distinctNames,
          oracle_reduction: w.calls > 0 ? 1 - (w.distinctNames + w.passthroughCalls) / w.calls : Number.NaN,
          upstream_calls: m.upstreamCalls,
          upstream_reduction: Number.NaN,
          upstream_reduction_vs_b1: Number.NaN,
          producer_link_bytes: m.producerLinkBytes,
          bytes_reduction: Number.NaN,
          edge_interests: m.edgeInterests,
          cs_hits: m.csHits,
          pit_aggregations: m.pitAggregations,
          cs_hit_ratio: m.csHitRatio,
          pit_aggregation_ratio: m.pitAggregationRatio,
          core_cs_hits: m.coreCsHits,
          local_cache_hits: m.localCacheHits,
          bypasses: m.bypasses,
          cs_evictions: m.csEvictions,
          latency_mean_ms: m.latencyMs.mean,
          latency_p50_ms: m.latencyMs.p50,
          latency_p95_ms: m.latencyMs.p95,
          latency_p99_ms: m.latencyMs.p99,
          latency_mean_vs_b0_ms: Number.NaN,
          latency_p50_vs_b0_ms: Number.NaN,
          latency_p95_vs_b0_ms: Number.NaN,
          latency_p99_vs_b0_ms: Number.NaN,
          latency_mean_vs_b2_ms: Number.NaN,
          verify_failures: m.verifyFailures,
          stale_serves: m.staleServes,
          late_serves: m.lateServes,
          max_late_ms: m.maxLateMs,
          safety_violations: m.safetyViolations,
          retries: m.retries,
          duration_ms: m.durationMs,
        });
        opts.onProgress?.(++done, total);
      }
      const b0 = bySeed.find((r) => r.mode === "B0");
      const b1 = bySeed.find((r) => r.mode === "B1");
      const b2 = bySeed.find((r) => r.mode === "B2");
      for (const r of bySeed) {
        if (b0 && b0.upstream_calls > 0) r.upstream_reduction = 1 - r.upstream_calls / b0.upstream_calls;
        if (b1 && b1.upstream_calls > 0)
          r.upstream_reduction_vs_b1 = 1 - r.upstream_calls / b1.upstream_calls;
        if (b0 && b0.producer_link_bytes > 0) {
          r.bytes_reduction = 1 - r.producer_link_bytes / b0.producer_link_bytes;
        }
        if (b0) {
          r.latency_mean_vs_b0_ms = r.latency_mean_ms - b0.latency_mean_ms;
          r.latency_p50_vs_b0_ms = r.latency_p50_ms - b0.latency_p50_ms;
          r.latency_p95_vs_b0_ms = r.latency_p95_ms - b0.latency_p95_ms;
          r.latency_p99_vs_b0_ms = r.latency_p99_ms - b0.latency_p99_ms;
        }
        if (b2) r.latency_mean_vs_b2_ms = r.latency_mean_ms - b2.latency_mean_ms;
      }
      point.push(...bySeed);
    }
    // Keep metrics.csv grouped by mode within a point.
    for (const mode of cfg.modes) rows.push(...point.filter((r) => r.mode === mode));
    for (const mode of cfg.modes) {
      const lat = pooled.get(mode) as number[];
      latencyPercentiles(lat).forEach((latency_ms, q) => {
        cdf.push({ mode, param: cfg.sweep.param, value, q, latency_ms, n: lat.length });
      });
    }
  }
  return { rows, summary: summarizeRows(rows), cdf };
}
