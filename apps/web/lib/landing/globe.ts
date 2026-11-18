import type { InstanceList } from "../render/shapes";
import type { Palette, Rgba } from "../theme-colors";

/**
 * The landing hero: an edge network on a turning globe, with the forwarding rules of the protocol
 * running on it (spec 01 §7). The globe is divided into Autonomous Systems, drawn as flat halftone
 * territories with solid borders. Inside each AS, agents ask their edge; edges hang off the AS's
 * core router; cores reach the producer's AS across the borders. Every forwarder answers from its
 * Content Store, folds an identical pending request into its PIT entry, or forwards one Interest
 * upstream. The signed Data comes back down the same path, is stored on the way, and satisfies
 * every waiting face at once.
 *
 * People can add to it: a click on open globe places an agent (near an edge of that AS) or a new
 * edge (wired to the AS core, with a few agents of its own); a click on a node makes it ask.
 *
 * Flat colors and no glow: solid shapes with a background outline, and cartoon motion (nodes pop
 * in with overshoot, bounce when a packet lands, packets squash and stretch with their speed).
 * Decorative and deterministic: seeded nodes and requests, no measured numbers, no text.
 * Orthographic projection; drawn as instanced shapes (WebGPU or Canvas2D).
 */

export type V3 = [number, number, number];
type Kind = "agent" | "edge" | "core" | "producer";

interface GNode {
  id: number;
  kind: Kind;
  p: V3;
  /** The Autonomous System it belongs to. */
  as: number;
  /** Next hop toward the producer (-1 for the producer). */
  parent: number;
  /** The arc to the parent, lifted above the surface. */
  arc: V3[];
  dur: number;
  cs: Map<number, number>;
  pit: Map<number, number[]>;
  waiting: number;
  /** When the node appeared, and when it started to leave (Infinity while it stays). */
  born: number;
  died: number;
  user: boolean;
  /** Hover scale as an underdamped spring: value and velocity. */
  hs: number;
  hv: number;
  /** When a packet last landed on it (it bounces). */
  bump: number;
  lastHit: number;
  lastAggregate: number;
  lastAnswer: number;
}

interface GPacket {
  kind: "interest" | "data";
  name: number;
  along: number;
  up: boolean;
  to: number;
  from: number;
  t0: number;
}

interface Ripple {
  node: number;
  t0: number;
  data: boolean;
}

/**
 * Autonomous Systems, by the point their territory grows from (lat, lon): the globe is split
 * among them by nearness (a spherical Voronoi partition). The first one holds the producer.
 */
const SYSTEMS: [number, number][] = [
  [-16, -54],
  [44, -112],
  [36, -78],
  [52, 10],
  [4, 20],
  [32, 52],
  [20, 80],
  [38, 118],
  [-22, 134],
  [-60, -150],
  [70, 60],
];
const PRODUCER: [number, number] = [-22.91, -43.2];
const NAME_WEIGHTS = [0.42, 0.24, 0.16, 0.1, 0.08];
/** Seconds a forwarder keeps a Data fresh, and the producer's time to run the tool. */
const TTL = 9;
const PRODUCE = 0.4;
/** A click closer than this to an edge of the same AS (radians) adds an agent to it; farther, a new edge. */
const JOIN = 14 * (Math.PI / 180);
/** Nodes people may add before the oldest ones leave. */
const USER_CAP = 48;
const LEAVE = 0.45;
/**
 * Territories drift: every second or two an AS's seed glides up to DRIFT degrees from its home,
 * over GLIDE seconds; up to GLIDES of them move at once.
 */
const DRIFT = 10;
const GLIDE = 2.6;
const GLIDES = 2;

function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RAD = Math.PI / 180;
/** Latitude/longitude (degrees) to a unit vector: x east, y north, z toward longitude 0. */
function v3(lat: number, lon: number): V3 {
  const f = lat * RAD;
  const l = lon * RAD;
  return [Math.cos(f) * Math.sin(l), Math.sin(f), Math.cos(f) * Math.cos(l)];
}
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const angle = (a: V3, b: V3) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const easeInOut = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(x));
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3;
/** Cartoon exit: a small wind-up, then gone (back-in easing). */
const backIn = (x: number) => {
  const u = clamp01(x);
  return 2.70158 * u * u * u - 1.70158 * u * u;
};

