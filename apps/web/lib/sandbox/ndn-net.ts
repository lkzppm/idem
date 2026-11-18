/**
 * The editor's NDN engine (ADR-028): an editor network run on real NDN routers in this page.
 *
 * - Every forwarder node is its own instance of YaNFD (ndnd's forwarder, compiled to WebAssembly by
 *   `experiments/ndn/yanfd-wasm/build.sh`), with its own PIT, Content Store, FIB and strategy. Each
 *   instance has its own memory, so they share one JavaScript realm.
 * - Every link is JavaScript: frames handed from one end to the other after the link's latency,
 *   dropped with its loss, and reported so the stage can draw them.
 * - Producers are `@idem/ndn` {@link serveNdn} on an NDNts logical forwarder bridged to a router
 *   face, serving the simulator's deterministic tools (`simTool`) and signing every Data.
 * - Agents are {@link NdnConsumer}s, one NDNts logical forwarder each, bridged the same way; they
 *   verify both signatures of every answer. Their calls are the simulator's plan for the seed.
 *
 * It runs in real time (Go timers): Interest lifetimes and freshness are wall-clock seconds. Calls
 * to private or side-effect tools never travel on NDN (ADR-026) and are reported as such. The
 * routers do not say what they did, so cache hits and aggregation are read from the traffic they
 * forward: Data sent back without an Interest going upstream is a Content Store hit, a second
 * Interest for a name already pending upstream is aggregated.
 */
import { keyPairFromSeed, Producer, producerPrefix, TrustStore } from "@idem/core";
import { NdnConsumer, ndnUri, serveNdn, toNdnName } from "@idem/ndn";
import { planWorkload, Rng, routesTo, simTool, type ToolId } from "@idem/sim";
import { Forwarder, type FwFace, FwPacket } from "@ndn/fw";
import { Nack, Name, Data as NdnData, Interest as NdnInterest } from "@ndn/packet";
import { Decoder, Encoder } from "@ndn/tlv";
import { type Network, producerNodes } from "./network";
import { networkToSim } from "./run";

/** The API one YaNFD instance exposes (`experiments/ndn/yanfd-wasm/main.go`). */
export interface Yanfd {
  addFace(onFrame: (frame: Uint8Array) => void): number;
  send(face: number, frame: Uint8Array): unknown;
  route(prefix: string, face: number): string | null | undefined;
  /** Ends the router's Go runtime so its memory can be freed (absent in older builds). */
  exit?(): void;
}

/** Makes a fresh router instance (one per forwarder node). */
export type YanfdFactory = () => Promise<Yanfd>;

/** What the engine reports, for drawing and counting. Times are `performance.now()` ms. */
export interface NdnNetEvents {
  packet(p: {
    from: string;
    to: string;
    kind: "interest" | "data";
    t0: number;
    t1: number;
    lost: boolean;
    label?: string;
  }): void;
  flash(node: string, kind: "cs" | "pit" | "produce" | "fail"): void;
  call(c: NdnCall): void;
}

/** One finished call of an agent. */
export interface NdnCall {
  agent: string;
  producer: string;
  tool: string;
  /** IDEM name ("" when the call could not travel on NDN). */
  name: string;
  ok: boolean;
  /** The call never travelled: private or side-effect tool (ADR-026). */
  bypass: boolean;
  error?: string;
  ms: number;
  at: number;
}

/** Counters of a run, per forwarder and in total. */
export interface NdnStats {
  calls: number;
  done: number;
  ok: number;
  failed: number;
  bypass: number;
  /** Interests that reached a producer. */
  upstream: number;
  csHits: number;
  aggregated: number;
  /** Mean latency of successful calls, ms. */
  meanMs: number;
  forwarders: Record<string, { pit: number; csHits: number; aggregated: number }>;
}

const TLV_INTEREST = 0x05;
const TLV_DATA = 0x06;
const TLV_LP = 0x64;
const TLV_LP_FRAGMENT = 0x50;
const TLV_LP_NACK = 0x0320;

/** The network-layer packet in a frame (unwrapping NDNLPv2), or `undefined` for an idle or Nack frame. */
export function l3(frame: Uint8Array): Uint8Array | undefined {
  const t = new Decoder(frame).read();
  if (t.type !== TLV_LP) return frame;
  const d = new Decoder(t.value);
  let frag: Uint8Array | undefined;
  while (!d.eof) {
    const f = d.read();
    if (f.type === TLV_LP_NACK) return undefined;
    if (f.type === TLV_LP_FRAGMENT) frag = f.value;
  }
  return frag;
}

