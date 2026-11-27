import { assertProducer } from "@idem/core";
import { type Dist, SIM_PRODUCER, type SimConfig, type ToolId } from "./config";
import { isToolId, toolInfo } from "./tools";

/** Error codes of the simulator's own checks. */
export type SimErrorCode = "BAD_CONFIG";

/** A configuration the simulator cannot run. `path` points at the offending field. */
export class SimConfigError extends Error {
  readonly code: SimErrorCode = "BAD_CONFIG";
  readonly path: string;

  constructor(path: string, why: string) {
    super(`BAD_CONFIG: ${path} ${why}`);
    this.name = "SimConfigError";
    this.path = path;
  }
}

/** A producer as the simulator runs it: defaults filled in. */
export interface ResolvedProducer {
  node: string;
  name: string;
  tools: { tool: ToolId; ttlMs: number }[];
  serviceTimeMs: Dist;
  maxResultBytes: number;
  /** True for the producer implied by a configuration without `producers`. */
  implicit: boolean;
}

/** Default bound on a generated result text, bytes. */
export const DEFAULT_MAX_RESULT_BYTES = 64 * 1024;

function finite(v: unknown, path: string, opts: { min?: number; max?: number; int?: boolean } = {}): void {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new SimConfigError(path, "must be a finite number");
  if (opts.int && !Number.isInteger(v)) throw new SimConfigError(path, "must be an integer");
  if (opts.min !== undefined && v < opts.min) throw new SimConfigError(path, `must be ≥ ${opts.min}`);
  if (opts.max !== undefined && v > opts.max) throw new SimConfigError(path, `must be ≤ ${opts.max}`);
}

/**
 * Check a configuration and return its producers with defaults filled in. Throws
 * {@link SimConfigError} on the first problem: unknown or duplicate nodes, links to nowhere,
 * producers on non-producer nodes, duplicate or invalid producer names, unknown tools, agent plans
 * that call a tool their producer does not serve. Reachability is not an error: a call to a
 * producer the agent cannot reach fails at run time with `error: "NO_ROUTE"`.
 */
export function validateConfig(cfg: SimConfig): ResolvedProducer[] {
  const kind = new Map<string, string>();
  cfg.topology.nodes.forEach((n, i) => {
    if (typeof n.id !== "string" || n.id.length === 0)
      throw new SimConfigError(`topology.nodes[${i}].id`, "must be a non-empty string");
    if (kind.has(n.id)) throw new SimConfigError(`topology.nodes[${i}].id`, `duplicates "${n.id}"`);
    if (n.kind !== "agent" && n.kind !== "forwarder" && n.kind !== "producer")
      throw new SimConfigError(`topology.nodes[${i}].kind`, "must be agent, forwarder or producer");
    if (n.csMaxBytes !== undefined) {
      if (n.kind !== "forwarder")
        throw new SimConfigError(`topology.nodes[${i}].csMaxBytes`, "applies to forwarders only");
      finite(n.csMaxBytes, `topology.nodes[${i}].csMaxBytes`, { min: 0, int: true });
    }
    kind.set(n.id, n.kind);
  });
  cfg.topology.links.forEach((l, i) => {
    for (const end of ["a", "b"] as const) {
      if (!kind.has(l[end]))
        throw new SimConfigError(`topology.links[${i}].${end}`, `unknown node "${l[end]}"`);
    }
    if (l.a === l.b) throw new SimConfigError(`topology.links[${i}]`, "links a node to itself");
    finite(l.latencyMs, `topology.links[${i}].latencyMs`, { min: 0 });
    finite(l.lossPct, `topology.links[${i}].lossPct`, { min: 0, max: 100 });
  });

  const producers = resolveProducers(cfg, kind);
  const byName = new Map(producers.map((p) => [p.name, p]));

  const w = cfg.workload;
  if (w.kind === "synthetic") {
    if (w.burst !== undefined) {
      finite(w.burst.size, "workload.burst.size", { min: 1, int: true });
      if (w.burst.parallel !== undefined && typeof w.burst.parallel !== "boolean")
        throw new SimConfigError("workload.burst.parallel", "must be a boolean");
    }
    if (w.startSpreadMs !== undefined) finite(w.startSpreadMs, "workload.startSpreadMs", { min: 0 });
  } else if (w.kind === "trace") {
    w.records.forEach((r, i) => {
      if (r.producer !== undefined && !byName.has(r.producer))
        throw new SimConfigError(`workload.records[${i}].producer`, `unknown producer "${r.producer}"`);
    });
  } else if (w.kind === "per-agent") {
    const seen = new Set<string>();
    w.agents.forEach((p, i) => {
      const at = `workload.agents[${i}]`;
      if (kind.get(p.node) !== "agent")
        throw new SimConfigError(`${at}.node`, `"${p.node}" is not an agent node`);
      if (seen.has(p.node)) throw new SimConfigError(`${at}.node`, `duplicates "${p.node}"`);
      seen.add(p.node);
      finite(p.calls, `${at}.calls`, { min: 0, int: true });
      if (p.thinkTimeMs !== undefined) finite(p.thinkTimeMs, `${at}.thinkTimeMs`, { min: 0 });
      if (p.overlap !== undefined) finite(p.overlap, `${at}.overlap`, { min: 0, max: 1 });
      if (p.zipfAlpha !== undefined) finite(p.zipfAlpha, `${at}.zipfAlpha`, { min: 0 });
      if (p.catalogSize !== undefined) finite(p.catalogSize, `${at}.catalogSize`, { min: 1, int: true });
      if (p.surfaceVariation !== undefined)
        finite(p.surfaceVariation, `${at}.surfaceVariation`, { min: 0, max: 1 });
      let total = 0;
      p.mix.forEach((m, j) => {
        const mat = `${at}.mix[${j}]`;
        const prod = byName.get(m.producer);
        if (!prod) throw new SimConfigError(`${mat}.producer`, `unknown producer "${m.producer}"`);
        if (!isToolId(m.tool)) throw new SimConfigError(`${mat}.tool`, `unknown tool "${String(m.tool)}"`);
        if (!prod.tools.some((t) => t.tool === m.tool))
          throw new SimConfigError(`${mat}.tool`, `"${m.producer}" does not serve "${m.tool}"`);
        finite(m.weight, `${mat}.weight`, { min: 0 });
        total += m.weight;
      });
      if (p.calls > 0 && !(total > 0)) throw new SimConfigError(`${at}.mix`, "needs a positive total weight");
    });
  }
  return producers;
}

