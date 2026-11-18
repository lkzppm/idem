import { describe, expect, it } from "vitest";
import {
  type AgentPlan,
  buildTopology,
  defaultConfig,
  type SimConfig,
  type SimLinkConfig,
  type SimNode,
  type SimProducerConfig,
} from "./config";
import { Rng } from "./rng";
import { pathToProducer, reachableProducers, routesTo } from "./routing";
import { type CallRecord, runSimulation, Simulation, type Transmission } from "./simulation";
import { SimConfigError } from "./validate";
import { planWorkload } from "./workload";

// ---- builders

const A = (id: string): SimNode => ({ id, kind: "agent" });
const F = (id: string, csMaxBytes?: number): SimNode => ({
  id,
  kind: "forwarder",
  ...(csMaxBytes !== undefined && { csMaxBytes }),
});
const P = (id: string): SimNode => ({ id, kind: "producer" });
const L = (a: string, b: string, latencyMs = 5): SimLinkConfig => ({ a, b, latencyMs, lossPct: 0 });

const ALPHA = "alpha.idem.dev";
const BETA = "beta.idem.dev";

function graph(
  nodes: SimNode[],
  links: SimLinkConfig[],
  producers: SimProducerConfig[],
  agents: AgentPlan[],
  extra: Partial<SimConfig> = {},
): SimConfig {
  return defaultConfig({
    topology: { nodes, links },
    producers,
    workload: { kind: "per-agent", agents },
    ...extra,
  });
}

async function run(cfg: SimConfig, seed = 1) {
  const calls: CallRecord[] = [];
  const txs: Transmission[] = [];
  const sim = await Simulation.create(cfg, {
    seed,
    keepEvents: true,
    onCall: (r) => calls.push(r),
    onTransmit: (tx) => txs.push(tx),
  });
  const result = await sim.run();
  return { sim, result, calls, txs };
}

/** Producer component of an IDEM name. */
const producerOf = (name: string | undefined) => name?.split("/")[3];

// ---- two producers behind one edge

function twoProducers(extra: Partial<SimConfig> = {}): SimConfig {
  return graph(
    [A("a0"), A("a1"), A("a2"), F("edge"), F("r1"), F("r2"), P("p1"), P("p2")],
    [
      L("a0", "edge"),
      L("a1", "edge"),
      L("a2", "edge"),
      L("edge", "r1", 10),
      L("edge", "r2", 10),
      L("r1", "p1", 20),
      L("r2", "p2", 20),
    ],
    [
      {
        node: "p1",
        name: ALPHA,
        tools: [{ tool: "fetch_page" }, { tool: "search_corpus" }, { tool: "my_notes" }],
      },
      { node: "p2", name: BETA, tools: [{ tool: "weather" }, { tool: "my_notes" }, { tool: "send_email" }] },
    ],
    ["a0", "a1", "a2"].map((node) => ({
      node,
      calls: 12,
      thinkTimeMs: 200,
      mix: [
        { producer: ALPHA, tool: "fetch_page", weight: 2 },
        { producer: ALPHA, tool: "search_corpus", weight: 2 },
        { producer: BETA, tool: "weather", weight: 2 },
        { producer: BETA, tool: "my_notes", weight: 1 },
        { producer: BETA, tool: "send_email", weight: 1 },
      ],
    })),
    extra,
  );
}

