/**
 * E4 configuration (`experiments/ndn/bench/configs/e4.json`; not under `experiments/configs`, whose files are all `@idem/sim` configs) and the five modes the bench compares.
 * Pure data and pure functions: shared by the orchestrator (host) and the roles (containers).
 */
import { readFileSync } from "node:fs";

/** B0/B2/B3 run over the HTTP overlay (spec 05 §1); N2/N3 are B2/B3's topologies on native NDN. */
export type E4Mode = "B0" | "B2" | "B3" | "N2" | "N3";

export interface ModeInfo {
  binding: "overlay" | "native";
  topology: "star" | "tree";
  /** B0: plain calls relayed by the edge, unsigned results, no cache. */
  plain: boolean;
}

export const MODES: Record<E4Mode, ModeInfo> = {
  B0: { binding: "overlay", topology: "star", plain: true },
  B2: { binding: "overlay", topology: "star", plain: false },
  B3: { binding: "overlay", topology: "tree", plain: false },
  N2: { binding: "native", topology: "star", plain: false },
  N3: { binding: "native", topology: "tree", plain: false },
};

export interface E4Config {
  experiment: string;
  kind: "emulation";
  title: string;
  description: string;
  seeds: { first: number; count: number };
  modes: E4Mode[];
  /** Loss on every link, each direction, in percent. */
  lossPct: number[];
  workload: {
    agents: number;
    callsPerAgent: number;
    catalogSize: number;
    zipfAlpha: number;
    overlap: number;
    thinkTimeMs: number;
    surfaceVariation: number;
  };
  /** One-way delays (applied at both ends' egress) and an optional rate per interface. */
  links: {
    agentMs: number;
    starProducerMs: number;
    treeCoreMs: number;
    treeProducerMs: number;
    rateMbit: number | null;
  };
  producer: {
    serviceMedianMs: number;
    serviceSigma: number;
    ttlMs: number;
    pageBytesMedian: number;
    pageBytesSigma: number;
    pageBytesMin: number;
    pageBytesMax: number;
  };
  overlay: { csMaxBytes: number; callTimeoutMs: number };
  native: { interestLifetimeMs: number; retransmissions: number };
  /** A run whose agents saw a timer fire later than this (a frozen host) is discarded and repeated. */
  guard: { maxTimerGapMs: number; retries: number };
}

export function loadConfig(path: string): E4Config {
  const cfg = JSON.parse(readFileSync(path, "utf8")) as E4Config;
  if (cfg.kind !== "emulation") throw new Error(`${path}: kind must be "emulation"`);
  for (const m of cfg.modes) if (!(m in MODES)) throw new Error(`${path}: unknown mode ${m}`);
  return cfg;
}

export interface RunKey {
  mode: E4Mode;
  lossPct: number;
  seed: number;
}

/** Seeds of a config, in order. */
export function seedsOf(cfg: E4Config): number[] {
  return Array.from({ length: cfg.seeds.count }, (_, i) => cfg.seeds.first + i);
}

/**
 * Every run of a config, in execution order: seed, then loss, then mode. The modes of one (seed,
 * loss) cell run back to back, so a slow drift of the host affects every mode alike.
 */
export function runPlan(cfg: E4Config): RunKey[] {
  const out: RunKey[] = [];
  for (const seed of seedsOf(cfg))
    for (const lossPct of cfg.lossPct) for (const mode of cfg.modes) out.push({ mode, lossPct, seed });
  return out;
}

/** `B2-loss1-seed3`: the key of one run in file names and CSV rows. */
export function runLabel(k: RunKey): string {
  return `${k.mode}-loss${k.lossPct}-seed${k.seed}`;
}