/** The producers a configuration runs, defaults filled in (see `SimConfig.producers`). */
function resolveProducers(cfg: SimConfig, kind: Map<string, string>): ResolvedProducer[] {
  if (cfg.producers === undefined) {
    const node = cfg.topology.nodes.find((n) => n.kind === "producer")?.id;
    if (node === undefined) throw new SimConfigError("topology", "has no producer");
    return [
      {
        node,
        name: SIM_PRODUCER,
        tools: (["fetch_page", "my_notes", "send_email"] as const).map((tool) => ({
          tool,
          ttlMs: toolInfo(tool).cacheable ? cfg.producer.ttlMs : 0,
        })),
        serviceTimeMs: cfg.producer.serviceTimeMs,
        maxResultBytes: DEFAULT_MAX_RESULT_BYTES,
        implicit: true,
      },
    ];
  }
  const nodes = new Set<string>();
  const names = new Set<string>();
  return cfg.producers.map((p, i) => {
    const at = `producers[${i}]`;
    if (kind.get(p.node) !== "producer")
      throw new SimConfigError(`${at}.node`, `"${p.node}" is not a producer node`);
    if (nodes.has(p.node)) throw new SimConfigError(`${at}.node`, `"${p.node}" already runs a producer`);
    nodes.add(p.node);
    try {
      assertProducer(p.name);
    } catch {
      throw new SimConfigError(`${at}.name`, `"${p.name}" is not a lowercase host[:port]`);
    }
    if (names.has(p.name)) throw new SimConfigError(`${at}.name`, `duplicates "${p.name}"`);
    names.add(p.name);
    const tools = new Set<ToolId>();
    p.tools.forEach((t, j) => {
      if (!isToolId(t.tool))
        throw new SimConfigError(`${at}.tools[${j}].tool`, `unknown tool "${String(t.tool)}"`);
      if (tools.has(t.tool)) throw new SimConfigError(`${at}.tools[${j}].tool`, `duplicates "${t.tool}"`);
      tools.add(t.tool);
      if (t.ttlMs !== undefined) finite(t.ttlMs, `${at}.tools[${j}].ttlMs`, { min: 0 });
    });
    if (p.maxResultBytes !== undefined)
      finite(p.maxResultBytes, `${at}.maxResultBytes`, { min: 1, int: true });
    return {
      node: p.node,
      name: p.name,
      tools: p.tools.map((t) => ({
        tool: t.tool,
        ttlMs: toolInfo(t.tool).cacheable ? (t.ttlMs ?? toolInfo(t.tool).ttlMs) : 0,
      })),
      serviceTimeMs: p.serviceTimeMs ?? cfg.producer.serviceTimeMs,
      maxResultBytes: p.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES,
      implicit: false,
    };
  });
}
