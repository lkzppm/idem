import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv";
import { buildResultsData, type LoadedRun, missOverhead, runRef, sweepData } from "./export";
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

async function sweepRun(id: string): Promise<LoadedRun> {
  const file = join(ROOT, "experiments", "configs", "e2-agents.json");
  const cfg = parseExperimentConfig(JSON.parse(readFileSync(file, "utf8"))) as SweepConfig;
  const { processing: _file, ...rest } = cfg;
  const small: ResolvedSweep = {
    ...rest,
    seeds: { first: 1, count: 2 },
    modes: ["B0", "B2"],
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
