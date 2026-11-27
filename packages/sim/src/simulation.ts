import {
  type AcceptVerdict,
  acceptData,
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
  stripEphemeral,
  type ToolIdentity,
  type ToolPolicy,
  TrustStore,
  utf8Length,
  VirtualClock,
  verifyData,
} from "@idem/core";
import type { SimConfig, SimLinkConfig, SimMode, SyntheticWorkload, ToolId } from "./config";
import { GatewayCache, GatewayRelay } from "./gateway-cache";
import { type Metrics, MetricsCollector } from "./metrics";
import { costUs } from "./processing";
import { Rng } from "./rng";
import { type RouteHop, routesTo } from "./routing";
import { distinctArgs, simTool } from "./tools";
import { type ResolvedProducer, validateConfig } from "./validate";
import { type PlannedCall, planWorkload } from "./workload";

export { SIM_PRODUCER } from "./config";
export { planWorkload } from "./workload";

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
  /** Name of the producer the call went to. */
  producer: string;
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
  /**
   * Why a call failed before anything was sent. `NO_ROUTE`: no path from the agent to the
   * producer's node (only forwarders relay), so the call was never issued (`attempts: 0`).
   */
  error?: SimCallError;
}

/**
 * Local failure of a simulated call (see {@link CallRecord.error}). `CLOCK_SKEW`: the verified
 * plain-call retry was still outside its signed lifetime [P-8.7].
 */
export type SimCallError = "NO_ROUTE" | "CLOCK_SKEW";

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

type CallSpec = PlannedCall;
type Cacheable = { policy: ToolPolicy; identity: ToolIdentity };

/** One running producer. */
interface ProducerRuntime {
  cfg: ResolvedProducer;
  producer: Producer;
  manifest: Manifest;
  cacheable: Map<string, Cacheable | undefined>;
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

// ---------------------------------------------------------------- agents

interface PendingCall {
  spec: CallSpec;
  /** Producer name of the call. */
  producer: string;
  /** The agent's face on the shortest path to that producer. */
  face: LinkFace;
  t0: number;
  attempts: number;
  via: CallRecord["via"];
  /**
   * Set when the plain call is the retry of [P-5.5]: the name the first, bad answer was for. The
   * retried result must carry Data signed for this name and verify, or the call fails (ADR-024).
   */
  retryOf?: string;
  timer?: unknown;
  done(r: Omit<CallRecord, "agent" | "producer" | "tool" | "t0" | "t1" | "latencyMs">): void;
}

type Waiter = (p: Packet) => void | Promise<void>;

class AgentNode {
  readonly id: string;
  readonly token: string;
  /** One face per link of the agent, in link order. */
  readonly faces: readonly LinkFace[];
  /** Producer name → the face on the shortest path to it; absent when unreachable. */
  readonly routes = new Map<string, LinkFace>();
  readonly #sim: Simulation;
  readonly #rng: Rng;
  readonly #thinkTimeMs: number;
  /** Nonces come from their own stream, so think times are the same draws in every mode. */
  readonly #nonceRng: Rng;
  readonly #waiters = new Map<string, Waiter>();
  readonly #localCache = new Map<string, { result: CallToolResult; at: number; ttlMs: number }>();
  /** W-code (ADR-037): calls per step and whether a step's calls go out at once. */
  readonly #burst: { size: number; parallel: boolean } | undefined;
  /** Window the first step starts in, ms (default: the think time). */
  readonly #startSpreadMs: number;
  plan: CallSpec[] = [];
  /** Index of the first call of the current step. */
  #k = 0;
  finished = false;

  constructor(
    id: string,
    faces: readonly LinkFace[],
    sim: Simulation,
    rng: Rng,
    thinkTimeMs: number,
    shape: Pick<SyntheticWorkload, "burst" | "startSpreadMs"> = {},
  ) {
    this.id = id;
    this.token = `token-${id}`;
    this.faces = faces;
    this.#sim = sim;
    this.#rng = rng;
    this.#thinkTimeMs = thinkTimeMs;
    this.#burst =
      shape.burst === undefined
        ? undefined
        : { size: shape.burst.size, parallel: shape.burst.parallel ?? true };
    this.#startSpreadMs = shape.startSpreadMs ?? thinkTimeMs;
    this.#nonceRng = rng.fork("nonce");
    for (const face of faces) {
      face.onReceive((p) => {
        const key = p.type === "data" || p.type === "nack" ? p.nonce : p.type === "result" ? p.id : undefined;
        const w = key === undefined ? undefined : this.#waiters.get(key);
        if (!w || key === undefined) return;
        this.#waiters.delete(key);
        return w(p);
      });
    }
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
    const delay = first.at ?? this.#rng.next() * this.#startSpreadMs;
    this.#sim.clock.setTimeout(() => this.#step(), delay);
  }

