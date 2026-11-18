import {
  b64uEncode,
  buildInterest,
  type CallToolResult,
  cacheablePolicy,
  type Data,
  dataBytes,
  dataFromToolResult,
  type Face,
  Fib,
  Forwarder,
  type ForwarderEvent,
  type Interest,
  type JsonValue,
  keyPairFromSeed,
  type Manifest,
  MemoryContentStore,
  type Packet,
  Producer,
  type ProducerTool,
  stripEphemeral,
  type ToolIdentity,
  type ToolPolicy,
  TrustStore,
  utf8Length,
  VirtualClock,
  verifyData,
} from "@idem/core";
import type { SimConfig, SimLinkConfig, SimMode, TraceRecord } from "./config";
import { type Metrics, MetricsCollector } from "./metrics";
import { costUs } from "./processing";
import { Rng, Zipf } from "./rng";

/** The demo producer's name in simulations. */
export const SIM_PRODUCER = "demo.idem.dev";
const CORPUS_ORIGIN = "https://corpus.idem.dev";

/** A packet crossing a link, for animation and byte accounting. */
export interface Transmission {
  link: string;
  from: string;
  to: string;
  kind: Packet["type"];
  /** Name for Interest/Data/Nack, tool for calls. */
  label?: string;
  bytes: number;
  t0: number;
  t1: number;
  lost: boolean;
  tampered?: boolean;
}

/** One completed (or failed) agent call. */
export interface CallRecord {
  agent: string;
  tool: string;
  t0: number;
  t1: number;
  latencyMs: number;
  ok: boolean;
  /** How the answer was obtained, as seen by the agent. */
  via: "idem" | "call" | "local-cache";
  attempts: number;
  stale: boolean;
  /**
   * Set when the Data was handed over at or past its freshness on the producer's clock: how far
   * past, in ms (`now − producedAt − min(freshnessMs, ttlMs)`). See `Metrics.lateServes`.
   */
  lateMs?: number;
}

/** Outcome of an injected attack. */
export interface AttackRecord {
  kind: "tamper" | "forge" | "private-probe";
  t: number;
  rejected: boolean;
  detail: string;
}

/** Callbacks of a running simulation. */
export interface SimHooks {
  onEvent?: (e: ForwarderEvent) => void;
  onTransmit?: (tx: Transmission) => void;
  onCall?: (r: CallRecord) => void;
  onAttack?: (a: AttackRecord) => void;
}

/** Result of a run (03-api). */
export interface SimResult {
  metrics: Metrics;
  events?: ForwarderEvent[];
  config: SimConfig;
  seed: number;
  gitSha?: string;
}

interface CallSpec {
  tool: string;
  args: JsonValue;
  /** Absolute start time (trace replay) or undefined (think-time driven). */
  at?: number;
}

// ---------------------------------------------------------------- links

class SimLink {
  readonly id: string;
  readonly cfg: SimLinkConfig;
  readonly #clock: VirtualClock;
  readonly #rng: Rng;
  readonly #hooks: SimHooks;
  readonly #busy = new Map<string, number>();
  readonly faces: Record<string, LinkFace> = {};
  tamperNextFrom: string | undefined;
  /** Arrival time of the last tampered packet (`undefined` until one is sent). */
  tamperArrivesAt: number | undefined;
  tamperPending = false;
  /** CPU time the sender spends before, and the receiver after, a packet crosses (ms). */
  processing: ((from: string, to: string, p: Packet) => { send: number; recv: number }) | undefined;

