import type { Data, Packet } from "@idem/core";
import { describe, expect, it } from "vitest";
import { buildTopology, defaultConfig, type SimConfig } from "./config";
import type { ProcessingCosts } from "./processing";
import { runSimulation, Simulation } from "./simulation";

function small(mode: SimConfig["mode"], extra: Partial<SimConfig> = {}): SimConfig {
  const base = defaultConfig();
  return {
    ...base,
    mode,
    workload: {
      ...(base.workload as Extract<SimConfig["workload"], { kind: "synthetic" }>),
      agents: 6,
      callsPerAgent: 8,
    },
    topology: buildTopology({ kind: "star", agents: 6, agentLinkMs: 5, producerLinkMs: 40 }),
    ...extra,
  };
}

describe("simulation", () => {
  it("is deterministic for a seed", async () => {
    const a = await runSimulation(small("idem"), { seed: 42, keepEvents: true });
    const b = await runSimulation(small("idem"), { seed: 42, keepEvents: true });
    const strip = (r: typeof a) => (r.events ?? []).map((e) => ({ ...e, us: 0 }));
    expect(strip(a)).toEqual(strip(b));
    expect(a.metrics).toEqual(b.metrics);
    const c = await runSimulation(small("idem"), { seed: 43 });
    expect(c.metrics).not.toEqual(a.metrics);
  });

  it("completes every call in every mode without safety violations", async () => {
    for (const mode of ["mcp-direct", "mcp-local-cache", "idem", "idem-noverify"] as const) {
      const r = await runSimulation(small(mode), { seed: 7 });
      expect(r.metrics.calls, mode).toBe(48);
      expect(r.metrics.failed, mode).toBe(0);
      expect(r.metrics.safetyViolations, mode).toBe(0);
      expect(r.metrics.staleServes, mode).toBe(0);
    }
  });

  it("runs a multi-hop tree with loss", async () => {
    const cfg = small("idem", {
      topology: buildTopology({
        kind: "tree",
        agents: 6,
        agentLinkMs: 5,
        coreLinkMs: 10,
        producerLinkMs: 40,
        lossPct: 2,
      }),
    });
    const r = await runSimulation(cfg, { seed: 3 });
    expect(r.metrics.calls).toBe(48);
    expect(r.metrics.safetyViolations).toBe(0);
  });

  it("rejects every injected attack (E5 smoke)", async () => {
    const sim = await Simulation.create(small("idem"), { seed: 11 });
    await sim.runUntil(500);
    sim.attackTamper();
    await sim.attackForge(0);
    await sim.attackPrivateProbe(0, 1);
    await sim.run();
    expect(sim.attacks.map((a) => a.kind).sort()).toEqual(["forge", "private-probe", "tamper"]);
    for (const a of sim.attacks) expect(a.rejected, `${a.kind}: ${a.detail}`).toBe(true);
    expect(sim.attacks.find((a) => a.kind === "tamper")?.detail).toMatch(/signature check failed/);
    expect(sim.result().metrics.safetyViolations).toBe(0);
  });

  // ---- evaluation support (05-evaluation §1–§3)

  const FLAT: ProcessingCosts = {
    sizesBytes: [1024, 1_048_576],
    canonicalizeUs: [0, 0],
    nameUs: [0, 0],
    signUs: [0, 0],
    verifyUs: [0, 0],
  };
  /** W-syn without private or side-effecting calls, against a plain MCP baseline. */
  function wsyn(mode: SimConfig["mode"], extra: Partial<SimConfig> = {}): SimConfig {
    const cfg = small(mode);
    return {
      ...cfg,
      workload: {
        ...(cfg.workload as Extract<SimConfig["workload"], { kind: "synthetic" }>),
        privateFraction: 0,
        sideEffectFraction: 0,
      },
      producer: { ...cfg.producer, signPlainCalls: false },
      ...extra,
    };
  }

  it("plans the same workload for every mode and topology of a seed", async () => {
    const tree = buildTopology({
      kind: "tree",
      agents: 6,
      agentLinkMs: 5,
      coreLinkMs: 10,
      producerLinkMs: 30,
    });
    const stats = [];
    for (const cfg of [
      wsyn("mcp-direct"),
      wsyn("mcp-local-cache"),
      wsyn("idem"),
      wsyn("idem", { topology: tree }),
    ]) {
      const sim = await Simulation.create(cfg, { seed: 5 });
      stats.push(await sim.workloadStats());
    }
    expect(stats[1]).toEqual(stats[0]);
    expect(stats[2]).toEqual(stats[0]);
    expect(stats[3]).toEqual(stats[0]);
    expect(stats[0]?.calls).toBe(48);
    expect(stats[0]?.cacheableCalls).toBe(48);
    expect(stats[0]?.distinctNames).toBeLessThan(48);
  });

  it("counts distinct names: no overlap means no repeats, and private names count once per agent", async () => {
    const base = wsyn("idem");
    const w = base.workload as Extract<SimConfig["workload"], { kind: "synthetic" }>;
    const none = await Simulation.create({ ...base, workload: { ...w, overlap: 0 } }, { seed: 2 });
    expect(await none.workloadStats()).toEqual({
      calls: 48,
      cacheableCalls: 48,
      distinctNames: 48,
      passthroughCalls: 0,
    });
    const priv = await Simulation.create({ ...base, workload: { ...w, privateFraction: 1 } }, { seed: 2 });
    expect((await priv.workloadStats()).distinctNames).toBe(6);
    const side = await Simulation.create({ ...base, workload: { ...w, sideEffectFraction: 1 } }, { seed: 2 });
    expect(await side.workloadStats()).toMatchObject({
      cacheableCalls: 0,
      distinctNames: 0,
      passthroughCalls: 48,
    });
  });

  it("never sends more upstream than there are calls, nor fewer than there are distinct names", async () => {
    for (const mode of ["mcp-direct", "mcp-local-cache", "idem"] as const) {
      const sim = await Simulation.create(wsyn(mode), { seed: 9 });
      const w = await sim.workloadStats();
      const { metrics } = await sim.run();
      expect(metrics.upstreamCalls, mode).toBeLessThanOrEqual(w.calls);
      expect(metrics.upstreamCalls, mode).toBeGreaterThanOrEqual(w.distinctNames);
      if (mode === "mcp-direct") expect(metrics.upstreamCalls).toBe(w.calls);
    }
  });

  it("serves the baselines from a plain MCP server when signPlainCalls is false", async () => {
    const signed = await runSimulation(
      wsyn("mcp-direct", { producer: { ...wsyn("idem").producer, signPlainCalls: true } }),
      { seed: 4 },
    );
    const plain = await runSimulation(wsyn("mcp-direct"), { seed: 4 });
    expect(plain.metrics.upstreamCalls).toBe(signed.metrics.upstreamCalls);
    expect(plain.metrics.latencyMs).toEqual(signed.metrics.latencyMs);
    // 48 results, each without its `_meta["dev.idem/data"]` block.
    expect(plain.metrics.producerLinkBytes).toBeLessThan(signed.metrics.producerLinkBytes - 48 * 200);
  });

  it("charges processing costs as virtual time in the IDEM modes only", async () => {
    const free = await runSimulation(wsyn("idem"), { seed: 6 });
    const zero = await runSimulation(wsyn("idem", { processing: FLAT }), { seed: 6 });
    expect(zero.metrics).toEqual(free.metrics);

    // 1 ms per verification: visible in every answered Interest, absent from the baselines.
    const costly: ProcessingCosts = { ...FLAT, verifyUs: [1000, 1000] };
    const b2 = await runSimulation(wsyn("idem", { processing: costly }), { seed: 6 });
    const b4 = await runSimulation(wsyn("idem-noverify", { processing: costly }), { seed: 6 });
    expect(b2.metrics.upstreamCalls).toBe(free.metrics.upstreamCalls);
    // A hit pays the consumer's verification only; a miss also pays the forwarder's.
    expect(b2.metrics.latencyMs.mean).toBeGreaterThan(free.metrics.latencyMs.mean + 0.99);
    expect(b2.metrics.latencyMs.mean).toBeLessThan(free.metrics.latencyMs.mean + 2.01);
    expect(b4.metrics.latencyMs.mean).toBeLessThan(b2.metrics.latencyMs.mean);
    expect(b4.metrics.latencyMs.mean).toBeGreaterThan(free.metrics.latencyMs.mean + 0.99);

    const b0 = await runSimulation(wsyn("mcp-direct"), { seed: 6 });
    const b0Costly = await runSimulation(wsyn("mcp-direct", { processing: costly }), { seed: 6 });
    expect(b0Costly.metrics).toEqual(b0.metrics);
  });

  it("counts serves past the producer-clock freshness apart from stale serves [P-8.1]", async () => {
    // TTL below the 45 ms it takes a Data to reach an agent: every answer arrives past its
    // freshness on the producer's clock, yet none is stale by ageMs.
    const cfg = wsyn("idem");
    const r = await runSimulation({ ...cfg, producer: { ...cfg.producer, ttlMs: 30 } }, { seed: 8 });
    expect(r.metrics.completed).toBe(48);
    expect(r.metrics.staleServes).toBe(0);
    expect(r.metrics.lateServes).toBe(48);
    expect(r.metrics.maxLateMs).toBeGreaterThanOrEqual(15);
    const roomy = await runSimulation(cfg, { seed: 8 });
    expect(roomy.metrics.lateServes).toBe(0);
    expect(roomy.metrics.maxLateMs).toBe(0);
  });

  it("reports hits beyond the edge, bypasses and evictions", async () => {
    const tree = buildTopology({
      kind: "tree",
      agents: 6,
      agentLinkMs: 5,
      coreLinkMs: 10,
      producerLinkMs: 30,
    });
    const t = await runSimulation(wsyn("idem", { topology: tree }), { seed: 12 });
    const star = await runSimulation(wsyn("idem"), { seed: 12 });
    expect(star.metrics.coreCsHits).toBe(0);
    expect(t.metrics.coreCsHits).toBeGreaterThan(0);
    expect(t.metrics.upstreamCalls).toBe(star.metrics.upstreamCalls);
    expect(star.metrics.bypasses).toBe(0);
    const mixed = await runSimulation(small("idem"), { seed: 12 });
    expect(mixed.metrics.bypasses).toBeGreaterThan(0);
    const tiny = await runSimulation(wsyn("idem", { cs: { maxBytes: 20_000, policy: "lru" } }), { seed: 12 });
    expect(tiny.metrics.csEvictions).toBeGreaterThan(0);
    expect(star.metrics.csEvictions).toBe(0);
  });

  it("MUST verify before use: an agent refuses a signed Data that answers another name [P-5.5]", async () => {
    const sim = await Simulation.create(wsyn("idem"), { seed: 21 });
    // On agent-0's link, replace each Data with the previous (genuine, signed) one for a different name.
    const link = sim.links.find((l) => l.id === "agent-0~edge");
    const face = link?.faces["agent-0"];
    if (!face) throw new Error("no agent-0 link");
    const deliver = face.deliver.bind(face);
    let previous: Data | undefined;
    let swapped = 0;
    face.deliver = (p: Packet) => {
      if (p.type !== "data") return deliver(p);
      const other = previous;
      previous = p.data;
      if (!other || other.name === p.data.name) return deliver(p);
      swapped++;
      return deliver({ ...p, data: other });
    };
    const r = await sim.run();
    expect(swapped).toBeGreaterThan(0);
    // Every swap is refused and the call is retried directly, so nothing fails and nothing wrong is used.
    expect(r.metrics.verifyFailures).toBe(swapped);
    expect(r.metrics.failed).toBe(0);
    expect(r.metrics.completed).toBe(48);
  });

  it("MUST hold the [P-5.5] retry to the first answer's standard: an unsigned retried result fails the call (ADR-024)", async () => {
    const sim = await Simulation.create(wsyn("idem"), { seed: 21 });
    // On agent-0's link: spoil every Data, then strip the signature block from every plain result.
    const face = sim.links.find((l) => l.id === "agent-0~edge")?.faces["agent-0"];
    if (!face) throw new Error("no agent-0 link");
    const deliver = face.deliver.bind(face);
    let spoiled = 0;
    face.deliver = (p: Packet) => {
      if (p.type === "data") {
        spoiled++;
        const content = { content: [{ type: "text", text: "spoiled" }] };
        return deliver({ ...p, data: { ...p.data, content } });
      }
      if (p.type === "result") {
        const { _meta: _signature, ...unsigned } = p.result;
        return deliver({
          ...p,
          result: { ...unsigned, content: [{ type: "text", text: "forged, unsigned" }] },
        });
      }
      return deliver(p);
    };
    const r = await sim.run();
    expect(spoiled).toBe(8);
    // Agent 0 made 8 calls: each first answer fails verification, each retry is refused.
    expect(r.metrics.failed).toBe(8);
    expect(r.metrics.completed).toBe(40);
    expect(r.metrics.safetyViolations).toBe(0);
  });

  it("accepts the [P-5.5] retry when it carries Data signed for the same name", async () => {
    const sim = await Simulation.create(wsyn("idem"), { seed: 21 });
    const face = sim.links.find((l) => l.id === "agent-0~edge")?.faces["agent-0"];
    if (!face) throw new Error("no agent-0 link");
    const deliver = face.deliver.bind(face);
    face.deliver = (p: Packet) =>
      deliver(
        p.type === "data"
          ? { ...p, data: { ...p.data, content: { content: [{ type: "text", text: "x" }] } } }
          : p,
      );
    const r = await sim.run();
    expect(r.metrics.failed).toBe(0);
    expect(r.metrics.completed).toBe(48);
    expect(r.metrics.verifyFailures).toBe(8);
    expect(r.metrics.retries).toBe(8);
  });
});
