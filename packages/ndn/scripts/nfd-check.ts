// `pnpm --filter @idem/ndn nfd:check` (or `pnpm exp:ndn`, which also starts and stops NFD): run the
// NFD check scenarios against the forwarders of experiments/ndn/nfd/compose.yaml and write a run
// folder under experiments/results/ndn-nfd/<run-id>/ (spec/05-evaluation.md layout).
//
//   node --import ./scripts/ts-resolve.mjs scripts/nfd-check.ts [--config <file>] [--only S1,S2]
//        (default config: experiments/ndn/nfd/config.json)
//        [--no-write] [--quiet]
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { cpus, loadavg, release, totalmem } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { sha256, utf8 } from "@idem/core";
import { dockerExec, type NfdCheckConfig, waitForNfd } from "./nfd/harness";
import { runScenario, SCENARIOS, type ScenarioResult, setupWorld } from "./nfd/scenarios";

const exec = promisify(execFile);
const HERE = import.meta.dirname;

function repoRoot(): string {
  let dir = HERE;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const up = dirname(dir);
    if (up === dir) throw new Error("no pnpm-workspace.yaml above this script");
    dir = up;
  }
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/** Same digest as `pnpm sim -- digest` (packages/sim/src/experiments/provenance.ts). */
async function sourceDigest(root: string): Promise<string> {
  const lines: [string, string][] = [];
  for (const pkg of await readdir(join(root, "packages"), { withFileTypes: true })) {
    const src = join(root, "packages", pkg.name, "src");
    if (!pkg.isDirectory() || !existsSync(src)) continue;
    for (const file of await walk(src)) {
      const path = relative(root, file).split(sep).join("/");
      if (path.includes("/__snapshots__/")) continue;
      if (/\.test\.[cm]?[jt]sx?$/.test(path) || /\.test-helpers\.[cm]?[jt]sx?$/.test(path)) continue;
      lines.push([path, hex(await sha256(new Uint8Array(await readFile(file)) as Uint8Array<ArrayBuffer>))]);
    }
  }
  lines.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return hex(await sha256(utf8(lines.map(([p, h]) => `${p}\0${h}\n`).join(""))));
}

/** Read-only `git rev-parse HEAD` (+ `-dirty`), or `none`; `GIT_OPTIONAL_LOCKS=0` so nothing is written. */
async function gitSha(root: string): Promise<string> {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
  try {
    const { stdout: top } = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: root, env });
    if (resolve(top.trim()) !== resolve(root)) return "none";
    const { stdout: sha } = await exec("git", ["rev-parse", "HEAD"], { cwd: root, env });
    const { stdout: dirty } = await exec("git", ["status", "--porcelain"], { cwd: root, env });
    return dirty.trim() === "" ? sha.trim() : `${sha.trim()}-dirty`;
  } catch {
    return "none";
  }
}

function runId(at: Date, digest: string): string {
  const stamp = at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return `${stamp}-${digest.slice(0, 8)}`;
}

async function versions(cfg: NfdCheckConfig) {
  const container = cfg.forwarders.edge1.container;
  const nfd = (await dockerExec(container, "nfd", "--version")).split("\n")[0];
  const { stdout: imageId } = await exec("docker", ["inspect", "--format", "{{.Image}}", container]);
  const { stdout: digests } = await exec("docker", [
    "image",
    "inspect",
    "--format",
    "{{json .RepoDigests}}",
    imageId.trim(),
  ]);
  const { stdout: docker } = await exec("docker", ["version", "--format", "{{.Server.Version}}"]);
  const ndnts: Record<string, string> = {};
  const mods = join(HERE, "..", "node_modules", "@ndn");
  for (const name of (await readdir(mods)).sort()) {
    const pkg = JSON.parse(await readFile(join(mods, name, "package.json"), "utf8")) as { version: string };
    ndnts[`@ndn/${name}`] = pkg.version;
  }
  return {
    nfd,
    image: {
      id: imageId.trim(),
      repoDigests: JSON.parse(digests) as string[],
      tag: "ghcr.io/named-data/nfd:20261105",
    },
    dockerServer: docker.trim(),
    ndnts,
  };
}