  constructor(
    cfg: SimLinkConfig,
    clock: VirtualClock,
    rng: Rng,
    hooks: SimHooks,
    onTx: (tx: Transmission) => void,
  ) {
    this.id = `${cfg.a}~${cfg.b}`;
    this.cfg = cfg;
    this.#clock = clock;
    this.#rng = rng;
    this.#hooks = hooks;
    this.faces[cfg.a] = new LinkFace(`${cfg.a}→${cfg.b}`, (p) => this.#transmit(cfg.a, cfg.b, p));
    this.faces[cfg.b] = new LinkFace(`${cfg.b}→${cfg.a}`, (p) => this.#transmit(cfg.b, cfg.a, p));
    this.onTx = onTx;
  }

  readonly onTx: (tx: Transmission) => void;

  #transmit(from: string, to: string, packet: Packet): void {
    let p = packet;
    let tampered = false;
    if (
      this.tamperNextFrom === from &&
      (p.type === "data" || (p.type === "result" && dataFromToolResult(p.result)))
    ) {
      this.tamperNextFrom = undefined;
      this.tamperPending = true;
      tampered = true;
      p = tamper(p);
    }
    const bytes = packetBytes(p);
    const now = this.#clock.now();
    const bw = this.cfg.bandwidthMbps;
    const txMs = bw ? (bytes * 8) / (bw * 1000) : 0;
    const cpu = this.processing?.(from, to, p);
    const start = Math.max(now + (cpu?.send ?? 0), this.#busy.get(from) ?? 0);
    this.#busy.set(from, start + txMs);
    const t1 = start + txMs + this.cfg.latencyMs + (cpu?.recv ?? 0);
    if (this.tamperPending) {
      this.tamperPending = false;
      this.tamperArrivesAt = t1;
    }
    const lost = this.cfg.lossPct > 0 && this.#rng.chance(this.cfg.lossPct / 100);
    const label = labelOf(p);
    const tx: Transmission = {
      link: this.id,
      from,
      to,
      kind: p.type,
      ...(label !== undefined && { label }),
      bytes,
      t0: now,
      t1,
      lost,
      ...(tampered && { tampered }),
    };
    this.onTx(tx);
    this.#hooks.onTransmit?.(tx);
    if (lost) return;
    const target = this.faces[to] as LinkFace;
    this.#clock.setTimeout(() => target.deliver(p), t1 - now);
  }
}

class LinkFace implements Face {
  readonly id: string;
  readonly #send: (p: Packet) => void;
  #cb: ((p: Packet) => void | Promise<void>) | undefined;
  #closed = false;

  constructor(id: string, send: (p: Packet) => void) {
    this.id = id;
    this.#send = send;
  }
  send(p: Packet): void {
    if (!this.#closed) this.#send(p);
  }
  onReceive(cb: (p: Packet) => void | Promise<void>): void {
    this.#cb = cb;
  }
  deliver(p: Packet): void | Promise<void> {
    return this.#closed ? undefined : this.#cb?.(p);
  }
  close(): void {
    this.#closed = true;
  }
}

function labelOf(p: Packet): string | undefined {
  switch (p.type) {
    case "interest":
      return p.interest.name;
    case "data":
      return p.data.name;
    case "nack":
      return p.name;
    case "call":
      return p.tool;
    case "result":
      return undefined;
  }
}

function packetBytes(p: Packet): number {
  if (p.type === "data") return dataBytes(p.data) + 40;
  return utf8Length(JSON.stringify(p));
}

function tamper<P extends Packet>(p: P): P {
  const evil: CallToolResult = { content: [{ type: "text", text: "tampered in flight" }] };
  if (p.type === "data") return { ...p, data: { ...p.data, content: evil } };
  if (p.type === "result")
    return { ...p, result: { ...evil, ...(p.result._meta && { _meta: p.result._meta }) } };
  return p;
}

// ---------------------------------------------------------------- corpus and tools

const LOREM =
  "Named data networking retrieves content by name rather than by host address. Every packet carries a name, " +
  "every Data packet is signed, and any node on the path may answer from its cache. ";

function pageText(i: number, bytes: number): string {
  const head = `# Document ${i}\n\n`;
  return head + LOREM.repeat(Math.ceil(bytes / LOREM.length)).slice(0, Math.max(0, bytes - head.length));
}

function demoTools(cfg: SimConfig, sizes: (i: number) => number): ProducerTool[] {
  return [
    {
      name: "fetch_page",
      description: "Return a page of the static corpus.",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string", minLength: 1 } },
        required: ["url"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      policy: {
        cacheable: true,
        ttlMs: cfg.producer.ttlMs,
        scope: "public",
        normalizers: { "/url": ["url:sortQuery"] },
      },
      handler: (args) => {
        const url = new URL((args as { url: string }).url);
        const m = /^\/doc\/(\d+)$/.exec(url.pathname);
        if (url.origin !== CORPUS_ORIGIN || !m) {
          return { content: [{ type: "text", text: `404 ${url.href}` }], isError: true };
        }
        const i = Number(m[1]);
        return { content: [{ type: "text", text: pageText(i, sizes(i)) }] };
      },
    },
    {
      name: "my_notes",
      description: "The caller's private notes.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      policy: { cacheable: true, ttlMs: cfg.producer.ttlMs, scope: "private" },
      handler: (_args, ctx) => ({ content: [{ type: "text", text: `notes of ${ctx.auth ?? "anonymous"}` }] }),
    },
    {
      name: "send_email",
      description: "Send an email (fake side effect).",
      inputSchema: {
        type: "object",
        properties: { to: { type: "string" }, body: { type: "string" } },
        required: ["to", "body"],
      },
      annotations: { readOnlyHint: false },
      handler: (args) => ({ content: [{ type: "text", text: `queued for ${(args as { to: string }).to}` }] }),
    },
  ];
}

function docUrl(i: number, rng: Rng, variation: number): string {
  if (!rng.chance(variation)) return `${CORPUS_ORIGIN}/doc/${i}?lang=en&v=1`;
  switch (rng.int(3)) {
    case 0:
      return `https://CORPUS.idem.dev/doc/${i}?v=1&lang=en`;
    case 1:
      return `${CORPUS_ORIGIN}/doc/${i}?lang=en&v=1#section-${rng.int(5)}`;
    default:
      return `https://corpus.idem.dev:443/doc/${i}?v=1&lang=en`;
  }
}

/** Expand the workload into per-agent call plans (deterministic for a seed). */
export function planWorkload(cfg: SimConfig, rng: Rng): CallSpec[][] {
  const w = cfg.workload;
  if (w.kind === "trace") {
    const agents = Math.max(0, ...w.records.map((r: TraceRecord) => r.agent + 1));
    const plans: CallSpec[][] = Array.from({ length: agents }, () => []);
    for (const r of [...w.records].sort((a, b) => a.t - b.t)) {
      plans[r.agent]?.push({ tool: r.tool, args: r.args as JsonValue, at: r.t });
    }
    return plans;
  }
  const zipf = new Zipf(Math.max(1, w.catalogSize), w.zipfAlpha);
  const variation = w.surfaceVariation ?? 0.3;
  return Array.from({ length: w.agents }, (_, a) => {
    const r = rng.fork(`plan-${a}`);
    return Array.from({ length: w.callsPerAgent }, (_, k): CallSpec => {
      const u = r.next();
      if (u < (w.sideEffectFraction ?? 0)) {
        return { tool: "send_email", args: { to: `team-${r.int(4)}@example.com`, body: `update ${a}.${k}` } };
      }
      if (u < (w.sideEffectFraction ?? 0) + (w.privateFraction ?? 0)) return { tool: "my_notes", args: {} };
      const shared = r.chance(w.overlap);
      // Private pool: documents only this agent ever asks for.
      const doc = shared ? zipf.sample(r) : w.catalogSize + a * w.callsPerAgent + k;
      return { tool: "fetch_page", args: { url: docUrl(doc, r, variation) } };
    });
  });
}

// ---------------------------------------------------------------- agents

interface PendingCall {
  spec: CallSpec;
  t0: number;
  attempts: number;
  via: CallRecord["via"];
  /**
   * Set when the plain call is the retry of [P-5.5]: the name the first, bad answer was for. The
   * retried result must carry Data signed for this name and verify, or the call fails (ADR-024).
   */
  retryOf?: string;
  timer?: unknown;
  done(r: Omit<CallRecord, "agent" | "tool" | "t0" | "t1" | "latencyMs">): void;
}

type Waiter = (p: Packet) => void | Promise<void>;

class AgentNode {
  readonly id: string;
  readonly token: string;
  readonly face: LinkFace;
  readonly #sim: Simulation;
  readonly #rng: Rng;
  /** Nonces come from their own stream, so think times are the same draws in every mode. */
  readonly #nonceRng: Rng;
  readonly #waiters = new Map<string, Waiter>();
  readonly #localCache = new Map<string, { result: CallToolResult; at: number; ttlMs: number }>();
  plan: CallSpec[] = [];
  #k = 0;
  finished = false;

  constructor(id: string, face: LinkFace, sim: Simulation, rng: Rng) {
    this.id = id;
    this.token = `token-${id}`;
    this.face = face;
    this.#sim = sim;
    this.#rng = rng;
    this.#nonceRng = rng.fork("nonce");
    face.onReceive((p) => {
      const key = p.type === "data" || p.type === "nack" ? p.nonce : p.type === "result" ? p.id : undefined;
      const w = key === undefined ? undefined : this.#waiters.get(key);
      if (!w || key === undefined) return;
      this.#waiters.delete(key);
      return w(p);
    });
  }

  nonce(): string {
    return b64uEncode(this.#nonceRng.bytes(8));
  }

  start(): void {
    const first = this.plan[0];
    if (!first) {
      this.finished = true;
      return;
    }
    const think = this.#sim.thinkTimeMs;
    const delay = first.at ?? this.#rng.next() * think;
    this.#sim.clock.setTimeout(() => this.#issue(), delay);
  }

  #next(): void {
    this.#k++;
    const spec = this.plan[this.#k];
    if (!spec) {
      this.finished = true;
      this.#sim.agentFinished();
      return;
    }
    const now = this.#sim.clock.now();
    const delay = spec.at !== undefined ? Math.max(0, spec.at - now) : this.#rng.exp(this.#sim.thinkTimeMs);
    this.#sim.clock.setTimeout(() => this.#issue(), delay);
  }

  async #issue(): Promise<void> {
    const spec = this.plan[this.#k] as CallSpec;
    const t0 = this.#sim.clock.now();
    const pending: PendingCall = {
      spec,
      t0,
      attempts: 0,
      via: "call",
      done: (r) => {
        const t1 = this.#sim.clock.now();
        this.#sim.recordCall({ agent: this.id, tool: spec.tool, t0, t1, latencyMs: t1 - t0, ...r });
        this.#next();
      },
    };
    const mode = this.#sim.mode;
    const cache = this.#sim.cacheable(spec.tool);
    if (cache && (mode === "idem" || mode === "idem-noverify")) {
      pending.via = "idem";
      return this.#sendInterest(pending, cache);
    }
    if (cache && mode === "mcp-local-cache") {
      const key = await this.#sim.nameFor(spec, cache).catch(() => undefined);
      const hit = key === undefined ? undefined : this.#localCache.get(`${this.token}|${key}`);
      if (hit && t0 - hit.at < hit.ttlMs) {
        pending.done({ ok: true, via: "local-cache", attempts: 0, stale: false });
        return;
      }
      return this.#sendCall(pending, (result) => {
        if (key !== undefined && result.isError !== true) {
          this.#localCache.set(`${this.token}|${key}`, {
            result,
            at: this.#sim.clock.now(),
            ttlMs: cache.policy.ttlMs,
          });
        }
      });
    }
    return this.#sendCall(pending);
  }

  async #sendInterest(
    pending: PendingCall,
    cache: { policy: ToolPolicy; identity: ToolIdentity },
  ): Promise<void> {
    pending.attempts++;
    let interest: Interest;
    try {
      ({ interest } = await buildInterest({
        producer: SIM_PRODUCER,
        identity: cache.identity,
        policy: cache.policy,
        args: pending.spec.args,
        nonce: this.nonce(),
        lifetimeMs: this.#sim.lifetimeMs,
      }));
    } catch {
      // Invalid for IDEM → plain MCP [P-3.1].
      return this.#sendCall(pending);
    }
    const timer = this.#sim.clock.setTimeout(() => {
      if (!this.#waiters.delete(interest.nonce)) return;
      this.#retry(pending, cache);
    }, this.#sim.lifetimeMs + 1_000);
    this.#waiters.set(interest.nonce, async (p) => {
      this.#sim.clock.clearTimeout(timer);
      if (p.type === "data") {
        // The answer must be for the name that was asked, and verify [P-5.5].
        const ok = p.data.name === interest.name && (await this.#sim.consumerVerify(p.data));
        if (!ok) {
          if (p.data.name !== interest.name) this.#sim.metrics.consumerVerifyFail();
          // [P-5.5] retry with a plain call (no PIT, no CS), held to the same standard.
          pending.retryOf = interest.name;
          return this.#sendCall(pending);
        }
        this.#sim.checkPrivate(this, p.data.content, pending.spec.tool);
        const freshness = Math.min(p.data.meta.freshnessMs, cache.policy.ttlMs);
        const stale = (p.data.ageMs ?? 0) >= freshness;
        const late = this.#sim.clock.now() - p.data.meta.producedAt - freshness;
        pending.done({
          ok: true,
          via: "idem",
          attempts: pending.attempts,
          stale,
          ...(freshness > 0 && late >= 0 && { lateMs: late }),
        });
        return;
      }
      if (p.type === "nack") {
        if (p.code === "TIMEOUT" || p.code === "UPSTREAM_ERROR") return this.#retry(pending, cache);
        // A forwarder refused the Data: the same retry as after a failed verification [P-5.5].
        if (p.code === "BAD_SIGNATURE") pending.retryOf = interest.name;
        return this.#sendCall(pending);
      }
    });
    this.face.send({ type: "interest", interest, auth: this.token });
  }

  #retry(pending: PendingCall, cache: { policy: ToolPolicy; identity: ToolIdentity }): void | Promise<void> {
    if (pending.attempts >= 3) {
      pending.done({ ok: false, via: pending.via, attempts: pending.attempts, stale: false });
      return;
    }
    return this.#sendInterest(pending, cache);
  }

  #sendCall(pending: PendingCall, onResult?: (r: CallToolResult) => void): void {
    pending.attempts++;
    const id = this.nonce();
    const timer = this.#sim.clock.setTimeout(() => {
      if (!this.#waiters.delete(id)) return;
      if (pending.attempts >= 3)
        pending.done({ ok: false, via: pending.via, attempts: pending.attempts, stale: false });
      else this.#sendCall(pending, onResult);
    }, 30_000);
    this.#waiters.set(id, async (p) => {
      this.#sim.clock.clearTimeout(timer);
      if (p.type === "result") {
        const data = dataFromToolResult(p.result);
        if (pending.retryOf !== undefined && data?.name !== pending.retryOf) {
          // The retry came back unsigned, or signed for another name: nothing reaches the agent.
          this.#sim.metrics.consumerVerifyFail();
          pending.done({ ok: false, via: pending.via, attempts: pending.attempts, stale: false });
          return;
        }
        if (data && this.#sim.verifies && !(await this.#sim.consumerVerify(data))) {
          pending.done({ ok: false, via: pending.via, attempts: pending.attempts, stale: false });
          return;
        }
        this.#sim.checkPrivate(this, p.result, pending.spec.tool);
        onResult?.(p.result);
        pending.done({
          ok: p.result.isError !== true,
          via: pending.via,
          attempts: pending.attempts,
          stale: false,
        });
      } else {
        pending.done({ ok: false, via: pending.via, attempts: pending.attempts, stale: false });
      }
    });
    this.face.send({
      type: "call",
      id,
      producer: SIM_PRODUCER,
      tool: pending.spec.tool,
      args: pending.spec.args,
      auth: this.token,
    });
  }

  /** Send a raw packet and get the first answer (used by attacks). */
  probe(p: Packet, key: string): Promise<Packet | undefined> {
    return new Promise((resolve) => {
      const timer = this.#sim.clock.setTimeout(() => {
        if (this.#waiters.delete(key)) resolve(undefined);
      }, this.#sim.lifetimeMs + 1_000);
      this.#waiters.set(key, (ans) => {
        this.#sim.clock.clearTimeout(timer);
        resolve(ans);
      });
      this.face.send(p);
    });
  }
}

