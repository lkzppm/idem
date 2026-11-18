import { describe, expect, it } from "vitest";
import { parseCliArgs, seedFile, withSeed } from "./args";
import type { MicrobenchConfig, SafetyConfig, SweepConfig } from "./spec";

describe("pnpm sim arguments", () => {
  it("runs an experiment from --config, as documented in CLAUDE.md", () => {
    expect(parseCliArgs(["--", "--config", "experiments/configs/e2-swarm.json", "--seed", "42"])).toEqual({
      command: "run",
      config: "experiments/configs/e2-swarm.json",
      seed: 42,
      quiet: false,
    });
    expect(parseCliArgs(["--config", "c.json", "--results", "out", "--run-id", "r1", "--quiet"])).toEqual({
      command: "run",
      config: "c.json",
      results: "out",
      runId: "r1",
      quiet: true,
    });
  });

  it("parses the other commands", () => {
    expect(parseCliArgs([])).toEqual({ command: "help" });
    expect(parseCliArgs(["--help"])).toEqual({ command: "help" });
    expect(parseCliArgs(["digest"])).toEqual({ command: "digest" });
    expect(parseCliArgs(["calibrate", "--from", "e1-node"])).toEqual({
      command: "calibrate",
      from: "e1-node",
    });
    expect(parseCliArgs(["--", "export-web", "--out", "data.json"])).toEqual({
      command: "export-web",
      out: "data.json",
    });
  });

  it("rejects bad usage with a message", () => {
    expect(() => parseCliArgs(["--seed", "1"])).toThrow(/--config/);
    expect(() => parseCliArgs(["--config"])).toThrow(/needs a value/);
    expect(() => parseCliArgs(["--config", "c.json", "--seed", "1.5"])).toThrow(/--seed/);
    expect(() => parseCliArgs(["--config", "c.json", "--seed", "-3"])).toThrow();
    expect(() => parseCliArgs(["--config", "c.json", "--run-id", "../x"])).toThrow(/--run-id/);
    expect(() => parseCliArgs(["--config", "c.json", "--fast"])).toThrow(/unknown option/);
    expect(() => parseCliArgs(["--config", "c.json", "extra"])).toThrow(/unexpected argument/);
    expect(() => parseCliArgs(["calibrate"])).toThrow(/--from/);
    expect(() => parseCliArgs(["digest", "--out", "x"])).toThrow(/does not apply/);
    expect(() => parseCliArgs(["launch"])).toThrow(/unknown command/);
  });

  const sweep = { kind: "sweep", seeds: { first: 1, count: 30 } } as SweepConfig;
  const micro = { kind: "microbench", seed: 1 } as MicrobenchConfig;
  const safety = { kind: "safety", seed: 1, trials: 250 } as SafetyConfig;

  it("applies --seed to the seed of E1/E5 and to the first seed of a sweep", () => {
    expect(withSeed(sweep, 42).seeds).toEqual({ first: 42, count: 30 });
    expect(withSeed(micro, 42).seed).toBe(42);
    expect(withSeed(safety, 42).seed).toBe(42);
    expect(withSeed(sweep, undefined)).toBe(sweep);
    expect(sweep.seeds.first).toBe(1);
  });

  it("writes the seed file as one seed or an inclusive range", () => {
    expect(seedFile(micro)).toBe("1");
    expect(seedFile(sweep)).toBe("1..30");
    expect(seedFile(withSeed(sweep, 42))).toBe("42..71");
    expect(seedFile(safety)).toBe("1..250");
    expect(seedFile({ ...sweep, seeds: { first: 7, count: 1 } })).toBe("7");
  });
});
