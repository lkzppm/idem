import { costUs, type ProcessingCosts } from "../processing";
import { calibrate } from "./calibrate";
import { type AttackClass, type Expectation, MECHANISM_SEPARATOR } from "./safety";
import {
  EVAL_MODES,
  type EvalModeId,
  type MicrobenchConfig,
  type SafetyConfig,
  type SweepBase,
  type SweepConfig,
} from "./spec";
import { median } from "./stats";

/**
 * The data behind the `/results` page: a compact JSON built only from committed run folders
 * (`experiments/results/<experiment>/<run-id>/`). Nothing here is measured or simulated anew; the
 * few derived values (medians over E1 runs, the per-miss overhead) are computed from the files.
 */

/** A run folder as read from disk. CSV cells are strings. */
export interface LoadedRun {
  experiment: string;
  id: string;
  config: unknown;
  seed: string;
  gitSha: string;
  sourceDigest: string;
  env: Record<string, unknown>;
  metrics: Record<string, string>[];
  summary?: Record<string, string>[];
  cdf?: Record<string, string>[];
}

/** Where a number on the page comes from. */
export interface RunRef {
  experiment: string;
  id: string;
  /** Contents of the run's `seed` file: one seed or `first..last`. */
  seed: string;
  gitSha: string;
  sourceDigest: string;
  node: string;
  platform: string;
  cpu: string;
  cores: number;
  loadavgStart: number[];
  loadavgEnd: number[];
  startedAt: string;
  durationMs: number;
}

/** Mean of a metric over the seeds of a point, with its 95% confidence half-width. */
export interface Stat {
  mean: number;
  ci95: number;
  min: number;
  max: number;
  n: number;
}

/** One E2 sweep: every mode at every value of one parameter. */
export interface SweepData {
  run: RunRef;
  title: string;
  param: string;
  values: number[];
  /** The value of `param` in the base configuration (may not be one of `values`). */
  baseValue: number;
  modes: { id: EvalModeId; name: string }[];
  seeds: number;
  base: SweepBase;
  /** The E1 runs whose medians price CPU work in this sweep, if it charges any. */
  processing: { experiment: string; runs: string[] } | null;
  /** `metrics[metric][mode][i]` is the statistic at `values[i]`. */
  metrics: Record<string, Partial<Record<EvalModeId, Stat[]>>>;
  /** The swept value the latency distribution below is for: the one closest to `baseValue`. */
  cdfValue: number;
  /** Latency percentiles 0..100 (ms) of all calls at `cdfValue`, pooled over seeds: `cdf[mode][q]`. */
  cdf: Partial<Record<EvalModeId, number[]>>;
}

/** One (operation, payload size) cell of E1 over the repeated runs. */
export interface MicrobenchCell {
  sizeBytes: number;
  inputBytes: number;
  iterations: number;
  /** Median over runs of each run's median, µs. */
  p50Us: number;
  /** Smallest and largest per-run median, µs. */
  p50MinUs: number;
  p50MaxUs: number;
  /** Median over runs of each run's 95th and 99th percentile, µs. */
  p95Us: number;
  p99Us: number;
}

export interface MicrobenchData {
  runs: RunRef[];
  seed: number;
  warmupFraction: number;
  sizesBytes: number[];
  ops: { op: string; cells: MicrobenchCell[] }[];
}

/** CPU a cache miss pays in the IDEM modes that plain MCP does not, priced from E1. */
export interface MissOverhead {
  /** Payload sizes the costs were read at. */
  argBytes: number;
  resultBytes: number;
  steps: { who: "consumer" | "edge" | "producer"; what: string; us: number }[];
  totalUs: number;
  /** For scale: the round trip to the producer and the median service time in E2, ms. */
  roundTripMs: number;
  serviceMedianMs: number;
}

export interface SafetyData {
  run: RunRef;
  trials: number;
  rows: {
    attack: AttackClass;
    variant: string;
    where: string;
    expected: Expectation;
    trials: number;
    rejected: number;
    accepted: number;
    mechanisms: { mechanism: string; count: number }[];
    assumes: string;
    summary: string;
  }[];
}

export interface ResultsData {
  schema: 1;
  /** Digest of `packages/*\/src` when this file was generated. */
  sourceDigest: string;
  e1: MicrobenchData | null;
  missOverhead: MissOverhead | null;
  sweeps: Record<string, SweepData>;
  e5: SafetyData | null;
}

