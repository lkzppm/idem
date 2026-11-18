import { type CsEntry, type Data, entryAge, type ForwarderEvent, type Scope } from "@idem/core";
import {
  type AttackRecord,
  buildTopology,
  defaultConfig,
  type Metrics,
  type SimConfig,
  type SimMode,
  Simulation,
} from "@idem/sim";
import { TopologyScene } from "./scene";

/** Every knob of the swarm sandbox. The URL encodes all of it. */
export interface SwarmParams {
  agents: number;
  callsPerAgent: number;
  /** 0..100 */
  overlap: number;
  zipf: number;
  catalog: number;
  /** seconds */
  ttl: number;
  /** KiB */
  csKiB: number;
  agentLinkMs: number;
  producerLinkMs: number;
  lossPct: number;
  /** virtual ms per real ms */
  speed: number;
  seed: number;
  topo: "star" | "tree";
  localCache: boolean;
  /** 0..100 */
  privatePct: number;
  /** 0..100 */
  sideEffectPct: number;
}

export const DEFAULT_PARAMS: SwarmParams = {
  agents: 8,
  callsPerAgent: 10,
  overlap: 60,
  zipf: 0.9,
  catalog: 40,
  ttl: 60,
  csKiB: 8192,
  agentLinkMs: 10,
  producerLinkMs: 40,
  lossPct: 0,
  speed: 0.1,
  seed: 42,
  topo: "star",
  localCache: false,
  privatePct: 5,
  sideEffectPct: 5,
};

const KEYS: Record<keyof SwarmParams, string> = {
  agents: "a",
  callsPerAgent: "cpa",
  overlap: "ov",
  zipf: "z",
  catalog: "cat",
  ttl: "ttl",
  csKiB: "cs",
  agentLinkMs: "al",
  producerLinkMs: "pl",
  lossPct: "loss",
  speed: "spd",
  seed: "seed",
  topo: "topo",
  localCache: "lc",
  privatePct: "pf",
  sideEffectPct: "sf",
};

const LIMITS: Partial<Record<keyof SwarmParams, [number, number]>> = {
  agents: [1, 32],
  callsPerAgent: [1, 40],
  overlap: [0, 100],
  zipf: [0, 2],
  catalog: [5, 500],
  ttl: [1, 600],
  csKiB: [16, 65536],
  agentLinkMs: [1, 200],
  producerLinkMs: [1, 500],
  lossPct: [0, 30],
  speed: [0.01, 2],
  seed: [0, 2 ** 31 - 1],
  privatePct: [0, 50],
  sideEffectPct: [0, 50],
};

/** Read params from a query string; anything missing or out of range falls back to defaults. */
export function paramsFromQuery(q: URLSearchParams): SwarmParams {
  const p: SwarmParams = { ...DEFAULT_PARAMS };
  for (const k of Object.keys(KEYS) as (keyof SwarmParams)[]) {
    const raw = q.get(KEYS[k]);
    if (raw === null) continue;
    if (k === "topo") p.topo = raw === "tree" ? "tree" : "star";
    else if (k === "localCache") p.localCache = raw === "1";
    else {
      const n = Number(raw);
      const lim = LIMITS[k];
      if (!Number.isFinite(n) || !lim) continue;
      (p[k] as number) = Math.min(lim[1], Math.max(lim[0], n));
    }
  }
  p.agents = Math.round(p.agents);
  p.seed = Math.round(p.seed);
  return p;
}

/** Write params into a query string (only non-default values, to keep links short). */
export function paramsToQuery(p: SwarmParams, base: URLSearchParams): URLSearchParams {
  const q = new URLSearchParams(base);
  for (const k of Object.keys(KEYS) as (keyof SwarmParams)[]) {
    const v = p[k];
    const d = DEFAULT_PARAMS[k];
    if (v === d) q.delete(KEYS[k]);
    else q.set(KEYS[k], typeof v === "boolean" ? (v ? "1" : "0") : String(v));
  }
  return q;
}

/** True when two param sets would produce a different simulation (speed does not). */
export function sameRun(a: SwarmParams, b: SwarmParams): boolean {
  return (Object.keys(KEYS) as (keyof SwarmParams)[]).every((k) => k === "speed" || a[k] === b[k]);
}

export function toSimConfig(p: SwarmParams, mode: SimMode): SimConfig {
  return defaultConfig({
    topology: buildTopology({
      kind: p.topo,
      agents: p.agents,
      agentLinkMs: p.agentLinkMs,
      coreLinkMs: Math.max(1, Math.round(p.producerLinkMs / 4)),
      producerLinkMs: p.producerLinkMs,
      lossPct: p.lossPct,
      edges: 2,
    }),
    mode,
    workload: {
      kind: "synthetic",
      agents: p.agents,
      callsPerAgent: p.callsPerAgent,
      zipfAlpha: p.zipf,
      overlap: p.overlap / 100,
      catalogSize: p.catalog,
      thinkTimeMs: 300,
      surfaceVariation: 0.3,
      privateFraction: p.privatePct / 100,
      sideEffectFraction: p.sideEffectPct / 100,
    },
    producer: { serviceTimeMs: { dist: "lognormal", mu: Math.log(150), sigma: 0.5 }, ttlMs: p.ttl * 1000 },
    cs: { maxBytes: p.csKiB * 1024, policy: "lru" },
  });
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

/** One running simulation plus its scene and logs. */
export class SwarmRun {
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

  async start(p: SwarmParams): Promise<void> {
    const cfg = toSimConfig(p, this.mode);
    this.scene.setTopology(cfg.topology);
    this.events.length = 0;
    this.attacks.length = 0;
    this.#tampered.clear();
    this.error = undefined;
    const producer = cfg.topology.nodes.find((n) => n.kind === "producer")?.id ?? "producer";
    try {
      this.sim = await Simulation.create(cfg, {
        seed: p.seed,
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
          if (tx.from === producer && (tx.kind === "data" || tx.kind === "result"))
            this.scene.flash(producer, "produce");
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
