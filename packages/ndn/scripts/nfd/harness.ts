// NFD check harness (spec/tasks/ndn.md): a real NFD (Docker, experiments/ndn/nfd) on one side, the
// @idem/ndn producer and consumers on the other, connected with NDNts faces (TCP, UDP, WebSocket).
// Node only. Counters come from three places: the tool handlers, NFD (`nfdc` in the containers)
// and the consumers' verification results.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildInterest,
  cacheablePolicy,
  type IdemKeyPair,
  type Interest,
  keyPairFromSeed,
  Producer,
  type ProducerTool,
  randomNonce,
  TrustStore,
} from "@idem/core";
import { consume, produce } from "@ndn/endpoint";
import { Forwarder, type FwFace } from "@ndn/fw";
import { enableNfdPrefixReg } from "@ndn/nfdmgmt";
import { TcpTransport, UdpTransport } from "@ndn/node-transport";
import { AltUri, type Data as NdnData, type Interest as NdnInterest } from "@ndn/packet";
import { WsTransport } from "@ndn/ws-transport";
import { encodeInterest } from "../../src/codec";
import { NdnConsumer } from "../../src/consumer";
import { serveNdn } from "../../src/producer";

const run = promisify(execFile);

/** Harness configuration (`experiments/ndn/nfd/config.json`). */
export interface NfdCheckConfig {
  experiment: string;
  title: string;
  description: string;
  kind: "nfd-check";
  /** Seeds the producer key (bytes `seed`) and the attacker key (bytes `seed + 1`). */
  seed: number;
  host: string;
  forwarders: Record<"edge1" | "edge2" | "regional", { container: string; tcpPort: number }>;
  /** Host ports of edge1's UDP and WebSocket listeners. */
  edge1UdpPort: number;
  edge1WsPort: number;
  producer: string;
  chainProducer: string;
  /** Concurrent consumers of scenario 2. */
  consumers: number;
  /** Tool service time, so concurrent Interests overlap in NFD's PIT. */
  handlerDelayMs: number;
  /** TTL of `fetch_page` and `blob`. */
  ttlMs: number;
  /** TTL of `quick` (scenario 3 waits past it). */
  shortTtlMs: number;
}

export type ForwarderName = keyof NfdCheckConfig["forwarders"];

// ---------------------------------------------------------------------------------------------
// NFD side: nfdc in the containers

/**
 * NFD answers each status dataset (face list, CS info, FIB) from a cache for its 1 s
 * FreshnessPeriod, so two reads within a second show the same counters. Reads of the same dataset
 * on the same forwarder are therefore spaced by {@link DATASET_GAP_MS}.
 */
export const DATASET_GAP_MS = 1100;
const lastRead = new Map<string, number>();

async function dataset(container: string, ...args: string[]): Promise<string> {
  const k = `${container} ${args.join(" ")}`;
  const wait = (lastRead.get(k) ?? 0) + DATASET_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  try {
    return await nfdc(container, ...args);
  } finally {
    lastRead.set(k, Date.now());
  }
}

/** `nfdc <args>` inside a container. */
export async function nfdc(container: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("docker", ["exec", container, "nfdc", ...args], { timeout: 15_000 });
  return stdout;
}

/** Run a command in a container (e.g. `nfd --version`). */
export async function dockerExec(container: string, ...args: string[]): Promise<string> {
  const { stdout, stderr } = await run("docker", ["exec", container, ...args], { timeout: 15_000 });
  return `${stdout}${stderr}`.trim();
}

export interface CsInfo {
  entries: number;
  hits: number;
  misses: number;
}

/** `nfdc cs info`. Management queries do not move these counters (checked against NFD 24.07). */
export async function csInfo(container: string): Promise<CsInfo> {
  const out = await dataset(container, "cs", "info");
  const num = (k: string) => Number(new RegExp(`${k}=(\\d+)`).exec(out)?.[1] ?? Number.NaN);
  return { entries: num("nEntries"), hits: num("nHits"), misses: num("nMisses") };
}

export interface FaceCounters {
  id: number;
  remote: string;
  inI: number;
  inD: number;
  inN: number;
  outI: number;
  outD: number;
  outN: number;
}

