import type { ExperimentConfig } from "./spec";

/** A parsed `pnpm sim` command line. */
export type CliCommand =
  | {
      command: "run";
      /** Path of the experiment config (JSON). */
      config: string;
      /** Overrides the config's seed (for a sweep, its first seed). */
      seed?: number;
      /** Results root. Default: `experiments/results` at the repository root. */
      results?: string;
      /** Run folder name. Default: timestamp plus source digest. */
      runId?: string;
      quiet: boolean;
    }
  | { command: "calibrate"; from: string; out?: string; results?: string }
  | { command: "export-web"; out?: string; results?: string }
  | { command: "digest" }
  | { command: "help" };

export const USAGE = `Usage:
  pnpm sim -- --config <file.json> [--seed <n>] [--results <dir>] [--run-id <id>] [--quiet]
      Run one experiment (E1 microbench, E2 sweep or E5 safety) and write
      <results>/<experiment>/<run-id>/ with config.json, metrics.csv, seed, git-sha,
      source-digest and env.json (plus summary.csv and latency_cdf.csv for sweeps,
      trials.csv for the safety suite).
  pnpm sim -- calibrate --from <experiment> [--out <file.json>] [--results <dir>]
      Turn the E1 runs of <experiment> into the processing-cost table E2 charges.
  pnpm sim -- export-web [--out <file.json>] [--results <dir>]
      Write the JSON the /results page is built from.
  pnpm sim -- digest
      Print the source digest of packages/*/src (tests excluded).

Paths are relative to where pnpm was invoked.`;

function value(argv: readonly string[], i: number, flag: string): string {
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
  return v;
}

/** Parse the arguments after `pnpm sim --`. Throws an `Error` with a usage problem. */
export function parseCliArgs(argv: readonly string[]): CliCommand {
  // pnpm forwards a literal "--" when the script is invoked as `pnpm sim -- …`.
  const args = argv.filter((a) => a !== "--");
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) return { command: "help" };
  const first = args[0] as string;
  const command = first.startsWith("--") ? "run" : first;
  const rest = first.startsWith("--") ? args : args.slice(1);
  const flags = new Map<string, string | true>();
  const takesValue = new Set(["--config", "--seed", "--results", "--run-id", "--from", "--out"]);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] as string;
    if (!a.startsWith("--")) throw new Error(`unexpected argument "${a}"`);
    if (takesValue.has(a)) {
      flags.set(a, value(rest, i, a));
      i++;
    } else if (a === "--quiet") flags.set(a, true);
    else throw new Error(`unknown option "${a}"`);
  }
  const text = (flag: string): string | undefined => {
    const v = flags.get(flag);
    return typeof v === "string" ? v : undefined;
  };
  const allow = (...allowed: string[]) => {
    for (const f of flags.keys()) {
      if (!allowed.includes(f)) throw new Error(`option "${f}" does not apply to "${command}"`);
    }
  };
  const results = text("--results");
  const out = text("--out");
  switch (command) {
    case "run": {
      allow("--config", "--seed", "--results", "--run-id", "--quiet");
      const config = text("--config");
      if (!config) throw new Error("--config <file.json> is required");
      const seedText = text("--seed");
      const seed = seedText === undefined ? undefined : Number(seedText);
      if (seed !== undefined && (!Number.isInteger(seed) || seed < 0)) {
        throw new Error("--seed must be a non-negative integer");
      }
      const runId = text("--run-id");
      if (runId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) {
        throw new Error("--run-id may contain letters, digits, dot, dash and underscore");
      }
      return {
        command,
        config,
        ...(seed !== undefined && { seed }),
        ...(results !== undefined && { results }),
        ...(runId !== undefined && { runId }),
        quiet: flags.has("--quiet"),
      };
    }
    case "calibrate": {
      allow("--from", "--out", "--results");
      const from = text("--from");
      if (!from) throw new Error("calibrate needs --from <experiment>");
      return { command, from, ...(out !== undefined && { out }), ...(results !== undefined && { results }) };
    }
    case "export-web":
      allow("--out", "--results");
      return { command, ...(out !== undefined && { out }), ...(results !== undefined && { results }) };
    case "digest":
      allow();
      return { command };
    default:
      throw new Error(`unknown command "${command}"`);
  }
}

/** A copy of `cfg` with `--seed` applied: the seed of E1/E5, the first seed of a sweep. */
export function withSeed<T extends ExperimentConfig>(cfg: T, seed: number | undefined): T {
  if (seed === undefined) return cfg;
  if (cfg.kind === "sweep") return { ...cfg, seeds: { ...cfg.seeds, first: seed } };
  return { ...cfg, seed };
}

/** The contents of a run's `seed` file: one seed, or an inclusive range `first..last`. */
export function seedFile(cfg: ExperimentConfig): string {
  if (cfg.kind === "sweep") {
    return cfg.seeds.count === 1
      ? `${cfg.seeds.first}`
      : `${cfg.seeds.first}..${cfg.seeds.first + cfg.seeds.count - 1}`;
  }
  if (cfg.kind === "safety")
    return cfg.trials === 1 ? `${cfg.seed}` : `${cfg.seed}..${cfg.seed + cfg.trials - 1}`;
  return `${cfg.seed}`;
}