/** A small step on the sphere from `p`: `d` radians toward bearing `a`. */
function offset(p: V3, a: number, d: number): V3 {
  const e = norm([p[2], 0, -p[0]]);
  const n = cross(p, e);
  const c = Math.cos(d);
  const s = Math.sin(d);
  const t: V3 = [
    e[0] * Math.cos(a) + n[0] * Math.sin(a),
    e[1] * Math.cos(a) + n[1] * Math.sin(a),
    e[2] * Math.cos(a) + n[2] * Math.sin(a),
  ];
  return [p[0] * c + t[0] * s, p[1] * c + t[1] * s, p[2] * c + t[2] * s];
}

/** A great-circle arc from `a` to `b`, lifted in the middle by an amount that grows with its length. */
function arc(a: V3, b: V3, n: number): V3[] {
  const omega = angle(a, b);
  const lift = 0.015 + 0.26 * (omega / Math.PI);
  const out: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const s = Math.sin(omega);
    const ka = s > 1e-6 ? Math.sin((1 - t) * omega) / s : 1 - t;
    const kb = s > 1e-6 ? Math.sin(t * omega) / s : t;
    const h = 1 + lift * Math.sin(Math.PI * t);
    out.push([(a[0] * ka + b[0] * kb) * h, (a[1] * ka + b[1] * kb) * h, (a[2] * ka + b[2] * kb) * h]);
  }
  return out;
}

/** The point at `s` (0..1) along a polyline. */
function along(pts: V3[], s: number): V3 {
  const n = pts.length - 1;
  const x = clamp01(s) * n;
  const i = Math.min(n - 1, Math.floor(x));
  const a = pts[i] as V3;
  const b = pts[i + 1] as V3;
  const u = x - i;
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

/** Evenly spread points on the sphere (Fibonacci lattice): the halftone of the territories. */
function lattice(count: number): V3[] {
  const out: V3[] = [];
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(1 - y * y);
    out.push([Math.cos(g * i) * r, y, Math.sin(g * i) * r]);
  }
  return out;
}

/**
 * The borders of the spherical Voronoi partition of `seeds`: for each pair, the stretch of their
 * bisecting great circle where no third seed is nearer. Also returns which territories touch.
 */
