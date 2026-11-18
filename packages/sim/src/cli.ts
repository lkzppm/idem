/**
 * `pnpm sim`: run an experiment of the evaluation (spec/05-evaluation.md) and write its run folder.
 * Node only (file system, OS facts); everything it calls lives in `./experiments` and is plain
 * TypeScript on Web APIs. Run through the `cli` script of this package (`pnpm sim -- …`).
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, loadavg, release, totalmem } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { type CliCommand, parseCliArgs, seedFile, USAGE, withSeed } from "./experiments/args";
import { calibrate } from "./experiments/calibrate";
import { type Cell, toCsv } from "./experiments/csv";
import { buildResultsData } from "./experiments/export";
import { MICROBENCH_COLUMNS, runMicrobench } from "./experiments/microbench";
import { digestOfSources, fromCwd, gitSha, loadRuns, repoRoot } from "./experiments/node-io";
import { runId } from "./experiments/provenance";
import { runSafety, SAFETY_COLUMNS, SAFETY_TRIAL_COLUMNS } from "./experiments/safety";
import { type ExperimentConfig, parseExperimentConfig, parseProcessingCosts } from "./experiments/spec";
import { CDF_COLUMNS, runSweep, SUMMARY_COLUMNS, SWEEP_COLUMNS } from "./experiments/sweep";
import type { ProcessingCosts } from "./processing";

function round3(v: number[]): number[] {
  return v.map((x) => Math.round(x * 1000) / 1000);
}

function progress(label: string, quiet: boolean): (done: number, total: number) => void {
  let last = -1;
  return (done, total) => {
    if (quiet) return;
    const pct = Math.floor((done / total) * 20) * 5;
    if (pct === last) return;
    last = pct;
    process.stderr.write(`  ${label}: ${pct}% (${done}/${total})\n`);
  };
}

async function loadConfig(
  path: string,
): Promise<{ cfg: ExperimentConfig; stored: unknown; costs?: ProcessingCosts }> {
  const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  const cfg = parseExperimentConfig(raw);
  if (cfg.kind !== "sweep" || cfg.processing === undefined) return { cfg, stored: cfg };
  if (typeof cfg.processing !== "string") return { cfg, stored: cfg, costs: cfg.processing };
  // A file name: read the cost table next to the config and store it inline, with its source.
  const file = resolve(dirname(path), cfg.processing);
  const table = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  const costs = parseProcessingCosts(table);
  return { cfg, stored: { ...cfg, processing: { file: cfg.processing, ...table } }, costs };
}

async function run(cmd: Extract<CliCommand, { command: "run" }>): Promise<void> {
  const root = repoRoot();
  const loaded = await loadConfig(fromCwd(cmd.config));
  const cfg = withSeed(loaded.cfg, cmd.seed);
  const stored = withSeed(loaded.stored as ExperimentConfig, cmd.seed);
  const digest = await digestOfSources(root);
  const startedAt = new Date();
  const id = cmd.runId ?? runId(startedAt, digest);
  const dir = join(
    cmd.results ? fromCwd(cmd.results) : join(root, "experiments", "results"),
    cfg.experiment,
    id,
  );
  if (existsSync(dir)) throw new Error(`run folder already exists: ${dir}`);
  const loadavgStart = round3(loadavg());
  if (!cmd.quiet) process.stderr.write(`${cfg.experiment} (${cfg.kind}) → ${relative(root, dir) || dir}\n`);

  const files: Record<string, string> = {};
  const csv = <K extends string>(columns: readonly K[], rows: readonly object[]) =>
    toCsv(columns, rows as readonly Partial<Record<K, Cell>>[]);
  if (cfg.kind === "sweep") {
    const { processing: _file, ...sweep } = cfg;
    const r = await runSweep(
      { ...sweep, ...(loaded.costs && { processing: loaded.costs }) },
      { onProgress: progress("runs", cmd.quiet) },
    );
    files["metrics.csv"] = csv(SWEEP_COLUMNS, r.rows);
    files["summary.csv"] = csv(SUMMARY_COLUMNS, r.summary);
    files["latency_cdf.csv"] = csv(CDF_COLUMNS, r.cdf);
  } else if (cfg.kind === "microbench") {
    const rows = await runMicrobench(cfg, { onProgress: progress("cells", cmd.quiet) });
    files["metrics.csv"] = csv(MICROBENCH_COLUMNS, rows);
  } else {
    const r = await runSafety(cfg, { onProgress: progress("trials", cmd.quiet) });
    files["metrics.csv"] = csv(SAFETY_COLUMNS, r.rows);
    files["trials.csv"] = csv(SAFETY_TRIAL_COLUMNS, r.trials);
  }

  const finishedAt = new Date();
  const cpu = cpus();
  const env = {
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    osRelease: release(),
    cpuModel: cpu[0]?.model ?? "unknown",
    cpuCores: cpu.length,
    totalMemBytes: totalmem(),
    // Other work shares this machine: the 1, 5 and 15 minute load averages around the run.
    loadavgStart,
    loadavgEnd: round3(loadavg()),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    command: `pnpm sim -- ${process.argv
      .slice(2)
      .filter((a) => a !== "--")
      .join(" ")}`,
  };
  files["config.json"] = `${JSON.stringify(stored, null, 2)}\n`;
  files.seed = `${seedFile(cfg)}\n`;
  files["git-sha"] = `${await gitSha(root)}\n`;
  files["source-digest"] = `${digest}\n`;
  files["env.json"] = `${JSON.stringify(env, null, 2)}\n`;
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
  if (!cmd.quiet) process.stderr.write(`  done in ${(env.durationMs / 1000).toFixed(1)} s\n`);
  process.stdout.write(`${dir}\n`);
}

async function main(): Promise<void> {
  const cmd = parseCliArgs(process.argv.slice(2));
  const root = repoRoot();
  const resultsDir =
    "results" in cmd && cmd.results ? fromCwd(cmd.results) : join(root, "experiments", "results");
  switch (cmd.command) {
    case "help":
      process.stdout.write(`${USAGE}\n`);
      return;
    case "digest":
      process.stdout.write(`${await digestOfSources(root)}\n`);
      return;
    case "run":
      return run(cmd);
    case "calibrate": {
      const runs = (await loadRuns(resultsDir, cmd.from)).filter(
        (r) => (r.config as { kind?: string }).kind === "microbench",
      );
      const latest = runs[runs.length - 1];
      if (!latest) throw new Error(`no microbench runs of "${cmd.from}" under ${resultsDir}`);
      const same = runs.filter((r) => JSON.stringify(r.config) === JSON.stringify(latest.config));
      const costs = calibrate(
        cmd.from,
        same.map((r) => ({
          id: r.id,
          rows: r.metrics.map((m) => ({
            op: m.op ?? "",
            size_bytes: Number(m.size_bytes),
            p50_us: Number(m.p50_us),
          })),
        })),
      );
      const out = cmd.out ? fromCwd(cmd.out) : join(root, "experiments", "configs", "processing.json");
      await writeFile(out, `${JSON.stringify(costs, null, 2)}\n`);
      process.stdout.write(`${out}\n`);
      return;
    }
    case "export-web": {
      const data = buildResultsData(await loadRuns(resultsDir), await digestOfSources(root));
      const out = cmd.out ? fromCwd(cmd.out) : join(root, "apps", "web", "lib", "results", "data.json");
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, `${JSON.stringify(data)}\n`);
      process.stdout.write(`${out}\n`);
      return;
    }
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});
