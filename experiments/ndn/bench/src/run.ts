/**
 * E4 orchestrator (host side): `pnpm exp:e4 [-- options]`.
 *
 *   --config <path>    experiments/ndn/bench/configs/e4.json (default)
 *   --seeds a..b       override the seeds          --modes B2,N2   override the modes
 *   --loss 0,5         override the loss sweep     --calls n       override callsPerAgent
 *   --out <dir>        results root (default experiments/results); overrides are recorded
 *   --keep-up          leave the stack running at the end (debugging only)
 *
 * Builds the Node image, brings `compose.yaml` up, creates the NFD faces, then for every run
 * (seed × loss × mode, `runPlan`): shapes every link with netem, clears the Content Stores, starts
 * the producer (and the HTTP forwarders for overlay modes) with `docker exec`, lets the agents
 * hand-shake, snapshots every counter, releases the agents, snapshots again, stops the roles and
 * keeps the numbers. Writes `experiments/results/<experiment>/<run-id>/` (spec 05) and always
 * tears the stack down.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, loadavg, release, totalmem } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { toCsv } from "../../../../packages/sim/src/experiments/csv";
import { digestOfSources, gitSha, repoRoot } from "../../../../packages/sim/src/experiments/node-io";
import { runId } from "../../../../packages/sim/src/experiments/provenance";
import { type E4Config, loadConfig, MODES, type RunKey, runLabel, runPlan, seedsOf } from "./config";
import {
  CDF_COLUMNS,
  cdfRows,
  type ForwarderNode,
  type GatewayStats,
  HOP_COLUMNS,
  type HopRow,
  hopRows,
  METRIC_COLUMNS,
  type MetricRow,
  metricRow,
  type ProducerStats,
  pairWithB0,
  type Snapshot,
  SUMMARY_COLUMNS,
  summaryRows,
} from "./metrics";
import {
  docker,
  dockerExec,
  type IfCounters,
  parseCsInfo,
  parseFaces,
  parseIpAddr,
  parseNetDev,
  parseSnmp,
} from "./probe";
import type { CallRow } from "./roles/agents";
import {
  CONTAINERS,
  HTTP_PORT,
  hopsOf,
  interfaces,
  ipOn,
  type LinkId,
  linkDelayMs,
  NDN_PORT,
  NDN_PREFIX,
  type NodeId,
} from "./topology";
import { oracle } from "./workload";

const ROOT = repoRoot();
const BENCH = join(ROOT, "experiments", "ndn", "bench");
const WORK = join(BENCH, ".work");
const PROJECT = "idem-bench";
const COMPOSE = ["compose", "-p", PROJECT, "-f", join(BENCH, "compose.yaml")];
const NODE_IMAGE = "idem-bench-node:local";
const FORWARDERS: ForwarderNode[] = ["edge1", "edge2", "regional", "producer"];
const NODES: NodeId[] = ["agents", "edge1", "edge2", "regional", "producer"];

const log = (s: string) => process.stderr.write(`${s}\n`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------------------------ arguments

interface Args {
  config: string;
  seeds?: [number, number];
  modes?: string[];
  loss?: number[];
  calls?: number;
  out?: string;
  keepUp: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { config: "experiments/ndn/bench/configs/e4.json", keepUp: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${k} needs a value`);
      return x;
    };
    if (k === "--") continue;
    else if (k === "--config") a.config = v();
    else if (k === "--seeds") {
      const m = /^(\d+)(?:\.\.(\d+))?$/.exec(v());
      if (!m) throw new Error("--seeds a..b");
      a.seeds = [Number(m[1]), Number(m[2] ?? m[1])];
    } else if (k === "--modes") a.modes = v().split(",");
    else if (k === "--loss") a.loss = v().split(",").map(Number);
    else if (k === "--calls") a.calls = Number(v());
    else if (k === "--out") a.out = v();
    else if (k === "--keep-up") a.keepUp = true;
    else throw new Error(`unknown option ${k}`);
  }
  return a;
}

function resolveConfig(a: Args): E4Config {
  const cfg = loadConfig(join(ROOT, a.config));
  if (a.seeds) cfg.seeds = { first: a.seeds[0], count: a.seeds[1] - a.seeds[0] + 1 };
  if (a.modes) cfg.modes = a.modes as E4Config["modes"];
  if (a.loss) cfg.lossPct = a.loss;
  if (a.calls) cfg.workload.callsPerAgent = a.calls;
  return loadConfigCheck(cfg);
}

function loadConfigCheck(cfg: E4Config): E4Config {
  for (const m of cfg.modes) if (!(m in MODES)) throw new Error(`unknown mode ${m}`);
  return cfg;
}

// ------------------------------------------------------------------------------------ the stack

async function down(): Promise<void> {
  await docker([...COMPOSE, "down", "--volumes", "--remove-orphans", "--timeout", "5"], 120_000).catch((e) =>
    log(`compose down failed: ${String(e)}`),
  );
}

async function up(): Promise<void> {
  log("building the Node image and starting the stack…");
  await docker(
    ["build", "-q", "-t", NODE_IMAGE, "-f", join(BENCH, "docker", "node.Dockerfile"), join(BENCH, "docker")],
    600_000,
  );
  await docker([...COMPOSE, "up", "-d"], 300_000);
  for (const n of FORWARDERS) {
    const c = CONTAINERS[n].nfd as string;
    for (let i = 0; ; i++) {
      try {
        await dockerExec(c, ["nfdc", "status"]);
        break;
      } catch (e) {
        if (i > 100) throw new Error(`NFD in ${c} is not answering: ${String(e)}`);
        await sleep(200);
      }
    }
  }
}

/** Interface name of every (node, link), from the addresses in each namespace. */
async function interfaceNames(): Promise<Record<NodeId, Partial<Record<LinkId, string>>>> {
  const out = Object.fromEntries(NODES.map((n) => [n, {}])) as Record<
    NodeId,
    Partial<Record<LinkId, string>>
  >;
  for (const n of NODES) {
    const byIp = parseIpAddr(await dockerExec(CONTAINERS[n].node, ["ip", "-o", "-4", "addr", "show"]));
    for (const i of interfaces().filter((x) => x.node === n)) {
      const name = byIp.get(i.ip);
      if (!name) throw new Error(`no interface with ${i.ip} in ${n}`);
      out[n][i.link] = name;
    }
  }
  return out;
}