  /** Move past the current step (`size` calls) and schedule the next one after a think time. */
  #next(size = 1): void {
    this.#k += size;
    const spec = this.plan[this.#k];
    if (!spec) {
      this.finished = true;
      this.#sim.agentFinished();
      return;
    }
    const now = this.#sim.clock.now();
    const delay = spec.at !== undefined ? Math.max(0, spec.at - now) : this.#rng.exp(this.#thinkTimeMs);
    this.#sim.clock.setTimeout(() => this.#step(), delay);
  }

  /**
   * Issue the current step. Without `burst` a step is one call (the model-turn workload). With it,
   * the next `size` calls: all at once (`parallel`), or each as soon as the previous one ends; the
   * think time starts when the last of them ends (ADR-037).
   */
  #step(): void | Promise<void> {
    const k = this.#k;
    const b = this.#burst;
    if (!b) return this.#issue(k, () => this.#next());
    const end = Math.min(this.plan.length, k + Math.max(1, b.size));
    const size = end - k;
    if (b.parallel) {
      let left = size;
      const done = () => {
        if (--left === 0) this.#next(size);
      };
      // Prepare the step's calls one after the other in plan order (names, Interests: WebCrypto
      // digests), then send them all at this virtual instant. Preparing them concurrently would let
      // the completion order of the digests decide the send order, hence CPU-charged send times and
      // service-time draws (golden rule 7).
      return (async () => {
        const sends: (() => void)[] = [];
        for (let i = 0; i < size; i++) sends.push(await this.#prepare(k + i, done));
        for (const send of sends) send();
      })();
    }
    const run = (i: number): Promise<void> =>
      this.#issue(i, () => {
        if (i + 1 < end) this.#sim.clock.setTimeout(() => run(i + 1), 0);
        else this.#next(size);
      });
    return run(k);
  }

  async #issue(k: number, after: () => void): Promise<void> {
    (await this.#prepare(k, after))();
  }

  /**
   * Everything a call needs before it leaves (its name for B1, its Interest for the IDEM modes),
   * computed now; the returned function sends it, synchronously, with nothing left to await.
   */
  async #prepare(k: number, after: () => void): Promise<() => void> {
    const spec = this.plan[k] as CallSpec;
    const t0 = this.#sim.clock.now();
    const producer = spec.producer ?? this.#sim.defaultProducer;
    const record = (r: Omit<CallRecord, "agent" | "producer" | "tool" | "t0" | "t1" | "latencyMs">) => {
      const t1 = this.#sim.clock.now();
      this.#sim.recordCall({ agent: this.id, producer, tool: spec.tool, t0, t1, latencyMs: t1 - t0, ...r });
      after();
    };
    const face = this.routes.get(producer);
    if (!face) {
      // No path to the producer: the call fails here, recorded, instead of vanishing on a link.
      return () => record({ ok: false, via: "call", attempts: 0, stale: false, error: "NO_ROUTE" });
    }
    const pending: PendingCall = { spec, producer, face, t0, attempts: 0, via: "call", done: record };
    const mode = this.#sim.mode;
    const cache = this.#sim.cacheable(spec.tool, producer);
    if (cache && (mode === "idem" || mode === "idem-noverify")) {
      pending.via = "idem";
      return this.#prepareInterest(pending, cache);
    }
    if (cache && mode === "mcp-local-cache") {
      const key = await this.#sim.nameFor(spec, cache).catch(() => undefined);
      const hit = key === undefined ? undefined : this.#localCache.get(`${this.token}|${key}`);
      if (hit && t0 - hit.at < hit.ttlMs) {
        return () => pending.done({ ok: true, via: "local-cache", attempts: 0, stale: false });
      }
      return () =>
        this.#sendCall(pending, (result) => {
          if (key !== undefined && result.isError !== true) {
            this.#localCache.set(`${this.token}|${key}`, {
              result,
              at: this.#sim.clock.now(),
              ttlMs: cache.policy.ttlMs,
            });
          }
        });
    }
    return () => this.#sendCall(pending);
  }

  async #sendInterest(pending: PendingCall, cache: Cacheable): Promise<void> {
    (await this.#prepareInterest(pending, cache))();
  }

  /** Build the next Interest of `pending`; the returned function registers its waiter and sends it. */
  async #prepareInterest(pending: PendingCall, cache: Cacheable): Promise<() => void> {
    pending.attempts++;
    let interest: Interest;
    try {
      ({ interest } = await buildInterest({
        producer: pending.producer,
        identity: cache.identity,
        policy: cache.policy,
        args: pending.spec.args,
        nonce: this.nonce(),
        lifetimeMs: this.#sim.lifetimeMs,
      }));
    } catch {
      // Invalid for IDEM → plain MCP [P-3.1].
      return () => this.#sendCall(pending);
    }
    return () => this.#sendPrepared(pending, cache, interest);
  }

  #sendPrepared(pending: PendingCall, cache: Cacheable, interest: Interest): void {
    const timer = this.#sim.clock.setTimeout(() => {
      if (!this.#waiters.delete(interest.nonce)) return;
      // Returned, so the clock awaits the retry's digest before it moves on (golden rule 7).
      return this.#retry(pending, cache);
    }, this.#sim.lifetimeMs + 1_000);
    this.#waiters.set(interest.nonce, async (p) => {
      this.#sim.clock.clearTimeout(timer);
      if (p.type === "data") {
        // The shared consumer decision (`acceptData`): the name that was asked, the signature
        // [P-5.5], and the signed lifetime and age on the agent's clock, the simulation's one clock
        // [P-8.7]. A refusal of any kind gets the [P-5.5] retry as a plain call (no PIT, no CS),
        // held to the same standard.
        const v = await this.#sim.consumerAccept(
          p.data,
          interest.name,
          interest.mustBeFresh,
          cache.policy.ttlMs,
        );
        if (!v.ok) {
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
        if (p.code === "BAD_SIGNATURE" || p.code === "EXPIRED") pending.retryOf = interest.name;
        return this.#sendCall(pending);
      }
    });
    pending.face.send({ type: "interest", interest, auth: this.token });
  }

  #retry(pending: PendingCall, cache: Cacheable): void | Promise<void> {
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
        if (pending.retryOf !== undefined) {
          // The [P-5.5] retry: the shared consumer decision, for the name first asked, as fresh Data.
          const ttl = this.#sim.cacheable(pending.spec.tool, pending.producer)?.policy.ttlMs ?? Infinity;
          const v = data && (await this.#sim.consumerAccept(data, pending.retryOf, true, ttl));
          if (!v) this.#sim.metrics.consumerVerifyFail(); // unsigned: nothing reaches the agent
          if (!v || !v.ok) {
            // Unsigned, signed for another name, or not verifying: nothing reaches the agent. A
            // verified retry still outside its lifetime fails closed [P-8.7].
            pending.done({
              ok: false,
              via: pending.via,
              attempts: pending.attempts,
              stale: false,
              ...(v?.code === "EXPIRED" && { error: "CLOCK_SKEW" }),
            });
            return;
          }
        } else if (data && this.#sim.verifies && !(await this.#sim.consumerVerify(data))) {
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
    pending.face.send({
      type: "call",
      id,
      producer: pending.producer,
      tool: pending.spec.tool,
      args: pending.spec.args,
      auth: this.token,
    });
  }

  /** Send a raw packet on `face` and get the first answer (used by attacks). */
  probe(p: Packet, key: string, face: LinkFace): Promise<Packet | undefined> {
    return new Promise((resolve) => {
      const timer = this.#sim.clock.setTimeout(() => {
        if (this.#waiters.delete(key)) resolve(undefined);
      }, this.#sim.lifetimeMs + 1_000);
      this.#waiters.set(key, (ans) => {
        this.#sim.clock.clearTimeout(timer);
        resolve(ans);
      });
      face.send(p);
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
  /** B5 (`mcp-gateway-cache`) only: the gateway cache of each edge forwarder, by node id. */
  readonly gatewayCaches = new Map<string, GatewayCache>();
  readonly #gateways = new Map<string, GatewayRelay>();
  readonly #hooks: SimHooks;
  readonly #rng: Rng;
  #trust = new TrustStore();
  readonly #resolved: ResolvedProducer[];
  readonly #producers: ProducerRuntime[] = [];
  readonly #byName = new Map<string, ProducerRuntime>();
  #finished = 0;
  #events: ForwarderEvent[] | undefined;
  readonly #kinds: Map<string, "agent" | "forwarder" | "producer">;

  private constructor(cfg: SimConfig, seed: number, hooks: SimHooks, keepEvents: boolean) {
    this.#resolved = validateConfig(cfg);
    this.config = cfg;
    this.seed = seed;
    this.mode = cfg.mode;
    this.#hooks = hooks;
    this.#rng = new Rng(seed);
    this.#events = keepEvents ? [] : undefined;
    this.#kinds = new Map(cfg.topology.nodes.map((n) => [n.id, n.kind]));
    const isKind = (id: string, k: string) => this.#kinds.get(id) === k;
    const producerLinks = new Set(
      cfg.topology.links.filter((l) => isKind(l.a, "producer") || isKind(l.b, "producer")).map(linkId),
    );
    const edges = new Set(
      cfg.topology.links
        .filter((l) => isKind(l.a, "agent") || isKind(l.b, "agent"))
        .map((l) => (isKind(l.a, "agent") ? l.b : l.a)),
    );
    const producers = new Set(cfg.topology.nodes.filter((n) => n.kind === "producer").map((n) => n.id));
    this.metrics = new MetricsCollector({ producerLinks, edges, producers });
  }

  /** Build the topology, keys, manifests, routes and agents. Rejects with `SimConfigError`. */
  static async create(
    cfg: SimConfig,
    opts: { seed: number; keepEvents?: boolean } & SimHooks = { seed: 1 },
  ): Promise<Simulation> {
    const sim = new Simulation(cfg, opts.seed, opts, opts.keepEvents ?? false);
    await sim.#init();
    return sim;
  }

  /** Mean think time of a synthetic workload (per-agent plans carry their own). */
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
  /** Name of the first producer: where calls that name none go. */
  get defaultProducer(): string {
    return this.#resolved[0]?.name ?? "";
  }
  /** The producers of the run, defaults filled in, in configuration order. */
  get producers(): readonly ResolvedProducer[] {
    return this.#resolved;
  }

  async #init(): Promise<void> {
    const cfg = this.config;
    // Kept so that every later stream of the run seed is what it was before ADR-027.
    void this.#rng.fork("sizes");
    const median = cfg.producer.pageBytesMedian ?? 6 * 1024;
    const keyRng = this.#rng.fork("producer-key");
    for (const p of this.#resolved) {
      // The implicit producer keeps its historical key; explicit ones derive theirs from the seed
      // and their node id, so reordering `producers` changes no key.
      const keySeed = p.implicit
        ? keyRng.bytes(32)
        : new Rng(this.seed).fork(`producer-key:${p.node}`).bytes(32);
      const producer = new Producer({
        producer: p.name,
        key: await keyPairFromSeed(keySeed),
        tools: p.tools.map((t) =>
          simTool(t.tool, {
            seed: this.seed,
            ttlMs: t.ttlMs,
            pageBytesMedian: median,
            maxResultBytes: p.maxResultBytes,
          }),
        ),
        clock: this.clock,
      });
      const manifest = await producer.manifest();
      await this.#trust.addManifest(manifest, { now: 0 });
      const cacheable = new Map<string, Cacheable | undefined>();
      for (const t of producer.toolList()) cacheable.set(t.name, await cacheablePolicy(manifest, t));
      const rt: ProducerRuntime = { cfg: p, producer, manifest, cacheable };
      this.#producers.push(rt);
      this.#byName.set(p.name, rt);
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

    // Routes: one shortest-path tree (link latency) per producer; only forwarders relay.
    const routes = new Map<string, Map<string, RouteHop>>(
      this.#producers.map((rt) => [rt.cfg.name, routesTo(cfg.topology, rt.cfg.node)]),
    );
    const faceOn = (hop: RouteHop, node: string) => (this.links[hop.link] as SimLink).faces[node] as LinkFace;

    // Forwarders.
    const verifyOnInsert = cfg.mode !== "idem-noverify";
    for (const node of cfg.topology.nodes.filter((n) => n.kind === "forwarder")) {
      const fib = new Fib();
      const fwd = new Forwarder({
        id: node.id,
        clock: this.clock,
        fib,
        trust: this.#trust,
        cs: new MemoryContentStore({ maxBytes: node.csMaxBytes ?? cfg.cs.maxBytes, policy: cfg.cs.policy }),
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
        const consumer = this.#kinds.get(peer) === "agent";
        const face = link.faces[node.id] as LinkFace;
        fwd.addFace(consumer && cfg.mode === "mcp-gateway-cache" ? this.#gatewayFace(node, face) : face, {
          consumer,
        });
      }
      for (const [name, tree] of routes) {
        const hop = tree.get(node.id);
        if (hop) fib.addProducer(name, faceOn(hop, node.id).id);
      }
      this.forwarders.set(node.id, fwd);
    }

    // Producers.
    const serviceBase = this.#rng.fork("service");
    // B0/B1 against a plain MCP server: results carry no IDEM metadata (config.producer.signPlainCalls).
    const plain = !this.verifies && cfg.producer.signPlainCalls === false;
    for (const rt of this.#producers) {
      const node = rt.cfg.node;
      const serviceRng = rt.cfg.implicit ? serviceBase : new Rng(this.seed).fork(`service:${node}`);
      const { mu, sigma } = rt.cfg.serviceTimeMs;
      for (const link of byNode.get(node) ?? []) {
        const face = link.faces[node] as LinkFace;
        rt.producer.serve(plain ? plainResults(face) : face, {
          clock: this.clock,
          serviceTimeMs: () => serviceRng.lognormal(mu, sigma),
        });
      }
    }

    // Agents. Synthetic and trace plans go to agents by index (agents without a link sit out);
    // per-agent plans go to the agent they name, linked or not (an unlinked agent's calls fail
    // with NO_ROUTE).
    const plans = planWorkload(cfg, this.#rng.fork("workload"));
    const w = cfg.workload;
    const perAgent =
      w.kind === "per-agent"
        ? new Map(w.agents.map((p, i) => [p.node, { plan: plans[i] ?? [], think: p.thinkTimeMs ?? 300 }]))
        : undefined;
    cfg.topology.nodes
      .filter((n) => n.kind === "agent")
      .forEach((node, i) => {
        const links = byNode.get(node.id) ?? [];
        if (!perAgent && links.length === 0) return;
        const own = perAgent?.get(node.id);
        const agent = new AgentNode(
          node.id,
          links.map((l) => l.faces[node.id] as LinkFace),
          this,
          this.#rng.fork(`agent-${i}`),
          perAgent ? (own?.think ?? 300) : this.thinkTimeMs,
          w.kind === "synthetic" ? w : {},
        );
        for (const [name, tree] of routes) {
          const hop = tree.get(node.id);
          if (hop) agent.routes.set(name, faceOn(hop, node.id));
        }
        agent.plan = perAgent ? (own?.plan ?? []) : (plans[i] ?? []);
        this.agents.push(agent);
      });
    for (const a of this.agents) a.start();
    this.#finished = this.agents.filter((a) => a.finished).length;
  }

  /**
   * B5: the agent-side face of an edge with its gateway cache in front. The operator caches exactly
   * the tools the producer's manifest marks cacheable and `public`, with the manifest's TTL (a
   * perfectly configured operator; ADR-036); every other call passes through.
   */
  #gatewayFace(node: SimConfig["topology"]["nodes"][number], face: LinkFace): Face {
    let relay = this.#gateways.get(node.id);
    if (!relay) {
      relay = new GatewayRelay({
        cache: new GatewayCache({
          maxBytes: node.csMaxBytes ?? this.config.cs.maxBytes,
          policy: this.config.cs.policy,
        }),
        clock: this.clock,
        // Every tool the manifest marks cacheable, with its TTL; `private` ones in a partition per
        // caller credential, as FastMCP's per-token key gives (ADR-036, amended).
        ttlFor: (producer, tool) => this.cacheable(tool, producer)?.policy.ttlMs,
        perCredential: (producer, tool) => this.cacheable(tool, producer)?.policy.scope === "private",
        onHit: () => this.metrics.gatewayHit(),
        onMiss: (_key, inFlight) => this.metrics.gatewayMiss(inFlight),
      });
      this.#gateways.set(node.id, relay);
      this.gatewayCaches.set(node.id, relay.cache);
    }
    return relay.face(face);
  }

  /**
   * Cache policy and naming identity of a tool of `producer` (default: the first producer), or
   * `undefined` if that producer does not serve it as cacheable.
   */
  cacheable(tool: string, producer: string = this.defaultProducer): Cacheable | undefined {
    return this.#byName.get(producer)?.cacheable.get(tool);
  }

  /** The first producer's signed manifest. */
  get manifest(): Manifest {
    return (this.#producers[0] as ProducerRuntime).manifest;
  }

  /** Every producer's signed manifest, in configuration order. */
  get manifests(): Manifest[] {
    return this.#producers.map((p) => p.manifest);
  }

  async nameFor(spec: CallSpec, c: Cacheable): Promise<string> {
    const { interest } = await buildInterest({
      producer: spec.producer ?? this.defaultProducer,
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
        const c = this.cacheable(spec.tool, spec.producer ?? this.defaultProducer);
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

  /**
   * An agent's decision on a Data: `acceptData` of `@idem/core`, the shared consumer decision, on
   * the simulation's clock, with the agent-side metrics (a failed name or signature check, a
   * tampered content that verified).
   */
  async consumerAccept(d: Data, name: string, mustBeFresh: boolean, ttlMs: number): Promise<AcceptVerdict> {
    const v = await acceptData(d, { trust: this.#trust, now: this.clock.now(), name, mustBeFresh, ttlMs });
    if (!v.verify.ok) this.metrics.consumerVerifyFail();
    else if (JSON.stringify(d.content).includes("tampered in flight"))
      this.metrics.safetyViolation("tampered");
    return v;
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

  /** The running producer called `name` (default: the first). */
  #target(name: string | undefined): ProducerRuntime | undefined {
    return name === undefined ? this.#producers[0] : this.#byName.get(name);
  }

  /**
   * Tamper with the next Data a producer sends on its first link (`producer` is a producer
   * name; default: the first producer). The first forwarder must reject it.
   */
  attackTamper(producer?: string): void {
    const producerId = this.#target(producer)?.cfg.node;
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

  /**
   * Send an Interest whose args do not match its name, to `producer` (default: the first), on one
   * of its public cacheable tools (`fetch_page` first). Expect DIGEST_MISMATCH. Returns without a
   * record when the attack cannot be staged (no such agent or tool, or no route).
   */
  async attackForge(agentIndex = 0, producer?: string): Promise<void> {
    const agent = this.agents[agentIndex];
    const rt = this.#target(producer);
    if (!agent || !rt) return;
    const tool = ["fetch_page", ...rt.cfg.tools.map((t) => t.tool)].find(
      (t) => rt.cacheable.get(t)?.policy.scope === "public" && distinctArgs(t as ToolId),
    ) as ToolId | undefined;
    const c = tool && rt.cacheable.get(tool);
    const pair = tool && distinctArgs(tool);
    const face = agent.routes.get(rt.cfg.name);
    if (!c || !pair || !face) return;
    const { interest } = await buildInterest({
      producer: rt.cfg.name,
      identity: c.identity,
      policy: c.policy,
      args: pair[0],
      nonce: agent.nonce(),
    });
    const forged: Interest = { ...interest, args: pair[1] };
    const t = this.clock.now();
    void agent
      .probe({ type: "interest", interest: forged, auth: agent.token }, forged.nonce, face)
      .then((ans) => {
        const rejected = ans?.type === "nack" && ans.code === "DIGEST_MISMATCH";
        this.#attack({
          kind: "forge",
          t,
          rejected,
          detail: rejected ? "dropped: DIGEST_MISMATCH" : `got ${ans?.type}`,
        });
      });
  }

  /**
   * Agent B asks `producer` (default: the first) for `my_notes` right after agent A. B must get
   * B's notes, never A's. Returns without a record when the attack cannot be staged.
   */
  async attackPrivateProbe(a = 0, b = 1, producer?: string): Promise<void> {
    const A = this.agents[a];
    const B = this.agents[b % Math.max(1, this.agents.length)];
    const rt = this.#target(producer);
    const c = rt?.cacheable.get("my_notes");
    const fa = rt && A?.routes.get(rt.cfg.name);
    const fb = rt && B?.routes.get(rt.cfg.name);
    if (!A || !B || !rt || !c || !fa || !fb) return;
    const t = this.clock.now();
    const mk = async (agent: AgentNode) =>
      (
        await buildInterest({
          producer: rt.cfg.name,
          identity: c.identity,
          policy: c.policy,
          args: {},
          nonce: agent.nonce(),
        })
      ).interest;
    // Never await an answer here: answers need the virtual clock to advance.
    const [ia, ib] = await Promise.all([mk(A), mk(B)]);
    void A.probe({ type: "interest", interest: ia, auth: A.token }, ia.nonce, fa).then(() =>
      B.probe({ type: "interest", interest: ib, auth: B.token }, ib.nonce, fb).then((ans) => {
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

/** Run a simulation to completion (03-api). */
export async function runSimulation(
  cfg: SimConfig,
  opts: { seed: number; onEvent?: (e: ForwarderEvent) => void; keepEvents?: boolean },
): Promise<SimResult> {
  const sim = await Simulation.create(cfg, opts);
  return sim.run();
}
