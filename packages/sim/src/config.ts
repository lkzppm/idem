import type { ReplacementPolicy } from "@idem/core";
import type { ProcessingCosts } from "./processing";

/** Node of a simulated topology. */
export interface SimNode {
  id: string;
  kind: "agent" | "forwarder" | "producer";
}

/** Bidirectional link. Latency is one-way. */
export interface SimLinkConfig {
  a: string;
  b: string;
  latencyMs: number;
  lossPct: number;
  bandwidthMbps?: number;
}

/** Modes compared in the evaluation (05-evaluation §1). */
export type SimMode = "mcp-direct" | "mcp-local-cache" | "idem" | "idem-noverify";

/** One tool call of a trace (05-evaluation §2, W-trace). */
export interface TraceRecord {
  t: number;
  agent: number;
  tool: string;
  args: unknown;
}

/** Synthetic workload W-syn / W-mixed. */
export interface SyntheticWorkload {
  kind: "synthetic";
  agents: number;
  callsPerAgent: number;
  zipfAlpha: number;
  /** Fraction of each agent's `fetch_page` calls drawn from the shared catalog, in [0, 1]. */
  overlap: number;
  catalogSize: number;
  /** Mean think time between an agent's calls (exponential). Default 300 ms. */
  thinkTimeMs?: number;
  /** Probability that a URL is written in an equivalent but different surface form. Default 0.3. */
  surfaceVariation?: number;
  /** Fraction of calls to `my_notes` (private scope). Default 0. */
  privateFraction?: number;
  /** Fraction of calls to `send_email` (not cacheable, bypass). Default 0. */
  sideEffectFraction?: number;
}

/** Replay of recorded calls. */
export interface TraceWorkload {
  kind: "trace";
  records: TraceRecord[];
}

/** Full simulation configuration (03-api, `@idem/sim`). */
export interface SimConfig {
  topology: { nodes: SimNode[]; links: SimLinkConfig[] };
  mode: SimMode;
  workload: SyntheticWorkload | TraceWorkload;
  producer: {
    serviceTimeMs: { dist: "lognormal"; mu: number; sigma: number };
    ttlMs: number;
    /** Median page size in bytes for the synthetic corpus. Default 6 KiB. */
    pageBytesMedian?: number;
    /**
     * In the baseline modes (`mcp-direct`, `mcp-local-cache`), whether the producer still attaches
     * the signed `_meta["dev.idem/data"]` block to plain results. Default `true` (an IDEM-aware
     * producer serving plain MCP clients, protocol §9.1). The evaluation sets `false`: B0 and B1
     * talk to a plain MCP server, so the baseline's bytes carry no IDEM metadata.
     */
    signPlainCalls?: boolean;
  };
  cs: { maxBytes: number; policy: ReplacementPolicy };
  /** Interest lifetime. Default 10 s. */
  interestLifetimeMs?: number;
  /**
   * CPU cost of canonicalize / name / sign / verify, charged as virtual delay in the IDEM modes
   * (the baselines do none of this work and are charged nothing). Absent: these operations take
   * no virtual time. See {@link ProcessingCosts}.
   */
  processing?: ProcessingCosts;
}

/** Parameters of the built-in topology presets. */
export interface TopologyPreset {
  kind: "star" | "tree";
  agents: number;
  /** Agent ↔ edge one-way latency. */
  agentLinkMs: number;
  /** Edge ↔ regional one-way latency (tree only). */
  coreLinkMs?: number;
  /** Last forwarder ↔ producer one-way latency. */
  producerLinkMs: number;
  lossPct?: number;
  bandwidthMbps?: number;
  /** Number of edge forwarders (tree only). Default 2. */
  edges?: number;
}

/**
 * Build a topology: `star` = agents → edge → producer; `tree` = agents → edges → regional →
 * producer. Agents are spread round-robin over edges.
 */
export function buildTopology(p: TopologyPreset): SimConfig["topology"] {
  const loss = p.lossPct ?? 0;
  const bw = p.bandwidthMbps;
  const link = (a: string, b: string, latencyMs: number): SimLinkConfig => ({
    a,
    b,
    latencyMs,
    lossPct: loss,
    ...(bw !== undefined && { bandwidthMbps: bw }),
  });
  const nodes: SimNode[] = [];
  const links: SimLinkConfig[] = [];
  const agents = Array.from({ length: p.agents }, (_, i) => `agent-${i}`);
  for (const id of agents) nodes.push({ id, kind: "agent" });
  nodes.push({ id: "producer", kind: "producer" });
  if (p.kind === "star") {
    nodes.push({ id: "edge", kind: "forwarder" });
    for (const a of agents) links.push(link(a, "edge", p.agentLinkMs));
    links.push(link("edge", "producer", p.producerLinkMs));
  } else {
    const edges = Array.from({ length: Math.max(1, p.edges ?? 2) }, (_, i) => `edge-${i}`);
    for (const e of edges) nodes.push({ id: e, kind: "forwarder" });
    nodes.push({ id: "regional", kind: "forwarder" });
    agents.forEach((a, i) => {
      links.push(link(a, edges[i % edges.length] as string, p.agentLinkMs));
    });
    for (const e of edges) links.push(link(e, "regional", p.coreLinkMs ?? 10));
    links.push(link("regional", "producer", p.producerLinkMs));
  }
  return { nodes, links };
}

/** A reasonable default configuration (used by the sandbox and tests). */
export function defaultConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  return {
    topology: buildTopology({ kind: "star", agents: 8, agentLinkMs: 5, producerLinkMs: 40 }),
    mode: "idem",
    workload: {
      kind: "synthetic",
      agents: 8,
      callsPerAgent: 12,
      zipfAlpha: 0.9,
      overlap: 0.6,
      catalogSize: 40,
      thinkTimeMs: 300,
      surfaceVariation: 0.3,
      privateFraction: 0.05,
      sideEffectFraction: 0.05,
    },
    producer: { serviceTimeMs: { dist: "lognormal", mu: Math.log(150), sigma: 0.5 }, ttlMs: 60_000 },
    cs: { maxBytes: 8 * 1024 * 1024, policy: "lru" },
    ...overrides,
  };
}