describe("several producers (ADR-027)", () => {
  it("routes each name to its own producer by longest-prefix match on the producer component", async () => {
    const { result, calls, txs } = await run(twoProducers());
    expect(result.metrics.calls).toBe(36);
    expect(result.metrics.failed).toBe(0);
    expect(result.metrics.safetyViolations).toBe(0);
    expect(new Set(calls.map((c) => c.producer))).toEqual(new Set([ALPHA, BETA]));
    // Every Interest that reaches a producer node carries that producer's name, and an Interest
    // never crosses the other producer's branch.
    const owner: Record<string, string> = { p1: ALPHA, p2: BETA };
    const interests = txs.filter((t) => t.kind === "interest");
    for (const t of interests.filter((t) => t.to in owner)) expect(producerOf(t.label)).toBe(owner[t.to]);
    for (const t of interests.filter((t) => t.link === "edge~r2" || t.link === "r2~p2"))
      expect(producerOf(t.label)).toBe(BETA);
    for (const t of interests.filter((t) => t.link === "edge~r1" || t.link === "r1~p1"))
      expect(producerOf(t.label)).toBe(ALPHA);
    // Plain calls (send_email) follow the same FIB, by producer.
    const plain = txs.filter((t) => t.kind === "call" && t.to === "p2");
    expect(plain.length).toBeGreaterThan(0);
    expect(txs.some((t) => t.kind === "call" && t.to === "p1")).toBe(false);
  });

  it("counts upstream calls at every producer node, not at a node called `producer`", async () => {
    const { result, txs } = await run(twoProducers());
    const upstream = txs.filter(
      (t) => !t.lost && (t.to === "p1" || t.to === "p2") && (t.kind === "interest" || t.kind === "call"),
    ).length;
    expect(result.metrics.upstreamCalls).toBe(upstream);
    expect(upstream).toBeGreaterThan(0);
  });

  it("is deterministic for a seed, in every mode", async () => {
    for (const mode of ["mcp-direct", "mcp-local-cache", "idem", "idem-noverify"] as const) {
      const a = await runSimulation(twoProducers({ mode }), { seed: 9 });
      const b = await runSimulation(twoProducers({ mode }), { seed: 9 });
      expect(a.metrics, mode).toEqual(b.metrics);
      expect(a.metrics.failed, mode).toBe(0);
    }
  });

  it("gives each producer its own key, all trusted, independent of the order of `producers`", async () => {
    const cfg = twoProducers();
    const { sim } = await run(cfg);
    const keys = sim.manifests.map((m) => m.signature.keyId);
    expect(new Set(keys).size).toBe(2);
    const swapped = await Simulation.create(
      { ...cfg, producers: [...(cfg.producers ?? [])].reverse() },
      { seed: 1 },
    );
    expect(new Set(swapped.manifests.map((m) => m.signature.keyId))).toEqual(new Set(keys));
  });

  it("MUST NOT serve one credential's private result to another, with several producers [P-8.3]", async () => {
    const cfg = twoProducers();
    const plans = (cfg.workload as { agents: AgentPlan[] }).agents.map((p) => ({
      ...p,
      calls: 20,
      thinkTimeMs: 20,
      mix: [
        { producer: ALPHA, tool: "my_notes" as const, weight: 1 },
        { producer: BETA, tool: "my_notes" as const, weight: 1 },
      ],
    }));
    const sim = await Simulation.create(
      { ...cfg, workload: { kind: "per-agent", agents: plans } },
      { seed: 4 },
    );
    await sim.runUntil(300);
    await sim.attackPrivateProbe(0, 1, BETA);
    await sim.attackPrivateProbe(1, 2, ALPHA);
    const r = await sim.run();
    expect(r.metrics.completed).toBe(60);
    expect(r.metrics.safetyViolations).toBe(0);
    expect(sim.attacks.map((a) => a.kind)).toEqual(["private-probe", "private-probe"]);
    for (const a of sim.attacks) expect(a.rejected, a.detail).toBe(true);
  });

  it("rejects tampering and forging aimed at a named producer", async () => {
    const sim = await Simulation.create(twoProducers(), { seed: 11 });
    await sim.runUntil(400);
    sim.attackTamper(BETA);
    await sim.attackForge(0, BETA); // BETA has no fetch_page: forges a weather name
    await sim.attackForge(1, ALPHA);
    await sim.run();
    expect(sim.attacks.map((a) => a.kind).sort()).toEqual(["forge", "forge", "tamper"]);
    for (const a of sim.attacks) expect(a.rejected, `${a.kind}: ${a.detail}`).toBe(true);
    expect(sim.result().metrics.safetyViolations).toBe(0);
  });
});

// ---- routing

