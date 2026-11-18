import type { InstanceList } from "../render/shapes";
import type { Palette, Rgba } from "../theme-colors";
import type { Rect } from "./layout";
import { bounce, easeInOut, easeOut, popIn } from "./motion";

export type NodeKind = "agent" | "forwarder" | "producer";
export type PacketKind = "interest" | "data" | "nack" | "call" | "result";
export type FlashKind = "cs" | "pit" | "fail" | "produce" | "bypass";

/**
 * A node's place: normalized [0, 1] coordinates inside its pane when the scene lays nodes out itself,
 * or world units (CSS px at zoom 1) when it has a {@link Camera} (the network editor).
 */
export interface SceneNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
}

/** A packet on a link, animated between `t0` and `t1` (scene time, ms). */
export interface ScenePacket {
  from: string;
  to: string;
  kind: PacketKind;
  t0: number;
  t1: number;
  lost?: boolean;
  tampered?: boolean;
  /** The IDEM name (or tool, for plain calls) it carries; the log highlights by it. */
  label?: string;
}

/** The editor's view: the world point at the pane's center, and the zoom (1 = one unit per CSS px). */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 2.5;

/** What the owner knows about a forwarder's tables, for its fill color. */
export interface NodeState {
  /** Pending Interests (waiting faces). */
  pit: number;
  /** Cached entries. */
  cs: number;
  /** Share of cached entries still fresh, 0..1. */
  fresh: number;
}

/** Per-node animation state, in real time (ms). */
interface Live {
  born: number;
  bump: number;
  ask: number;
  answer: number;
  hit: number;
  aggregate: number;
  produce: number;
  fail: number;
}

interface Packet extends ScenePacket {
  departed?: boolean;
}

/** Draw options. */
export interface BuildOptions {
  /** Honor `prefers-reduced-motion`: no pops, bounces, squash or puffs. */
  reduced: boolean;
  /** Many shapes on a slow backend: solid links instead of dashes. */
  dense: boolean;
}

const MAX_PACKETS = 900;
const LIFE: Live = {
  born: 0,
  bump: -1e9,
  ask: -1e9,
  answer: -1e9,
  hit: -1e9,
  aggregate: -1e9,
  produce: -1e9,
  fail: -1e9,
};

/**
 * Columns by hop distance from the producer: agents at x = 0 (fanned on a shallow arc so dense swarms
 * stay legible), the producer at x = 1.
 */
export function layoutTopology(topology: {
  nodes: { id: string; kind: NodeKind }[];
  links: { a: string; b: string }[];
}): SceneNode[] {
  const adj = new Map<string, string[]>();
  for (const l of topology.links) {
    adj.set(l.a, [...(adj.get(l.a) ?? []), l.b]);
    adj.set(l.b, [...(adj.get(l.b) ?? []), l.a]);
  }
  const depth = bfsDepth(topology, adj);
  const agentDepth = Math.max(
    1,
    ...topology.nodes.filter((n) => n.kind === "agent").map((n) => depth.get(n.id) ?? 1),
  );
  const columns = new Map<number, { id: string; kind: NodeKind }[]>();
  for (const n of topology.nodes) {
    const d = n.kind === "agent" ? agentDepth : (depth.get(n.id) ?? 1);
    columns.set(d, [...(columns.get(d) ?? []), n]);
  }
  const out: SceneNode[] = [];
  for (const [d, nodes] of columns) {
    const x = 1 - d / agentDepth;
    nodes.forEach((n, i) => {
      const f = (i + 0.5) / nodes.length;
      if (n.kind === "agent") {
        const span = Math.min(1, 0.1 + nodes.length * 0.075);
        out.push({
          id: n.id,
          kind: n.kind,
          x: x + 0.07 * Math.sin(Math.PI * f) * Math.min(1, nodes.length / 6),
          y: 0.5 + (f - 0.5) * span,
        });
      } else {
        const span = Math.min(0.72, (nodes.length - 1) * 0.36);
        out.push({
          id: n.id,
          kind: n.kind,
          x,
          y: nodes.length === 1 ? 0.5 : 0.5 + (f - 0.5) * (span / (1 - 1 / nodes.length)),
        });
      }
    });
  }
  return out;
}

