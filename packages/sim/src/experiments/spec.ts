import type { ReplacementPolicy } from "@idem/core";
import { buildTopology, type SimConfig, type SimMode } from "../config";
import { assertProcessingCosts, type ProcessingCosts } from "../processing";

/** Modes compared in the evaluation (05-evaluation §1). */
export type EvalModeId = "B0" | "B1" | "B2" | "B3" | "B4";

/** How each evaluation mode maps onto the simulator: its engine mode and its topology. */
export const EVAL_MODES: Readonly<
  Record<EvalModeId, { id: EvalModeId; name: string; simMode: SimMode; topology: "star" | "tree" }>
> = {
  B0: { id: "B0", name: "mcp-direct", simMode: "mcp-direct", topology: "star" },
  B1: { id: "B1", name: "mcp-local-cache", simMode: "mcp-local-cache", topology: "star" },
  B2: { id: "B2", name: "idem", simMode: "idem", topology: "star" },
  B3: { id: "B3", name: "idem-tree", simMode: "idem", topology: "tree" },
  B4: { id: "B4", name: "idem-noverify", simMode: "idem-noverify", topology: "star" },
};

/** Every mode id, in order. */
export const EVAL_MODE_IDS = Object.keys(EVAL_MODES) as EvalModeId[];

/** Parameters of a W-syn / W-mixed sweep that do not change between points (05-evaluation §2). */
export interface SweepBase {
  workload: {
    agents: number;
    callsPerAgent: number;
    catalogSize: number;
    zipfAlpha: number;
    /** Fraction of each agent's cacheable calls drawn from the shared catalog. */
    overlap: number;
    /** Mean of the exponential think time between an agent's calls, ms. */
    thinkTimeMs: number;
    /** Probability that a URL is written in an equivalent but different surface form. */
    surfaceVariation: number;
    /** Fraction of calls to the `private` tool (W-mixed). */
    privateFraction: number;
    /** Fraction of calls to the non-cacheable tool (W-mixed). */
    sideEffectFraction: number;
  };
  topology: {
    /** One-way agent ↔ edge latency, ms. */
    agentLinkMs: number;
    /** One-way edge ↔ producer latency in the star (B0, B1, B2, B4), ms. */
    producerLinkMs: number;
    lossPct: number;
    /** The tree of B3: agents → `edges` edge forwarders → one regional forwarder → producer. */
    tree: { edges: number; coreLinkMs: number; producerLinkMs: number };
  };
  producer: {
    /** Median of the log-normal tool service time, ms. */
    serviceMedianMs: number;
    /** Sigma of the log-normal tool service time. */
    serviceSigma: number;
    /** Manifest TTL of the cacheable tools, ms. */
    ttlMs: number;
    /** Median result size, bytes (log-normal, sigma 0.7, clamped to [512, 65536]). */
    pageBytesMedian: number;
  };
  cs: { maxBytes: number; policy: ReplacementPolicy };
  interestLifetimeMs: number;
}

/** Parameters a sweep may vary. */
export const SWEEP_PARAMS = [
  "agents",
  "overlap",
  "callsPerAgent",
  "catalogSize",
  "zipfAlpha",
  "thinkTimeMs",
  "surfaceVariation",
  "privateFraction",
  "sideEffectFraction",
  "ttlMs",
  "csMaxBytes",
  "lossPct",
] as const;
export type SweepParam = (typeof SWEEP_PARAMS)[number];

/** E2: every listed mode at every value of one parameter, over a set of seeds. */
export interface SweepConfig {
  experiment: string;
  kind: "sweep";
  title?: string;
  description?: string;
  /** Seeds `first, first + 1, …, first + count − 1`; the same seeds at every point. */
  seeds: { first: number; count: number };
  modes: EvalModeId[];
  sweep: { param: SweepParam; values: number[] };
  base: SweepBase;
  /** CPU costs charged in the IDEM modes; a file name is resolved by the CLI against the config. */
  processing?: ProcessingCosts | string;
}

/** The four operations E1 measures. */
export const MICROBENCH_OPS = ["canonicalizeArgs", "makeName", "signData", "verifyData"] as const;
export type MicrobenchOp = (typeof MICROBENCH_OPS)[number];

/** E1: time each operation at each payload size. */
export interface MicrobenchConfig {
  experiment: string;
  kind: "microbench";
  title?: string;
  description?: string;
  /** Seeds the payload text and the signing key. */
  seed: number;
  ops: MicrobenchOp[];
  sizesBytes: number[];
  /** Timed iterations per size (same order as `sizesBytes`). */
  iterations: number[];
  /** Untimed iterations before the timed ones, as a fraction of `iterations` (at least 20). */
  warmupFraction: number;
}