describe("routing on arbitrary graphs (ADR-027)", () => {
  // a is multi-homed: a~f1 (5 ms) and a~f2 (20 ms). p1 sits behind f1, p2 behind f2; a costly
  // cross link f1~p2 (100 ms) must not attract p2's traffic.
  const nodes = [A("a"), F("f1"), F("f2"), P("p1"), P("p2")];
  const links = [L("a", "f1", 5), L("a", "f2", 20), L("f1", "p1", 5), L("f2", "p2", 5), L("f1", "p2", 100)];

  it("sends each call of a multi-homed agent on the shortest path to its producer", async () => {
    const cfg = graph(
      nodes,
      links,
      [
        { node: "p1", name: ALPHA, tools: [{ tool: "search_corpus" }] },
        { node: "p2", name: BETA, tools: [{ tool: "weather" }] },
      ],
      [
        {
          node: "a",
          calls: 16,
          mix: [
            { producer: ALPHA, tool: "search_corpus", weight: 1 },
            { producer: BETA, tool: "weather", weight: 1 },
          ],
        },
      ],
    );
    const { result, txs } = await run(cfg);
    expect(result.metrics.failed).toBe(0);
    const out = txs.filter((t) => t.from === "a" && t.kind === "interest");
    expect(out.length).toBe(16);
    for (const t of out) expect(t.link).toBe(producerOf(t.label) === ALPHA ? "a~f1" : "a~f2");
    expect(txs.some((t) => t.link === "f1~p2")).toBe(false);
    expect(pathToProducer(cfg.topology, "a", "p2")).toEqual({
      nodes: ["a", "f2", "p2"],
      links: [1, 3],
      latencyMs: 25,
    });
    expect(pathToProducer(cfg.topology, "a", "p1")?.latencyMs).toBe(10);
  });

  it("never relays through an agent or another producer", () => {
    // p2 hangs off agent b only; p3 is reachable from f only through p1.
    const t = {
      nodes: [A("a"), A("b"), F("f"), P("p1"), P("p2"), P("p3")],
      links: [L("a", "f"), L("b", "f"), L("f", "p1"), L("b", "p2"), L("p1", "p3")],
    };
    expect(reachableProducers(t, "a")).toEqual(["p1"]);
    expect(reachableProducers(t, "b")).toEqual(["p2", "p1"]);
    expect(routesTo(t, "p3").size).toBe(0);
    expect(routesTo(t, "p2").get("f")).toBeUndefined();
  });

  it("breaks equal-cost ties by node id, then link index", () => {
    // Square f0–f1–f2–f3–f0 with p on f1: f3 reaches p via f0 or f2 at the same cost.
    const t = {
      nodes: [F("f0"), F("f1"), F("f2"), F("f3"), P("p")],
      links: [L("f0", "f1"), L("f1", "f2"), L("f2", "f3"), L("f3", "f0"), L("f1", "p")],
    };
    expect(routesTo(t, "p").get("f3")).toEqual({ link: 3, next: "f0", latencyMs: 15 });
    const parallel = { nodes: [F("f"), P("p")], links: [L("f", "p", 7), L("p", "f", 7)] };
    expect(routesTo(parallel, "p").get("f")?.link).toBe(0);
  });

  it("runs a cyclic graph without loops (loop guard [P-4.4])", async () => {
    const ring = [F("f0"), F("f1"), F("f2"), F("f3")];
    const cfg = graph(
      [...ring, A("a0"), A("a2"), A("a3"), P("p")],
      [
        L("f0", "f1", 4),
        L("f1", "f2", 4),
        L("f2", "f3", 4),
        L("f3", "f0", 4),
        L("f0", "f2", 9),
        L("a0", "f0"),
        L("a2", "f2"),
        L("a3", "f3"),
        L("f1", "p", 10),
      ],
      [{ node: "p", name: ALPHA, tools: [{ tool: "fetch_page" }, { tool: "weather" }] }],
      ["a0", "a2", "a3"].map((node) => ({
        node,
        calls: 15,
        thinkTimeMs: 100,
        mix: [
          { producer: ALPHA, tool: "fetch_page", weight: 3 },
          { producer: ALPHA, tool: "weather", weight: 1 },
        ],
      })),
    );
    const { result } = await run(cfg, 5);
    expect(result.metrics.calls).toBe(45);
    expect(result.metrics.failed).toBe(0);
    const drops = (result.events ?? []).filter((e) => e.kind === "drop");
    expect(drops.filter((e) => /loop|hop|no_route/i.test(JSON.stringify(e)))).toEqual([]);
    // Interests only ever travel toward the producer: never back out of f1 into the ring.
    expect((result.events ?? []).some((e) => e.kind === "interest_in" && e.node === "f1")).toBe(true);
    const again = await runSimulation(cfg, { seed: 5 });
    expect(again.metrics).toEqual(result.metrics);
  });

  it("fails calls to an unreachable producer with NO_ROUTE, sending nothing", async () => {
    const cfg = graph(
      [A("a"), A("b"), F("f"), P("p1"), P("p2"), A("lonely")],
      [L("a", "f"), L("b", "f"), L("f", "p1"), L("b", "p2")],
      [
        { node: "p1", name: ALPHA, tools: [{ tool: "fetch_page" }] },
        { node: "p2", name: BETA, tools: [{ tool: "weather" }] },
      ],
      ["a", "b", "lonely"].map((node) => ({
        node,
        calls: 10,
        mix: [
          { producer: ALPHA, tool: "fetch_page", weight: 1 },
          { producer: BETA, tool: "weather", weight: 1 },
        ],
      })),
    );
    const { result, calls, txs } = await run(cfg);
    const noRoute = calls.filter((c) => c.error === "NO_ROUTE");
    // a cannot reach p2 (only through agent b); lonely reaches nothing; b reaches both.
    expect(new Set(noRoute.map((c) => `${c.agent}->${c.producer}`))).toEqual(
      new Set(["a->beta.idem.dev", "lonely->alpha.idem.dev", "lonely->beta.idem.dev"]),
    );
    for (const c of noRoute) expect(c).toMatchObject({ ok: false, attempts: 0 });
    expect(calls.filter((c) => c.agent === "lonely")).toHaveLength(10);
    expect(result.metrics.noRoute).toBe(noRoute.length);
    expect(result.metrics.failed).toBe(noRoute.length);
    expect(result.metrics.calls).toBe(30);
    expect(txs.some((t) => t.from === "lonely")).toBe(false);
    expect(txs.some((t) => t.link === "b~p2" && t.kind === "interest")).toBe(true);
    // b reaches p2 directly over its own link and gets answers.
    expect(calls.filter((c) => c.agent === "b" && c.producer === BETA).every((c) => c.ok)).toBe(true);
  });
});