// ---------------------------------------------------------------- simulation

/**
 * A running simulation. Use {@link Simulation.create}, then {@link Simulation.runUntil} to advance
 * in steps (the sandbox does this per animation frame) or {@link Simulation.run} to completion.
 */
export class Simulation {
  readonly config: SimConfig;
  readonly seed: number;
  readonly clock = new VirtualClock();
  readonly mode: SimMode;
  readonly forwarders = new Map<string, Forwarder>();
  readonly links: SimLink[] = [];
  readonly agents: AgentNode[] = [];
  readonly metrics: MetricsCollector;
  readonly attacks: AttackRecord[] = [];
  readonly #hooks: SimHooks;
  readonly #rng: Rng;
  #trust = new TrustStore();
  #manifest!: Manifest;
  #producer!: Producer;
  #cacheable = new Map<string, { policy: ToolPolicy; identity: ToolIdentity } | undefined>();
  #finished = 0;
  #events: ForwarderEvent[] | undefined;
  readonly #kinds: Map<string, "agent" | "forwarder" | "producer">;

  private constructor(cfg: SimConfig, seed: number, hooks: SimHooks, keepEvents: boolean) {
    this.config = cfg;
    this.seed = seed;
    this.mode = cfg.mode;
    this.#hooks = hooks;
    this.#rng = new Rng(seed);
    this.#events = keepEvents ? [] : undefined;
    this.#kinds = new Map(cfg.topology.nodes.map((n) => [n.id, n.kind]));
    const producerLinks = new Set(
      cfg.topology.links
        .filter((l) => kindOf(cfg, l.a) === "producer" || kindOf(cfg, l.b) === "producer")
        .map(linkId),
    );
    const edges = new Set(
      cfg.topology.links
        .filter((l) => kindOf(cfg, l.a) === "agent" || kindOf(cfg, l.b) === "agent")
        .map((l) => (kindOf(cfg, l.a) === "agent" ? l.b : l.a)),
    );
    this.metrics = new MetricsCollector({ producerLinks, edges });
  }

