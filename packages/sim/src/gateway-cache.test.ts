import { describe, expect, it } from "vitest";
import { buildTopology, defaultConfig, type SimConfig, type TraceRecord } from "./config";
import { GatewayCache, gatewayCacheKey, stableJson } from "./gateway-cache";
import type { ProcessingCosts } from "./processing";
import { runSimulation, Simulation } from "./simulation";

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const URL_A = "https://corpus.idem.dev/doc/1?lang=en&v=1";

function trace(records: TraceRecord[], mode: SimConfig["mode"], extra: Partial<SimConfig> = {}): SimConfig {
  const agents = Math.max(...records.map((r) => r.agent)) + 1;
  return defaultConfig({
    mode,
    topology: buildTopology({ kind: "star", agents, agentLinkMs: 5, producerLinkMs: 40 }),
    workload: { kind: "trace", records },
    producer: { ...defaultConfig().producer, signPlainCalls: false },
    ...extra,
  });
}

describe("gateway cache (B5, ADR-036)", () => {
  it("keys on the arguments as sent: key order does not matter, spelling does", () => {
    expect(stableJson({ b: 1, a: { d: [1, { z: 0, y: null }], c: "x" } })).toBe(
      '{"a":{"c":"x","d":[1,{"y":null,"z":0}]},"b":1}',
    );
    const k = (args: unknown) => gatewayCacheKey("p.example", "fetch_page", args);
    expect(k({ url: "a", lang: "en" })).toBe(k({ lang: "en", url: "a" }));
    expect(k({ url: "HTTP://Example.com:80/a" })).not.toBe(k({ url: "http://example.com/a" }));
    expect(gatewayCacheKey("p.example", "a", {})).not.toBe(gatewayCacheKey("q.example", "a", {}));
  });

  it("serves an entry for its TTL, then misses; respects the byte budget with the CS policies", () => {
    const c = new GatewayCache({ maxBytes: 200, policy: "lru" });
    c.put("a", text("A".repeat(40)), 1000, 0);
    expect(c.get("a", 999)?.result).toEqual(text("A".repeat(40)));
    expect(c.get("a", 1000)).toBeUndefined();
    expect(c.stats().entries).toBe(0);
    // LRU: reading "x" makes "y" the victim.
    c.put("x", text("x".repeat(40)), 10_000, 0);
    c.put("y", text("y".repeat(40)), 10_000, 0);
    c.get("x", 1);
    c.put("z", text("z".repeat(40)), 10_000, 2);
    expect([...c.entries()].map((e) => e.key)).toEqual(["x", "z"]);
    expect(c.stats().evictions).toBe(1);
    expect(c.put("big", text("b".repeat(500)), 10_000, 3).inserted).toBe(false);
    const fifo = new GatewayCache({ maxBytes: 200, policy: "fifo" });
    fifo.put("x", text("x".repeat(40)), 10_000, 0);
    fifo.put("y", text("y".repeat(40)), 10_000, 0);
    fifo.get("x", 1);
    fifo.put("z", text("z".repeat(40)), 10_000, 2);
    expect([...fifo.entries()].map((e) => e.key)).toEqual(["y", "z"]);
  });

  it("answers a repeated call from the edge, shared by every agent, with plain MCP results", async () => {
    const records: TraceRecord[] = [
      { t: 0, agent: 0, tool: "fetch_page", args: { url: URL_A } },
      { t: 1000, agent: 1, tool: "fetch_page", args: { url: URL_A } },
      { t: 2000, agent: 2, tool: "fetch_page", args: { url: URL_A } },
    ];
    const sim = await Simulation.create(trace(records, "mcp-gateway-cache"), { seed: 1 });
    const results: unknown[] = [];
    const r = await sim.run();
    expect(r.metrics.upstreamCalls).toBe(1);
    expect(r.metrics.gatewayCacheHits).toBe(2);
    expect(r.metrics.gatewayInflightDuplicates).toBe(0);
    expect(r.metrics.completed).toBe(3);
    expect(r.metrics.pitAggregations + r.metrics.csHits + r.metrics.edgeInterests).toBe(0);
    // Plain MCP: nothing IDEM is stored or sent.
    for (const e of sim.gatewayCaches.get("edge")?.entries() ?? []) results.push(e.result);
    expect(results).toHaveLength(1);
    expect(JSON.stringify(results)).not.toContain("dev.idem/");
  });

  it("sends identical calls in flight upstream (no coalescing) where IDEM aggregates them [H5]", async () => {
    const records: TraceRecord[] = [
      { t: 0, agent: 0, tool: "fetch_page", args: { url: URL_A } },
      { t: 5, agent: 1, tool: "fetch_page", args: { url: URL_A } },
      { t: 10, agent: 2, tool: "fetch_page", args: { url: URL_A } },
    ];
    const b5 = await runSimulation(trace(records, "mcp-gateway-cache"), { seed: 1 });
    expect(b5.metrics.upstreamCalls).toBe(3);
    expect(b5.metrics.gatewayInflightDuplicates).toBe(2);
    expect(b5.metrics.gatewayCacheHits).toBe(0);
    const idem = await runSimulation(trace(records, "idem"), { seed: 1 });
    expect(idem.metrics.upstreamCalls).toBe(1);
    expect(idem.metrics.pitAggregations).toBe(2);
  });

  it("misses on an equivalent spelling that IDEM's canonical name matches [H5]", async () => {
    const records: TraceRecord[] = [
      { t: 0, agent: 0, tool: "fetch_page", args: { url: URL_A } },
      { t: 1000, agent: 1, tool: "fetch_page", args: { url: "https://CORPUS.idem.dev/doc/1?v=1&lang=en" } },
    ];
    const b5 = await runSimulation(trace(records, "mcp-gateway-cache"), { seed: 1 });
    expect(b5.metrics.upstreamCalls).toBe(2);
    const idem = await runSimulation(trace(records, "idem"), { seed: 1 });
    expect(idem.metrics.upstreamCalls).toBe(1);
  });

  it("passes side-effect calls through and never caches an error result", async () => {
    const records: TraceRecord[] = [
      { t: 2000, agent: 0, tool: "send_email", args: { to: "a@example.com", body: "x" } },
      { t: 3000, agent: 1, tool: "send_email", args: { to: "a@example.com", body: "x" } },
      { t: 4000, agent: 0, tool: "fetch_page", args: { url: 42 } },
      { t: 5000, agent: 1, tool: "fetch_page", args: { url: 42 } },
    ];
    const sim = await Simulation.create(trace(records, "mcp-gateway-cache"), { seed: 1 });
    const r = await sim.run();
    expect(r.metrics.upstreamCalls).toBe(4);
    expect(r.metrics.gatewayCacheHits).toBe(0);
    expect(r.metrics.safetyViolations).toBe(0);
    expect([...(sim.gatewayCaches.get("edge")?.entries() ?? [])]).toHaveLength(0);
  });

  it("caches a private cacheable tool in a partition per credential, never across users (ADR-036)", async () => {
    // A gateway keyed per caller token, as FastMCP's is, gets the per-user hits IDEM's edge gets.
    const records: TraceRecord[] = [
      { t: 0, agent: 0, tool: "my_notes", args: {} },
      { t: 1000, agent: 1, tool: "my_notes", args: {} },
      { t: 2000, agent: 0, tool: "my_notes", args: {} },
      { t: 3000, agent: 1, tool: "my_notes", args: {} },
    ];
    for (const mode of ["mcp-gateway-cache", "idem"] as const) {
      const sim = await Simulation.create(trace(records, mode), { seed: 1 });
      const r = await sim.run();
      expect(r.metrics.upstreamCalls, mode).toBe(2);
      expect(r.metrics.safetyViolations, mode).toBe(0); // each agent got its own notes
    }
    const k = (auth: string) => gatewayCacheKey("p.example", "my_notes", {}, auth);
    expect(k("token-a")).not.toBe(k("token-b"));
    expect(gatewayCacheKey("p.example", "fetch_page", {})).not.toBe(k(""));
  });

  it("is charged no CPU, like B0 and B1, and expires entries at the manifest TTL", async () => {
    const SLOW: ProcessingCosts = {
      sizesBytes: [1024, 1_048_576],
      canonicalizeUs: [50_000, 50_000],
      nameUs: [50_000, 50_000],
      signUs: [50_000, 50_000],
      verifyUs: [50_000, 50_000],
    };
    const records: TraceRecord[] = [
      { t: 0, agent: 0, tool: "fetch_page", args: { url: URL_A } },
      { t: 30_000, agent: 1, tool: "fetch_page", args: { url: URL_A } },
      { t: 61_000, agent: 0, tool: "fetch_page", args: { url: URL_A } },
    ];
    const cfg = trace(records, "mcp-gateway-cache", { processing: SLOW });
    const withCpu = await runSimulation(cfg, { seed: 2 });
    const without = await runSimulation({ ...cfg, processing: undefined } as SimConfig, { seed: 2 });
    expect(withCpu.metrics).toEqual(without.metrics);
    // 60 s TTL from the store at the edge: the second call hits, the third (61 s) goes upstream.
    expect(withCpu.metrics.gatewayCacheHits).toBe(1);
    expect(withCpu.metrics.upstreamCalls).toBe(2);
  });

  it("runs the synthetic workload with the same calls as the other modes", async () => {
    const cfg = (mode: SimConfig["mode"]) =>
      defaultConfig({ mode, producer: { ...defaultConfig().producer, signPlainCalls: false } });
    const b0 = await Simulation.create(cfg("mcp-direct"), { seed: 9 });
    const b5 = await Simulation.create(cfg("mcp-gateway-cache"), { seed: 9 });
    expect(await b5.workloadStats()).toEqual(await b0.workloadStats());
    const r0 = await b0.run();
    const r5 = await b5.run();
    expect(r5.metrics.calls).toBe(r0.metrics.calls);
    expect(r5.metrics.failed).toBe(0);
    expect(r5.metrics.safetyViolations).toBe(0);
    expect(r5.metrics.upstreamCalls).toBe(r0.metrics.upstreamCalls - r5.metrics.gatewayCacheHits);
  });
});