// ---- per-agent workloads

describe("per-agent workloads (ADR-027)", () => {
  const cfg = twoProducers();

  it("draws each agent's calls from its own weighted mix", () => {
    const agents: AgentPlan[] = [
      { node: "a0", calls: 400, mix: [{ producer: BETA, tool: "weather", weight: 1 }] },
      {
        node: "a1",
        calls: 400,
        mix: [
          { producer: ALPHA, tool: "search_corpus", weight: 3 },
          { producer: BETA, tool: "send_email", weight: 1 },
          { producer: ALPHA, tool: "fetch_page", weight: 0 },
        ],
      },
    ];
    const plans = planWorkload({ ...cfg, workload: { kind: "per-agent", agents } }, new Rng(3));
    expect(plans).toHaveLength(2);
    expect(plans[0]?.every((c) => c.tool === "weather" && c.producer === BETA)).toBe(true);
    const a1 = plans[1] ?? [];
    expect(a1.some((c) => c.tool === "fetch_page")).toBe(false);
    const share = a1.filter((c) => c.tool === "search_corpus").length / a1.length;
    expect(share).toBeGreaterThan(0.68);
    expect(share).toBeLessThan(0.82);
  });

  it("writes arguments in equivalent surface forms, so normalizers decide the names", async () => {
    const agents: AgentPlan[] = [
      {
        node: "a0",
        calls: 60,
        surfaceVariation: 0.8,
        mix: [
          { producer: ALPHA, tool: "search_corpus", weight: 1 },
          { producer: BETA, tool: "weather", weight: 1 },
        ],
      },
    ];
    const sim = await Simulation.create({ ...cfg, workload: { kind: "per-agent", agents } }, { seed: 2 });
    const plan = sim.agents.find((a) => a.id === "a0")?.plan ?? [];
    const raw = new Set(plan.map((c) => `${c.producer}|${c.tool}|${JSON.stringify(c.args)}`));
    const stats = await sim.workloadStats();
    expect(stats.cacheableCalls).toBe(60);
    expect(stats.distinctNames).toBeLessThan(raw.size);
  });

  it("keeps fetch_page overlap per agent: overlap 0 never shares a page", async () => {
    const agents: AgentPlan[] = ["a0", "a1", "a2"].map((node) => ({
      node,
      calls: 15,
      overlap: 0,
      mix: [{ producer: ALPHA, tool: "fetch_page", weight: 1 }],
    }));
    const sim = await Simulation.create({ ...cfg, workload: { kind: "per-agent", agents } }, { seed: 2 });
    expect((await sim.workloadStats()).distinctNames).toBe(45);
    const r = await sim.run();
    expect(r.metrics.csHits + r.metrics.pitAggregations).toBe(0);
    expect(r.metrics.upstreamCalls).toBe(45);
  });

  it("lets agents without a plan sit idle", async () => {
    const agents: AgentPlan[] = [
      { node: "a2", calls: 3, mix: [{ producer: BETA, tool: "weather", weight: 1 }] },
    ];
    const { result, calls } = await run({ ...cfg, workload: { kind: "per-agent", agents } });
    expect(result.metrics.calls).toBe(3);
    expect(new Set(calls.map((c) => c.agent))).toEqual(new Set(["a2"]));
  });
});