function borders(seeds: V3[], N = 480): { lines: { a: number; b: number; pts: V3[] }[]; touch: boolean[][] } {
  const lines: { a: number; b: number; pts: V3[] }[] = [];
  const touch = seeds.map(() => seeds.map(() => false));
  for (let i = 0; i < seeds.length; i++) {
    for (let j = i + 1; j < seeds.length; j++) {
      const si = seeds[i] as V3;
      const sj = seeds[j] as V3;
      const n = norm([si[0] - sj[0], si[1] - sj[1], si[2] - sj[2]]);
      const u = norm(cross(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
      const v = cross(n, u);
      const ok: boolean[] = [];
      const pts: V3[] = [];
      for (let k = 0; k < N; k++) {
        const th = (k / N) * Math.PI * 2;
        const x: V3 = [
          u[0] * Math.cos(th) + v[0] * Math.sin(th),
          u[1] * Math.cos(th) + v[1] * Math.sin(th),
          u[2] * Math.cos(th) + v[2] * Math.sin(th),
        ];
        const d = dot(x, si);
        let good = true;
        for (let m = 0; m < seeds.length && good; m++) {
          if (m !== i && m !== j && dot(x, seeds[m] as V3) > d) good = false;
        }
        ok.push(good);
        pts.push(x);
      }
      // Runs of valid points, starting after an invalid one so a run never wraps.
      const start = ok.indexOf(false);
      if (start < 0) continue;
      const before = lines.length;
      let run: V3[] = [];
      for (let k = 1; k <= N; k++) {
        const idx = (start + k) % N;
        if (ok[idx]) run.push(pts[idx] as V3);
        else {
          if (run.length > 1) lines.push({ a: i, b: j, pts: run });
          run = [];
        }
      }
      if (run.length > 1) lines.push({ a: i, b: j, pts: run });
      if (lines.length > before) {
        (touch[i] as boolean[])[j] = true;
        (touch[j] as boolean[])[i] = true;
      }
    }
  }
  return { lines, touch };
}

export interface View {
  cx: number;
  cy: number;
  r: number;
  /** Rotation about the vertical axis, then the horizontal one (radians). */
  yaw: number;
  pitch: number;
}

/** Underdamped spring step (cartoon settle): angular frequency `w`, damping ratio `z`. */
function spring(x: number, v: number, target: number, dt: number, w = 20, z = 0.42): [number, number] {
  const a = -w * w * (x - target) - 2 * z * w * v;
  const nv = v + a * dt;
  return [x + nv * dt, nv];
}

export class Globe {
  readonly nodes: GNode[] = [];
  readonly packets: GPacket[] = [];
  readonly ripples: Ripple[] = [];
  time = 0;
  /** The node under the pointer, or -1; the AS under the pointer, or -1. */
  hovered = -1;
  hoveredAs = -1;
  #rand = mulberry(0x1de3);
  #nextAsk = 0.4;
  #nextBurst = 1.6;
  #timers: { at: number; run: () => void }[] = [];
  readonly #home: V3[] = SYSTEMS.map(([lat, lon]) => v3(lat, lon));
  readonly #seeds: V3[] = this.#home.map((p) => [...p] as V3);
  readonly #glides = new Map<number, { from: V3; to: V3; t0: number }>();
  #nextGlide = 1.5;
  readonly #cores: number[] = [];
  readonly #dots: { p: V3; as: number }[];
  #borders: { a: number; b: number; pts: V3[] }[];
  /** Which of four flat tones each territory takes (neighbours never share one). */
  readonly #tone: number[];
  /** Per AS, how lit it is under the pointer (eased). */
  readonly #asLight: number[];

  constructor() {
    const r = this.#rand;
    this.#dots = lattice(7000).map((p) => ({ p, as: this.asOf(p) }));
    const { lines, touch } = borders(this.#seeds);
    this.#borders = lines;
    this.#tone = [];
    for (let i = 0; i < this.#seeds.length; i++) {
      const used = new Set<number>();
      for (let j = 0; j < i; j++) if (touch[i]?.[j]) used.add(this.#tone[j] as number);
      let c = 0;
      while (used.has(c)) c++;
      this.#tone.push(c % 4);
    }
    this.#asLight = this.#seeds.map(() => 0);

    const producer = this.#add("producer", v3(...PRODUCER), 0, -1, false, -100);
    // Inter-AS routes: each core forwards to a neighbouring AS one step closer to the producer's
    // (breadth-first over the territories that share a border), so every arc crosses one border.
    const via = this.#seeds.map(() => -1);
    const queue = [0];
    via[0] = 0;
    while (queue.length) {
      const a = queue.shift() as number;
      for (let b = 0; b < this.#seeds.length; b++) {
        if (via[b] === -1 && touch[a]?.[b]) {
          via[b] = a;
          queue.push(b);
        }
      }
    }
    const order = [...this.#seeds.keys()].sort((a, b) => depth(a) - depth(b));
    function depth(a: number): number {
      let d = 0;
      for (let x = a; x !== 0 && d < 99; x = via[x] as number) d++;
      return d;
    }
    const coreOf = new Map<number, number>();
    for (const a of order) {
      const up = a === 0 ? producer : (coreOf.get(via[a] === -1 ? 0 : (via[a] as number)) as number);
      coreOf.set(a, this.#add("core", this.#seeds[a] as V3, a, up, false, -100));
    }
    for (let a = 0; a < this.#seeds.length; a++) this.#cores.push(coreOf.get(a) as number);
    for (let a = 0; a < this.#seeds.length; a++) {
      const edges = a >= 9 ? 1 : 2;
      for (let k = 0; k < edges; k++) {
        const p = this.#inside(a, this.#seeds[a] as V3, 9, 20);
        const edge = this.#add("edge", p, a, this.#cores[a] as number, false, -100);
        const n = 3 + Math.floor(r() * 3);
        for (let m = 0; m < n; m++) this.#add("agent", this.#inside(a, p, 3, 8), a, edge, false, -100);
      }
    }
  }

  /** The AS whose territory holds `p`. */
  asOf(p: V3): number {
    let best = 0;
    let bd = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < this.#seeds.length; i++) {
      const d = dot(p, this.#seeds[i] as V3);
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /** A random point `lo`..`hi` degrees from `from`, inside territory `as`. */
  #inside(as: number, from: V3, lo: number, hi: number): V3 {
    const r = this.#rand;
    let p = from;
    for (let k = 0; k < 24; k++) {
      p = offset(from, r() * Math.PI * 2, (lo + r() * (hi - lo)) * RAD);
      if (this.asOf(p) === as) return p;
    }
    return p;
  }

  #add(kind: Kind, p: V3, as: number, parent: number, user: boolean, born = this.time): number {
    const id = this.nodes.length;
    const q = parent >= 0 ? (this.nodes[parent] as GNode).p : p;
    const omega = angle(p, q);
    this.nodes.push({
      id,
      kind,
      p,
      as,
      parent,
      arc: parent >= 0 ? arc(p, q, kind === "agent" ? 12 : 48) : [p, p],
      dur: 0.5 + omega * 1.7,
      cs: new Map(),
      pit: new Map(),
      waiting: -1,
      born,
      died: Number.POSITIVE_INFINITY,
      user,
      hs: 1,
      hv: 0,
      bump: -1e9,
      lastHit: -1e9,
      lastAggregate: -1e9,
      lastAnswer: -1e9,
    });
    return id;
  }

  #live(n: GNode | undefined): n is GNode {
    return n !== undefined && n.died === Number.POSITIVE_INFINITY;
  }

  #pickName(): number {
    let x = this.#rand();
    for (let i = 0; i < NAME_WEIGHTS.length; i++) {
      x -= NAME_WEIGHTS[i] as number;
      if (x <= 0) return i;
    }
    return 0;
  }

  #send(kind: GPacket["kind"], name: number, alongId: number, up: boolean, to: number, from: number): void {
    this.packets.push({ kind, name, along: alongId, up, to, from, t0: this.time });
  }

  #after(s: number, run: () => void): void {
    this.#timers.push({ at: this.time + s, run });
  }

  /** Agent `id` asks for `name` (ignored while it already waits for an answer). */
  ask(id: number, name = this.#pickName()): void {
    const a = this.nodes[id];
    if (!this.#live(a) || a.kind !== "agent" || a.waiting >= 0) return;
    a.waiting = name;
    a.bump = this.time;
    this.#send("interest", name, id, true, a.parent, id);
  }

  /** Every live agent below forwarder `id` asks the same thing within a moment: watch them fold. */
  #chorus(id: number, name: number): void {
    for (const n of this.nodes) {
      if (!this.#live(n) || n.parent !== id) continue;
      if (n.kind === "agent") {
        const aid = n.id;
        this.#after(this.#rand() * 0.3, () => this.ask(aid, name));
      } else this.#chorus(n.id, name);
    }
  }

  /**
   * A click on node `id`: an agent asks; an edge or a core has every agent below it ask the same
   * name at once; the producer only bounces (it answers nothing unasked).
   */
  poke(id: number): void {
    const n = this.nodes[id];
    if (!this.#live(n)) return;
    n.bump = this.time;
    if (n.kind === "agent") this.ask(id);
    else if (n.kind !== "producer") this.#chorus(id, this.#pickName());
    this.ripples.push({ node: id, t0: this.time, data: false });
  }

  /**
   * A click on open globe at screen (x, y). Near an edge of the same AS it adds an agent wired to
   * it, which asks once its link has drawn in; otherwise it adds a new edge wired to that AS's
   * core, with a few agents that pop up around it. Returns the new node's id, or -1 off the globe.
   */
  place(view: View, x: number, y: number): number {
    const p = unproject(view, x, y);
    if (!p) return -1;
    const as = this.asOf(p);
    let best = -1;
    let bd = Number.POSITIVE_INFINITY;
    for (const n of this.nodes) {
      if (!this.#live(n) || n.kind !== "edge" || n.as !== as) continue;
      const d = angle(n.p, p);
      if (d < bd) {
        bd = d;
        best = n.id;
      }
    }
    let id: number;
    if (best >= 0 && bd < JOIN) {
      id = this.#add("agent", p, as, best, true);
      this.#after(0.7, () => this.ask(id));
    } else {
      id = this.#add("edge", p, as, this.#cores[as] as number, true);
      const r = this.#rand;
      const count = 3 + Math.floor(r() * 2);
      for (let k = 0; k < count; k++) {
        this.#after(0.35 + k * 0.11, () => {
          if (!this.#live(this.nodes[id])) return;
          const child = this.#add("agent", this.#inside(as, p, 3, 7), as, id, true);
          this.#after(0.8 + r() * 0.6, () => this.ask(child));
        });
      }
    }
    this.#trim();
    return id;
  }

  /** Past the cap, the oldest added nodes leave (an edge takes its agents with it). */
  #trim(): void {
    const added = this.nodes.filter((n) => n.user && this.#live(n));
    let extra = added.length - USER_CAP;
    for (const n of added) {
      if (extra <= 0) break;
      n.died = this.time;
      extra--;
      if (n.kind === "edge") {
        for (const c of this.nodes) if (c.parent === n.id && this.#live(c)) c.died = this.time;
      }
    }
  }

  #land(n: GNode, data: boolean): void {
    n.bump = this.time;
    this.ripples.push({ node: n.id, t0: this.time, data });
  }

  #onInterest(p: GPacket): void {
    const n = this.nodes[p.to];
    if (!this.#live(n)) return;
    this.#land(n, false);
    if (n.kind === "producer") {
      this.#after(PRODUCE, () => {
        n.lastAnswer = this.time;
        n.bump = this.time;
        this.#send("data", p.name, p.from, false, p.from, n.id);
      });
      return;
    }
    const exp = n.cs.get(p.name);
    if (exp !== undefined && exp > this.time) {
      n.lastHit = this.time;
      this.#send("data", p.name, p.from, false, p.from, n.id);
      return;
    }
    const waiting = n.pit.get(p.name);
    if (waiting) {
      waiting.push(p.from);
      n.lastAggregate = this.time;
      return;
    }
    n.pit.set(p.name, [p.from]);
    this.#send("interest", p.name, n.id, true, n.parent, n.id);
  }

  #onData(p: GPacket): void {
    const n = this.nodes[p.to];
    if (!this.#live(n)) return;
    this.#land(n, true);
    if (n.kind === "agent") {
      if (n.waiting === p.name) n.waiting = -1;
      n.lastAnswer = this.time;
      return;
    }
    n.cs.set(p.name, this.time + TTL);
    const faces = n.pit.get(p.name) ?? [];
    n.pit.delete(p.name);
    for (const f of faces) this.#send("data", p.name, f, false, f, n.id);
  }

  step(dt: number): void {
    this.time += dt;
    const t = this.time;
    const r = this.#rand;
    const agents = this.nodes.filter((n) => n.kind === "agent" && this.#live(n));
    if (t >= this.#nextAsk) {
      const a = agents[Math.floor(r() * agents.length)];
      if (a) this.ask(a.id);
      this.#nextAsk = t + 0.3 + r() * 0.7;
    }
    if (t >= this.#nextBurst) {
      // A popular question, asked by many agents within a moment of each other.
      const name = this.#pickName();
      for (const a of agents) {
        if (r() < 0.4) {
          const id = a.id;
          this.#after(r() * 0.9, () => this.ask(id, name));
        }
      }
      this.#nextBurst = t + 6 + r() * 3;
    }
    const due = this.#timers.filter((x) => x.at <= t);
    this.#timers = this.#timers.filter((x) => x.at > t);
    for (const x of due) x.run();
    for (let i = this.packets.length - 1; i >= 0; i--) {
      const p = this.packets[i] as GPacket;
      const link = this.nodes[p.along] as GNode;
      if (!this.#live(link)) {
        this.packets.splice(i, 1);
        continue;
      }
      if (t - p.t0 >= link.dur) {
        this.packets.splice(i, 1);
        if (p.kind === "interest") this.#onInterest(p);
        else this.#onData(p);
      }
    }
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      if (t - (this.ripples[i] as Ripple).t0 > 0.8) this.ripples.splice(i, 1);
    }
    // Small substeps keep the stiff hover spring stable at any frame rate.
    const sub = Math.max(1, Math.ceil(dt / (1 / 120)));
    for (const n of this.nodes) {
      const target = n.id === this.hovered ? 1.4 : 1;
      for (let k = 0; k < sub; k++) [n.hs, n.hv] = spring(n.hs, n.hv, target, dt / sub);
      for (const [name, exp] of n.cs) if (exp <= t) n.cs.delete(name);
    }
    this.#drift();
    const k = 1 - Math.exp(-dt * 10);
    for (let a = 0; a < this.#asLight.length; a++) {
      const cur = this.#asLight[a] as number;
      this.#asLight[a] = cur + ((a === this.hoveredAs ? 1 : 0) - cur) * k;
    }
  }

  /**
   * Now and then one territory reshapes: its seed glides to a new spot near its home and the
   * borders follow. A move is taken only if every node still sits inside its own AS at the end.
   */
  #drift(): void {
    const t = this.time;
    if (this.#glides.size > 0) {
      for (const [as, g] of this.#glides) {
        const e = easeInOut((t - g.t0) / GLIDE);
        this.#seeds[as] = norm([
          g.from[0] + (g.to[0] - g.from[0]) * e,
          g.from[1] + (g.to[1] - g.from[1]) * e,
          g.from[2] + (g.to[2] - g.from[2]) * e,
        ]);
        if (e >= 1) this.#glides.delete(as);
      }
      this.#reshape();
    }
    if (t < this.#nextGlide || this.#glides.size >= GLIDES) return;
    const r = this.#rand;
    this.#nextGlide = t + 0.9 + r() * 1.2;
    const as = Math.floor(r() * this.#seeds.length);
    if (this.#glides.has(as)) return;
    // Check the move against where every gliding seed is headed, so no node ends up abroad.
    const saved = this.#seeds.map((p) => p);
    for (const [other, g] of this.#glides) this.#seeds[other] = g.to;
    let target: V3 | null = null;
    for (let k = 0; k < 8 && !target; k++) {
      const to = offset(this.#home[as] as V3, r() * Math.PI * 2, DRIFT * (0.4 + 0.6 * r()) * RAD);
      this.#seeds[as] = to;
      if (this.nodes.every((n) => !this.#live(n) || n.kind === "producer" || this.asOf(n.p) === n.as))
        target = to;
    }
    for (let i = 0; i < saved.length; i++) this.#seeds[i] = saved[i] as V3;
    if (target) this.#glides.set(as, { from: this.#seeds[as] as V3, to: target, t0: t });
  }

  /** Recompute the territories (dots and borders) for the current seeds. */
  #reshape(): void {
    for (const d of this.#dots) d.as = this.asOf(d.p);
    this.#borders = borders(this.#seeds).lines;
  }

  #freshness(n: GNode): number {
    let best = 0;
    for (const exp of n.cs.values()) best = Math.max(best, (exp - this.time) / TTL);
    return clamp01(best);
  }

  /** Scale from appearing (pop with overshoot) and leaving (wind-up, then gone). */
  #presence(n: GNode): number {
    const a = this.time - n.born;
    if (a < 0) return 0;
    const grow = a > 2 ? 1 : 1 - Math.exp(-6 * a) * Math.cos(12 * a);
    const leave = n.died === Number.POSITIVE_INFINITY ? 1 : 1 - backIn((this.time - n.died) / LEAVE);
    return Math.max(0, grow * leave);
  }

  /** The bounce after a packet lands: a quick damped wobble around 1. */
  #bounce(n: GNode): number {
    const a = this.time - n.bump;
    if (a < 0 || a > 1.2) return 1;
    return 1 + 0.38 * Math.exp(-6 * a) * Math.sin(15 * a);
  }

  /** The live node drawn nearest to (x, y) on the visible side, within `reach` pixels; -1 if none. */
  nodeAt(view: View, x: number, y: number, reach = 16): number {
    const P = projector(view);
    let best = -1;
    let bd = reach;
    for (const n of this.nodes) {
      if (!this.#live(n)) continue;
      const [sx, sy, z] = P(n.p);
      if (z < 0.05) continue;
      const pad = n.kind === "agent" ? 0 : n.kind === "producer" ? 8 : 5;
      const d = Math.hypot(sx - x, sy - y) - pad;
      if (d < bd) {
        bd = d;
        best = n.id;
      }
    }
    return best;
  }

  /** Point the hover at screen (x, y): the node under it and the AS under it. Returns the node or -1. */
  hoverAt(view: View | null, x = 0, y = 0): number {
    if (!view) {
      this.hovered = -1;
      this.hoveredAs = -1;
      return -1;
    }
    this.hovered = this.nodeAt(view, x, y);
    const p = unproject(view, x, y);
    this.hoveredAs = p ? this.asOf(p) : -1;
    return this.hovered;
  }

  draw(list: InstanceList, view: View, pal: Palette): void {
    list.clear();
    const P = projector(view);
    const t = this.time;
    const { cx, cy, r } = view;
    const dark = pal.dark;
    const front = (z: number) => clamp01((z + 0.02) / 0.25);
    // A point of a lifted arc is hidden only when it is behind the globe's disk.
    const shown = (q: [number, number, number]) => q[2] >= 0 || Math.hypot(q[0] - cx, q[1] - cy) > r;
    const mix = (a: Rgba, b: Rgba, k: number): Rgba => [
      a[0] + (b[0] - a[0]) * k,
      a[1] + (b[1] - a[1]) * k,
      a[2] + (b[2] - a[2]) * k,
      1,
    ];
    const body = mix(pal.bg, pal.fg, dark ? 0.05 : 0.035);
    // Four flat, muted territory tones: ink, and ink leaning to each accent.
    const tones: Rgba[] = [
      mix(body, pal.fg, dark ? 0.3 : 0.24),
      mix(body, mix(pal.fg, pal.interest, 0.75), dark ? 0.55 : 0.42),
      mix(body, mix(pal.fg, pal.data, 0.75), dark ? 0.52 : 0.44),
      mix(body, pal.fg, dark ? 0.52 : 0.42),
    ];

    // The body: a flat disk and a solid limb.
    list.circle(cx, cy, r, body, 1);
    list.ring(cx, cy, r, 1.5, pal.fg, dark ? 0.35 : 0.3);

    // Territories: a halftone of flat dots in each AS's tone; the AS under the pointer lights up.
    for (const d of this.#dots) {
      const [x, y, z] = P(d.p);
      if (z <= 0.04) continue;
      const lit = this.#asLight[d.as] as number;
      const tone = tones[this.#tone[d.as] as number] as Rgba;
      const c = lit > 0.01 ? mix(tone, pal.interest, 0.45 * lit) : tone;
      list.circle(x, y, (0.7 + 0.6 * z) * (1 + 0.25 * lit), c, Math.min(1, z * 2.5));
    }

    // Borders: dashed solid lines, heavier around the AS under the pointer.
    for (const b of this.#borders) {
      const lit = Math.max(this.#asLight[b.a] as number, this.#asLight[b.b] as number);
      const color = lit > 0.05 ? mix(pal.fg, pal.interest, lit) : pal.fg;
      let prev = P(b.pts[0] as V3);
      for (let i = 1; i < b.pts.length; i++) {
        const q = P(b.pts[i] as V3);
        const f = Math.min(front(prev[2]), front(q[2]));
        if (f > 0 && i % 3 !== 0) {
          list.capsule(
            prev[0],
            prev[1],
            q[0],
            q[1],
            0.7 + 0.5 * lit,
            color,
            ((dark ? 0.32 : 0.3) + 0.4 * lit) * f,
          );
        }
        prev = q;
      }
    }

    // The path from the hovered node to the producer, to show where its questions go.
    const lit = new Set<number>();
    for (let i = this.hovered; i >= 0; i = (this.nodes[i] as GNode).parent) lit.add(i);

    // Links: solid arcs that draw themselves in from the new node toward its parent.
    for (const n of this.nodes) {
      if (n.parent < 0) continue;
      const pres = Math.min(1, this.#presence(n));
      if (pres <= 0) continue;
      const reveal = easeOut((t - n.born) / 0.7);
      const pts = n.arc;
      const segs = pts.length - 1;
      const on = lit.has(n.id);
      const w = n.kind === "core" ? 0.95 : n.kind === "edge" ? 0.8 : 0.65;
      const a = (n.kind === "agent" ? 0.42 : 0.5) * pres;
      let prev = P(pts[0] as V3);
      for (let i = 1; i <= segs; i++) {
        if (i / segs > reveal + 1e-6) break;
        const q = P(pts[i] as V3);
        if (shown(prev) && shown(q)) {
          if (on) list.capsule(prev[0], prev[1], q[0], q[1], w + 0.7, pal.interest, pres);
          else list.capsule(prev[0], prev[1], q[0], q[1], w, pal.fg, a);
        }
        prev = q;
      }
    }

    // Ripples where a packet just landed: a solid ring that springs out and thins.
    for (const rp of this.ripples) {
      const n = this.nodes[rp.node] as GNode;
      const [x, y, z] = P(n.p);
      const f = front(z);
      const e = (t - rp.t0) / 0.6;
      if (f <= 0 || e < 0 || e > 1) continue;
      const base = n.kind === "agent" ? 5 : n.kind === "producer" ? 14 : 10;
      list.ring(x, y, base + 12 * easeOut(e), 2.2 * (1 - e) + 0.4, rp.data ? pal.data : pal.interest, f);
    }

    // Packets: solid balls with an outline, stretched along their path by their speed
    // (round when they leave and when they land), with two puffs trailing behind.
    for (const p of this.packets) {
      const link = this.nodes[p.along] as GNode;
      const u = clamp01((t - p.t0) / link.dur);
      const pos = (uu: number) => {
        const e = easeInOut(uu);
        return P(along(link.arc, p.up ? e : 1 - e));
      };
      const head = pos(u);
      if (!shown(head)) continue;
      const color: Rgba = p.kind === "interest" ? pal.interest : pal.data;
      const speed = Math.sin(Math.PI * u);
      const back = pos(Math.max(0, u - 0.04));
      let dx = head[0] - back[0];
      let dy = head[1] - back[1];
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const stretch = 1 + 9 * speed;
      const rad = 4.2 - 1.1 * speed;
      for (const [lag, size] of [
        [0.16, 1.5],
        [0.09, 2.2],
      ] as const) {
        const q = pos(Math.max(0, u - lag / Math.max(0.5, link.dur)));
        if (u > lag && shown(q)) list.circle(q[0], q[1], size * (0.4 + 0.6 * speed), color, 0.9);
      }
      const tx = head[0] - dx * stretch;
      const ty = head[1] - dy * stretch;
      list.capsule(tx, ty, head[0], head[1], rad + 1.6, pal.bg, 1);
      list.capsule(tx, ty, head[0], head[1], rad, color, 1);
    }

    // Nodes: flat fills, an outline in the background color so they sit on the lines, and the
    // state shown as a fill color (blue: waiting or pending; amber: answered or cached).
    const mark = (x: number, y: number, at: number, half: number, color: Rgba, f: number) => {
      const e = (t - at) / 0.7;
      if (e < 0 || e > 1) return;
      const g = half + 10 * easeOut(e);
      list.boxOutline(x, y, g, g, 3, 2 * (1 - e) + 0.5, color, f);
    };
    const order: Kind[] = ["agent", "edge", "core", "producer"];
    for (const kind of order) {
      for (const n of this.nodes) {
        if (n.kind !== kind) continue;
        const pres = this.#presence(n);
        if (pres <= 0) continue;
        const [x, y, z] = P(n.p);
        const f = front(z);
        if (f <= 0) continue;
        const s = pres * n.hs * this.#bounce(n);
        if (kind === "agent") {
          const answered = clamp01(1 - (t - n.lastAnswer) / 1.2);
          const fill =
            n.waiting >= 0 ? pal.interest : answered > 0 ? mix(pal.fg, pal.data, answered) : pal.fg;
          list.circle(x, y, 4.2 * s + 1.6, pal.bg, f);
          list.circle(x, y, 4.2 * s, fill, f);
        } else if (kind === "edge") {
          const fresh = this.#freshness(n);
          const h = 7 * s;
          const fill =
            n.pit.size > 0 ? pal.interest : fresh > 0 ? mix(body, pal.data, 0.35 + 0.65 * fresh) : body;
          list.box(x, y, h + 1.6, h + 1.6, 3.5, pal.bg, f);
          list.box(x, y, h, h, 2.6, fill, f);
          list.boxOutline(x, y, h, h, 2.6, 2, pal.fg, f);
          mark(x, y, n.lastHit, h, pal.data, f);
          mark(x, y, n.lastAggregate, h, pal.interest, f);
        } else if (kind === "core") {
          const fresh = this.#freshness(n);
          const rr = 9 * s;
          const inner =
            n.pit.size > 0 ? pal.interest : fresh > 0 ? mix(pal.fg, pal.data, 0.4 + 0.6 * fresh) : pal.fg;
          list.circle(x, y, rr + 1.6, pal.bg, f);
          list.circle(x, y, rr, body, f);
          list.ring(x, y, rr - 1, 2.2, pal.fg, f);
          list.circle(x, y, 3.6 * s, inner, f);
          const e = (t - Math.max(n.lastHit, n.lastAggregate)) / 0.7;
          if (e >= 0 && e <= 1) {
            const c = n.lastHit > n.lastAggregate ? pal.data : pal.interest;
            list.ring(x, y, rr + 2 + 9 * easeOut(e), 2 * (1 - e) + 0.5, c, f);
          }
        } else {
          const h = 11 * s;
          list.box(x, y, h + 2, h + 2, 4.5, pal.bg, f);
          list.box(x, y, h, h, 3.5, pal.fg, f);
          list.box(x, y, h * 0.42, h * 0.42, 1.8, pal.data, f);
          mark(x, y, n.lastAnswer, h, pal.data, f);
        }
      }
    }
  }
}

/** Orthographic projection for `view`: a unit-sphere point to (screen x, screen y, depth toward the viewer). */
export function projector(view: View): (p: V3) => [number, number, number] {
  const cy = Math.cos(view.yaw);
  const sy = Math.sin(view.yaw);
  const cp = Math.cos(view.pitch);
  const sp = Math.sin(view.pitch);
  return (p) => {
    const x1 = p[0] * cy - p[2] * sy;
    const z1 = p[0] * sy + p[2] * cy;
    const y2 = p[1] * cp - z1 * sp;
    const z2 = p[1] * sp + z1 * cp;
    return [view.cx + x1 * view.r, view.cy - y2 * view.r, z2];
  };
}

/** The point of the unit sphere drawn at screen (x, y), or `null` off the disk. Inverse of {@link projector}. */
export function unproject(view: View, x: number, y: number): V3 | null {
  const x1 = (x - view.cx) / view.r;
  const y2 = -(y - view.cy) / view.r;
  const d = x1 * x1 + y2 * y2;
  if (d >= 0.985) return null;
  const z2 = Math.sqrt(1 - d);
  const cp = Math.cos(view.pitch);
  const sp = Math.sin(view.pitch);
  const p1 = y2 * cp + z2 * sp;
  const z1 = -y2 * sp + z2 * cp;
  const cy = Math.cos(view.yaw);
  const sy = Math.sin(view.yaw);
  return [x1 * cy + z1 * sy, p1, -x1 * sy + z1 * cy];
}

/**
 * The starting orientation. The longitude facing the viewer equals `yaw` and the latitude at the
 * centre equals `pitch`. The globe sits half off the right edge, so the side in view is the one
 * west of `yaw`: the producer's AS first, then the globe turns.
 */
export const REST = { yaw: -12 * RAD, pitch: 12 * RAD };