/** `nfdc face list`, keyed by face id. */
export async function faces(container: string): Promise<Map<number, FaceCounters>> {
  const out = await dataset(container, "face", "list");
  const m = new Map<number, FaceCounters>();
  for (const line of out.split("\n")) {
    const r =
      /faceid=(\d+) remote=(\S+) .*counters=\{in=\{(\d+)i (\d+)d (\d+)n \d+B\} out=\{(\d+)i (\d+)d (\d+)n \d+B\}\}/.exec(
        line,
      );
    if (!r) continue;
    const n = r.slice(1).map((x, i) => (i === 1 ? x : Number(x)));
    m.set(n[0] as number, {
      id: n[0] as number,
      remote: n[1] as unknown as string,
      inI: n[2] as number,
      inD: n[3] as number,
      inN: n[4] as number,
      outI: n[5] as number,
      outD: n[6] as number,
      outN: n[7] as number,
    });
  }
  return m;
}

/** Next hops of the FIB entry for exactly `prefix` (NDN URI), or `[]`. */
export async function fibNexthops(container: string, prefix: string): Promise<number[]> {
  const out = await dataset(container, "fib", "list");
  for (const line of out.split("\n")) {
    const t = line.trim();
    if (t.startsWith(`${prefix} `)) return [...t.matchAll(/faceid=(\d+)/g)].map((x) => Number(x[1]));
  }
  return [];
}

/** Erase cached Data under `/idem` on every forwarder, so scenarios do not see each other's Data. */
export async function eraseCs(cfg: NfdCheckConfig): Promise<void> {
  await Promise.all(Object.values(cfg.forwarders).map((f) => command(f.container, "cs", "erase", "/idem")));
}

/** Wait until `nfdc status` answers in every container. */
export async function waitForNfd(cfg: NfdCheckConfig, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (const f of Object.values(cfg.forwarders)) {
    for (;;) {
      try {
        await nfdc(f.container, "status");
        break;
      } catch (e) {
        if (Date.now() > deadline) throw new Error(`NFD in ${f.container} not reachable: ${String(e)}`);
        await sleep(300);
      }
    }
  }
  // The producer's prefix registration is a signed command Interest timestamped with the host's
  // clock; NFD rejects it when its own clock (the Docker VM's) is far off, and the run would fail
  // with a missing route. Docker Desktop's VM clock was once 15 minutes behind after a stall.
  const vm = Number(await dockerExec(cfg.forwarders.edge1.container, "date", "-u", "+%s"));
  const skewS = Math.round(Date.now() / 1000 - vm);
  if (!Number.isFinite(skewS) || Math.abs(skewS) > MAX_CLOCK_SKEW_S) {
    throw new Error(
      `the Docker VM clock is ${skewS} s off the host's; NFD would reject the producer's prefix registration. ` +
        "Wait for Docker to resync its clock (or restart Docker), then run again.",
    );
  }
}

/** Largest host ↔ Docker VM clock difference the check accepts, in seconds. */
export const MAX_CLOCK_SKEW_S = 30;

/**
 * A management command, retried: NFD rejects (403) a signed command whose timestamp it finds out of
 * order, which happened once while the Docker VM clock was being corrected after a stall.
 */
async function command(container: string, ...args: string[]): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await nfdc(container, ...args);
    } catch (e) {
      if (attempt >= 5) throw e;
      await sleep(500 * attempt);
    }
  }
}