/** E5: run each attack variant `trials` times. */
export interface SafetyConfig {
  experiment: string;
  kind: "safety";
  title?: string;
  description?: string;
  /** Trial `k` of every variant uses seed `seed + k`. */
  seed: number;
  trials: number;
  /** Variant ids to run (default: all). */
  variants?: string[];
}

export type ExperimentConfig = SweepConfig | MicrobenchConfig | SafetyConfig;

class ConfigError extends Error {
  constructor(path: string, why: string) {
    super(`config: ${path} ${why}`);
    this.name = "ConfigError";
  }
}

function obj(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v))
    throw new ConfigError(path, "must be an object");
  return v as Record<string, unknown>;
}
function num(v: unknown, path: string, opts: { min?: number; max?: number; int?: boolean } = {}): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new ConfigError(path, "must be a number");
  if (opts.int && !Number.isInteger(v)) throw new ConfigError(path, "must be an integer");
  if (opts.min !== undefined && v < opts.min) throw new ConfigError(path, `must be ≥ ${opts.min}`);
  if (opts.max !== undefined && v > opts.max) throw new ConfigError(path, `must be ≤ ${opts.max}`);
  return v;
}
function str(v: unknown, path: string): string {
  if (typeof v !== "string" || v.length === 0) throw new ConfigError(path, "must be a non-empty string");
  return v;
}
function optStr(v: unknown, path: string): string | undefined {
  return v === undefined ? undefined : str(v, path);
}
function nums(v: unknown, path: string, opts: { min?: number; int?: boolean } = {}): number[] {
  if (!Array.isArray(v) || v.length === 0) throw new ConfigError(path, "must be a non-empty array");
  return v.map((x, i) => num(x, `${path}[${i}]`, opts));
}

const FRACTION = { min: 0, max: 1 } as const;

function parseBase(v: unknown): SweepBase {
  const b = obj(v, "base");
  const w = obj(b.workload, "base.workload");
  const t = obj(b.topology, "base.topology");
  const tree = obj(t.tree, "base.topology.tree");
  const p = obj(b.producer, "base.producer");
  const cs = obj(b.cs, "base.cs");
  const policy = str(cs.policy, "base.cs.policy");
  if (policy !== "lru" && policy !== "lfu" && policy !== "fifo") {
    throw new ConfigError("base.cs.policy", "must be lru, lfu or fifo");
  }
  return {
    workload: {
      agents: num(w.agents, "base.workload.agents", { min: 1, int: true }),
      callsPerAgent: num(w.callsPerAgent, "base.workload.callsPerAgent", { min: 1, int: true }),
      catalogSize: num(w.catalogSize, "base.workload.catalogSize", { min: 1, int: true }),
      zipfAlpha: num(w.zipfAlpha, "base.workload.zipfAlpha", { min: 0 }),
      overlap: num(w.overlap, "base.workload.overlap", FRACTION),
      thinkTimeMs: num(w.thinkTimeMs, "base.workload.thinkTimeMs", { min: 0 }),
      surfaceVariation: num(w.surfaceVariation, "base.workload.surfaceVariation", FRACTION),
      privateFraction: num(w.privateFraction, "base.workload.privateFraction", FRACTION),
      sideEffectFraction: num(w.sideEffectFraction, "base.workload.sideEffectFraction", FRACTION),
    },
    topology: {
      agentLinkMs: num(t.agentLinkMs, "base.topology.agentLinkMs", { min: 0 }),
      producerLinkMs: num(t.producerLinkMs, "base.topology.producerLinkMs", { min: 0 }),
      lossPct: num(t.lossPct, "base.topology.lossPct", { min: 0, max: 100 }),
      tree: {
        edges: num(tree.edges, "base.topology.tree.edges", { min: 1, int: true }),
        coreLinkMs: num(tree.coreLinkMs, "base.topology.tree.coreLinkMs", { min: 0 }),
        producerLinkMs: num(tree.producerLinkMs, "base.topology.tree.producerLinkMs", { min: 0 }),
      },
    },
    producer: {
      serviceMedianMs: num(p.serviceMedianMs, "base.producer.serviceMedianMs", { min: 0.001 }),
      serviceSigma: num(p.serviceSigma, "base.producer.serviceSigma", { min: 0 }),
      ttlMs: num(p.ttlMs, "base.producer.ttlMs", { min: 1, int: true }),
      pageBytesMedian: num(p.pageBytesMedian, "base.producer.pageBytesMedian", { min: 1 }),
    },
    cs: { maxBytes: num(cs.maxBytes, "base.cs.maxBytes", { min: 0, int: true }), policy },
    interestLifetimeMs: num(b.interestLifetimeMs, "base.interestLifetimeMs", { min: 1 }),
  };
}

