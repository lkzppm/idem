import type { JsonValue } from "@idem/core";
import type { AgentPlan, SimConfig, ToolId, TraceRecord } from "./config";
import { type Rng, Zipf } from "./rng";
import { CITIES, docUrl, SEARCH_QUERIES, searchArgs, weatherArgs } from "./tools";

/** One call of an agent's plan. */
export interface PlannedCall {
  /** Producer *name*; absent means the first producer. */
  producer?: string;
  tool: string;
  args: JsonValue;
  /** Absolute start time (trace replay) or undefined (think-time driven). */
  at?: number;
}

/** Defaults of an {@link AgentPlan}. */
export const AGENT_PLAN_DEFAULTS = {
  thinkTimeMs: 300,
  overlap: 0.6,
  zipfAlpha: 0.9,
  catalogSize: 40,
  surfaceVariation: 0.3,
} as const;

/**
 * Expand the workload into per-agent call plans (deterministic for a seed). Synthetic and trace
 * workloads give one plan per agent index; a per-agent workload gives one plan per entry of
 * `workload.agents`, in that order.
 */
export function planWorkload(cfg: SimConfig, rng: Rng): PlannedCall[][] {
  const w = cfg.workload;
  if (w.kind === "trace") {
    const agents = Math.max(0, ...w.records.map((r: TraceRecord) => r.agent + 1));
    const plans: PlannedCall[][] = Array.from({ length: agents }, () => []);
    for (const r of [...w.records].sort((a, b) => a.t - b.t)) {
      plans[r.agent]?.push({
        ...(r.producer !== undefined && { producer: r.producer }),
        tool: r.tool,
        args: r.args as JsonValue,
        at: r.t,
      });
    }
    return plans;
  }
  if (w.kind === "per-agent") return planPerAgent(w.agents, rng);
  const zipf = new Zipf(Math.max(1, w.catalogSize), w.zipfAlpha);
  const variation = w.surfaceVariation ?? 0.3;
  return Array.from({ length: w.agents }, (_, a) => {
    const r = rng.fork(`plan-${a}`);
    return Array.from({ length: w.callsPerAgent }, (_, k): PlannedCall => {
      const u = r.next();
      if (u < (w.sideEffectFraction ?? 0)) {
        return { tool: "send_email", args: { to: `team-${r.int(4)}@example.com`, body: `update ${a}.${k}` } };
      }
      if (u < (w.sideEffectFraction ?? 0) + (w.privateFraction ?? 0)) return { tool: "my_notes", args: {} };
      const shared = r.chance(w.overlap);
      // Private pool: documents only this agent ever asks for.
      const doc = shared ? zipf.sample(r) : w.catalogSize + a * w.callsPerAgent + k;
      return { tool: "fetch_page", args: { url: docUrl(doc, r, variation) } };
    });
  });
}

function planPerAgent(agents: readonly AgentPlan[], rng: Rng): PlannedCall[][] {
  // Documents past every agent's shared catalog, so no agent's private pool meets another's.
  let privateBase = Math.max(0, ...agents.map((p) => p.catalogSize ?? AGENT_PLAN_DEFAULTS.catalogSize));
  return agents.map((p) => {
    const r = rng.fork(`plan-${p.node}`);
    const d = { ...AGENT_PLAN_DEFAULTS, ...definedOnly(p) };
    const pages = new Zipf(Math.max(1, d.catalogSize), d.zipfAlpha);
    const queries = new Zipf(SEARCH_QUERIES.length, d.zipfAlpha);
    const cities = new Zipf(CITIES.length, d.zipfAlpha);
    const total = p.mix.reduce((s, m) => s + Math.max(0, m.weight), 0);
    const base = privateBase;
    privateBase += p.calls;
    const plan = Array.from({ length: total > 0 ? p.calls : 0 }, (_, k): PlannedCall => {
      let u = r.next() * total;
      let entry = p.mix[p.mix.length - 1] as AgentPlan["mix"][number];
      for (const m of p.mix) {
        const wgt = Math.max(0, m.weight);
        if (wgt > 0 && u < wgt) {
          entry = m;
          break;
        }
        u -= wgt;
      }
      return { producer: entry.producer, tool: entry.tool, args: argsFor(entry.tool, k) };
    });
    return plan;

    function argsFor(tool: ToolId, k: number): JsonValue {
      switch (tool) {
        case "fetch_page": {
          const doc = r.chance(d.overlap) ? pages.sample(r) : base + k;
          return { url: docUrl(doc, r, d.surfaceVariation) };
        }
        case "search_corpus":
          return searchArgs(SEARCH_QUERIES[queries.sample(r)] as string, r, d.surfaceVariation);
        case "weather":
          return weatherArgs(CITIES[cities.sample(r)] as string, r, d.surfaceVariation);
        case "my_notes":
          return {};
        case "send_email":
          return { to: `team-${r.int(4)}@example.com`, body: `update ${p.node}.${k}` };
      }
    }
  });
}

function definedOnly<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