function numbers(v: unknown): number[] {
  return Array.isArray(v) ? v.map(Number) : [];
}

/** The provenance line of a run. */
export function runRef(r: LoadedRun): RunRef {
  const e = r.env;
  return {
    experiment: r.experiment,
    id: r.id,
    seed: r.seed,
    gitSha: r.gitSha,
    sourceDigest: r.sourceDigest,
    node: String(e.node ?? ""),
    platform: `${String(e.platform ?? "")} ${String(e.arch ?? "")}`.trim(),
    cpu: String(e.cpuModel ?? ""),
    cores: Number(e.cpuCores ?? 0),
    loadavgStart: numbers(e.loadavgStart),
    loadavgEnd: numbers(e.loadavgEnd),
    startedAt: String(e.startedAt ?? ""),
    durationMs: Number(e.durationMs ?? 0),
  };
}

function baseValueOf(base: SweepBase, param: string): number {
  switch (param) {
    case "ttlMs":
      return base.producer.ttlMs;
    case "csMaxBytes":
      return base.cs.maxBytes;
    case "lossPct":
      return base.topology.lossPct;
    default:
      return (base.workload as unknown as Record<string, number>)[param] ?? Number.NaN;
  }
}

/** Reshape one sweep run (`summary.csv`, `latency_cdf.csv`) for the page. */
export function sweepData(r: LoadedRun): SweepData {
  const cfg = r.config as SweepConfig;
  const values = cfg.sweep.values;
  const index = new Map(values.map((v, i) => [v, i]));
  const metrics: SweepData["metrics"] = {};
  for (const row of r.summary ?? []) {
    const mode = row.mode as EvalModeId;
    const i = index.get(Number(row.value));
    if (i === undefined || !row.metric) continue;
    const byMode = (metrics[row.metric] ??= {});
    const series = (byMode[mode] ??= []);
    series[i] = {
      mean: Number(row.mean),
      ci95: Number(row.ci95),
      min: Number(row.min),
      max: Number(row.max),
      n: Number(row.n),
    };
  }
  const baseValue = baseValueOf(cfg.base, cfg.sweep.param);
  const cdfValue = values.reduce(
    (best, v) => (Math.abs(v - baseValue) < Math.abs(best - baseValue) ? v : best),
    values[0] as number,
  );
  const cdf: SweepData["cdf"] = {};
  for (const row of r.cdf ?? []) {
    if (Number(row.value) !== cdfValue) continue;
    const series = (cdf[row.mode as EvalModeId] ??= []);
    series[Number(row.q)] = Math.round(Number(row.latency_ms) * 1000) / 1000;
  }
  const source = (cfg.processing as { source?: { experiment?: unknown; runs?: unknown } } | undefined)
    ?.source;
  return {
    run: runRef(r),
    title: cfg.title ?? cfg.experiment,
    param: cfg.sweep.param,
    values,
    baseValue,
    modes: cfg.modes.map((id) => ({ id, name: EVAL_MODES[id].name })),
    seeds: cfg.seeds.count,
    base: cfg.base,
    processing: source
      ? {
          experiment: String(source.experiment ?? ""),
          runs: Array.isArray(source.runs) ? source.runs.map(String) : [],
        }
      : null,
    metrics,
    cdfValue,
    cdf,
  };
}

/** Combine the repeated E1 runs: per cell, the median over runs of each run's statistic. */
export function microbenchData(runs: readonly LoadedRun[]): MicrobenchData {
  const cfg = (runs[runs.length - 1] as LoadedRun).config as MicrobenchConfig;
  const ops = cfg.ops.map((op) => ({
    op,
    cells: cfg.sizesBytes.map((sizeBytes): MicrobenchCell => {
      const cells = runs.flatMap((r) =>
        r.metrics.filter((m) => m.op === op && Number(m.size_bytes) === sizeBytes),
      );
      const col = (name: string) => cells.map((c) => Number(c[name]));
      const p50 = col("p50_us");
      return {
        sizeBytes,
        inputBytes: Number(cells[0]?.input_bytes ?? Number.NaN),
        iterations: Number(cells[0]?.iterations ?? Number.NaN),
        p50Us: median(p50),
        p50MinUs: Math.min(...p50),
        p50MaxUs: Math.max(...p50),
        p95Us: median(col("p95_us")),
        p99Us: median(col("p99_us")),
      };
    }),
  }));
  return {
    runs: runs.map(runRef),
    seed: cfg.seed,
    warmupFraction: cfg.warmupFraction,
    sizesBytes: cfg.sizesBytes,
    ops,
  };
}