/** netem on both ends of every link: the link's one-way delay, the run's loss, optional rate. */
async function shape(cfg: E4Config, ifs: Record<NodeId, Partial<Record<LinkId, string>>>, lossPct: number) {
  const settings: Record<string, string> = {};
  await Promise.all(
    interfaces().map(async (i) => {
      const dev = ifs[i.node][i.link] as string;
      const args = ["delay", `${linkDelayMs(cfg, i.link)}ms`];
      if (lossPct > 0) args.push("loss", `${lossPct}%`);
      if (cfg.links.rateMbit) args.push("rate", `${cfg.links.rateMbit}mbit`);
      args.push("limit", "10000");
      await dockerExec(CONTAINERS[i.node].node, [
        "tc",
        "qdisc",
        "replace",
        "dev",
        dev,
        "root",
        "netem",
        ...args,
      ]);
      const shown = await dockerExec(CONTAINERS[i.node].node, ["tc", "qdisc", "show", "dev", dev]);
      settings[`${i.node}/${i.link}/${dev}`] = shown.trim();
    }),
  );
  return settings;
}

/** Permanent UDP faces between forwarders; returns face ids per (node, link). */
async function createFaces(): Promise<Partial<Record<string, number>>> {
  const out: Partial<Record<string, number>> = {};
  for (const topology of ["star", "tree"] as const) {
    for (const h of hopsOf(topology)) {
      const key = `${h.node}/${h.link}`;
      if (out[key] !== undefined) continue;
      const uri = `udp4://${ipOn(h.link, h.nextHop)}:${NDN_PORT}`;
      const res = await dockerExec(CONTAINERS[h.node].nfd as string, [
        "nfdc",
        "face",
        "create",
        uri,
        "persistency",
        "permanent",
      ]);
      const id = Number(/id=(\d+)/.exec(res)?.[1]);
      if (!Number.isInteger(id)) throw new Error(`face create ${uri} on ${h.node}: ${res}`);
      out[key] = id;
    }
  }
  return out;
}

