import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./node-io";
import {
  applyParam,
  EVAL_MODE_IDS,
  EVAL_MODES,
  parseExperimentConfig,
  parseProcessingCosts,
  type SweepConfig,
  simConfigFor,
} from "./spec";

const CONFIGS = join(repoRoot(), "experiments", "configs");
const read = (name: string): unknown => JSON.parse(readFileSync(join(CONFIGS, name), "utf8"));
const sweep = () => parseExperimentConfig(read("e2-agents.json")) as SweepConfig;

describe("experiment configs", () => {
  it("names the six modes of spec 05 §1", () => {
    expect(EVAL_MODE_IDS).toEqual(["B0", "B1", "B2", "B3", "B4", "B5"]);
    expect(EVAL_MODE_IDS.map((m) => EVAL_MODES[m].name)).toEqual([
      "mcp-direct",
      "mcp-local-cache",
      "idem",
      "idem-tree",
      "idem-noverify",
      "mcp-gateway-cache",
    ]);
  });

  it("accepts every committed config", () => {
    const files = readdirSync(CONFIGS).filter((f) => f.endsWith(".json") && f !== "processing.json");
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const f of files) {
      const cfg = parseExperimentConfig(read(f));
      expect(`${cfg.experiment}.json`, f).toBe(f);
      if (cfg.kind === "sweep") {
        // Spec 05: at least 10 seeds per point.
        expect(cfg.seeds.count, f).toBeGreaterThanOrEqual(10);
        expect(cfg.modes, f).toContain("B0");
      }
    }
  });

  it("reports the path of the first bad field", () => {
    const good = read("e2-agents.json") as Record<string, unknown>;
    const bad = (patch: Record<string, unknown>) => () => parseExperimentConfig({ ...good, ...patch });
    expect(bad({ experiment: "E2 Agents" })).toThrow(/experiment/);
    expect(bad({ kind: "magic" })).toThrow(/kind/);
    expect(bad({ modes: ["B0", "B9"] })).toThrow(/modes\[1\]/);
    expect(bad({ modes: ["B0", "B0"] })).toThrow(/repeat/);
    expect(bad({ seeds: { first: 1, count: 0 } })).toThrow(/seeds.count/);
    expect(bad({ sweep: { param: "weather", values: [1] } })).toThrow(/sweep.param/);
    expect(bad({ sweep: { param: "overlap", values: [0.5, 1.5] } })).toThrow(/overlap = 1.5/);
    expect(bad({ sweep: { param: "agents", values: [1, 1] } })).toThrow(/repeat/);
    expect(bad({ base: { ...(good.base as object), cs: { maxBytes: 1, policy: "random" } } })).toThrow(
      /policy/,
    );
    expect(bad({ processing: { sizesBytes: [1], canonicalizeUs: [1], nameUs: [1], signUs: [1] } })).toThrow(
      /verifyUs/,
    );
    expect(() => parseExperimentConfig({ ...(read("e1-node.json") as object), iterations: [10] })).toThrow(
      /iterations/,
    );
    expect(() => parseExperimentConfig({ ...(read("e1-node.json") as object), ops: ["hash"] })).toThrow(
      /ops\[0\]/,
    );
    expect(() => parseExperimentConfig({ ...(read("e5-safety.json") as object), trials: 0 })).toThrow(
      /trials/,
    );
    expect(() => parseExperimentConfig(null)).toThrow(/object/);
  });

  it("reads a cost table and ignores its provenance fields", () => {
    const table = {
      sizesBytes: [1, 2],
      canonicalizeUs: [1, 2],
      nameUs: [1, 2],
      signUs: [1, 2],
      verifyUs: [1, 2],
    };
    expect(parseProcessingCosts({ ...table, source: { experiment: "e1-node" } })).toEqual(table);
    expect(() => parseProcessingCosts("processing.json")).toThrow(/cost table/);
    expect(() => parseProcessingCosts(undefined)).toThrow(/cost table/);
  });

  it("sets one parameter without touching the base", () => {
    const { base } = sweep();
    expect(applyParam(base, "agents", 32).workload.agents).toBe(32);
    expect(applyParam(base, "ttlMs", 1000).producer.ttlMs).toBe(1000);
    expect(applyParam(base, "csMaxBytes", 0).cs.maxBytes).toBe(0);
    expect(applyParam(base, "lossPct", 5).topology.lossPct).toBe(5);
    expect(applyParam(base, "thinkTimeMs", 0).workload.thinkTimeMs).toBe(0);
    expect(applyParam(base, "burstSize", 4).workload.burst).toEqual({ size: 4, parallel: true });
    expect(applyParam(base, "startSpreadMs", 0).workload.startSpreadMs).toBe(0);
    expect(base.workload.burst).toBeUndefined();
    expect(base.workload.startSpreadMs).toBeUndefined();
    expect(() => applyParam(base, "burstSize", 0)).toThrow();
    expect(() => applyParam(base, "startSpreadMs", -1)).toThrow();
    expect(base.workload.agents).toBe(8);
    expect(base.producer.ttlMs).toBe(60_000);
    expect(() => applyParam(base, "agents", 0)).toThrow();
    expect(() => applyParam(base, "agents", 2.5)).toThrow();
    expect(() => applyParam(base, "overlap", -0.1)).toThrow();
    expect(() => applyParam(applyParam(base, "privateFraction", 0.7), "sideEffectFraction", 0.4)).toThrow(
      /≤ 1/,
    );
  });

  it("builds B0, B1, B2, B4 and B5 on the star and B3 on the tree, with the same end-to-end delay", () => {
    const { base } = sweep();
    const oneWay = (mode: (typeof EVAL_MODE_IDS)[number]) => {
      const { topology } = simConfigFor(base, mode);
      const forwarders = topology.nodes.filter((n) => n.kind === "forwarder").map((n) => n.id);
      const hop = (a: string, b: string) =>
        topology.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))?.latencyMs;
      // agent-0 → its edge → (regional →) producer
      const edge = topology.links.find((l) => l.a === "agent-0")?.b as string;
      const direct = hop(edge, "producer");
      const total =
        direct !== undefined
          ? (hop("agent-0", edge) as number) + direct
          : (hop("agent-0", edge) as number) +
            (hop(edge, "regional") as number) +
            (hop("regional", "producer") as number);
      return { forwarders: forwarders.length, total };
    };
    for (const mode of ["B0", "B1", "B2", "B4", "B5"] as const)
      expect(oneWay(mode)).toEqual({ forwarders: 1, total: 45 });
    expect(oneWay("B3")).toEqual({ forwarders: 3, total: 45 });
  });

  it("maps each mode to its engine mode and runs the baselines against a plain MCP server", () => {
    const { base } = sweep();
    expect(EVAL_MODE_IDS.map((m) => simConfigFor(base, m).mode)).toEqual([
      "mcp-direct",
      "mcp-local-cache",
      "idem",
      "idem",
      "idem-noverify",
      "mcp-gateway-cache",
    ]);
    const cfg = simConfigFor(base, "B0");
    expect(simConfigFor(base, "B5").producer.signPlainCalls).toBe(false);
    expect(simConfigFor(base, "B5").processing).toBeUndefined();
    expect(cfg.producer.signPlainCalls).toBe(false);
    expect(cfg.producer.serviceTimeMs.mu).toBeCloseTo(Math.log(150));
    expect(cfg.processing).toBeUndefined();
    const costs = { sizesBytes: [1], canonicalizeUs: [1], nameUs: [1], signUs: [1], verifyUs: [1] };
    expect(simConfigFor(base, "B2", costs).processing).toBe(costs);
    expect(cfg.workload).toMatchObject({ kind: "synthetic", agents: 8, callsPerAgent: 20, overlap: 0.5 });
    // A config without the W-code fields resolves to a workload without them (today's behaviour).
    expect("burst" in cfg.workload || "startSpreadMs" in cfg.workload).toBe(false);
  });

  it("reads the W-code fields of a sweep base and rejects bad ones", () => {
    const good = read("e2-agents.json") as { base: { workload: object } } & Record<string, unknown>;
    const withWorkload = (w: Record<string, unknown>) => ({
      ...good,
      base: { ...good.base, workload: { ...good.base.workload, ...w } },
    });
    const cfg = parseExperimentConfig(
      withWorkload({ burst: { size: 4, parallel: false }, startSpreadMs: 0 }),
    ) as SweepConfig;
    expect(cfg.base.workload.burst).toEqual({ size: 4, parallel: false });
    expect(simConfigFor(cfg.base, "B2").workload).toMatchObject({
      burst: { size: 4, parallel: false },
      startSpreadMs: 0,
    });
    expect(() => parseExperimentConfig(withWorkload({ burst: { size: 0, parallel: true } }))).toThrow(
      /burst.size/,
    );
    expect(() => parseExperimentConfig(withWorkload({ burst: { size: 2 } }))).toThrow(/burst.parallel/);
    expect(() => parseExperimentConfig(withWorkload({ startSpreadMs: -5 }))).toThrow(/startSpreadMs/);
  });
});
