import { describe, expect, it } from "vitest";
import { buildTopology, defaultConfig, type SimConfig, type SyntheticWorkload } from "./config";
import { type CallRecord, Simulation } from "./simulation";

/** W-code (ADR-037): calls issued by code in steps (`burst`), agents started within `startSpreadMs`. */

function cfg(
  mode: SimConfig["mode"],
  w: Partial<SyntheticWorkload> = {},
  extra: Partial<SimConfig> = {},
): SimConfig {
  const base = defaultConfig({ mode, producer: { ...defaultConfig().producer, signPlainCalls: false } });
  return {
    ...base,
    workload: { ...(base.workload as SyntheticWorkload), agents: 6, callsPerAgent: 12, ...w },
    topology: buildTopology({ kind: "star", agents: 6, agentLinkMs: 5, producerLinkMs: 40 }),
    ...extra,
  };
}

async function run(c: SimConfig, seed = 5): Promise<{ sim: Simulation; calls: CallRecord[] }> {
  const calls: CallRecord[] = [];
  const sim = await Simulation.create(c, { seed, onCall: (r) => calls.push(r) });
  await sim.run();
  return { sim, calls };
}

const MODES = ["mcp-direct", "mcp-local-cache", "mcp-gateway-cache", "idem", "idem-noverify"] as const;

describe("W-code: bursts of calls issued by code (ADR-037)", () => {
  it("one call per step and a start window equal to the think time are today's workload, draw for draw", async () => {
    for (const mode of MODES) {
      const today = await run(cfg(mode));
      const one = await run(cfg(mode, { burst: { size: 1, parallel: true } }));
      const spread = await run(cfg(mode, { startSpreadMs: 300 }));
      expect(one.calls, mode).toEqual(today.calls);
      expect(spread.calls, mode).toEqual(today.calls);
      expect(one.sim.result().metrics, mode).toEqual(today.sim.result().metrics);
    }
  });

  it("issues a step's calls at the same instant and thinks only after the last one ends", async () => {
    const { calls } = await run(cfg("idem", { burst: { size: 4, parallel: true } }));
    expect(calls).toHaveLength(72);
    const mine = calls.filter((c) => c.agent === "agent-0").sort((a, b) => a.t0 - b.t0);
    expect(mine).toHaveLength(12);
    for (let s = 0; s < 3; s++) {
      const step = mine.slice(4 * s, 4 * s + 4);
      expect(new Set(step.map((c) => c.t0)).size, `step ${s}`).toBe(1);
      const next = mine[4 * s + 4];
      if (next) expect(next.t0).toBeGreaterThanOrEqual(Math.max(...step.map((c) => c.t1)));
    }
  });

  it("issues a sequential step back to back, with no think time inside the step", async () => {
    const { calls } = await run(cfg("mcp-direct", { burst: { size: 3, parallel: false } }));
    const mine = calls.filter((c) => c.agent === "agent-1").sort((a, b) => a.t0 - b.t0);
    for (let s = 0; s < 4; s++) {
      for (let i = 1; i < 3; i++) {
        expect((mine[3 * s + i] as CallRecord).t0).toBe((mine[3 * s + i - 1] as CallRecord).t1);
      }
    }
  });

  it("starts every agent at the same instant with startSpreadMs 0, and within the window otherwise", async () => {
    const first = (calls: CallRecord[]) =>
      [...new Set(calls.map((c) => c.agent))].map((a) =>
        Math.min(...calls.filter((c) => c.agent === a).map((c) => c.t0)),
      );
    expect(new Set(first((await run(cfg("idem", { startSpreadMs: 0 }))).calls))).toEqual(new Set([0]));
    for (const t of first((await run(cfg("idem", { startSpreadMs: 50 }))).calls)) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(50);
    }
  });

  it("keeps private scope, the [P-5.5] retry and every call's outcome intact for concurrent calls of one agent", async () => {
    const w = {
      burst: { size: 6, parallel: true },
      startSpreadMs: 0,
      privateFraction: 0.4,
      sideEffectFraction: 0.1,
    };
    for (const mode of MODES) {
      const { sim } = await run(cfg(mode, w));
      const m = sim.result().metrics;
      expect(m.calls, mode).toBe(72);
      expect(m.failed, mode).toBe(0);
      expect(m.safetyViolations, mode).toBe(0);
      expect(m.staleServes, mode).toBe(0);
    }
    // A tampered Data in the middle of a burst: rejected at the edge, its waiters retry as plain calls.
    const sim = await Simulation.create(cfg("idem", w), { seed: 5 });
    await sim.runUntil(1);
    sim.attackTamper();
    await sim.attackPrivateProbe(0, 1);
    await sim.run();
    for (const a of sim.attacks) expect(a.rejected, `${a.kind}: ${a.detail}`).toBe(true);
    const m = sim.result().metrics;
    expect(m.safetyViolations).toBe(0);
    expect(m.failed).toBe(0);
  });

  it("gives the PIT identical calls in flight, which B5 sends upstream [H6]", async () => {
    const w = { burst: { size: 12, parallel: true }, startSpreadMs: 0, surfaceVariation: 0, overlap: 1 };
    const idem = (await run(cfg("idem", w))).sim.result().metrics;
    const b5 = (await run(cfg("mcp-gateway-cache", w))).sim.result().metrics;
    expect(idem.pitAggregations).toBeGreaterThan(0);
    expect(b5.gatewayInflightDuplicates).toBeGreaterThan(0);
    expect(idem.upstreamCalls).toBeLessThan(b5.upstreamCalls);
  });

  it("rejects a bad burst or start window", async () => {
    await expect(Simulation.create(cfg("idem", { burst: { size: 0 } }), { seed: 1 })).rejects.toThrow(
      /workload.burst.size/,
    );
    await expect(Simulation.create(cfg("idem", { startSpreadMs: -1 }), { seed: 1 })).rejects.toThrow(
      /workload.startSpreadMs/,
    );
  });
});
