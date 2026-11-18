/**
 * File-system side of the evaluation pipeline: finding the repository, hashing the sources and
 * reading run folders. Node only; kept apart from the CLI entry point so tests can use it.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { parseCsv } from "./csv";
import type { LoadedRun } from "./export";
import { isSourceFile, type SourceFile, sourceDigest } from "./provenance";

const HERE = import.meta.dirname;

/** The repository root: the nearest folder above this file with a `pnpm-workspace.yaml`. */
export function repoRoot(): string {
  let dir = HERE;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const up = dirname(dir);
    if (up === dir) throw new Error("cannot find the repository root (no pnpm-workspace.yaml above the CLI)");
    dir = up;
  }
}

/** Paths on the command line are relative to where pnpm was invoked, not to this package. */
export function fromCwd(p: string): string {
  return isAbsolute(p) ? p : resolve(process.env.INIT_CWD ?? process.cwd(), p);
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/** The source digest of the checkout at `root` (see {@link sourceDigest}). */
export async function digestOfSources(root: string): Promise<string> {
  const files: SourceFile[] = [];
  const packages = join(root, "packages");
  for (const pkg of await readdir(packages, { withFileTypes: true })) {
    const src = join(packages, pkg.name, "src");
    if (!pkg.isDirectory() || !existsSync(src)) continue;
    for (const file of await walk(src)) {
      const path = relative(root, file).split(sep).join("/");
      if (isSourceFile(path)) files.push({ path, content: new Uint8Array(await readFile(file)) });
    }
  }
  return sourceDigest(files);
}

/** `git rev-parse HEAD` (with `-dirty` when the tree has changes), or `none` outside a repository. */
export async function gitSha(root: string): Promise<string> {
  const git = promisify(execFile);
  try {
    const { stdout: top } = await git("git", ["rev-parse", "--show-toplevel"], { cwd: root });
    if (resolve(top.trim()) !== resolve(root)) return "none";
    const { stdout: sha } = await git("git", ["rev-parse", "HEAD"], { cwd: root });
    const { stdout: dirty } = await git("git", ["status", "--porcelain"], { cwd: root });
    return dirty.trim() === "" ? sha.trim() : `${sha.trim()}-dirty`;
  } catch {
    return "none";
  }
}

/** Read one run folder; `undefined` if it lacks the files every finished run has. */
export async function readRun(dir: string, experiment: string, id: string): Promise<LoadedRun | undefined> {
  const text = async (name: string): Promise<string | undefined> => {
    try {
      return await readFile(join(dir, name), "utf8");
    } catch {
      return undefined;
    }
  };
  const [config, metrics, seed, git, digest, env, summary, cdf] = await Promise.all(
    [
      "config.json",
      "metrics.csv",
      "seed",
      "git-sha",
      "source-digest",
      "env.json",
      "summary.csv",
      "latency_cdf.csv",
    ].map(text),
  );
  // A folder without the files every run has is not a finished run.
  if (!config || !metrics || !seed || !env) return undefined;
  return {
    experiment,
    id,
    config: JSON.parse(config),
    seed: seed.trim(),
    gitSha: (git ?? "none").trim(),
    sourceDigest: (digest ?? "").trim(),
    env: JSON.parse(env) as Record<string, unknown>,
    metrics: parseCsv(metrics),
    ...(summary !== undefined && { summary: parseCsv(summary) }),
    ...(cdf !== undefined && { cdf: parseCsv(cdf) }),
  };
}

/** Every finished run under `resultsDir` (optionally of one experiment), oldest first. */
export async function loadRuns(resultsDir: string, only?: string): Promise<LoadedRun[]> {
  const runs: LoadedRun[] = [];
  if (!existsSync(resultsDir)) return runs;
  for (const exp of await readdir(resultsDir, { withFileTypes: true })) {
    if (!exp.isDirectory() || (only !== undefined && exp.name !== only)) continue;
    for (const r of await readdir(join(resultsDir, exp.name), { withFileTypes: true })) {
      if (!r.isDirectory()) continue;
      const loaded = await readRun(join(resultsDir, exp.name, r.name), exp.name, r.name);
      if (loaded) runs.push(loaded);
    }
  }
  return runs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
