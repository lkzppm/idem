import { type CsEntry, type Data, entryAge, type ForwarderEvent, type Scope } from "@idem/core";
import {
  type SimMode as AnySimMode,
  type AttackRecord,
  defaultConfig,
  type Metrics,
  type SimConfig,
  Simulation,
} from "@idem/sim";
import { type Network, producerNodes } from "./network";
import { type Camera, TopologyScene } from "./scene";

/** The modes the sandbox runs; B5 (`mcp-gateway-cache`) is an evaluation baseline only. */
type SimMode = Exclude<AnySimMode, "mcp-gateway-cache">;

/** The protocols the editor can compare side by side. */
export type CompareMode = Network["run"]["compare"][number];

/**
 * The simulator configuration of an editor network in one mode (ADR-027): its graph as drawn, one
 * producer per producer node with the tools it serves and their TTLs, one plan per agent with its
 * tool mix, and each forwarder's Content Store size.
 */
export function networkToSim(net: Network, mode: SimMode): SimConfig {
  const producers = producerNodes(net);
  const nameOf = new Map(producers.map((p) => [p.id, p.config.name]));
  const service = (ms: number) => ({ dist: "lognormal" as const, mu: Math.log(Math.max(1, ms)), sigma: 0.5 });
  return defaultConfig({
    topology: {
      nodes: net.nodes.map((n) =>
        n.kind === "forwarder"
          ? { id: n.id, kind: n.kind, csMaxBytes: n.config.csKiB * 1024 }
          : { id: n.id, kind: n.kind },
      ),
      links: net.links.map((l) => ({ a: l.a, b: l.b, latencyMs: l.latencyMs, lossPct: l.lossPct })),
    },
    mode,
    producers: producers.map((p) => ({
      node: p.id,
      name: p.config.name,
      tools: p.config.tools.map((t) => ({ tool: t.tool, ttlMs: t.ttl * 1000 })),
      serviceTimeMs: service(p.config.serviceMs),
    })),
    workload: {
      kind: "per-agent",
      agents: net.nodes.flatMap((n) =>
        n.kind === "agent"
          ? [
              {
                node: n.id,
                calls: n.config.calls,
                thinkTimeMs: n.config.thinkMs,
                overlap: n.config.overlap,
                zipfAlpha: n.config.zipf,
                mix: n.config.tools.flatMap((t) => {
                  const producer = nameOf.get(t.producer);
                  return producer ? [{ producer, tool: t.tool, weight: t.weight }] : [];
                }),
              },
            ]
          : [],
      ),
    },
    producer: { serviceTimeMs: service(150), ttlMs: 60_000 },
    cs: { maxBytes: 8 * 1024 * 1024, policy: "lru" },
  });
}

/** Everything about a network that changes what a run does (positions and speed do not). */
export function runSignature(net: Network): string {
  return JSON.stringify({
    nodes: net.nodes.map(({ x: _x, y: _y, ...rest }) => rest),
    links: net.links,
    seed: net.run.seed,
    compare: net.run.compare,
    engine: net.run.engine,
  });
}

/** Total calls the agents of a network make in one run. */
export function totalCalls(net: Network): number {
  return net.nodes.reduce((s, n) => s + (n.kind === "agent" ? n.config.calls : 0), 0);
}

/** A Content Store entry as the tables window shows it. */
export interface CsRow {
  key: string;
  name: string;
  scope: Scope;
  /** Residual age (virtual ms). */
  ageMs: number;
  /** Freshness left (virtual ms); negative once stale. */
  leftMs: number;
  freshnessMs: number;
  bytes: number;
  hits: number;
  data: Data;
}

/** One forwarder's tables at a moment of the run. */
export interface TableSnapshot {
  node: string;
  pit: { name: string; waiting: number; scope: Scope }[];
  cs: CsRow[];
  entries: number;
  bytes: number;
  maxBytes: number;
}

/** Where a name is cached right now, and its recent events. */
export interface NameSnapshot {
  name: string;
  cached: (CsRow & { node: string })[];
  events: LoggedEvent[];
}

function csEntries(cs: unknown): CsEntry[] {
  const it = (cs as { entries?: () => IterableIterator<CsEntry> }).entries;
  return typeof it === "function" ? [...it.call(cs)] : [];
}

export interface LoggedEvent {
  seq: number;
  e: ForwarderEvent;
}

const LOG_CAP = 3000;

/**
 * One run of an editor network in one mode: the simulation, the scene it draws on, and its logs. A
 * network that cannot run yet still gets a scene (so the editor can draw it) and no simulation.
 */
export class NetworkRun {
  readonly mode: SimMode;
  readonly scene = new TopologyScene();
  readonly events: LoggedEvent[] = [];
  readonly attacks: AttackRecord[] = [];
  sim: Simulation | undefined;
  #stepping = false;
  /** Names of Data the tamper attack altered, and where their signature check failed. */
  readonly #tampered = new Map<string, string | undefined>();
  #seq = 0;
  error: string | undefined;

  constructor(mode: SimMode) {
    this.mode = mode;
  }