/**
 * What a miss costs in CPU in B2 that B0 does not pay, from a cost table: the consumer
 * canonicalizes and names the call, the edge recomputes the digest, the producer canonicalizes,
 * names and signs, and the edge and the consumer each verify.
 */
export function missOverhead(costs: ProcessingCosts, base: SweepBase, argBytes = 1024): MissOverhead {
  const resultBytes = base.producer.pageBytesMedian;
  const canon = costUs(costs, "canonicalizeUs", argBytes);
  const name = costUs(costs, "nameUs", argBytes);
  const sign = costUs(costs, "signUs", resultBytes);
  const verify = costUs(costs, "verifyUs", resultBytes);
  const steps: MissOverhead["steps"] = [
    { who: "consumer", what: "canonicalizeArgs + makeName", us: canon + name },
    { who: "edge", what: "args digest", us: name },
    { who: "producer", what: "canonicalizeArgs + makeName + signData", us: canon + name + sign },
    { who: "edge", what: "verifyData", us: verify },
    { who: "consumer", what: "verifyData", us: verify },
  ];
  return {
    argBytes,
    resultBytes,
    steps,
    totalUs: steps.reduce((s, x) => s + x.us, 0),
    roundTripMs: 2 * (base.topology.agentLinkMs + base.topology.producerLinkMs),
    serviceMedianMs: base.producer.serviceMedianMs,
  };
}

function safetyData(r: LoadedRun): SafetyData {
  const cfg = r.config as SafetyConfig;
  return {
    run: runRef(r),
    trials: cfg.trials,
    rows: r.metrics.map((m) => ({
      attack: m.attack as AttackClass,
      variant: m.variant ?? "",
      where: m.where ?? "",
      expected: m.expected as Expectation,
      trials: Number(m.trials),
      rejected: Number(m.rejected),
      accepted: Number(m.accepted),
      mechanisms: (m.mechanisms ?? "")
        .split(MECHANISM_SEPARATOR)
        .filter(Boolean)
        .map((s) => {
          const i = s.lastIndexOf("=");
          return { mechanism: s.slice(0, i), count: Number(s.slice(i + 1)) };
        }),
      assumes: m.assumes ?? "",
      summary: m.summary ?? "",
    })),
  };
}

function kindOf(r: LoadedRun): string {
  return String((r.config as { kind?: unknown }).kind ?? "");
}

/**
 * Choose the runs the page shows and reshape them. For a sweep or the safety suite, the latest
 * run of each experiment; for the microbenchmarks, every run that shares the latest run's config
 * (E1 is wall-clock, so it is repeated and every repetition is kept).
 */
export function buildResultsData(runs: readonly LoadedRun[], sourceDigest: string): ResultsData {
  const byExperiment = new Map<string, LoadedRun[]>();
  for (const r of [...runs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const list = byExperiment.get(r.experiment);
    if (list) list.push(r);
    else byExperiment.set(r.experiment, [r]);
  }
  const data: ResultsData = { schema: 1, sourceDigest, e1: null, missOverhead: null, sweeps: {}, e5: null };
  let e1Runs: LoadedRun[] = [];
  for (const [experiment, list] of [...byExperiment.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const latest = list[list.length - 1] as LoadedRun;
    const kind = kindOf(latest);
    if (kind === "sweep") data.sweeps[experiment] = sweepData(latest);
    else if (kind === "safety") data.e5 = safetyData(latest);
    else if (kind === "microbench" && data.e1 === null) {
      const same = JSON.stringify(latest.config);
      e1Runs = list.filter((r) => JSON.stringify(r.config) === same);
      data.e1 = microbenchData(e1Runs);
    }
  }
  const base = Object.values(data.sweeps)[0]?.base;
  if (data.e1 && base) {
    const costs = calibrate(
      e1Runs[0]?.experiment ?? "",
      e1Runs.map((r) => ({
        id: r.id,
        rows: r.metrics.map((m) => ({
          op: m.op ?? "",
          size_bytes: Number(m.size_bytes),
          p50_us: Number(m.p50_us),
        })),
      })),
    );
    data.missOverhead = missOverhead(costs, base);
  }
  return data;
}
