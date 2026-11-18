import type { ResultsData, Stat } from "@idem/sim";
import { significantly, statAt } from "./data";

/** How the data leaves a hypothesis of spec 00 §6. */
export type VerdictStatus = "supported" | "partly" | "refuted" | "not-evaluated";

/**
 * The verdicts are computed from the committed results, never written by hand: if a rerun changes
 * the numbers, the page changes its conclusions with them. The rules are spelled out per field.
 */
export interface Verdicts {
  h1: {
    status: VerdictStatus;
    /** Points of the agents and overlap sweeps where agents share something (≥ 2 agents, overlap > 0). */
    sharedPoints: number;
    /** Of those, where B2's reduction against B0 / against B1 has a 95% interval above zero. */
    aboveB0: number;
    aboveB1: number;
    base?: { agents: number; vsB0: Stat; vsB1: Stat; b1: Stat; oracle: Stat };
    largest?: { agents: number; vsB0: Stat; vsB1: Stat };
    /** B2 against B1 with a single agent, and with no overlap: nothing to share. */
    alone?: Stat;
    noOverlap?: Stat;
  };
  h2: {
    status: VerdictStatus;
    /** Points with ≥ 2 agents in the agents sweep, and where p50 / p95 drop with a 95% interval below zero. */
    points: number;
    p50Below: number;
    p95Below: number;
    p99Below: number;
    base?: { agents: number; p50: Stat; p95: Stat; p99: Stat };
    /** B2's median latency against B0 with no overlap: the price of the crypto path alone. */
    noOverlapP50?: Stat;
    /** CPU per miss as a share of the round trip to the producer. */
    overheadShare?: number;
    overheadUs?: number;
  };
  h3: {
    status: VerdictStatus;
    /** Trials in which tampered, forged or wrongly keyed Data was accepted. */
    integrityAccepted: number;
    integrityTrials: number;
    integrityVariants: number;
    /** Trials in which a private result reached another context. */
    privateAccepted: number;
    privateTrials: number;
    privateVariants: number;
    privateLeakingVariants: string[];
  };
  e5: {
    variants: number;
    /** Variants the protocol claims to stop, and those stopped in every trial. */
    expectedRejected: number;
    allRejected: number;
    /** Variants expected to be rejected that were accepted at least once. */
    findings: string[];
    /** Variants the specification documents as limits or accepted risks of v1: measured, not claimed. */
    declared: string[];
  } | null;
}