function bfsDepth(
  topology: { nodes: { id: string; kind: NodeKind }[] },
  adj: Map<string, string[]>,
): Map<string, number> {
  // Hops from the nearest producer (every producer is a source, so several producers work).
  const producers = topology.nodes.filter((n) => n.kind === "producer");
  const depth = new Map<string, number>();
  for (const p of producers) depth.set(p.id, 0);
  const q = producers.map((p) => p.id);
  while (q.length > 0) {
    const n = q.shift() as string;
    for (const m of adj.get(n) ?? []) {
      if (depth.has(m)) continue;
      depth.set(m, (depth.get(n) ?? 0) + 1);
      q.push(m);
    }
  }
  return depth;
}

const mix = (a: Rgba, b: Rgba, k: number): Rgba => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
  1,
];

/** The inner box of a pane where nodes are placed (room for titles above and labels below). */
export function innerFrame(frame: Rect): Rect {
  const small = frame.h < 260;
  const l = 30;
  const r = 34;
  const t = small ? 40 : 56;
  const b = small ? 34 : 48;
  return { x: frame.x + l, y: frame.y + t, w: Math.max(1, frame.w - l - r), h: Math.max(1, frame.h - t - b) };
}

/** Node scale for a pane: shapes grow a little in roomy panes and shrink in cramped ones. */
export function nodeScale(frame: Rect): number {
  return Math.max(0.78, Math.min(1.18, Math.min(frame.w, frame.h) / 400));
}

/**
 * What a topology pane draws: nodes, links, packets in flight and the marks protocol events leave,
 * in the site's flat cartoon style (the hero globe's vocabulary): solid shapes with a
 * background-colored outline, dashed agent links, nodes that pop in with overshoot and bounce when a
 * packet lands, packets that squash and stretch with their speed and trail two puffs. Blue is a
 * request (an Interest, a pending PIT entry), yellow an answer (Data, a fresh CS entry), ink a
 * rejection. No glow and no gradients.
 */
export class TopologyScene {
  nodes = new Map<string, SceneNode>();
  links: [string, string][] = [];
  packets: Packet[] = [];
  /** When set, packets carrying another label are dimmed. */
  highlight: string | undefined;
  /** Node under the pointer: its path to the producer is drawn in blue. */
  hover: string | undefined;
  /** Node whose tables are open (or the editor's selected node). */
  selected: string | undefined;
  /** The editor's selected link, as an index into `links`. */
  selectedLink: number | undefined;
  /**
   * The editor's link being drawn: from a node to a screen point, `ok` when it would land on a node
   * it may link to.
   */
  draft: { from: string; x: number; y: number; ok: boolean } | undefined;
  /** Bumped on topology change, so overlays can re-render. */
  version = 0;
  /**
   * Set by the network editor: nodes keep the world positions they are given and are drawn through
   * this view (pan and zoom) instead of being laid out in the pane. `null`: the automatic layout.
   */
  camera: Camera | null = null;
  readonly #state = new Map<string, NodeState>();
  readonly #live = new Map<string, Live>();
  #parent = new Map<string, string>();