/** Static routes for a topology: exactly one next hop for the producer prefix on each forwarder. */
async function route(topology: "star" | "tree", faces: Partial<Record<string, number>>) {
  const wanted = new Map<string, number>(
    hopsOf(topology).map((h) => [h.node, faces[`${h.node}/${h.link}`] as number]),
  );
  for (const [key, id] of Object.entries(faces)) {
    const node = key.split("/")[0] as ForwarderNode;
    const nfd = CONTAINERS[node].nfd as string;
    if (wanted.get(node) === id) {
      await dockerExec(nfd, ["nfdc", "route", "add", NDN_PREFIX, String(id)]);
    } else {
      await dockerExec(nfd, ["nfdc", "route", "remove", NDN_PREFIX, String(id)]).catch(() => undefined);
    }
  }
}

async function eraseCs(): Promise<void> {
  await Promise.all(
    FORWARDERS.map(async (n) => {
      const nfd = CONTAINERS[n].nfd as string;
      // NFD erases a bounded number of entries per command: repeat until nothing is left.
      for (let i = 0; i < 50; i++) {
        const out = await dockerExec(nfd, ["nfdc", "cs", "erase", "/idem"]);
        if (/count=0\b/.test(out)) return;
      }
      throw new Error(`could not empty the Content Store of ${nfd}`);
    }),
  );
}

async function snapshot(ifs: Record<NodeId, Partial<Record<LinkId, string>>>): Promise<Snapshot> {
  const s = { ifs: {}, snmp: {}, faces: {}, cs: {} } as Snapshot;
  await Promise.all([
    ...NODES.map(async (n) => {
      const out = await dockerExec(CONTAINERS[n].node, [
        "sh",
        "-c",
        "cat /proc/net/dev; echo ===; cat /proc/net/snmp",
      ]);
      const [dev, snmp] = out.split("===\n") as [string, string];
      const byName = parseNetDev(dev);
      const perLink: Partial<Record<LinkId, IfCounters>> = {};
      for (const [link, name] of Object.entries(ifs[n]) as [LinkId, string][])
        perLink[link] = byName.get(name);
      s.ifs[n] = perLink;
      s.snmp[n] = parseSnmp(snmp);
    }),
    ...FORWARDERS.map(async (n) => {
      const nfd = CONTAINERS[n].nfd as string;
      s.faces[n] = parseFaces(await dockerExec(nfd, ["nfdc", "face", "list"]));
      s.cs[n] = parseCsInfo(await dockerExec(nfd, ["nfdc", "cs", "info"]));
    }),
  ]);
  return s;
}

// ------------------------------------------------------------------------------------ one run