export function computeVerdicts(data: ResultsData): Verdicts {
  const agents = data.sweeps["e2-agents"];
  const overlap = data.sweeps["e2-overlap"];

  // ---- H1: fewer calls reach the producer than with direct MCP and than with a local cache.
  const h1: Verdicts["h1"] = { status: "not-evaluated", sharedPoints: 0, aboveB0: 0, aboveB1: 0 };
  const shared: { vsB0?: Stat; vsB1?: Stat }[] = [];
  if (agents) {
    for (const v of agents.values.filter((x) => x >= 2)) {
      const vsB0 = statAt(agents, "upstream_reduction", "B2", v);
      const vsB1 = statAt(agents, "upstream_reduction_vs_b1", "B2", v);
      shared.push({ ...(vsB0 && { vsB0 }), ...(vsB1 && { vsB1 }) });
    }
    const b = agents.baseValue;
    const vsB0 = statAt(agents, "upstream_reduction", "B2", b);
    const vsB1 = statAt(agents, "upstream_reduction_vs_b1", "B2", b);
    const b1 = statAt(agents, "upstream_reduction", "B1", b);
    const oracle = statAt(agents, "oracle_reduction", "B2", b);
    if (vsB0 && vsB1 && b1 && oracle) h1.base = { agents: b, vsB0, vsB1, b1, oracle };
    const top = Math.max(...agents.values);
    const topB0 = statAt(agents, "upstream_reduction", "B2", top);
    const topB1 = statAt(agents, "upstream_reduction_vs_b1", "B2", top);
    if (topB0 && topB1) h1.largest = { agents: top, vsB0: topB0, vsB1: topB1 };
    const alone = statAt(agents, "upstream_reduction_vs_b1", "B2", 1);
    if (alone) h1.alone = alone;
  }
  if (overlap) {
    for (const v of overlap.values.filter((x) => x > 0)) {
      const vsB0 = statAt(overlap, "upstream_reduction", "B2", v);
      const vsB1 = statAt(overlap, "upstream_reduction_vs_b1", "B2", v);
      shared.push({ ...(vsB0 && { vsB0 }), ...(vsB1 && { vsB1 }) });
    }
    const none = statAt(overlap, "upstream_reduction_vs_b1", "B2", 0);
    if (none) h1.noOverlap = none;
  }
  h1.sharedPoints = shared.length;
  h1.aboveB0 = shared.filter((p) => significantly(p.vsB0, "above")).length;
  h1.aboveB1 = shared.filter((p) => significantly(p.vsB1, "above")).length;
  if (shared.length > 0) {
    h1.status =
      h1.aboveB0 === shared.length && h1.aboveB1 === shared.length
        ? "supported"
        : h1.aboveB0 > 0 || h1.aboveB1 > 0
          ? "partly"
          : "refuted";
  }

  // ---- H2: p50 and p95 drop; the extra cost on a miss is small against the round trip.
  const h2: Verdicts["h2"] = { status: "not-evaluated", points: 0, p50Below: 0, p95Below: 0, p99Below: 0 };
  if (agents) {
    const points = agents.values.filter((x) => x >= 2);
    h2.points = points.length;
    const below = (metric: string) =>
      points.filter((v) => significantly(statAt(agents, metric, "B2", v), "below")).length;
    h2.p50Below = below("latency_p50_vs_b0_ms");
    h2.p95Below = below("latency_p95_vs_b0_ms");
    h2.p99Below = below("latency_p99_vs_b0_ms");
    const b = agents.baseValue;
    const p50 = statAt(agents, "latency_p50_vs_b0_ms", "B2", b);
    const p95 = statAt(agents, "latency_p95_vs_b0_ms", "B2", b);
    const p99 = statAt(agents, "latency_p99_vs_b0_ms", "B2", b);
    if (p50 && p95 && p99) h2.base = { agents: b, p50, p95, p99 };
    if (points.length > 0) {
      h2.status =
        h2.p50Below === points.length && h2.p95Below === points.length
          ? "supported"
          : h2.p50Below > 0 || h2.p95Below > 0
            ? "partly"
            : "refuted";
    }
  }
  if (overlap) {
    const none = statAt(overlap, "latency_p50_vs_b0_ms", "B2", 0);
    if (none) h2.noOverlapP50 = none;
  }
  if (data.missOverhead) {
    h2.overheadUs = data.missOverhead.totalUs;
    h2.overheadShare = data.missOverhead.totalUs / (data.missOverhead.roundTripMs * 1000);
  }

  // ---- H3: no tampered response accepted, no private result served to another context.
  const h3: Verdicts["h3"] = {
    status: "not-evaluated",
    integrityAccepted: 0,
    integrityTrials: 0,
    integrityVariants: 0,
    privateAccepted: 0,
    privateTrials: 0,
    privateVariants: 0,
    privateLeakingVariants: [],
  };
  let e5: Verdicts["e5"] = null;
  if (data.e5) {
    const rows = data.e5.rows;
    const integrity = rows.filter(
      (r) => r.attack === "tamper" || r.attack === "forge" || r.attack === "poison",
    );
    const priv = rows.filter((r) => r.attack === "private");
    h3.integrityVariants = integrity.length;
    h3.integrityTrials = integrity.reduce((n, r) => n + r.trials, 0);
    h3.integrityAccepted = integrity.reduce((n, r) => n + r.accepted, 0);
    h3.privateVariants = priv.length;
    h3.privateTrials = priv.reduce((n, r) => n + r.trials, 0);
    h3.privateAccepted = priv.reduce((n, r) => n + r.accepted, 0);
    h3.privateLeakingVariants = priv.filter((r) => r.accepted > 0).map((r) => r.variant);
    h3.status =
      h3.integrityAccepted === 0 && h3.privateAccepted === 0
        ? "supported"
        : h3.integrityAccepted === 0 || h3.privateAccepted === 0
          ? "partly"
          : "refuted";
    const expected = rows.filter((r) => r.expected === "rejected");
    e5 = {
      variants: rows.length,
      expectedRejected: expected.length,
      allRejected: expected.filter((r) => r.accepted === 0).length,
      findings: expected.filter((r) => r.accepted > 0).map((r) => r.variant),
      declared: rows.filter((r) => r.expected !== "rejected").map((r) => r.variant),
    };
  }
  return { h1, h2, h3, e5 };
}