const csvCell = (v: unknown) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return /[",\n]/.test(s ?? "") ? `"${(s ?? "").replace(/"/g, '""')}"` : (s ?? "");
};

function metricsCsv(results: ScenarioResult[]): string {
  const rows = ["scenario,check,pass,expected,actual"];
  for (const r of results) {
    for (const c of r.checks) rows.push([r.id, c.name, c.pass, c.expected, c.actual].map(csvCell).join(","));
    if (r.error) rows.push([r.id, "no exception", false, "", r.error.split("\n")[0]].map(csvCell).join(","));
  }
  return `${rows.join("\n")}\n`;
}

function parseArgs(argv: string[]) {
  const o = {
    config: undefined as string | undefined,
    only: undefined as string[] | undefined,
    write: true,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue;
    if (a === "--config") o.config = argv[++i];
    else if (a === "--only") o.only = (argv[++i] ?? "").split(",");
    else if (a === "--no-write") o.write = false;
    else if (a === "--quiet") o.quiet = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot();
  // Under a pnpm script, relative paths are relative to where pnpm was invoked.
  const base = (process.env.npm_lifecycle_event && process.env.INIT_CWD) || process.cwd();
  const cfgPath =
    args.config === undefined
      ? join(root, "experiments", "ndn", "nfd", "config.json")
      : isAbsolute(args.config)
        ? args.config
        : resolve(base, args.config);
  const cfg = JSON.parse(await readFile(cfgPath, "utf8")) as NfdCheckConfig;
  const startedAt = new Date();
  const loadavgStart = loadavg().map((x) => Math.round(x * 1000) / 1000);
  const log = (s: string) => {
    if (!args.quiet) process.stderr.write(`${s}\n`);
  };

  await waitForNfd(cfg);
  const world = await setupWorld(cfg);
  const results: ScenarioResult[] = [];
  try {
    for (const s of SCENARIOS) {
      if (args.only && !args.only.includes(s.id)) continue;
      const r = await runScenario(world, s);
      results.push(r);
      log(`${r.pass ? "PASS" : "FAIL"} ${r.id} ${r.title} (${r.durationMs} ms)`);
      for (const c of r.checks.filter((c) => !c.pass)) {
        log(`     ✗ ${c.name}: expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(c.actual)}`);
      }
      if (r.error) log(`     ✗ ${r.error}`);
    }
  } finally {
    world.producer.close();
  }
  const finishedAt = new Date();
  const pass = results.length > 0 && results.every((r) => r.pass);
  log(`${results.filter((r) => r.pass).length}/${results.length} scenarios passed`);

  if (args.write) {
    const digest = await sourceDigest(root);
    const id = runId(startedAt, digest);
    const dir = join(root, "experiments", "results", cfg.experiment, id);
    if (existsSync(dir)) throw new Error(`run folder already exists: ${dir}`);
    const v = await versions(cfg);
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
      loadavgStart,
      loadavgEnd: loadavg().map((x) => Math.round(x * 1000) / 1000),
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      command: `pnpm --filter @idem/ndn nfd:check ${process.argv.slice(2).join(" ")}`.trim(),
      ...v,
    };
    const summary = {
      experiment: cfg.experiment,
      runId: id,
      pass,
      passed: results.filter((r) => r.pass).length,
      total: results.length,
      nfd: v.nfd,
      image: v.image,
      ndnts: v.ndnts["@ndn/packet"],
      scenarios: results,
    };
    const files: Record<string, string> = {
      "config.json": `${JSON.stringify(cfg, null, 2)}\n`,
      seed: `${cfg.seed}\n`,
      "git-sha": `${await gitSha(root)}\n`,
      "source-digest": `${digest}\n`,
      "env.json": `${JSON.stringify(env, null, 2)}\n`,
      "metrics.csv": metricsCsv(results),
      "summary.json": `${JSON.stringify(summary, null, 2)}\n`,
    };
    for (const f of Object.values(cfg.forwarders)) {
      const { stdout, stderr } = await exec("docker", ["logs", f.container], { maxBuffer: 64 * 1024 * 1024 });
      files[`${f.container}.log`] = `${stdout}${stderr}`;
    }
    await mkdir(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
    process.stdout.write(`${dir}\n`);
  }
  process.exit(pass ? 0 : 1);
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(2);
});