async function waitFor(path: string, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what} (${path})`);
    await sleep(50);
  }
}

function roleCommand(role: string, jobPath: string, extra: string[] = []): string {
  const inRepo = (p: string) => `/repo/${relative(ROOT, p)}`;
  return [
    "cd /repo/experiments/ndn/bench &&",
    "exec node --import ../../../packages/sim/scripts/ts-resolve.mjs",
    `src/roles/${role}.ts`,
    inRepo(jobPath),
    ...extra,
  ].join(" ");
}

function startRole(container: string, role: string, jobPath: string, logName: string, extra: string[] = []) {
  const logPath = `/repo/${relative(ROOT, join(dirname(jobPath), logName))}`;
  return docker([
    "exec",
    "-d",
    container,
    "sh",
    "-c",
    `${roleCommand(role, jobPath, extra)} > ${logPath} 2>&1`,
  ]);
}

async function killRoles(): Promise<void> {
  await Promise.all(
    NODES.map((n) => dockerExec(CONTAINERS[n].node, ["pkill", "-f", "src/roles/"]).catch(() => undefined)),
  );
}

async function fibHas(node: ForwarderNode, prefix: string): Promise<boolean> {
  const out = await dockerExec(CONTAINERS[node].nfd as string, ["nfdc", "fib", "list"]);
  return out.split("\n").some((l) => l.trim().startsWith(`${prefix} `));
}

interface RunResult {
  metrics: MetricRow;
  hops: HopRow[];
  calls: CallRow[];
}

async function runOne(
  cfg: E4Config,
  configPath: string,
  key: RunKey,
  ifs: Record<NodeId, Partial<Record<LinkId, string>>>,
  orc: { calls: number; distinctNames: number },
): Promise<RunResult> {
  const mode = MODES[key.mode];
  const work = join(WORK, runLabel(key));
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const jobPath = join(work, "job.json");
  writeFileSync(
    jobPath,
    JSON.stringify({
      config: configPath,
      mode: key.mode,
      seed: key.seed,
      lossPct: key.lossPct,
      work: relative(ROOT, work),
    }),
  );
  await eraseCs();

  // Producer, then (overlay) the HTTP forwarders, upstream first.
  await startRole(CONTAINERS.producer.node, "producer", jobPath, "producer.log");
  await waitFor(join(work, "producer.ready"), 60_000, "producer");
  if (mode.binding === "native") {
    for (let i = 0; !(await fibHas("producer", NDN_PREFIX)); i++) {
      if (i > 100) throw new Error("the producer prefix never reached the producer NFD's FIB");
      await sleep(100);
    }
  } else {
    for (const h of [...hopsOf(mode.topology)].reverse()) {
      const kind = h.nextHop === "producer" ? "producer" : "forwarder";
      const url = `http://${ipOn(h.link, h.nextHop)}:${HTTP_PORT}`;
      await startRole(CONTAINERS[h.node].node, "gateway", jobPath, `gateway-${h.node}.log`, [
        h.node,
        url,
        kind,
      ]);
      await waitFor(join(work, `gateway-${h.node}.ready`), 60_000, `gateway ${h.node}`);
    }
  }

  // Agents: handshake, then the measured workload between two snapshots.
  const agents = docker(
    [
      "exec",
      CONTAINERS.agents.node,
      "sh",
      "-c",
      `${roleCommand("agents", jobPath)} > /repo/${relative(ROOT, join(work, "agents.log"))} 2>&1`,
    ],
    20 * 60_000,
  );
  agents.catch(() => undefined);
  await Promise.race([
    waitFor(join(work, "agents.ready"), 120_000, "agents"),
    agents.then(() => {
      throw new Error("agents exited before the handshake");
    }),
  ]);
  const before = await snapshot(ifs);
  writeFileSync(join(work, "go"), "");
  await agents;
  const after = await snapshot(ifs);
  writeFileSync(join(work, "stop"), "");
  await waitFor(join(work, "producer.json"), 30_000, "producer stats");
  const gateways: GatewayStats[] = [];
  if (mode.binding === "overlay") {
    for (const h of hopsOf(mode.topology)) {
      const p = join(work, `gateway-${h.node}.json`);
      await waitFor(p, 30_000, `gateway ${h.node} stats`);
      gateways.push(JSON.parse(readFileSync(p, "utf8")) as GatewayStats);
    }
  }
  await killRoles();

  const calls = readFileSync(join(work, "calls.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as CallRow);
  const input = {
    key,
    calls,
    before,
    after,
    producer: JSON.parse(readFileSync(join(work, "producer.json"), "utf8")) as ProducerStats,
    gateways,
    agents: JSON.parse(readFileSync(join(work, "agents.json"), "utf8")),
    oracle: orc,
  };
  return { metrics: metricRow(input), hops: hopRows(input), calls };
}

// ------------------------------------------------------------------------------------ provenance

function harnessDigest(): string {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".work") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(BENCH);
  const h = createHash("sha256");
  for (const f of files.sort()) {
    h.update(`${relative(ROOT, f)}\0${createHash("sha256").update(readFileSync(f)).digest("hex")}\n`);
  }
  return h.digest("hex");
}