function parseProcessing(v: unknown): ProcessingCosts | string | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "string") return str(v, "processing");
  const o = obj(v, "processing");
  const costs: ProcessingCosts = {
    sizesBytes: nums(o.sizesBytes, "processing.sizesBytes", { min: 0 }),
    canonicalizeUs: nums(o.canonicalizeUs, "processing.canonicalizeUs", { min: 0 }),
    nameUs: nums(o.nameUs, "processing.nameUs", { min: 0 }),
    signUs: nums(o.signUs, "processing.signUs", { min: 0 }),
    verifyUs: nums(o.verifyUs, "processing.verifyUs", { min: 0 }),
  };
  try {
    assertProcessingCosts(costs);
  } catch (e) {
    throw new ConfigError("processing", e instanceof Error ? e.message : "is invalid");
  }
  return costs;
}

/** Validate a processing-cost table read from JSON (extra fields such as `source` are ignored). */
export function parseProcessingCosts(json: unknown): ProcessingCosts {
  const costs = parseProcessing(json);
  if (costs === undefined || typeof costs === "string") {
    throw new ConfigError("processing", "must be a cost table");
  }
  return costs;
}

/** Validate an experiment config read from JSON. Throws with the path of the first bad field. */
export function parseExperimentConfig(json: unknown): ExperimentConfig {
  const c = obj(json, "(root)");
  const experiment = str(c.experiment, "experiment");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(experiment)) {
    throw new ConfigError("experiment", "must be lowercase letters, digits and dashes (it names a folder)");
  }
  const title = optStr(c.title, "title");
  const description = optStr(c.description, "description");
  const common = { experiment, ...(title && { title }), ...(description && { description }) };
  const kind = str(c.kind, "kind");
  if (kind === "sweep") {
    const seeds = obj(c.seeds, "seeds");
    if (!Array.isArray(c.modes) || c.modes.length === 0) throw new ConfigError("modes", "must list modes");
    const modes = c.modes.map((m, i) => {
      if (typeof m !== "string" || !(m in EVAL_MODES)) throw new ConfigError(`modes[${i}]`, "must be B0..B4");
      return m as EvalModeId;
    });
    if (new Set(modes).size !== modes.length) throw new ConfigError("modes", "must not repeat a mode");
    const sweep = obj(c.sweep, "sweep");
    const param = str(sweep.param, "sweep.param");
    if (!(SWEEP_PARAMS as readonly string[]).includes(param)) {
      throw new ConfigError("sweep.param", `must be one of ${SWEEP_PARAMS.join(", ")}`);
    }
    const values = nums(sweep.values, "sweep.values");
    if (new Set(values).size !== values.length) throw new ConfigError("sweep.values", "must not repeat");
    const base = parseBase(c.base);
    for (const v of values) applyParam(base, param as SweepParam, v);
    const processing = parseProcessing(c.processing);
    return {
      ...common,
      kind,
      seeds: {
        first: num(seeds.first, "seeds.first", { min: 0, int: true }),
        count: num(seeds.count, "seeds.count", { min: 1, int: true }),
      },
      modes,
      sweep: { param: param as SweepParam, values },
      base,
      ...(processing !== undefined && { processing }),
    };
  }
  if (kind === "microbench") {
    if (!Array.isArray(c.ops) || c.ops.length === 0) throw new ConfigError("ops", "must list operations");
    const ops = c.ops.map((o, i) => {
      if (typeof o !== "string" || !(MICROBENCH_OPS as readonly string[]).includes(o)) {
        throw new ConfigError(`ops[${i}]`, `must be one of ${MICROBENCH_OPS.join(", ")}`);
      }
      return o as MicrobenchOp;
    });
    const sizesBytes = nums(c.sizesBytes, "sizesBytes", { min: 1, int: true });
    const iterations = nums(c.iterations, "iterations", { min: 1, int: true });
    if (iterations.length !== sizesBytes.length) {
      throw new ConfigError("iterations", "needs one value per entry of sizesBytes");
    }
    return {
      ...common,
      kind,
      seed: num(c.seed, "seed", { min: 0, int: true }),
      ops,
      sizesBytes,
      iterations,
      warmupFraction: num(c.warmupFraction, "warmupFraction", { min: 0, max: 10 }),
    };
  }
  if (kind === "safety") {
    const variants =
      c.variants === undefined
        ? undefined
        : (c.variants as unknown[]).map((v, i) => str(v, `variants[${i}]`));
    return {
      ...common,
      kind,
      seed: num(c.seed, "seed", { min: 0, int: true }),
      trials: num(c.trials, "trials", { min: 1, int: true }),
      ...(variants && { variants }),
    };
  }
  throw new ConfigError("kind", "must be sweep, microbench or safety");
}