  /** Replace the topology; nodes pop in from the producer outward, starting at real time `at`. */
  setTopology(
    t: { nodes: { id: string; kind: NodeKind; x?: number; y?: number }[]; links: { a: string; b: string }[] },
    at = performance.now(),
    /** Keep the packets in flight whose ends still exist (an edit, not a new run). */
    keepTraffic = false,
  ): void {
    // With a camera the nodes come placed (world units); otherwise they are laid out in columns.
    const placed: SceneNode[] = this.camera
      ? t.nodes.map((n) => ({ id: n.id, kind: n.kind, x: n.x ?? 0, y: n.y ?? 0 }))
      : layoutTopology(t);
    const before = new Set(this.nodes.keys());
    this.nodes = new Map(placed.map((n) => [n.id, n]));
    this.links = t.links.map((l) => [l.a, l.b]);
    this.packets = keepTraffic
      ? this.packets.filter((p) => this.nodes.has(p.from) && this.nodes.has(p.to))
      : [];
    // Parents toward the producer, for the hover path.
    const adj = new Map<string, string[]>();
    for (const l of t.links) {
      adj.set(l.a, [...(adj.get(l.a) ?? []), l.b]);
      adj.set(l.b, [...(adj.get(l.b) ?? []), l.a]);
    }
    const depth = bfsDepth(t, adj);
    this.#parent = new Map();
    for (const n of t.nodes) {
      const d = depth.get(n.id);
      if (d === undefined || d === 0) continue;
      const up = (adj.get(n.id) ?? []).find((m) => depth.get(m) === d - 1);
      if (up) this.#parent.set(n.id, up);
    }
    // Entrance: the producer first, then forwarders, then agents; nodes that already existed stay.
    const order = [...placed].sort((a, b) => (depth.get(a.id) ?? 0) - (depth.get(b.id) ?? 0));
    const live = new Map<string, Live>();
    order.forEach((n, i) => {
      const prev = before.has(n.id) ? this.#live.get(n.id) : undefined;
      live.set(n.id, prev ?? { ...LIFE, born: at + Math.min(i, 24) * 14 });
    });
    this.#live.clear();
    for (const [k, v] of live) this.#live.set(k, v);
    for (const id of this.#state.keys()) if (!this.nodes.has(id)) this.#state.delete(id);
    if (this.hover && !this.nodes.has(this.hover)) this.hover = undefined;
    if (this.selected && !this.nodes.has(this.selected)) this.selected = undefined;
    this.selectedLink = undefined;
    this.version++;
  }

  clearTraffic(): void {
    this.packets = [];
  }

  addPacket(p: ScenePacket): void {
    this.packets.push({ ...p });
    if (this.packets.length > MAX_PACKETS) this.packets.splice(0, this.packets.length - MAX_PACKETS);
  }

  /** A protocol event at a node: CS hit, PIT aggregation, production, rejection. */
  flash(node: string, kind: FlashKind, at = performance.now()): void {
    const l = this.#live.get(node);
    if (!l) return;
    if (kind === "cs") l.hit = at;
    else if (kind === "pit") l.aggregate = at;
    else if (kind === "produce") l.produce = at;
    else if (kind === "fail") l.fail = at;
    l.bump = at;
  }

  /** Update a forwarder's table counts (sampled by the owner). */
  setState(id: string, s: NodeState): void {
    this.#state.set(id, s);
  }

  /** Packets still travelling at scene time `now`. */
  inFlight(now: number): number {
    let n = 0;
    for (const p of this.packets) if (now < p.t1) n++;
    return n;
  }

  /** Move a node (world units, editor only); packets on its links follow it. */
  move(id: string, x: number, y: number): void {
    const n = this.nodes.get(id);
    if (!n) return;
    n.x = x;
    n.y = y;
  }

  /** How big nodes are drawn in `frame`: the pane's size, or the camera's zoom in the editor. */
  scaleFor(frame: Rect): number {
    if (this.camera) return Math.max(0.6, Math.min(1.6, this.camera.zoom));
    return nodeScale(frame);
  }

  /** Screen position of a world point (editor) inside `frame`. */
  toScreen(frame: Rect, x: number, y: number): [number, number] {
    const c = this.camera ?? { x: 0, y: 0, zoom: 1 };
    return [frame.x + frame.w / 2 + (x - c.x) * c.zoom, frame.y + frame.h / 2 + (y - c.y) * c.zoom];
  }

  /** World point under a screen position (editor) inside `frame`. */
  toWorld(frame: Rect, sx: number, sy: number): [number, number] {
    const c = this.camera ?? { x: 0, y: 0, zoom: 1 };
    return [c.x + (sx - frame.x - frame.w / 2) / c.zoom, c.y + (sy - frame.y - frame.h / 2) / c.zoom];
  }

  /** Center and zoom the camera on every node, leaving `pad` px around them. */
  fit(frame: Rect, pad = 72): void {
    if (!this.camera) return;
    const ns = [...this.nodes.values()];
    // In place: the editor shares one camera object between the panes of a comparison.
    if (ns.length === 0) {
      Object.assign(this.camera, { x: 0, y: 0, zoom: 1 });
      return;
    }
    const xs = ns.map((n) => n.x);
    const ys = ns.map((n) => n.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const zoom = Math.min(
      1.4,
      Math.max(
        MIN_ZOOM,
        Math.min((frame.w - 2 * pad) / Math.max(1, x1 - x0), (frame.h - 2 * pad) / Math.max(1, y1 - y0)),
      ),
    );
    Object.assign(this.camera, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom });
  }

  /** Screen position of a node inside `frame`. */
  screen(frame: Rect, id: string): [number, number] | undefined {
    const n = this.nodes.get(id);
    if (!n) return undefined;
    if (this.camera) return this.toScreen(frame, n.x, n.y);
    const f = innerFrame(frame);
    return [f.x + n.x * f.w, f.y + n.y * f.h];
  }

  /** The link drawn nearest to (x, y) within `reach` px, as its index in `links`, if any. */
  linkAt(frame: Rect, x: number, y: number, reach = 7): number | undefined {
    let best: number | undefined;
    let bd = reach;
    this.links.forEach(([a, b], i) => {
      const p = this.screen(frame, a);
      const q = this.screen(frame, b);
      if (!p || !q) return;
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - p[0]) * dx + (y - p[1]) * dy) / len2));
      const d = Math.hypot(p[0] + t * dx - x, p[1] + t * dy - y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  /** The node drawn nearest to (x, y) within `reach` px, if any. */
  nodeAt(frame: Rect, x: number, y: number, reach = 12): string | undefined {
    const k = this.scaleFor(frame);
    let best: string | undefined;
    let bd = reach;
    for (const n of this.nodes.values()) {
      const p = this.screen(frame, n.id);
      if (!p) continue;
      const pad = (n.kind === "agent" ? 5 : n.kind === "forwarder" ? 10 : 12) * k;
      const d = Math.hypot(p[0] - x, p[1] - y) - pad;
      if (d < bd) {
        bd = d;
        best = n.id;
      }
    }
    return best;
  }

  /**
   * Append this frame's shapes to `list`, inside `frame` (CSS px). `now` is scene time (virtual ms for
   * the simulator, real ms for live mode); `real` is `performance.now()` for the cartoon motion.
   */
  build(list: InstanceList, frame: Rect, pal: Palette, now: number, real: number, o: BuildOptions): void {
    const k = this.scaleFor(frame);
    const pos = (id: string) => this.screen(frame, id);
    const body = mix(pal.bg, pal.fg, pal.dark ? 0.08 : 0.05);
    const age = (t: number) => (real - t) / 1000;
    const presence = (id: string) => {
      const l = this.#live.get(id);
      if (!l) return 1;
      return o.reduced ? (real >= l.born ? 1 : 0) : popIn(age(l.born));
    };

    // The hovered node's path to the producer.
    const path = new Set<string>();
    for (let n = this.hover; n !== undefined; n = this.#parent.get(n)) path.add(n);

    // The editor's selected link, under everything: a wide ink band.
    const sel = this.selectedLink !== undefined ? this.links[this.selectedLink] : undefined;
    if (sel) {
      const pa = pos(sel[0]);
      const pb = pos(sel[1]);
      if (pa && pb) list.capsule(pa[0], pa[1], pb[0], pb[1], 3.2, pal.fg, 0.22);
    }

    // Links: dashed toward agents, solid between forwarders; drawn in from the child to its parent.
    for (const [a, b] of this.links) {
      const pa = pos(a);
      const pb = pos(b);
      if (!pa || !pb) continue;
      const na = this.nodes.get(a);
      const nb = this.nodes.get(b);
      const agentLink = na?.kind === "agent" || nb?.kind === "agent";
      const child = this.#parent.get(a) === b ? a : b;
      const [from, to] = child === a ? [pa, pb] : [pb, pa];
      const born = this.#live.get(child)?.born ?? 0;
      const reveal = o.reduced ? 1 : easeOut((real - born) / 520);
      if (reveal <= 0) continue;
      const ex = from[0] + (to[0] - from[0]) * reveal;
      const ey = from[1] + (to[1] - from[1]) * reveal;
      const lit = path.has(a) && path.has(b);
      if (lit) {
        list.capsule(from[0], from[1], ex, ey, 1.3, pal.interest, 1);
        continue;
      }
      if (agentLink && !o.dense) {
        const len = Math.hypot(ex - from[0], ey - from[1]);
        const dash = 5;
        const gap = 4.5;
        const ux = (ex - from[0]) / Math.max(1, len);
        const uy = (ey - from[1]) / Math.max(1, len);
        for (let s = 0; s < len; s += dash + gap) {
          const e = Math.min(len, s + dash);
          list.capsule(
            from[0] + ux * s,
            from[1] + uy * s,
            from[0] + ux * e,
            from[1] + uy * e,
            0.6,
            pal.fg,
            0.34,
          );
        }
      } else {
        list.capsule(from[0], from[1], ex, ey, agentLink ? 0.55 : 0.95, pal.fg, agentLink ? 0.26 : 0.42);
      }
    }

    // The link being drawn in the editor: dashed, blue once it would land on a node it may join.
    if (this.draft) {
      const p = pos(this.draft.from);
      if (p) {
        const { x, y, ok } = this.draft;
        const len = Math.hypot(x - p[0], y - p[1]);
        const ux = (x - p[0]) / Math.max(1, len);
        const uy = (y - p[1]) / Math.max(1, len);
        const ink = ok ? pal.interest : pal.fg;
        for (let s = 0; s < len; s += 10) {
          const e = Math.min(len, s + 6);
          list.capsule(p[0] + ux * s, p[1] + uy * s, p[0] + ux * e, p[1] + uy * e, 1.1, ink, ok ? 1 : 0.6);
        }
        list.circle(x, y, 3.2, ink, ok ? 1 : 0.6);
      }
    }

    // Packets, under the nodes they land in.
    const keep: Packet[] = [];
    for (const pk of this.packets) {
      const fromNode = this.nodes.get(pk.from);
      if (!pk.departed && now >= pk.t0) {
        pk.departed = true;
        if (fromNode?.kind === "agent" && (pk.kind === "interest" || pk.kind === "call")) {
          const l = this.#live.get(pk.from);
          if (l) l.ask = real;
        }
      }
      if (now >= pk.t1) {
        if (!pk.lost) {
          const l = this.#live.get(pk.to);
          if (l) {
            l.bump = real;
            if (this.nodes.get(pk.to)?.kind === "agent" && pk.kind !== "interest" && pk.kind !== "call")
              l.answer = real;
          }
        }
        continue;
      }
      keep.push(pk);
      if (now < pk.t0) continue;
      const a = pos(pk.from);
      const b = pos(pk.to);
      if (!a || !b) continue;
      this.#packet(list, pk, a, b, now, real, pal, k, o);
    }
    this.packets = keep;

    // Nodes.
    const mark = (x: number, y: number, at: number, half: number, color: Rgba) => {
      const e = age(at) / 0.7;
      if (e < 0 || e > 1) return;
      const g = half + (o.reduced ? 5 : 11 * easeOut(e));
      list.boxOutline(x, y, g, g, 3.5, 2.2 * (1 - e) + 0.5, color, o.reduced ? 1 - e : 1);
    };
    const ring = (x: number, y: number, at: number, r: number, color: Rgba) => {
      const e = age(at) / 0.7;
      if (e < 0 || e > 1) return;
      list.ring(
        x,
        y,
        r + (o.reduced ? 5 : 12 * easeOut(e)),
        2.2 * (1 - e) + 0.4,
        color,
        o.reduced ? 1 - e : 1,
      );
    };
    const cross = (x: number, y: number, at: number) => {
      const e = age(at);
      if (e < 0 || e > 1.1) return;
      const s = (o.reduced ? 1 : popIn(e)) * 4.5;
      const fade = e < 0.8 ? 1 : 1 - (e - 0.8) / 0.3;
      const cy = y - 22 * k;
      list.capsule(x - s, cy - s, x + s, cy + s, 2.6, pal.bg, fade);
      list.capsule(x - s, cy + s, x + s, cy - s, 2.6, pal.bg, fade);
      list.capsule(x - s, cy - s, x + s, cy + s, 1.3, pal.fg, fade);
      list.capsule(x - s, cy + s, x + s, cy - s, 1.3, pal.fg, fade);
    };
    const order: NodeKind[] = ["agent", "forwarder", "producer"];
    for (const kind of order) {
      for (const n of this.nodes.values()) {
        if (n.kind !== kind) continue;
        const p = pos(n.id);
        const l = this.#live.get(n.id) ?? LIFE;
        if (!p) continue;
        const pres = presence(n.id);
        if (pres <= 0) continue;
        const [x, y] = p;
        const s = pres * (o.reduced ? 1 : bounce(age(l.bump), kind === "agent" ? 0.42 : 0.24)) * k;
        const hovered = this.hover === n.id;
        if (kind === "agent") {
          const answered = Math.max(0, 1 - age(l.answer) / 1.2);
          const waiting = l.ask > l.answer;
          const fill = waiting ? pal.interest : answered > 0 ? mix(pal.fg, pal.data, answered) : pal.fg;
          const r = (hovered ? 5.6 : 4.6) * s;
          list.circle(x, y, r + 1.8, pal.bg);
          list.circle(x, y, r, fill);
          if (this.selected === n.id) list.ring(x, y, r + 4, 1.4, pal.fg);
        } else if (kind === "forwarder") {
          const st = this.#state.get(n.id);
          const h = (hovered ? 10.5 : 9) * s;
          const fill =
            st && st.pit > 0
              ? pal.interest
              : st && st.cs > 0
                ? mix(body, pal.data, 0.3 + 0.6 * st.fresh)
                : body;
          list.box(x, y, h + 2, h + 2, 4.5, pal.bg);
          list.box(x, y, h, h, 3.2, fill);
          list.boxOutline(x, y, h, h, 3.2, 2, pal.fg);
          if (this.selected === n.id) list.boxOutline(x, y, h + 5, h + 5, 5.5, 1.4, pal.fg, 0.9);
          mark(x, y, l.hit, h, pal.data);
          mark(x, y, l.aggregate, h, pal.interest);
          cross(x, y, l.fail);
        } else {
          const h = (hovered ? 12.5 : 11) * s;
          list.box(x, y, h + 2.2, h + 2.2, 5, pal.bg);
          list.box(x, y, h, h, 3.8, pal.fg);
          list.box(x, y, h * 0.42, h * 0.42, 1.8, pal.data);
          if (this.selected === n.id) list.boxOutline(x, y, h + 5, h + 5, 6, 1.4, pal.fg, 0.9);
          ring(x, y, l.produce, h, pal.data);
          cross(x, y, l.fail);
        }
        if (kind === "agent") cross(x, y, l.fail);
      }
    }
  }

  #packet(
    list: InstanceList,
    pk: Packet,
    a: [number, number],
    b: [number, number],
    now: number,
    real: number,
    pal: Palette,
    k: number,
    o: BuildOptions,
  ): void {
    const span = Math.max(1e-6, pk.t1 - pk.t0);
    const u = Math.min(1, (now - pk.t0) / span);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / len;
    const uy = dy / len;
    // Requests and answers ride opposite sides of the link.
    const side = pk.kind === "interest" || pk.kind === "call" ? 1 : -1;
    const ox = -uy * 3.2 * side;
    const oy = ux * 3.2 * side;
    const at = (uu: number): [number, number] => {
      const e = o.reduced ? uu : easeInOut(uu);
      return [a[0] + dx * e + ox, a[1] + dy * e + oy];
    };
    let [hx, hy] = at(u);
    const dim = this.highlight && pk.label !== this.highlight ? 0.2 : 1;
    let alpha = dim;
    let fall = 0;
    if (pk.lost) {
      // Lost on the link: it slips off, drops and fades.
      if (u > 0.55) {
        const q = (u - 0.55) / 0.3;
        if (q >= 1) return;
        fall = q * q * 26;
        alpha *= 1 - q;
      }
      hy += fall;
    }
    if (pk.tampered && !o.reduced) {
      const w = Math.sin(real * 0.035) * 1.6;
      hx += -uy * w;
      hy += ux * w;
    }
    const request = pk.kind === "interest" || pk.kind === "call";
    const color: Rgba = pk.lost
      ? pal.faint
      : request
        ? pal.interest
        : pk.kind === "data" || pk.kind === "result"
          ? pal.data
          : pal.fg;
    const speed = o.reduced ? 0 : Math.sin(Math.PI * u);
    const stretch = Math.min(len * 0.12, 1 + 8 * speed);
    const tx = hx - ux * stretch;
    const ty = hy - uy * stretch;
    const rad = (3.7 - 0.9 * speed) * Math.min(1.1, k);
    const emphasis = this.highlight && dim === 1 ? 1.25 : 1;

    if (pk.kind === "nack") {
      list.circle(hx, hy, 3.4, pal.bg, alpha);
      list.circle(hx, hy, 2.2, pal.fg, alpha);
      return;
    }
    // Two puffs trailing the packet (the hero's cartoon speed lines).
    if (!o.reduced && !pk.lost && len > 40) {
      for (const [lag, size] of [
        [0.16, 1.3],
        [0.08, 1.9],
      ] as const) {
        if (u <= lag) continue;
        const q = at(u - lag);
        list.circle(q[0], q[1], size * (0.45 + 0.55 * speed), color, 0.85 * alpha);
      }
    }
    if (pk.tampered) {
      list.capsule(tx, ty, hx, hy, rad * emphasis + 1.8, pal.bg, alpha);
      list.capsule(tx, ty, hx, hy, rad * emphasis, pal.fg, alpha);
      list.capsuleOutline(tx, ty, hx, hy, rad * emphasis + 1.6, 1.4, pal.data, alpha);
      return;
    }
    if (pk.kind === "call" || pk.kind === "result") {
      list.capsule(tx, ty, hx, hy, rad * emphasis + 1.6, pal.bg, alpha);
      list.capsuleOutline(tx, ty, hx, hy, rad * emphasis - 0.2, 1.7, color, alpha);
      return;
    }
    list.capsule(tx, ty, hx, hy, rad * emphasis + 1.7, pal.bg, alpha);
    list.capsule(tx, ty, hx, hy, rad * emphasis, color, alpha);
  }
}