async function environment(cfg: E4Config, netem: Record<string, string>) {
  const nfdImage = (
    await docker(["inspect", "--format", "{{.Image}}", CONTAINERS.edge1.nfd as string])
  ).trim();
  const nodeImage = (await docker(["inspect", "--format", "{{.Image}}", CONTAINERS.agents.node])).trim();
  const ver = (
    await docker(["version", "--format", "{{.Server.Version}} {{.Server.Os}}/{{.Server.Arch}}"])
  ).trim();
  const info = (
    await docker(["info", "--format", "{{.KernelVersion}}|{{.OperatingSystem}}|{{.NCPU}}|{{.MemTotal}}"])
  )
    .trim()
    .split("|");
  const ndn = JSON.parse(readFileSync(join(BENCH, "node_modules", "@ndn", "fw", "package.json"), "utf8")) as {
    version: string;
  };
  const cpu = cpus();
  return {
    host: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      osRelease: release(),
      cpuModel: cpu[0]?.model ?? "unknown",
      cpuCores: cpu.length,
      totalMemBytes: totalmem(),
    },
    docker: {
      server: ver,
      vmKernel: info[0],
      vmOs: info[1],
      vmCpus: Number(info[2]),
      vmMemBytes: Number(info[3]),
    },
    nfd: {
      version: (await dockerExec(CONTAINERS.edge1.nfd as string, ["nfd", "--version"])).trim(),
      image: "ghcr.io/named-data/nfd:20261105",
      imageDigest: "sha256:d9ffc6fb0a6171af4fc69c4d6a18f8e4d9d9dd130f28c768716c500c283504a5",
      imageId: nfdImage,
      config: "experiments/ndn/bench/nfd.conf",
    },
    nodeContainers: {
      image:
        "node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 + iproute2",
      imageId: nodeImage,
      node: (await dockerExec(CONTAINERS.agents.node, ["node", "--version"])).trim(),
      tc: (await dockerExec(CONTAINERS.agents.node, ["tc", "-V"])).trim(),
    },
    ndnts: ndn.version,
    netem: { links: cfg.links, perInterface: netem },
    harnessDigest: harnessDigest(),
  };
}