// ---- configuration checks

describe("configuration checks (ADR-027)", () => {
  const base = twoProducers();
  const plans = (base.workload as { agents: AgentPlan[] }).agents;
  const bad: [string, SimConfig, RegExp][] = [
    [
      "unknown producer in a mix",
      {
        ...base,
        workload: {
          kind: "per-agent",
          agents: [{ ...plans[0], mix: [{ producer: "x.dev", tool: "weather", weight: 1 }] } as AgentPlan],
        },
      },
      /mix\[0\]\.producer unknown producer/,
    ],
    [
      "tool the producer does not serve",
      {
        ...base,
        workload: {
          kind: "per-agent",
          agents: [{ ...plans[0], mix: [{ producer: ALPHA, tool: "weather", weight: 1 }] } as AgentPlan],
        },
      },
      /does not serve "weather"/,
    ],
    [
      "producer on a forwarder",
      { ...base, producers: [{ node: "edge", name: ALPHA, tools: [] }] },
      /not a producer node/,
    ],
    [
      "duplicate producer name",
      {
        ...base,
        producers: [
          { node: "p1", name: ALPHA, tools: [] },
          { node: "p2", name: ALPHA, tools: [] },
        ],
      },
      /duplicates "alpha.idem.dev"/,
    ],
    [
      "invalid producer name",
      { ...base, producers: [{ node: "p1", name: "Not A Host", tools: [] }] },
      /host\[:port\]/,
    ],
    [
      "CS size on an agent",
      {
        ...base,
        topology: {
          ...base.topology,
          nodes: base.topology.nodes.map((n) => (n.id === "a0" ? { ...n, csMaxBytes: 10 } : n)),
        },
      },
      /forwarders only/,
    ],
    [
      "link to nowhere",
      { ...base, topology: { ...base.topology, links: [...base.topology.links, L("a0", "ghost")] } },
      /unknown node "ghost"/,
    ],
  ];
  for (const [what, cfg, msg] of bad) {
    it(`rejects ${what} with SimConfigError`, async () => {
      const err = await Simulation.create(cfg, { seed: 1 }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SimConfigError);
      expect((err as SimConfigError).code).toBe("BAD_CONFIG");
      expect((err as Error).message).toMatch(msg);
    });
  }
});

// ---- per-forwarder Content Store size

describe("per-forwarder CS size", () => {
  const tree = buildTopology({
    kind: "tree",
    agents: 8,
    agentLinkMs: 5,
    coreLinkMs: 10,
    producerLinkMs: 30,
    edges: 2,
  });

  it("sizes each forwarder's Content Store from its node, else from cs.maxBytes [P-7.4]", async () => {
    const nodes = tree.nodes.map((n) => (n.id === "edge-0" ? { ...n, csMaxBytes: 0 } : n));
    const { sim, result } = await run(defaultConfig({ topology: { ...tree, nodes } }), 3);
    expect(sim.forwarders.get("edge-0")?.cs.stats().maxBytes).toBe(0);
    expect(sim.forwarders.get("edge-1")?.cs.stats().maxBytes).toBe(8 * 1024 * 1024);
    const hits = (node: string) =>
      (result.events ?? []).filter((e) => e.kind === "cs_hit" && e.node === node).length;
    expect(hits("edge-0")).toBe(0);
    expect(hits("edge-1")).toBeGreaterThan(0);
    expect(result.metrics.safetyViolations).toBe(0);
  });

  it("changes nothing when every forwarder states the global size", async () => {
    const cfg = defaultConfig({ topology: tree });
    const same = defaultConfig({
      topology: {
        ...tree,
        nodes: tree.nodes.map((n) => (n.kind === "forwarder" ? { ...n, csMaxBytes: cfg.cs.maxBytes } : n)),
      },
    });
    expect((await runSimulation(same, { seed: 8 })).metrics).toEqual(
      (await runSimulation(cfg, { seed: 8 })).metrics,
    );
  });
});