function peek(pkt: Uint8Array): { type: number; name: string } {
  const t = new Decoder(pkt).read();
  if (t.type === TLV_INTEREST)
    return { type: t.type, name: new Decoder(pkt).decode(NdnInterest).name.toString() };
  if (t.type === TLV_DATA) return { type: t.type, name: new Decoder(pkt).decode(NdnData).name.toString() };
  return { type: t.type, name: "" };
}

/** An NDNts logical forwarder face whose other end is a byte pipe (here: a link to a router). */
function bridge(
  fw: Forwarder,
  send: (wire: Uint8Array) => void,
  describe: string,
): { face: FwFace; deliver(wire: Uint8Array): void } {
  const queue: FwPacket[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  async function* rx(): AsyncGenerator<FwPacket> {
    while (!closed) {
      const p = queue.shift();
      if (p) yield p;
      else await new Promise<void>((r) => (wake = r));
    }
  }
  const face = fw.addFace(
    {
      rx: rx(),
      tx: async (it) => {
        for await (const p of it) {
          // Nacks (a host has no route, an Interest expired) stay inside the host.
          if (FwPacket.isEncodable(p) && !(p.l3 instanceof Nack)) send(Encoder.encode(p.l3));
        }
      },
    },
    { describe, local: false, advertiseFrom: false },
  );
  face.addEventListener("close", () => {
    closed = true;
    wake?.();
  });
  return {
    face,
    deliver(wire) {
      const type = new Decoder(wire).read().type;
      const pkt =
        type === TLV_INTEREST
          ? new Decoder(wire).decode(NdnInterest)
          : type === TLV_DATA
            ? new Decoder(wire).decode(NdnData)
            : undefined;
      if (!pkt) return;
      queue.push(FwPacket.create(pkt));
      wake?.();
      wake = undefined;
    },
  };
}

/** How long the watch remembers an Interest it saw: the consumers' InterestLifetime. */
const WATCH_LIFETIME_MS = 4000;

/** Per-forwarder bookkeeping to read cache hits and aggregation off the traffic. */
class Watch {
  readonly pending = new Map<string, { up: boolean; n: number; at: number }>();
  csHits = 0;
  aggregated = 0;
  constructor(
    readonly node: string,
    readonly events: NdnNetEvents,
  ) {}
  interestIn(name: string): void {
    const now = performance.now();
    let p = this.pending.get(name);
    // An entry older than an Interest's lifetime was lost or expired: this is a new question.
    if (p && now - p.at > WATCH_LIFETIME_MS) {
      this.pending.delete(name);
      p = undefined;
    }
    if (p) {
      p.n++;
      if (p.up) {
        this.aggregated++;
        this.events.flash(this.node, "pit");
      }
    } else this.pending.set(name, { up: false, n: 1, at: now });
  }
  interestUp(name: string): void {
    const p = this.pending.get(name);
    if (p) p.up = true;
  }
  dataDown(name: string): void {
    // A CanBePrefix Interest (the manifest, the tool list) is answered by a longer name.
    let key = name;
    if (!this.pending.has(key)) {
      for (const k of this.pending.keys()) if (name.startsWith(`${k}/`)) key = k;
    }
    const p = this.pending.get(key);
    if (!p) return;
    if (!p.up) {
      this.csHits++;
      this.events.flash(this.node, "cs");
    }
    this.pending.delete(key);
  }
  /** Names sent upstream and not yet answered, within an Interest's lifetime. */
  inFlight(): number {
    const now = performance.now();
    let n = 0;
    for (const [k, p] of this.pending) {
      if (now - p.at > WATCH_LIFETIME_MS) this.pending.delete(k);
      else if (p.up) n++;
    }
    return n;
  }
}

/** Exponential think time (ms), seeded. */
function think(rng: Rng, mean: number): number {
  return -Math.log(1 - rng.next()) * mean;
}

/** One editor network running on YaNFD routers. */
export class NdnNetwork {
  readonly #net: Network;
  readonly #events: NdnNetEvents;
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();
  readonly #faces: FwFace[] = [];
  readonly #closers: (() => void)[] = [];
  readonly #watch = new Map<string, Watch>();
  readonly #agents: { id: string; run: () => Promise<void> }[] = [];
  readonly #routers: Yanfd[] = [];
  #stopped = false;
  /** While paused, agents send no new call (the ones in flight finish). */
  #paused = false;
  #unpause: (() => void)[] = [];
  #stats = { calls: 0, done: 0, ok: 0, failed: 0, bypass: 0, upstream: 0, latency: 0 };

  private constructor(net: Network, events: NdnNetEvents) {
    this.#net = net;
    this.#events = events;
  }

  /**
   * Build the routers, links, producers and agents of `net` (nothing is sent until {@link start}).
   * An aborted `signal` stops the build between routers, frees what it made and rejects.
   */
  static async create(
    net: Network,
    factory: YanfdFactory,
    events: NdnNetEvents,
    signal?: AbortSignal,
  ): Promise<NdnNetwork> {
    const self = new NdnNetwork(net, events);
    try {
      await self.#build(factory, signal);
    } catch (e) {
      self.stop();
      throw e;
    }
    return self;
  }

  #later(ms: number, fn: () => void): void {
    if (this.#stopped) return;
    const t = setTimeout(
      () => {
        this.#timers.delete(t);
        if (!this.#stopped) fn();
      },
      Math.max(0, ms),
    );
    this.#timers.add(t);
  }

  async #build(factory: YanfdFactory, signal?: AbortSignal): Promise<void> {
    const net = this.#net;
    const sim = networkToSim(net, "idem");
    const kind = new Map(net.nodes.map((n) => [n.id, n.kind]));
    const rng = new Rng(net.run.seed);
    const lossRng = rng.fork("ndn-loss");

    // Routers.
    const routers = new Map<string, Yanfd>();
    for (const n of net.nodes) {
      if (n.kind !== "forwarder") continue;
      signal?.throwIfAborted();
      const r = await factory();
      this.#routers.push(r);
      signal?.throwIfAborted();
      routers.set(n.id, r);
      this.#watch.set(n.id, new Watch(n.id, this.#events));
    }
    // NDNts logical forwarders for agents and producers.
    const hosts = new Map<string, Forwarder>();
    for (const n of net.nodes) if (n.kind !== "forwarder") hosts.set(n.id, Forwarder.create());

    // Links: an endpoint on each side (a router face, or a bridge into a host's NDNts forwarder).
    // `faceOf[link][node]` is the router face id on that link, for routes.
    const routerFace = new Map<string, number>();
    const hostFace = new Map<string, FwFace>();
    const key = (link: number, node: string) => `${link}|${node}`;
    sim.topology.links.forEach((l, i) => {
      const ends = [l.a, l.b] as const;
      const deliverTo = new Map<string, (wire: Uint8Array) => void>();
      const transmit = (from: string, to: string, wire: Uint8Array) => {
        const now = performance.now();
        const lost = lossRng.next() * 100 < l.lossPct;
        const { type, name } = peek(wire);
        const kindOf = type === TLV_INTEREST ? "interest" : "data";
        this.#events.packet({ from, to, kind: kindOf, t0: now, t1: now + l.latencyMs, lost, label: name });
        // Forwarder bookkeeping: what left `from` and where.
        const wf = this.#watch.get(from);
        if (wf && type === TLV_INTEREST) wf.interestUp(name);
        if (wf && type === TLV_DATA) wf.dataDown(name);
        if (kind.get(to) === "producer" && type === TLV_INTEREST) this.#stats.upstream++;
        if (kind.get(from) === "producer" && type === TLV_DATA) this.#events.flash(from, "produce");
        if (lost) return;
        this.#later(l.latencyMs, () => {
          const wt = this.#watch.get(to);
          if (wt && type === TLV_INTEREST) wt.interestIn(name);
          deliverTo.get(to)?.(wire);
        });
      };
      for (const node of ends) {
        const other = node === l.a ? l.b : l.a;
        const r = routers.get(node);
        if (r) {
          const id = r.addFace((frame) => {
            const pkt = l3(frame);
            if (pkt) transmit(node, other, pkt);
          });
          routerFace.set(key(i, node), id);
          deliverTo.set(node, (wire) => r.send(id, wire));
        } else {
          const fw = hosts.get(node) as Forwarder;
          const b = bridge(fw, (wire) => transmit(node, other, wire), `link ${l.a}-${l.b}`);
          this.#faces.push(b.face);
          hostFace.set(key(i, node), b.face);
          deliverTo.set(node, b.deliver);
        }
      }
    });

    // Routes: each producer's prefix along its shortest-path tree (only forwarders relay).
    for (const p of producerNodes(net)) {
      const prefix = ndnUri(toNdnName(producerPrefix(p.config.name)));
      for (const [node, hop] of routesTo(sim.topology, p.id)) {
        const r = routers.get(node);
        const face = r ? routerFace.get(key(hop.link, node)) : undefined;
        if (r && face !== undefined) r.route(prefix, face);
        else hostFace.get(key(hop.link, node))?.addRoute(new Name(prefix), false);
      }
    }

    // Producers: the simulator's tools, keys derived from the seed and the node id.
    const trust = new TrustStore();
    for (const p of producerNodes(net)) {
      const key = await keyPairFromSeed(new Rng(net.run.seed).fork(`ndn-key:${p.id}`).bytes(32));
      const producer = new Producer({
        producer: p.config.name,
        key,
        tools: p.config.tools.map((t) =>
          simTool(t.tool as ToolId, {
            seed: net.run.seed,
            ttlMs: t.ttl * 1000,
            pageBytesMedian: 2048,
            maxResultBytes: 7168,
          }),
        ),
      });
      const served = await serveNdn({ producer, key, fw: hosts.get(p.id) as Forwarder });
      this.#closers.push(() => served.close());
    }

    // Agents: the simulator's plan for this seed, run in real time.
    const plans = planWorkload(sim, new Rng(net.run.seed).fork("workload"));
    const agentNodes = net.nodes.filter((n) => n.kind === "agent");
    agentNodes.forEach((a, i) => {
      if (a.kind !== "agent") return;
      const plan = plans[i] ?? [];
      const fw = hosts.get(a.id) as Forwarder;
      const consumers = new Map<string, NdnConsumer>();
      const consumerFor = (producer: string) => {
        let c = consumers.get(producer);
        if (!c) {
          c = new NdnConsumer({ producer, fw, trust });
          consumers.set(producer, c);
        }
        return c;
      };
      const r = rng.fork(`think-${a.id}`);
      this.#stats.calls += plan.length;
      const run = async () => {
        for (const call of plan) {
          await new Promise<void>((res) => this.#later(think(r, a.config.thinkMs), res));
          await this.#whilePaused();
          if (this.#stopped) return;
          const producer = call.producer ?? producerNodes(net)[0]?.config.name ?? "";
          const t0 = performance.now();
          let out: NdnCall;
          try {
            const o = await consumerFor(producer).call(call.tool, call.args);
            const bypass = o.error?.code === "NOT_CACHEABLE" && o.name === "";
            out = {
              agent: a.id,
              producer,
              tool: call.tool,
              name: o.name,
              ok: !o.error,
              bypass,
              ...(o.error && { error: `${o.error.code}: ${o.error.message}` }),
              ms: performance.now() - t0,
              at: t0,
            };
          } catch (e) {
            out = {
              agent: a.id,
              producer,
              tool: call.tool,
              name: "",
              ok: false,
              bypass: false,
              error: e instanceof Error ? e.message : String(e),
              ms: performance.now() - t0,
              at: t0,
            };
          }
          if (this.#stopped) return;
          this.#stats.done++;
          if (out.bypass) this.#stats.bypass++;
          else if (out.ok) {
            this.#stats.ok++;
            this.#stats.latency += out.ms;
          } else {
            this.#stats.failed++;
            this.#events.flash(a.id, "fail");
          }
          this.#events.call(out);
        }
      };
      this.#agents.push({ id: a.id, run });
    });
  }

  /** Start every agent's plan. */
  start(): void {
    for (const a of this.#agents) void a.run();
  }

  /** Hold every agent's next call until {@link resume} (calls in flight still finish). */
  pause(): void {
    this.#paused = true;
  }

  /** Let the agents call again. */
  resume(): void {
    this.#paused = false;
    for (const f of this.#unpause.splice(0)) f();
  }

  get paused(): boolean {
    return this.#paused;
  }

  #whilePaused(): Promise<void> {
    if (!this.#paused || this.#stopped) return Promise.resolve();
    return new Promise((res) => this.#unpause.push(res));
  }

  stats(): NdnStats {
    const s = this.#stats;
    const forwarders: NdnStats["forwarders"] = {};
    let csHits = 0;
    let aggregated = 0;
    for (const [id, w] of this.#watch) {
      forwarders[id] = {
        pit: w.inFlight(),
        csHits: w.csHits,
        aggregated: w.aggregated,
      };
      csHits += w.csHits;
      aggregated += w.aggregated;
    }
    return {
      calls: s.calls,
      done: s.done,
      ok: s.ok,
      failed: s.failed,
      bypass: s.bypass,
      upstream: s.upstream,
      csHits,
      aggregated,
      meanMs: s.ok ? s.latency / s.ok : 0,
      forwarders,
    };
  }

  /** Stop sending, drop every pending timer and end the routers (their memory can then be freed). */
  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    for (const f of this.#unpause.splice(0)) f();
    for (const t of this.#timers) clearTimeout(t);
    this.#timers.clear();
    for (const c of this.#closers) c();
    for (const f of this.#faces) f.close();
    for (const r of this.#routers) r.exit?.();
    this.#routers.length = 0;
  }
}

// ---------------------------------------------------------------- loading the router

let runtime: Promise<WebAssembly.Module> | undefined;

/**
 * The router factory for this page: loads `wasm_exec.js` (Go's loader) and compiles `yanfd.wasm`
 * once, then instantiates a fresh router per call.
 */
export function browserYanfd(
  base = "/ndn/",
  onProgress?: (loaded: number, total: number) => void,
): { factory: YanfdFactory; ready: Promise<void> } {
  runtime ??= (async () => {
    const g = globalThis as unknown as { Go?: unknown };
    if (!g.Go) {
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement("script");
        s.src = `${base}wasm_exec.js`;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("could not load wasm_exec.js"));
        document.head.appendChild(s);
      });
    }
    const res = await fetch(`${base}yanfd.wasm`);
    if (!res.ok || !res.body) throw new Error(`yanfd.wasm: HTTP ${res.status}`);
    const total = Number(res.headers.get("content-length")) || 9_680_301;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      onProgress?.(loaded, total);
    }
    const bytes = new Uint8Array(loaded);
    let o = 0;
    for (const c of chunks) {
      bytes.set(c, o);
      o += c.length;
    }
    return WebAssembly.compile(bytes);
  })();
  runtime.catch(() => {
    runtime = undefined;
  });
  return {
    factory: () => instantiate(runtime as Promise<WebAssembly.Module>),
    ready: runtime.then(() => undefined),
  };
}

/** The parts of Go's `wasm_exec.js` runtime the loader touches. */
interface GoRuntime {
  importObject: WebAssembly.Imports;
  run(i: WebAssembly.Instance): Promise<void>;
  exited: boolean;
  _resume(): void;
  _scheduledTimeouts: Map<number, ReturnType<typeof setTimeout>>;
}

/** How long a router gets to announce itself. */
const READY_TIMEOUT_MS = 15_000;

/** Routers are started one at a time: each announces itself on the same global names. */
let queue: Promise<unknown> = Promise.resolve();

/** A router from a compiled module (browser or Node: needs Go's `wasm_exec.js` loaded). */
export function instantiate(mod: Promise<WebAssembly.Module>): Promise<Yanfd> {
  const next = queue.then(async () => {
    const G = globalThis as unknown as {
      Go: new () => GoRuntime;
      yanfd?: Yanfd;
      onYanfdReady?: () => void;
    };
    const go = new G.Go();
    const ready = new Promise<void>((r) => {
      G.onYanfdReady = r;
    });
    const instance = await WebAssembly.instantiate(await mod, go.importObject);
    const exited = go.run(instance);
    // A router that never announces itself must not hold up every later one.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        ready,
        exited.then(() => {
          throw new Error("the router exited before it was ready");
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("the router did not start")), READY_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    const api = G.yanfd as Yanfd;
    delete G.yanfd;
    delete G.onYanfdReady;
    // After exit, Go's timers that are still scheduled (and any late call into the router) would
    // resume a program that is gone: they are dropped instead, and the instance can be collected.
    const resume = go._resume.bind(go);
    go._resume = () => {
      if (!go.exited) resume();
    };
    const exit = api.exit;
    if (exit)
      api.exit = () => {
        exit();
        void exited.then(() => {
          for (const t of go._scheduledTimeouts.values()) clearTimeout(t);
          go._scheduledTimeouts.clear();
        });
      };
    return api;
  });
  queue = next.catch(() => undefined);
  return next;
}
