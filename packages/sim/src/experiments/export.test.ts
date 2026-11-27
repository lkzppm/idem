import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv";
import {
  buildResultsData,
  emulationData,
  type LoadedRun,
  missOverhead,
  nfdRunData,
  runRef,
  sweepData,
} from "./export";
import { loadRuns, repoRoot } from "./node-io";
import { parseExperimentConfig, type SweepConfig } from "./spec";
import { CDF_COLUMNS, type ResolvedSweep, runSweep, SUMMARY_COLUMNS } from "./sweep";

const ROOT = repoRoot();
const ENV = {
  node: "v24.0.0",
  platform: "linux",
  arch: "x64",
  cpuModel: "Test CPU",
  cpuCores: 4,
  loadavgStart: [0.1, 0.2, 0.3],
  loadavgEnd: [0.4, 0.5, 0.6],
  startedAt: "2026-11-17T00:00:00.000Z",
  durationMs: 1234,
};
const rows = (text: string) => parseCsv(text);

async function sweepRun(id: string, modes: ResolvedSweep["modes"] = ["B0", "B2"]): Promise<LoadedRun> {
  const file = join(ROOT, "experiments", "configs", "e2-agents.json");
  const cfg = parseExperimentConfig(JSON.parse(readFileSync(file, "utf8"))) as SweepConfig;
  const { processing: _file, ...rest } = cfg;
  const small: ResolvedSweep = {
    ...rest,
    seeds: { first: 1, count: 2 },
    modes,
    sweep: { param: "agents", values: [2, 4] },
    base: { ...cfg.base, workload: { ...cfg.base.workload, callsPerAgent: 5 } },
  };
  const r = await runSweep(small);
  return {
    experiment: "e2-agents",
    id,
    config: { ...small, processing: { source: { experiment: "e1-node", runs: ["a", "b"] } } },
    seed: "1..2",
    gitSha: "none",
    sourceDigest: "d".repeat(64),
    env: ENV,
    metrics: [],
    summary: rows(toCsv(SUMMARY_COLUMNS, r.summary)),
    cdf: rows(toCsv(CDF_COLUMNS, r.cdf)),
  };
}

function microRun(id: string, scale: number): LoadedRun {
  const ops = ["canonicalizeArgs", "makeName", "signData", "verifyData"];
  const sizes = [1024, 16384];
  return {
    experiment: "e1-node",
    id,
    config: {
      experiment: "e1-node",
      kind: "microbench",
      seed: 1,
      ops,
      sizesBytes: sizes,
      iterations: [10, 10],
      warmupFraction: 0.2,
    },
    seed: "1",
    gitSha: "none",
    sourceDigest: "d".repeat(64),
    env: ENV,
    metrics: ops.flatMap((op, i) =>
      sizes.map((size, j) => ({
        op,
        size_bytes: String(size),
        input_bytes: String(size + 60),
        iterations: "10",
        p50_us: String(scale * (10 * (i + 1) + 100 * j)),
        p95_us: String(scale * (20 * (i + 1) + 100 * j)),
        p99_us: String(scale * (30 * (i + 1) + 100 * j)),
      })),
    ),
  };
}