  /**
   * Draw `net` (through the shared `camera`) and, when `runnable`, start simulating it. `at` is when
   * nodes pop in: an edit passes 0 so the network does not re-enter on every change.
   */
  async start(net: Network, camera: Camera, runnable: boolean, at = performance.now()): Promise<void> {
    this.scene.camera = camera;
    this.scene.setTopology(net, at);
    this.events.length = 0;
    this.attacks.length = 0;
    this.#tampered.clear();
    this.error = undefined;
    if (!runnable) return;
    const cfg = networkToSim(net, this.mode);
    const producers = new Set(producerNodes(net).map((p) => p.id));
    try {
      this.sim = await Simulation.create(cfg, {
        seed: net.run.seed,
        onTransmit: (tx) => {
          if (tx.tampered && tx.label !== undefined && !this.#tampered.has(tx.label))
            this.#tampered.set(tx.label, undefined);
          this.scene.addPacket({
            from: tx.from,
            to: tx.to,
            kind: tx.kind,
            t0: tx.t0,
            t1: tx.t1,
            lost: tx.lost,
            ...(tx.tampered && { tampered: true }),
            ...(tx.label !== undefined && { label: tx.label }),
          });
          if (producers.has(tx.from) && (tx.kind === "data" || tx.kind === "result"))
            this.scene.flash(tx.from, "produce");
        },
        onEvent: (e) => {
          this.events.push({ seq: this.#seq++, e });
          if (this.events.length > LOG_CAP) this.events.splice(0, this.events.length - LOG_CAP);
          if (e.kind === "cs_hit") this.scene.flash(e.node, "cs");
          else if (e.kind === "pit_aggregate") this.scene.flash(e.node, "pit");
          else if (e.kind === "verify_fail" || e.kind === "drop") this.scene.flash(e.node, "fail");
          if (e.kind === "verify_fail" && this.#tampered.has(e.name) && !this.#tampered.get(e.name)) {
            this.#tampered.set(e.name, e.node);
          }
        },
        onAttack: (a) => {
          this.attacks.push(a);
        },
      });
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  /** Advance to virtual time `t`. Steps never overlap; a busy run just catches up next frame. */
  advance(t: number): void {
    const sim = this.sim;
    if (!sim || this.#stepping) return;
    this.#stepping = true;
    sim
      .runUntil(t)
      .catch((e: unknown) => {
        this.error = e instanceof Error ? e.message : String(e);
      })
      .finally(() => {
        this.#stepping = false;
      });
  }

  /**
   * Attack outcomes for display. The simulator decides the tamper verdict on a timer that can fire
   * before the altered Data reaches the forwarder; the event stream is authoritative, so a
   * `verify_fail` on a tampered name counts as the rejection it is. `caughtAt` names the forwarder
   * whose check failed, so the page can word the verdict in the visitor's language.
   */
  attackView(): (AttackRecord & { caughtAt?: string })[] {
    const caught = [...this.#tampered.entries()].find(([, node]) => node !== undefined)?.[1];
    return this.attacks.map((a) =>
      a.kind === "tamper" && caught !== undefined
        ? {
            ...a,
            rejected: true,
            caughtAt: caught,
            detail: a.rejected
              ? a.detail
              : `signature check failed at ${caught} (verify_fail); waiters retried directly`,
          }
        : a,
    );
  }

  get now(): number {
    return this.sim?.now ?? 0;
  }

  metrics(): Metrics | undefined {
    return this.sim?.metrics.snapshot(this.sim.now);
  }

  /** PIT waiting faces, CS entries and the share still fresh, per forwarder. */
  tables(): Record<string, { pit: number; cs: number; fresh: number }> {
    const out: Record<string, { pit: number; cs: number; fresh: number }> = {};
    const now = this.now;
    for (const [id, f] of this.sim?.forwarders ?? []) {
      const entries = csEntries(f.cs);
      const fresh = entries.filter((e) => entryAge(e, now) < e.data.meta.freshnessMs).length;
      out[id] = {
        pit: f.pit().reduce((s, e) => s + e.waiting, 0),
        cs: f.cs.stats().entries,
        fresh: entries.length ? fresh / entries.length : 0,
      };
    }
    return out;
  }

  /** Forwarder ids, edges first. */
  forwarderIds(): string[] {
    return [...(this.sim?.forwarders.keys() ?? [])];
  }

  #row(e: CsEntry, now: number): CsRow {
    const age = entryAge(e, now);
    return {
      key: e.key,
      name: e.data.name,
      scope: e.data.meta.scope,
      ageMs: age,
      leftMs: e.data.meta.freshnessMs - age,
      freshnessMs: e.data.meta.freshnessMs,
      bytes: e.bytes,
      hits: e.hits,
      data: e.data,
    };
  }

  /** A forwarder's PIT and CS, newest CS entries first (at most `limit`). */
  table(node: string, limit = 80): TableSnapshot | undefined {
    const f = this.sim?.forwarders.get(node);
    if (!f) return undefined;
    const now = this.now;
    const stats = f.cs.stats();
    const rows = csEntries(f.cs)
      .reverse()
      .slice(0, limit)
      .map((e) => this.#row(e, now));
    return {
      node,
      pit: f.pit(),
      cs: rows,
      entries: stats.entries,
      bytes: stats.bytes,
      maxBytes: stats.maxBytes,
    };
  }

  /** Every forwarder's cached copies of `name`, and the latest events that mention it. */
  inspect(name: string, limit = 16): NameSnapshot {
    const now = this.now;
    const cached: NameSnapshot["cached"] = [];
    for (const [id, f] of this.sim?.forwarders ?? []) {
      for (const e of csEntries(f.cs))
        if (e.data.name === name) cached.push({ ...this.#row(e, now), node: id });
    }
    const events: LoggedEvent[] = [];
    for (let i = this.events.length - 1; i >= 0 && events.length < limit; i--) {
      const l = this.events[i];
      if (l && "name" in l.e && l.e.name === name) events.push(l);
    }
    return { name, cached, events };
  }
}