/** A copy of `base` with one sweep parameter set to `value`. Throws if the value is out of range. */
export function applyParam(base: SweepBase, param: SweepParam, value: number): SweepBase {
  const b: SweepBase = {
    ...base,
    workload: { ...base.workload },
    topology: { ...base.topology, tree: { ...base.topology.tree } },
    producer: { ...base.producer },
    cs: { ...base.cs },
  };
  const bad = (why: string): never => {
    throw new ConfigError(`sweep.values (${param} = ${value})`, why);
  };
  const fraction = () => (value >= 0 && value <= 1 ? value : bad("must be in [0, 1]"));
  const positiveInt = () => (Number.isInteger(value) && value >= 1 ? value : bad("must be an integer ≥ 1"));
  switch (param) {
    case "agents":
      b.workload.agents = positiveInt();
      break;
    case "callsPerAgent":
      b.workload.callsPerAgent = positiveInt();
      break;
    case "catalogSize":
      b.workload.catalogSize = positiveInt();
      break;
    case "overlap":
      b.workload.overlap = fraction();
      break;
    case "surfaceVariation":
      b.workload.surfaceVariation = fraction();
      break;
    case "privateFraction":
      b.workload.privateFraction = fraction();
      break;
    case "sideEffectFraction":
      b.workload.sideEffectFraction = fraction();
      break;
    case "zipfAlpha":
      b.workload.zipfAlpha = value >= 0 ? value : bad("must be ≥ 0");
      break;
    case "thinkTimeMs":
      b.workload.thinkTimeMs = value >= 0 ? value : bad("must be ≥ 0");
      break;
    case "ttlMs":
      b.producer.ttlMs = positiveInt();
      break;
    case "csMaxBytes":
      b.cs.maxBytes = Number.isInteger(value) && value >= 0 ? value : bad("must be an integer ≥ 0");
      break;
    case "lossPct":
      b.topology.lossPct = value >= 0 && value <= 100 ? value : bad("must be in [0, 100]");
      break;
  }
  if (b.workload.privateFraction + b.workload.sideEffectFraction > 1) {
    bad("privateFraction + sideEffectFraction must be ≤ 1");
  }
  return b;
}

/**
 * The simulator configuration of one evaluation mode at one point. B0, B1, B2 and B4 run on the
 * star (agents → edge → producer); B3 runs on the tree. In B0 and B1 the edge only relays plain
 * calls, so every mode crosses the same links, and the producer answers them as a plain MCP
 * server (no IDEM metadata on the wire).
 */
export function simConfigFor(base: SweepBase, mode: EvalModeId, processing?: ProcessingCosts): SimConfig {
  const m = EVAL_MODES[mode];
  const t = base.topology;
  const w = base.workload;
  return {
    topology:
      m.topology === "star"
        ? buildTopology({
            kind: "star",
            agents: w.agents,
            agentLinkMs: t.agentLinkMs,
            producerLinkMs: t.producerLinkMs,
            lossPct: t.lossPct,
          })
        : buildTopology({
            kind: "tree",
            agents: w.agents,
            agentLinkMs: t.agentLinkMs,
            coreLinkMs: t.tree.coreLinkMs,
            producerLinkMs: t.tree.producerLinkMs,
            edges: t.tree.edges,
            lossPct: t.lossPct,
          }),
    mode: m.simMode,
    workload: { kind: "synthetic", ...w },
    producer: {
      serviceTimeMs: {
        dist: "lognormal",
        mu: Math.log(base.producer.serviceMedianMs),
        sigma: base.producer.serviceSigma,
      },
      ttlMs: base.producer.ttlMs,
      pageBytesMedian: base.producer.pageBytesMedian,
      signPlainCalls: false,
    },
    cs: { ...base.cs },
    interestLifetimeMs: base.interestLifetimeMs,
    ...(processing && { processing }),
  };
}
