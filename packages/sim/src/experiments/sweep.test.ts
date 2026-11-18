import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./node-io";
import { parseExperimentConfig, type SweepConfig } from "./spec";
import {
  latencyPercentiles,
  type ResolvedSweep,
  runSweep,
  type SweepRow,
  summarizeRows,
  sweepSeeds,
} from "./sweep";

function tiny(patch: Partial<ResolvedSweep> = {}): ResolvedSweep {
  const file = join(repoRoot(), "experiments", "configs", "e2-agents.json");
  const cfg = parseExperimentConfig(JSON.parse(readFileSync(file, "utf8"))) as SweepConfig;
  const { processing: _file, ...rest } = cfg;
  return {
    ...rest,
    seeds: { first: 3, count: 2 },
    modes: ["B0", "B1", "B2", "B3", "B4"],
    sweep: { param: "agents", values: [1, 4] },
    base: { ...cfg.base, workload: { ...cfg.base.workload, callsPerAgent: 6 } },
    ...patch,
  };
}

describe("E2 sweep", () => {
  it("lists the seeds of a sweep", () => {
    expect(sweepSeeds({ seeds: { first: 5, count: 3 } })).toEqual([5, 6, 7]);
  });

  it("runs every mode at every value with every seed, deterministically", async () => {
    const a = await runSweep(tiny());
    const b = await runSweep(tiny());
    expect(a).toEqual(b);
    expect(a.rows).toHaveLength(2 * 2 * 5);
    expect(a.rows.map((r) => `${r.value}/${r.mode}/${r.seed}`).slice(0, 4)).toEqual([
      "1/B0/3",
      "1/B0/4",
      "1/B1/3",
      "1/B1/4",
    ]);
    for (const r of a.rows) {
      expect(r.calls).toBe(r.value * 6);
      expect(r.failed).toBe(0);
      expect(r.stale_serves).toBe(0);
      expect(r.safety_violations).toBe(0);
      expect(r.upstream_calls).toBeGreaterThanOrEqual(r.distinct_names);
    }
  });

  it("pairs reductions by seed against B0 and B1", async () => {
    const { rows } = await runSweep(tiny());
    const at = (mode: string, value: number, seed: number) =>
      rows.find((r) => r.mode === mode && r.value === value && r.seed === seed) as SweepRow;
    for (const value of [1, 4]) {
      for (const seed of [3, 4]) {
        const b0 = at("B0", value, seed);
        const b1 = at("B1", value, seed);
        const b2 = at("B2", value, seed);
        // B0 forwards every call; it is its own baseline.
        expect(b0.upstream_calls).toBe(b0.calls);
        expect(b0.upstream_reduction).toBe(0);
        expect(b0.bytes_reduction).toBe(0);
        expect(b1.upstream_reduction_vs_b1).toBe(0);
        expect(b2.upstream_reduction).toBeCloseTo(1 - b2.upstream_calls / b0.upstream_calls, 12);
        expect(b2.upstream_reduction_vs_b1).toBeCloseTo(1 - b2.upstream_calls / b1.upstream_calls, 12);
        expect(b2.bytes_reduction).toBeCloseTo(1 - b2.producer_link_bytes / b0.producer_link_bytes, 12);
        expect(b0.latency_p50_vs_b0_ms).toBe(0);
        expect(b2.latency_mean_vs_b0_ms).toBeCloseTo(b2.latency_mean_ms - b0.latency_mean_ms, 12);
        expect(b2.latency_p95_vs_b0_ms).toBeCloseTo(b2.latency_p95_ms - b0.latency_p95_ms, 12);
        expect(b2.latency_mean_vs_b2_ms).toBe(0);
        expect(at("B4", value, seed).latency_mean_vs_b2_ms).toBeCloseTo(
          at("B4", value, seed).latency_mean_ms - b2.latency_mean_ms,
          12,
        );
        // The same seed plans the same workload in every mode.
        expect(b2.distinct_names).toBe(b0.distinct_names);
        expect(b2.oracle_reduction).toBe(b0.oracle_reduction);
        // One agent has nobody to share with: the edge cache does what a local cache does.
        if (value === 1) expect(b2.upstream_calls).toBe(b1.upstream_calls);
        // B4 only skips a check: the same packets reach the producer.
        expect(at("B4", value, seed).upstream_calls).toBe(b2.upstream_calls);
      }
    }
  });

  it("leaves reductions empty when the sweep has no B0", async () => {
    const { rows, summary } = await runSweep(
      tiny({ modes: ["B2"], sweep: { param: "agents", values: [2] } }),
    );
    expect(rows.every((r) => Number.isNaN(r.upstream_reduction))).toBe(true);
    expect(summary.find((s) => s.metric === "upstream_reduction")?.n).toBe(0);
  });

  it("charges processing costs to the IDEM modes only", async () => {
    const processing = {
      sizesBytes: [1024, 1_048_576],
      canonicalizeUs: [0, 0],
      nameUs: [0, 0],
      signUs: [0, 0],
      verifyUs: [5000, 5000],
    };
    const cfg = tiny({ sweep: { param: "agents", values: [4] }, modes: ["B0", "B2", "B4"] });
    const free = await runSweep(cfg);
    const paid = await runSweep({ ...cfg, processing });
    const lat = (r: typeof free, mode: string) =>
      r.summary.find((s) => s.mode === mode && s.metric === "latency_mean_ms")?.mean as number;
    expect(lat(paid, "B0")).toBe(lat(free, "B0"));
    expect(lat(paid, "B2")).toBeGreaterThan(lat(free, "B2") + 4.9);
    expect(lat(paid, "B4")).toBeLessThan(lat(paid, "B2"));
  });

  it("summarizes each metric over the seeds of a point", async () => {
    const { rows, summary } = await runSweep(tiny());
    expect(summarizeRows(rows)).toEqual(summary);
    const s = summary.find((x) => x.mode === "B2" && x.value === 4 && x.metric === "upstream_calls");
    const values = rows.filter((r) => r.mode === "B2" && r.value === 4).map((r) => r.upstream_calls);
    expect(s?.n).toBe(2);
    expect(s?.mean).toBe(((values[0] as number) + (values[1] as number)) / 2);
    expect(s?.min).toBe(Math.min(...values));
    // Two seeds: half-width = t(0.975, 1) · sd / √2.
    const sd = Math.abs((values[0] as number) - (values[1] as number)) / Math.SQRT2;
    expect(s?.ci95).toBeCloseTo((12.706 * sd) / Math.SQRT2, 9);
  });

  it("pools call latencies over seeds into percentiles 0..100", async () => {
    const { cdf, rows } = await runSweep(tiny());
    expect(cdf).toHaveLength(2 * 5 * 101);
    const b2 = cdf.filter((c) => c.mode === "B2" && c.value === 4);
    expect(b2.map((c) => c.q)).toEqual(Array.from({ length: 101 }, (_, q) => q));
    expect(b2[0]?.n).toBe(
      rows.filter((r) => r.mode === "B2" && r.value === 4).reduce((n, r) => n + r.completed, 0),
    );
    for (let q = 1; q <= 100; q++) {
      expect((b2[q] as (typeof b2)[number]).latency_ms).toBeGreaterThanOrEqual(
        (b2[q - 1] as (typeof b2)[number]).latency_ms,
      );
    }
    expect(latencyPercentiles([30, 10, 20])).toHaveLength(101);
    expect(latencyPercentiles([30, 10, 20])[0]).toBe(10);
    expect(latencyPercentiles([30, 10, 20])[50]).toBe(20);
    expect(latencyPercentiles([30, 10, 20])[100]).toBe(30);
  });
});