describe("export for the /results page", () => {
  it("carries a run's provenance", () => {
    expect(runRef(microRun("r1", 1))).toEqual({
      experiment: "e1-node",
      id: "r1",
      seed: "1",
      gitSha: "none",
      sourceDigest: "d".repeat(64),
      node: "v24.0.0",
      platform: "linux x64",
      cpu: "Test CPU",
      cores: 4,
      loadavgStart: [0.1, 0.2, 0.3],
      loadavgEnd: [0.4, 0.5, 0.6],
      startedAt: "2026-11-17T00:00:00.000Z",
      durationMs: 1234,
    });
  });

  it("reshapes a sweep: one statistic per mode and value, the latency distribution at the base point", async () => {
    const run = await sweepRun("20261117T000000Z-dddddddd");
    const s = sweepData(run);
    expect(s.param).toBe("agents");
    expect(s.values).toEqual([2, 4]);
    expect(s.baseValue).toBe(8);
    // The base (8 agents) is not swept here: the closest swept value stands in.
    expect(s.cdfValue).toBe(4);
    expect(s.seeds).toBe(2);
    expect(s.modes).toEqual([
      { id: "B0", name: "mcp-direct" },
      { id: "B2", name: "idem" },
    ]);
    expect(s.processing).toEqual({ experiment: "e1-node", runs: ["a", "b"] });
    expect(s.metrics.upstream_calls?.B0?.map((x) => x.mean)).toEqual([10, 20]);
    expect(s.metrics.upstream_reduction?.B0?.map((x) => x.mean)).toEqual([0, 0]);
    const reduction = s.metrics.upstream_reduction?.B2;
    expect(reduction).toHaveLength(2);
    expect(reduction?.[0]?.n).toBe(2);
    expect(s.cdf.B0).toHaveLength(101);
    expect(s.cdf.B2).toHaveLength(101);
    const cdf = s.cdf.B2 as number[];
    for (let q = 1; q <= 100; q++) expect(cdf[q] as number).toBeGreaterThanOrEqual(cdf[q - 1] as number);
  });

  it("carries B5 like any mode, with its gateway counters and the reduction against it", async () => {
    const s = sweepData(await sweepRun("20261117T000000Z-dddddddd", ["B0", "B2", "B5"]));
    expect(s.modes).toEqual([
      { id: "B0", name: "mcp-direct" },
      { id: "B2", name: "idem" },
      { id: "B5", name: "mcp-gateway-cache" },
    ]);
    expect(s.metrics.upstream_reduction_vs_b5?.B5?.map((x) => x.mean)).toEqual([0, 0]);
    expect(s.metrics.upstream_reduction_vs_b5?.B2).toHaveLength(2);
    expect(s.metrics.gateway_cache_hits?.B5).toHaveLength(2);
    expect(s.metrics.gateway_inflight_duplicates?.B5).toHaveLength(2);
    expect(s.metrics.gateway_cache_hits?.B2?.map((x) => x.mean)).toEqual([0, 0]);
    expect(s.cdf.B5).toHaveLength(101);
  });

  it("reads the base value of the W-code parameters (ADR-037)", () => {
    const file = join(ROOT, "experiments", "configs", "e2-agents.json");
    const cfg = parseExperimentConfig(JSON.parse(readFileSync(file, "utf8"))) as SweepConfig;
    const run = (param: string, workload: object): LoadedRun => ({
      experiment: "x",
      id: "r",
      config: { ...cfg, sweep: { param, values: [1, 4] }, base: { ...cfg.base, workload } },
      seed: "1",
      gitSha: "none",
      sourceDigest: "d",
      env: ENV,
      metrics: [],
      summary: [],
      cdf: [],
    });
    expect(sweepData(run("burstSize", cfg.base.workload)).baseValue).toBe(1);
    expect(
      sweepData(run("burstSize", { ...cfg.base.workload, burst: { size: 4, parallel: true } })).baseValue,
    ).toBe(4);
    expect(sweepData(run("startSpreadMs", cfg.base.workload)).baseValue).toBe(cfg.base.workload.thinkTimeMs);
    expect(sweepData(run("startSpreadMs", { ...cfg.base.workload, startSpreadMs: 0 })).baseValue).toBe(0);
  });

  it("combines repeated E1 runs by the median of their statistics and keeps the spread", () => {
    const data = buildResultsData([microRun("r1", 1), microRun("r3", 3), microRun("r2", 2)], "x");
    expect(data.e1?.runs.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
    const sign = data.e1?.ops.find((o) => o.op === "signData")?.cells;
    expect(sign?.map((c) => c.sizeBytes)).toEqual([1024, 16384]);
    // signData is the third operation: 30 µs at 1 KiB in run r1, twice and three times that in r2 and r3.
    expect(sign?.[0]).toMatchObject({
      p50Us: 60,
      p50MinUs: 30,
      p50MaxUs: 90,
      p95Us: 120,
      p99Us: 180,
      inputBytes: 1084,
    });
    // No sweep: nothing to price a miss against.
    expect(data.missOverhead).toBeNull();
  });

  it("leaves out E1 runs made with another config", () => {
    const old = microRun("r0", 9);
    (old.config as { seed: number }).seed = 2;
    const data = buildResultsData([old, microRun("r1", 1)], "x");
    expect(data.e1?.runs.map((r) => r.id)).toEqual(["r1"]);
  });

  it("uses the latest run of a sweep and prices a miss from E1", async () => {
    const older = await sweepRun("20261117T000000Z-dddddddd");
    const newer = { ...older, id: "20261117T010000Z-dddddddd" };
    const data = buildResultsData([newer, older, microRun("r1", 1)], "digest");
    expect(data.sourceDigest).toBe("digest");
    expect(Object.keys(data.sweeps)).toEqual(["e2-agents"]);
    expect(data.sweeps["e2-agents"]?.run.id).toBe("20261117T010000Z-dddddddd");
    const m = data.missOverhead;
    expect(m?.roundTripMs).toBe(90);
    expect(m?.serviceMedianMs).toBe(150);
    expect(m?.steps.map((x) => x.who)).toEqual(["consumer", "edge", "producer", "edge", "consumer"]);
    expect(m?.totalUs).toBeCloseTo(
      (m?.steps ?? []).reduce((s, x) => s + x.us, 0),
      9,
    );
  });

  it("prices a miss: consumer names, edge checks, producer signs, edge and consumer verify", () => {
    const costs = {
      sizesBytes: [1024, 8192],
      canonicalizeUs: [10, 10],
      nameUs: [20, 20],
      signUs: [40, 40],
      verifyUs: [60, 60],
    };
    const base = {
      producer: { pageBytesMedian: 6144, serviceMedianMs: 150 },
      topology: { agentLinkMs: 5, producerLinkMs: 40 },
    };
    const m = missOverhead(costs, base as never);
    expect(m.steps.map((x) => x.us)).toEqual([30, 20, 70, 60, 60]);
    expect(m.totalUs).toBe(240);
    expect(m.argBytes).toBe(1024);
    expect(m.resultBytes).toBe(6144);
  });

  it("reads the safety table with its mechanisms", () => {
    const run: LoadedRun = {
      experiment: "e5-safety",
      id: "r1",
      config: { experiment: "e5-safety", kind: "safety", seed: 1, trials: 3 },
      seed: "1..3",
      gitSha: "none",
      sourceDigest: "d",
      env: ENV,
      metrics: [
        {
          attack: "replay",
          variant: "replay/expired@upstream",
          where: "producer link",
          expected: "rejected",
          trials: "3",
          rejected: "1",
          accepted: "2",
          mechanisms: "ACCEPTED: a=b; c=2 | Nack TIMEOUT=1",
          assumes: "",
          summary: "s",
        },
      ],
    };
    const e5 = buildResultsData([run], "x").e5;
    expect(e5?.trials).toBe(3);
    expect(e5?.rows[0]).toMatchObject({ rejected: 1, accepted: 2, expected: "rejected" });
    expect(e5?.rows[0]?.mechanisms).toEqual([
      { mechanism: "ACCEPTED: a=b; c", count: 2 },
      { mechanism: "Nack TIMEOUT", count: 1 },
    ]);
    // A run made before the baseline rows existed: no `mirrors` column, no baseline.
    expect(e5).not.toHaveProperty("baseline");
    expect(e5?.rows[0]).not.toHaveProperty("mirrors");
  });

  it("keeps the B5 baseline rows apart from the IDEM rows (ADR-036)", () => {
    const line = (variant: string, expected: string, mirrors: string, accepted: number) => ({
      attack: "tamper",
      variant,
      where: "w",
      expected,
      trials: "3",
      rejected: String(3 - accepted),
      accepted: String(accepted),
      mechanisms: accepted ? `ACCEPTED: x=${accepted}` : "edge=3",
      assumes: "",
      summary: "s",
      mirrors,
    });
    const run: LoadedRun = {
      experiment: "e5-safety",
      id: "r1",
      config: { experiment: "e5-safety", kind: "safety", seed: 1, trials: 3 },
      seed: "1..3",
      gitSha: "none",
      sourceDigest: "d",
      env: ENV,
      metrics: [
        line("tamper/content@upstream", "rejected", "", 0),
        line("baseline/tamper@upstream", "baseline", "tamper/content@upstream", 3),
      ],
    };
    const e5 = buildResultsData([run], "x").e5;
    expect(e5?.rows.map((r) => r.variant)).toEqual(["tamper/content@upstream"]);
    expect(e5?.rows[0]).not.toHaveProperty("mirrors");
    expect(e5?.baseline).toEqual([
      expect.objectContaining({
        variant: "baseline/tamper@upstream",
        expected: "baseline",
        mirrors: "tamper/content@upstream",
        accepted: 3,
        mechanisms: [{ mechanism: "ACCEPTED: x", count: 3 }],
      }),
    ]);
  });

  // A synthetic run folder in the shape `pnpm exp:e4` writes. It exists only in this test: the page
  // shows E4 when a real run folder is committed, and never before.
  function e4Run(id: string): LoadedRun {
    const summary: Record<string, string>[] = [];
    const cdf: Record<string, string>[] = [];
    for (const mode of ["B2", "N2"]) {
      for (const loss of [0, 5]) {
        summary.push({
          mode,
          loss_pct: String(loss),
          metric: "success_ratio",
          n: "3",
          mean: loss === 0 ? "1" : "0.9",
          sd: "0.01",
          ci95: "0.02",
          min: "0.88",
          max: "1",
        });
        for (const p of [0, 1, 100]) {
          cdf.push({ mode, loss_pct: String(loss), percentile: String(p), latency_ms: String(p + loss) });
        }
      }
    }
    return {
      experiment: "e4",
      id,
      config: {
        experiment: "e4",
        kind: "emulation",
        title: "E4 test",
        seeds: { first: 1, count: 3 },
        modes: ["B2", "N2"],
        lossPct: [0, 5],
        workload: {
          agents: 8,
          callsPerAgent: 20,
          catalogSize: 50,
          zipfAlpha: 0.8,
          overlap: 0.5,
          thinkTimeMs: 2000,
        },
        links: { agentMs: 5, starProducerMs: 40, treeCoreMs: 10, treeProducerMs: 30, rateMbit: null },
        producer: { serviceMedianMs: 150, ttlMs: 60000, pageBytesMedian: 2048 },
        native: { interestLifetimeMs: 1000, retransmissions: 4 },
      },
      seed: "1..3",
      gitSha: "none",
      sourceDigest: "d",
      env: { ...ENV, discardedRuns: [{ key: "x" }] },
      metrics: [],
      summary,
      cdf,
    };
  }

  it("reshapes an E4 run by mode and loss, with the latency distribution per loss", () => {
    const e4 = emulationData(e4Run("r1"));
    expect(e4?.lossPct).toEqual([0, 5]);
    expect(e4?.modes).toEqual([
      { id: "B2", binding: "overlay" },
      { id: "N2", binding: "native" },
    ]);
    expect(e4?.metrics.success_ratio?.N2?.[1]).toMatchObject({ mean: 0.9, ci95: 0.02, n: 3 });
    expect(e4?.cdf.B2?.[1]?.[100]).toBe(105);
    expect(e4?.discardedRuns).toBe(1);
    expect(buildResultsData([e4Run("r1")], "x").e4?.seeds).toBe(3);
  });

  it("has no E4 until a run with a summary exists", () => {
    expect(buildResultsData([], "x").e4).toBeNull();
    const { summary: _s, ...bare } = e4Run("r1");
    expect(buildResultsData([bare], "x").e4).toBeNull();
  });

  it("reads the NFD conformance runs, keeping a scenario that stopped on an error", () => {
    const run = (id: string, ok: boolean): LoadedRun => ({
      experiment: "ndn-nfd",
      id,
      config: { experiment: "ndn-nfd", kind: "nfd-check", seed: 7 },
      seed: "7",
      gitSha: "none",
      sourceDigest: "d",
      env: ENV,
      metrics: [],
      summaryJson: {
        pass: ok,
        passed: ok ? 2 : 1,
        total: 2,
        nfd: "24.07",
        ndnts: "0.0.1",
        image: { tag: "ghcr.io/named-data/nfd:x" },
        scenarios: [
          { id: "S1", title: "one", rules: ["P-9.1"], pass: true, checks: [{ pass: true }], durationMs: 5 },
          {
            id: "S2",
            title: "two",
            pass: ok,
            checks: ok ? [{ pass: true }] : [],
            ...(ok ? {} : { error: "Error: boom\n    at x" }),
            durationMs: 7,
          },
        ],
      },
    });
    const nfd = buildResultsData([run("a", true), run("b", false)], "x").nfd;
    expect(nfd?.runs.map((r) => [r.run.id, r.passed, r.total])).toEqual([
      ["a", 2, 2],
      ["b", 1, 2],
    ]);
    expect(nfd?.runs[1]?.scenarios[1]).toMatchObject({ pass: false, checks: 0, error: "Error: boom" });
    expect(nfdRunData({ ...run("c", true), summaryJson: undefined })).toBeUndefined();
  });

  // The page shows only what is committed: the JSON it imports must be exactly what the committed
  // run folders produce (`pnpm sim -- export-web`). The source digest is left out of the comparison:
  // it names the code at export time and moves with every change to the packages.
  it("matches the committed run folders (apps/web/lib/results/data.json is up to date)", async () => {
    const file = join(ROOT, "apps", "web", "lib", "results", "data.json");
    if (!existsSync(file)) return;
    const committed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const built = buildResultsData(
      await loadRuns(join(ROOT, "experiments", "results")),
      "",
    ) as unknown as Record<string, unknown>;
    const strip = ({ sourceDigest: _d, ...rest }: Record<string, unknown>) =>
      JSON.parse(JSON.stringify(rest));
    expect(strip(committed)).toEqual(strip(built));
  });
});