/** Static routes edge1/edge2 → regional for `/idem` (idempotent): the chain of scenario 8. */
export async function routeEdgesToRegional(cfg: NfdCheckConfig): Promise<Record<string, number>> {
  const regional = cfg.forwarders.regional.container;
  const out: Record<string, number> = {};
  for (const edge of [cfg.forwarders.edge1.container, cfg.forwarders.edge2.container]) {
    const created = await command(
      edge,
      "face",
      "create",
      `tcp4://${regional}:6363`,
      "persistency",
      "permanent",
    );
    const id = Number(/id=(\d+)/.exec(created)?.[1]);
    if (!Number.isInteger(id)) throw new Error(`nfdc face create on ${edge}: ${created}`);
    await command(edge, "route", "add", "/idem", String(id));
    out[edge] = id;
  }
  return out;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------------------------
// Node side: producers and consumers, each its own NDNts forwarder with its own face to NFD

export type Transport = "tcp" | "udp" | "ws";

/** An NDNts logical forwarder with one face to an NFD. */
export interface Node {
  fw: Forwarder;
  face: FwFace;
  transport: Transport;
  close(): void;
}

/** Connect a fresh NDNts forwarder to `forwarder` over `transport`. */
export async function connect(
  cfg: NfdCheckConfig,
  forwarder: ForwarderName,
  transport: Transport = "tcp",
): Promise<Node> {
  const fw = Forwarder.create();
  const f = cfg.forwarders[forwarder];
  let face: FwFace;
  if (transport === "tcp") face = await TcpTransport.createFace({ fw }, cfg.host, f.tcpPort);
  else if (forwarder !== "edge1") throw new Error(`${transport} is only published for edge1`);
  else if (transport === "udp")
    face = await UdpTransport.createFace({ fw }, { host: cfg.host, port: cfg.edge1UdpPort });
  else face = await WsTransport.createFace({ fw }, `ws://${cfg.host}:${cfg.edge1WsPort}`);
  return { fw, face, transport, close: () => face.close() };
}

/** Invocation counters of one producer's tools. */
export type Counters = Record<string, number>;

/** The demo tools of the check. `blob` returns `n` bytes of text (scenario 7). */
export function tools(cfg: NfdCheckConfig, counters: Counters): ProducerTool[] {
  const count = (t: string) => {
    counters[t] = (counters[t] ?? 0) + 1;
  };
  return [
    {
      name: "fetch_page",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      policy: {
        cacheable: true,
        ttlMs: cfg.ttlMs,
        scope: "public",
        normalizers: { "/url": ["url:sortQuery"] },
      },
      handler: async (args) => {
        count("fetch_page");
        await sleep(cfg.handlerDelayMs);
        const url = (args as { url: string }).url;
        if (url.endsWith("/missing")) return { content: [{ type: "text", text: "404" }], isError: true };
        return { content: [{ type: "text", text: `page ${url}` }] };
      },
    },
    {
      name: "quick",
      inputSchema: {
        type: "object",
        properties: { q: { type: "string" } },
        required: ["q"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      policy: { cacheable: true, ttlMs: cfg.shortTtlMs, scope: "public" },
      handler: (args) => {
        count("quick");
        return { content: [{ type: "text", text: `quick ${(args as { q: string }).q}` }] };
      },
    },
    {
      name: "blob",
      inputSchema: {
        type: "object",
        properties: { n: { type: "integer" } },
        required: ["n"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      policy: { cacheable: true, ttlMs: cfg.ttlMs, scope: "public" },
      handler: (args) => {
        count("blob");
        return { content: [{ type: "text", text: "x".repeat((args as { n: number }).n) }] };
      },
    },
    {
      name: "my_notes",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      policy: { cacheable: true, ttlMs: cfg.ttlMs, scope: "private" },
      handler: (_args, ctx) => {
        count("my_notes");
        return { content: [{ type: "text", text: `notes of ${ctx.auth ?? "anonymous"}` }] };
      },
    },
  ];
}

export async function keyFromSeed(seed: number): Promise<IdemKeyPair> {
  return keyPairFromSeed(new Uint8Array(32).fill(seed & 0xff));
}

/** A core Producer with counting tools, not attached to any network (to craft packets offline). */
export async function offlineProducer(cfg: NfdCheckConfig, name: string, key: IdemKeyPair) {
  const counters: Counters = {};
  const producer = new Producer({ producer: name, key, tools: tools(cfg, counters) });
  return { producer, counters, manifest: await producer.manifest() };
}

/** A native producer served on `forwarder` through NFD prefix registration. */
export interface LiveProducer {
  name: string;
  producer: Producer;
  counters: Counters;
  node: Node;
  /** NFD face id of the producer, read from NFD's FIB once the prefix is registered. */
  nfdFaceId: number;
  close(): void;
}

/** Serve a producer on `forwarder` (TCP face, `/localhost/nfd/rib/register`) and wait for the route. */
export async function startProducer(
  cfg: NfdCheckConfig,
  forwarder: ForwarderName,
  name: string,
  key: IdemKeyPair,
): Promise<LiveProducer> {
  const { producer, counters } = await offlineProducer(cfg, name, key);
  const node = await connect(cfg, forwarder);
  enableNfdPrefixReg(node.face);
  const served = await serveNdn({ producer, key, fw: node.fw });
  const prefix = `/idem/v1/${name}`;
  const container = cfg.forwarders[forwarder].container;
  const deadline = Date.now() + 10_000;
  let hops: number[] = [];
  while ((hops = await fibNexthops(container, prefix)).length === 0) {
    if (Date.now() > deadline) throw new Error(`${prefix} never reached the FIB of ${container}`);
    await sleep(100);
  }
  return {
    name,
    producer,
    counters,
    node,
    nfdFaceId: hops[0] as number,
    close() {
      served.close();
      node.close();
    },
  };
}

/** A rogue NDNts producer registered on `prefix` (longest-prefix match beats the real producer). */
export async function startRogue(
  cfg: NfdCheckConfig,
  forwarder: ForwarderName,
  prefix: NdnInterest["name"],
  answer: (interest: NdnInterest) => Promise<NdnData | undefined>,
): Promise<{ hits: () => number; close(): void }> {
  const node = await connect(cfg, forwarder);
  enableNfdPrefixReg(node.face);
  let hits = 0;
  const p = produce(
    prefix,
    async (i) => {
      hits++;
      return answer(i);
    },
    { fw: node.fw, describe: "rogue" },
  );
  const container = cfg.forwarders[forwarder].container;
  const uri = AltUri.ofName(prefix);
  const deadline = Date.now() + 10_000;
  while ((await fibNexthops(container, uri)).length === 0) {
    if (Date.now() > deadline) throw new Error(`rogue ${uri} never reached the FIB`);
    await sleep(100);
  }
  return {
    hits: () => hits,
    close() {
      p.close();
      node.close();
    },
  };
}

/** A consumer with its own forwarder and face. */
export interface LiveConsumer {
  consumer: NdnConsumer;
  node: Node;
  /**
   * Send a hand-made IDEM Interest (bypasses the consumer's own rules, fresh nonce) and return the
   * raw answer.
   */
  raw(interest: Interest): Promise<NdnData>;
  close(): void;
}

export async function startConsumer(
  cfg: NfdCheckConfig,
  forwarder: ForwarderName,
  producer: string,
  transport: Transport = "tcp",
): Promise<LiveConsumer> {
  const node = await connect(cfg, forwarder, transport);
  const consumer = new NdnConsumer({ producer, fw: node.fw, trust: new TrustStore() });
  return {
    consumer,
    node,
    // A fresh nonce per send: NFD drops a name + nonce pair it has seen (Dead Nonce List).
    raw: async (interest) =>
      consume(await encodeInterest({ ...interest, nonce: randomNonce() }), { fw: node.fw }),
    close: () => node.close(),
  };
}

/** The IDEM Interest core builds for a call, from the producer's own manifest (not over NDN). */
export async function idemInterest(
  producer: Producer,
  tool: string,
  args: unknown,
  extra: Partial<Interest> = {},
): Promise<Interest> {
  const info = producer.toolList().find((t) => t.name === tool);
  if (!info) throw new Error(`no tool ${tool}`);
  const c = await cacheablePolicy(await producer.manifest(), info);
  if (!c) throw new Error(`${tool} is not cacheable`);
  const { interest } = await buildInterest({
    producer: producer.producer,
    identity: c.identity,
    policy: c.policy,
    args,
  });
  return { ...interest, ...extra };
}

/**
 * Network faces (TCP, UDP, WebSocket) in `after` that are not in `before`: the faces opened in
 * between. `nfdc` itself connects over the Unix socket (`fd://…`); those faces are left out.
 */
export function newFaces(
  before: Map<number, FaceCounters>,
  after: Map<number, FaceCounters>,
): FaceCounters[] {
  return [...after.values()].filter((f) => !before.has(f.id) && !f.remote.startsWith("fd://"));
}

/** Difference of two snapshots of one face (absent → zeros). */
export function faceDelta(
  before: Map<number, FaceCounters>,
  after: Map<number, FaceCounters>,
  id: number,
): Omit<FaceCounters, "id" | "remote"> {
  const z = { inI: 0, inD: 0, inN: 0, outI: 0, outD: 0, outN: 0 };
  const a = after.get(id) ?? { ...z, id, remote: "" };
  const b = before.get(id) ?? { ...z, id, remote: "" };
  return {
    inI: a.inI - b.inI,
    inD: a.inD - b.inD,
    inN: a.inN - b.inN,
    outI: a.outI - b.outI,
    outD: a.outD - b.outD,
    outN: a.outN - b.outN,
  };
}
