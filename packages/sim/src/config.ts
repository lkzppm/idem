import type { ReplacementPolicy } from "@idem/core";
import type { ProcessingCosts } from "./processing";

/** The producer name of a configuration without `producers` (the demo producer's). */
export const SIM_PRODUCER = "demo.idem.dev";

/** Node of a simulated topology. */
export interface SimNode {
  id: string;
  kind: "agent" | "forwarder" | "producer";
  /** Forwarders only: this node's Content Store size, bytes. Default `SimConfig.cs.maxBytes`. */
  csMaxBytes?: number;
}

/** Bidirectional link. Latency is one-way. */
export interface SimLinkConfig {
  a: string;
  b: string;
  latencyMs: number;
  lossPct: number;
  bandwidthMbps?: number;
}

/**
 * Modes compared in the evaluation (05-evaluation §1). `mcp-gateway-cache` (B5) is plain MCP with
 * a shared, unsigned response cache at each edge, as MCP gateways ship it today (ADR-036).
 */
export type SimMode = "mcp-direct" | "mcp-local-cache" | "mcp-gateway-cache" | "idem" | "idem-noverify";

/** One tool call of a trace (05-evaluation §2, W-trace). */
export interface TraceRecord {
  t: number;
  agent: number;
  tool: string;
  args: unknown;
  /** Producer *name* the call goes to. Default: the first producer (ADR-027). */
  producer?: string;
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
  /**
   * W-code (ADR-037): calls issued by code in steps. Each step issues the next `size` planned calls
   * (all at once if `parallel`, the default, else back to back with no think time), waits for all of
   * them, then thinks (`thinkTimeMs`, the model turn) before the next step. Absent: one call per
   * step, which is the behaviour of every configuration written before this field existed.
   */
  burst?: { size: number; parallel?: boolean };
  /**
   * Agents start uniformly within `[0, startSpreadMs)`; 0 starts them all at the same instant (an
   * orchestrator spawning its sub-agents). Default `thinkTimeMs` (the behaviour before this field
   * existed; the same random draw, scaled).
   */
  startSpreadMs?: number;
}

/** Replay of recorded calls. */
export interface TraceWorkload {
  kind: "trace";
  records: TraceRecord[];
}

/** The tools the simulated producers can serve (see `TOOL_CATALOG`). */
export type ToolId = "fetch_page" | "search_corpus" | "weather" | "my_notes" | "send_email";

/** A service-time distribution, ms. */
export interface Dist {
  dist: "lognormal";
  mu: number;
  sigma: number;
}

/** One tool a producer serves. */
export interface SimToolConfig {
  tool: ToolId;
  /** Manifest TTL. Default: the tool's `TOOL_CATALOG` TTL. Ignored for a non-cacheable tool. */
  ttlMs?: number;
}

/**
 * A producer of the network (ADR-027): the producer-kind node that runs it, the name every one of
 * its Data names carries (`/idem/v1/<name>/…`), and the tools it serves.
 */
export interface SimProducerConfig {
  /** Id of a `kind: "producer"` node of the topology. */
  node: string;
  /** Producer component of the names: a lowercase `host[:port]`, unique in the config. */
  name: string;
  tools: SimToolConfig[];
  /** Tool service time. Default: `SimConfig.producer.serviceTimeMs`. */
  serviceTimeMs?: Dist;
  /** Upper bound on the size of a generated result text, bytes. Default 64 KiB. */
  maxResultBytes?: number;
}

/** One entry of an agent's tool mix: a tool of one producer, drawn with probability ∝ `weight`. */
export interface ToolMixEntry {
  /** Producer *name* (not node id). */
  producer: string;
  tool: ToolId;
  weight: number;
}

/** The calls one agent makes (per-agent workload, ADR-027). */
export interface AgentPlan {
  /** Id of a `kind: "agent"` node. */
  node: string;
  calls: number;
  /** Mean think time between calls (exponential). Default 300 ms. */
  thinkTimeMs?: number;
  mix: ToolMixEntry[];
  /** Fraction of this agent's `fetch_page` calls drawn from the shared catalog, in [0, 1]. Default 0.6. */
  overlap?: number;
  /** Zipf exponent over the shared catalogs (pages, queries, cities). Default 0.9. */
  zipfAlpha?: number;
  /** Number of pages in the shared page catalog. Default 40. */
  catalogSize?: number;
  /** Probability that an argument is written in an equivalent but different surface form. Default 0.3. */
  surfaceVariation?: number;
}

/** A workload given agent by agent, each with its own tool mix over any of the producers. */
export interface PerAgentWorkload {
  kind: "per-agent";
  agents: AgentPlan[];
}

/** Full simulation configuration (03-api, `@idem/sim`). */
export interface SimConfig {
  topology: { nodes: SimNode[]; links: SimLinkConfig[] };
  mode: SimMode;
  workload: SyntheticWorkload | TraceWorkload | PerAgentWorkload;
  /**
   * The producers and their tools (ADR-027). Absent: one producer named `SIM_PRODUCER` on the
   * first producer-kind node, serving `fetch_page`, `my_notes` and `send_email` with
   * `producer.ttlMs` (the behaviour of every configuration written before this field existed).
   */
  producers?: SimProducerConfig[];
  /** Defaults of every producer; `ttlMs` applies only when `producers` is absent. */
  producer: {
    serviceTimeMs: Dist;
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