// ------------------------------------------------------------------------------------ main

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cfg = resolveConfig(args);
  const configPath = relative(ROOT, join(WORK, "config.json"));
  const plan = runPlan(cfg);
  const startedAt = new Date();
  const loadavgStart = loadavg().map((x) => Math.round(x * 1000) / 1000);
  const digest = await digestOfSources(ROOT);
  const sha = await gitSha(ROOT);
  const id = runId(startedAt, digest);
  const dir = join(
    args.out ? resolve(ROOT, args.out) : join(ROOT, "experiments", "results"),
    cfg.experiment,
    id,
  );
  if (existsSync(dir)) throw new Error(`run folder already exists: ${dir}`);
  log(`${cfg.experiment}: ${plan.length} runs → ${relative(ROOT, dir)}`);

  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  writeFileSync(join(WORK, "config.json"), JSON.stringify(cfg, null, 2));

  const orc = new Map<number, { calls: number; distinctNames: number }>();
  for (const s of seedsOf(cfg)) orc.set(s, await oracle(cfg, s));

  const stop = () => {
    log("interrupted: tearing the stack down");
    void down().then(() => process.exit(130));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  // macOS: hold off idle sleep while the bench runs (does not wake a sleeping laptop; the timer
  // guard below catches that).
  if (process.platform === "darwin") {
    spawn("caffeinate", ["-i", "-s", "-w", String(process.pid)], { stdio: "ignore", detached: true }).unref();
  }
  const discarded: (RunKey & { attempt: number; maxTimerGapMs: number })[] = [];

  const rows: MetricRow[] = [];
  const hops: HopRow[] = [];
  const calls: (CallRow & { mode: string; loss_pct: number; seed: number })[] = [];
  const netemByLoss: Record<string, Record<string, string>> = {};
  let env: Awaited<ReturnType<typeof environment>> | undefined;
  try {
    await down();
    await up();
    const ifs = await interfaceNames();
    const faces = await createFaces();
    let shapedLoss: number | undefined;
    let routed: string | undefined;
    for (const [i, key] of plan.entries()) {
      const mode = MODES[key.mode];
      if (shapedLoss !== key.lossPct) {
        netemByLoss[String(key.lossPct)] = await shape(cfg, ifs, key.lossPct);
        shapedLoss = key.lossPct;
      }
      if (mode.binding === "native" && routed !== mode.topology) {
        await route(mode.topology, faces);
        routed = mode.topology;
      }
      const t = Date.now();
      let r: RunResult | undefined;
      for (let attempt = 0; attempt <= cfg.guard.retries; attempt++) {
        const res = await runOne(
          cfg,
          configPath,
          key,
          ifs,
          orc.get(key.seed) as { calls: number; distinctNames: number },
        );
        const gap = Number(res.metrics.max_timer_gap_ms);
        if (gap <= cfg.guard.maxTimerGapMs) {
          r = res;
          break;
        }
        discarded.push({ ...key, attempt, maxTimerGapMs: gap });
        log(`  ${runLabel(key)}: discarded (a timer fired ${gap.toFixed(0)} ms late: the host was frozen)`);
      }
      if (!r) {
        throw new Error(
          `${runLabel(key)}: every attempt saw the host frozen (sleep?). Keep the machine awake (on AC power) and rerun.`,
        );
      }
      rows.push(r.metrics);
      hops.push(...r.hops);
      for (const c of r.calls) calls.push({ mode: key.mode, loss_pct: key.lossPct, seed: key.seed, ...c });
      const m = r.metrics;
      log(
        `[${i + 1}/${plan.length}] ${runLabel(key)}: ok ${m.ok}/${m.calls}, upstream ${m.upstream_calls}, ` +
          `p50 ${Number(m.latency_p50_ms).toFixed(0)} ms, p95 ${Number(m.latency_p95_ms).toFixed(0)} ms, ` +
          `producer link ${m.producer_link_bytes} B (${((Date.now() - t) / 1000).toFixed(0)} s)`,
      );
    }
    env = await environment(cfg, netemByLoss["0"] ?? Object.values(netemByLoss)[0] ?? {});
  } finally {
    if (!args.keepUp) await down();
    if (!args.keepUp) rmSync(WORK, { recursive: true, force: true });
  }

  pairWithB0(rows);
  const finishedAt = new Date();
  const seeds = seedsOf(cfg);
  mkdirSync(dir, { recursive: true });
  const callColumns = [
    "mode",
    "loss_pct",
    "seed",
    "agent",
    "k",
    "edge",
    "startMs",
    "latencyMs",
    "ok",
    "code",
    "attempts",
    "verifyMs",
    "servedBy",
    "resultBytes",
  ] as const;
  const files: Record<string, string> = {
    "config.json": `${JSON.stringify(cfg, null, 2)}\n`,
    seed: `${seeds.length > 1 ? `${seeds[0]}..${seeds[seeds.length - 1]}` : seeds[0]}\n`,
    "git-sha": `${sha}\n`,
    "source-digest": `${digest}\n`,
    "metrics.csv": toCsv(METRIC_COLUMNS, rows),
    "hops.csv": toCsv(HOP_COLUMNS, hops),
    "calls.csv": toCsv(
      callColumns,
      calls.map((c) => ({ ...c, verifyMs: c.verifyMs ?? undefined })),
    ),
    "summary.csv": toCsv(SUMMARY_COLUMNS, summaryRows(rows)),
    "latency_cdf.csv": toCsv(
      CDF_COLUMNS,
      cdfRows(
        calls.map((c) => ({
          mode: c.mode as RunKey["mode"],
          loss_pct: c.loss_pct,
          ok: c.ok,
          latencyMs: c.latencyMs,
        })),
      ),
    ),
    "env.json": `${JSON.stringify(
      {
        ...env,
        netemByLoss,
        discardedRuns: discarded,
        loadavgStart,
        loadavgEnd: loadavg().map((x) => Math.round(x * 1000) / 1000),
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        command: `pnpm exp:e4 ${process.argv
          .slice(2)
          .filter((a) => a !== "--")
          .join(" ")}`.trim(),
      },
      null,
      2,
    )}\n`,
  };
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  log(
    `done in ${((finishedAt.getTime() - startedAt.getTime()) / 60_000).toFixed(1)} min → ${relative(ROOT, dir)}`,
  );
}

await main();
