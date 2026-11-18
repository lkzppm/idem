import type { EmulationData, EmulationModeId, NfdData, NfdRunData, Stat } from "@idem/sim";

/**
 * What the native-NDN section says in one line, computed from the exported runs and never typed.
 * Pure functions over `ResultsData`, so they are tested with small fixtures.
 */

/** The statistic of an E4 metric for a mode at the loss level with index `i`, if the run has one. */
export function e4At(e4: EmulationData, metric: string, mode: EmulationModeId, i: number): Stat | undefined {
  const s = e4.metrics[metric]?.[mode]?.[i];
  return s && s.n > 0 ? s : undefined;
}

/** One mode's headline numbers at one loss level. */
export interface E4Cell {
  success?: Stat;
  p50?: Stat;
  p95?: Stat;
  bytes?: Stat;
}

/**
 * The native star (N2) against the overlay star (B2), the same topology on the two bindings, at the
 * highest loss the run covers. `undefined` when the run did not include both.
 */
export interface E4Reading {
  loss: number;
  lossIndex: number;
  n2: E4Cell;
  b2: E4Cell;
}

export function e4Reading(e4: EmulationData): E4Reading | undefined {
  const lossIndex = e4.lossPct.length - 1;
  const loss = e4.lossPct[lossIndex];
  if (loss === undefined) return undefined;
  const ids = e4.modes.map((m) => m.id);
  if (!ids.includes("N2") || !ids.includes("B2")) return undefined;
  const cell = (mode: EmulationModeId): E4Cell => {
    const out: E4Cell = {};
    const success = e4At(e4, "success_ratio", mode, lossIndex);
    const p50 = e4At(e4, "latency_p50_ms", mode, lossIndex);
    const p95 = e4At(e4, "latency_p95_ms", mode, lossIndex);
    const bytes = e4At(e4, "producer_link_bytes", mode, lossIndex);
    if (success) out.success = success;
    if (p50) out.p50 = p50;
    if (p95) out.p95 = p95;
    if (bytes) out.bytes = bytes;
    return out;
  };
  const n2 = cell("N2");
  const b2 = cell("B2");
  if (!n2.success || !b2.success) return undefined;
  return { loss, lossIndex, n2, b2 };
}

/** The NFD conformance check: the latest run, the run before it, and what stopped on an error. */
export interface NfdReading {
  latest: NfdRunData;
  previous?: NfdRunData;
  /** Scenarios of the latest run that stopped on an error before finishing their checks. */
  stopped: string[];
  /** Scenarios of the latest run with at least one check that failed. */
  failing: string[];
}

export function nfdReading(nfd: NfdData | null): NfdReading | undefined {
  const latest = nfd?.runs[nfd.runs.length - 1];
  if (!nfd || !latest) return undefined;
  const previous = nfd.runs[nfd.runs.length - 2];
  return {
    latest,
    ...(previous && { previous }),
    stopped: latest.scenarios.filter((s) => s.error !== undefined).map((s) => s.id),
    failing: latest.scenarios.filter((s) => s.error === undefined && !s.pass).map((s) => s.id),
  };
}