  /** Build the topology, keys, manifest and agents. */
  static async create(
    cfg: SimConfig,
    opts: { seed: number; keepEvents?: boolean } & SimHooks = { seed: 1 },
  ): Promise<Simulation> {
    const sim = new Simulation(cfg, opts.seed, opts, opts.keepEvents ?? false);
    await sim.#init();
    return sim;
  }

  get thinkTimeMs(): number {
    return this.config.workload.kind === "synthetic" ? (this.config.workload.thinkTimeMs ?? 300) : 0;
  }
  get lifetimeMs(): number {
    return this.config.interestLifetimeMs ?? 10_000;
  }
  get verifies(): boolean {
    return this.mode === "idem" || this.mode === "idem-noverify";
  }
  /** All agents finished their plans. */
  get done(): boolean {
    return this.#finished >= this.agents.length;
  }
  get now(): number {
    return this.clock.now();
  }

  async #init(): Promise<void> {
    const cfg = this.config;
    const sizeRng = this.#rng.fork("sizes");
    const median = cfg.producer.pageBytesMedian ?? 6 * 1024;
    const sizeCache = new Map<number, number>();
    const sizes = (i: number) => {
      let s = sizeCache.get(i);
      if (s === undefined) {
        // Stable per document regardless of request order.
        s = Math.min(
          64 * 1024,
          Math.max(512, Math.round(new Rng(i * 7919 + this.seed).lognormal(Math.log(median), 0.7))),
        );
        sizeCache.set(i, s);
      }
      return s;
    };
    void sizeRng;
    const key = await keyPairFromSeed(this.#rng.fork("producer-key").bytes(32));
    this.#producer = new Producer({
      producer: SIM_PRODUCER,
      key,
      tools: demoTools(cfg, sizes),
      clock: this.clock,
    });
    this.#manifest = await this.#producer.manifest();
    await this.#trust.addManifest(this.#manifest, { now: 0 });
    for (const t of this.#producer.toolList()) {
      this.#cacheable.set(t.name, await cacheablePolicy(this.#manifest, t));
    }

    // Links.
    const linkRng = this.#rng.fork("links");
    const byNode = new Map<string, SimLink[]>();
    for (const l of cfg.topology.links) {
      const link = new SimLink(l, this.clock, linkRng.fork(linkId(l)), this.#hooks, (tx) =>
        this.metrics.transmit(tx),
      );
      if (cfg.processing && this.verifies) link.processing = (from, to, p) => this.#cpu(from, to, p);
      this.links.push(link);
      for (const n of [l.a, l.b]) byNode.set(n, [...(byNode.get(n) ?? []), link]);
    }

    // Routes toward the producer: BFS over the link graph.
    const producerId = cfg.topology.nodes.find((n) => n.kind === "producer")?.id;
    if (!producerId) throw new Error("topology has no producer");
    const nextHop = new Map<string, string>();
    const queue = [producerId];
    const seen = new Set(queue);
    while (queue.length > 0) {
      const n = queue.shift() as string;
      for (const link of byNode.get(n) ?? []) {
        const m = link.cfg.a === n ? link.cfg.b : link.cfg.a;
        if (seen.has(m) || kindOf(cfg, m) === "agent") continue;
        seen.add(m);
        nextHop.set(m, n);
        queue.push(m);
      }
    }

    // Forwarders.
    const verifyOnInsert = cfg.mode !== "idem-noverify";
    for (const node of cfg.topology.nodes.filter((n) => n.kind === "forwarder")) {
      const fib = new Fib();
      const fwd = new Forwarder({
        id: node.id,
        clock: this.clock,
        fib,
        trust: this.#trust,
        cs: new MemoryContentStore({ maxBytes: cfg.cs.maxBytes, policy: cfg.cs.policy }),
        verifyOnInsert,
        authSecret: `edge-secret-${node.id}`,
        onEvent: (e) => {
          this.metrics.event(e);
          this.#events?.push(e);
          this.#hooks.onEvent?.(e);
        },
      });
      for (const link of byNode.get(node.id) ?? []) {
        const peer = link.cfg.a === node.id ? link.cfg.b : link.cfg.a;
        const face = link.faces[node.id] as LinkFace;
        fwd.addFace(face, { consumer: kindOf(cfg, peer) === "agent" });
        if (peer === nextHop.get(node.id)) fib.addProducer(SIM_PRODUCER, face.id);
      }
      this.forwarders.set(node.id, fwd);
    }

    // Producer.
    const serviceRng = this.#rng.fork("service");
    const { mu, sigma } = cfg.producer.serviceTimeMs;
    // B0/B1 against a plain MCP server: results carry no IDEM metadata (config.producer.signPlainCalls).
    const plain = !this.verifies && cfg.producer.signPlainCalls === false;
    for (const link of byNode.get(producerId) ?? []) {
      const face = link.faces[producerId] as LinkFace;
      this.#producer.serve(plain ? plainResults(face) : face, {
        clock: this.clock,
        serviceTimeMs: () => serviceRng.lognormal(mu, sigma),
      });
    }

    // Agents.
    const plans = planWorkload(cfg, this.#rng.fork("workload"));
    const agentNodes = cfg.topology.nodes.filter((n) => n.kind === "agent");
    agentNodes.forEach((node, i) => {
      const link = byNode.get(node.id)?.[0];
      if (!link) return;
      const agent = new AgentNode(
        node.id,
        link.faces[node.id] as LinkFace,
        this,
        this.#rng.fork(`agent-${i}`),
      );
      agent.plan = plans[i] ?? [];
      this.agents.push(agent);
    });
    for (const a of this.agents) a.start();
    this.#finished = this.agents.filter((a) => a.finished).length;
  }

  /** Cache policy and naming identity of a tool, or `undefined` if not cacheable. */
  cacheable(tool: string): { policy: ToolPolicy; identity: ToolIdentity } | undefined {
    return this.#cacheable.get(tool);
  }

  /** The demo producer's signed manifest. */
  get manifest(): Manifest {
    return this.#manifest;
  }

  async nameFor(spec: CallSpec, c: { policy: ToolPolicy; identity: ToolIdentity }): Promise<string> {
    const { interest } = await buildInterest({
      producer: SIM_PRODUCER,
      identity: c.identity,
      policy: c.policy,
      args: spec.args,
      nonce: "x",
    });
    return interest.name;
  }

  /**
   * What the planned workload asks for, before anything runs: how many calls may use IDEM and how
   * many distinct things they name. `distinctNames` counts a `private` name once per agent (it is
   * never shared). With an unbounded cache and no expiry, `distinctNames + passthroughCalls` is the
   * fewest calls that could reach the producer.
   */
  async workloadStats(): Promise<{
    calls: number;
    cacheableCalls: number;
    distinctNames: number;
    passthroughCalls: number;
  }> {
    const names = new Set<string>();
    let calls = 0;
    let cacheableCalls = 0;
    for (const agent of this.agents) {
      for (const spec of agent.plan) {
        calls++;
        const c = this.cacheable(spec.tool);
        const name = c ? await this.nameFor(spec, c).catch(() => undefined) : undefined;
        if (!c || name === undefined) continue;
        cacheableCalls++;
        names.add(c.policy.scope === "private" ? `${name}|${agent.token}` : name);
      }
    }
    return { calls, cacheableCalls, distinctNames: names.size, passthroughCalls: calls - cacheableCalls };
  }

  /** CPU time around one packet crossing a link, from `config.processing` (ms). */
  #cpu(from: string, to: string, p: Packet): { send: number; recv: number } {
    const c = this.config.processing;
    if (!c) return NO_CPU;
    const src = this.#kinds.get(from);
    const dst = this.#kinds.get(to);
    let send = 0;
    let recv = 0;
    if (p.type === "interest") {
      const bytes = utf8Length(JSON.stringify(p.interest.args));
      const name = costUs(c, "nameUs", bytes);
      const canon = costUs(c, "canonicalizeUs", bytes);
      // Consumer: canonicalize and name the call [P-4.1].
      if (src === "agent") send += canon + name;
      // Forwarder: recompute the args digest [P-4.3] (priced as a full makeName, an upper bound).
      if (dst === "forwarder") recv += name;
      // Producer: canonicalize and name the call itself [P-5.1].
      if (dst === "producer") recv += canon + name;
    } else if (p.type === "data") {
      const bytes = dataBytes(p.data);
      if (src === "producer") send += costUs(c, "signUs", bytes);
      // Forwarder: verify before caching [P-7.1], unless the experiment flag disables it (B4).
      if (dst === "forwarder" && this.mode !== "idem-noverify") recv += costUs(c, "verifyUs", bytes);
      // Consumer: verify before use [P-5.5].
      if (dst === "agent") recv += costUs(c, "verifyUs", bytes);
    }
    return { send: send / 1000, recv: recv / 1000 };
  }

  async consumerVerify(d: Data): Promise<boolean> {
    const r = await verifyData(d, this.#trust, { now: this.clock.now() });
    if (!r.ok) this.metrics.consumerVerifyFail();
    else if (JSON.stringify(d.content).includes("tampered in flight"))
      this.metrics.safetyViolation("tampered");
    return r.ok;
  }

  checkPrivate(agent: AgentNode, content: CallToolResult, tool: string): void {
    if (tool !== "my_notes") return;
    const text = (content.content[0] as { text?: string } | undefined)?.text;
    if (text !== `notes of ${agent.token}`) this.metrics.safetyViolation("private_leak");
  }

  recordCall(r: CallRecord): void {
    this.metrics.call(r);
    this.#hooks.onCall?.(r);
  }

  agentFinished(): void {
    this.#finished++;
  }

  /** Advance virtual time to `t`, processing every event due. */
  async runUntil(t: number): Promise<void> {
    await this.clock.runUntil(t);
  }

  /** Run to completion and return the result. */
  async run(): Promise<SimResult> {
    await this.clock.runAll();
    return this.result();
  }

  result(): SimResult {
    return {
      metrics: this.metrics.snapshot(this.clock.now()),
      ...(this.#events && { events: this.#events }),
      config: this.config,
      seed: this.seed,
    };
  }

  // ------------------------------------------------------------ attacks (sandbox, E5)

  /** Tamper with the next Data the producer sends. The first forwarder must reject it. */
  attackTamper(): void {
    const producerId = this.config.topology.nodes.find((n) => n.kind === "producer")?.id;
    const link = this.links.find((l) => l.cfg.a === producerId || l.cfg.b === producerId);
    if (!link || !producerId) return;
    link.tamperNextFrom = producerId;
    link.tamperArrivesAt = undefined;
    const t = this.clock.now();
    const before = this.metrics.counts.verify_fail + this.metrics.consumerVerifyFailures;
    const check = () => {
      const rejected = this.metrics.counts.verify_fail + this.metrics.consumerVerifyFailures > before;
      const pending = link.tamperNextFrom !== undefined;
      if (pending && this.clock.now() - t < 60_000) {
        this.clock.setTimeout(check, 50);
        return;
      }
      // Judge only after the tampered packet arrived and was processed (its verify ran then).
      const arrives = link.tamperArrivesAt;
      if (!pending && arrives !== undefined && this.clock.now() <= arrives) {
        this.clock.setTimeout(check, arrives - this.clock.now() + 1);
        return;
      }
      this.#attack({
        kind: "tamper",
        t,
        rejected: rejected || pending,
        detail: pending
          ? "no Data crossed the producer link"
          : rejected
            ? "signature check failed at the forwarder; waiters retried directly"
            : "tampered Data was not detected",
      });
    };
    this.clock.setTimeout(check, 50);
  }

  /** Send an Interest whose args do not match its name. Expect DIGEST_MISMATCH. */
  async attackForge(agentIndex = 0): Promise<void> {
    const agent = this.agents[agentIndex];
    const c = this.cacheable("fetch_page");
    if (!agent || !c) return;
    const { interest } = await buildInterest({
      producer: SIM_PRODUCER,
      identity: c.identity,
      policy: c.policy,
      args: { url: `${CORPUS_ORIGIN}/doc/0` },
      nonce: agent.nonce(),
    });
    const forged: Interest = { ...interest, args: { url: `${CORPUS_ORIGIN}/doc/1` } };
    const t = this.clock.now();
    void agent.probe({ type: "interest", interest: forged, auth: agent.token }, forged.nonce).then((ans) => {
      const rejected = ans?.type === "nack" && ans.code === "DIGEST_MISMATCH";
      this.#attack({
        kind: "forge",
        t,
        rejected,
        detail: rejected ? "dropped: DIGEST_MISMATCH" : `got ${ans?.type}`,
      });
    });
  }

  /** Agent B asks for `my_notes` right after agent A. B must get B's notes, never A's. */
  async attackPrivateProbe(a = 0, b = 1): Promise<void> {
    const A = this.agents[a];
    const B = this.agents[b % Math.max(1, this.agents.length)];
    const c = this.cacheable("my_notes");
    if (!A || !B || !c) return;
    const t = this.clock.now();
    const mk = async (agent: AgentNode) =>
      (
        await buildInterest({
          producer: SIM_PRODUCER,
          identity: c.identity,
          policy: c.policy,
          args: {},
          nonce: agent.nonce(),
        })
      ).interest;
    // Never await an answer here: answers need the virtual clock to advance.
    const [ia, ib] = await Promise.all([mk(A), mk(B)]);
    void A.probe({ type: "interest", interest: ia, auth: A.token }, ia.nonce).then(() =>
      B.probe({ type: "interest", interest: ib, auth: B.token }, ib.nonce).then((ans) => {
        const text =
          ans?.type === "data" ? (ans.data.content.content[0] as { text?: string }).text : undefined;
        const rejected = text === `notes of ${B.token}` || ans?.type !== "data";
        if (!rejected) this.metrics.safetyViolation("private_leak");
        this.#attack({
          kind: "private-probe",
          t,
          rejected,
          detail: rejected
            ? `${B.id} got its own notes; ${A.id}'s cached entry stayed in its partition`
            : "LEAK",
        });
      }),
    );
  }

  #attack(a: AttackRecord): void {
    this.attacks.push(a);
    this.#hooks.onAttack?.(a);
  }
}

const NO_CPU = { send: 0, recv: 0 } as const;

/** A view of a producer-side face that sends tool results without their top-level `_meta`. */
function plainResults(face: LinkFace): Face {
  return {
    id: face.id,
    send: (p) => face.send(p.type === "result" ? { ...p, result: stripEphemeral(p.result) } : p),
    onReceive: (cb) => face.onReceive(cb),
    close: () => face.close(),
  };
}

function linkId(l: SimLinkConfig): string {
  return `${l.a}~${l.b}`;
}

function kindOf(cfg: SimConfig, id: string): "agent" | "forwarder" | "producer" | undefined {
  return cfg.topology.nodes.find((n) => n.id === id)?.kind;
}

/** Run a simulation to completion (03-api). */
export async function runSimulation(
  cfg: SimConfig,
  opts: { seed: number; onEvent?: (e: ForwarderEvent) => void; keepEvents?: boolean },
): Promise<SimResult> {
  const sim = await Simulation.create(cfg, opts);
  return sim.run();
}
