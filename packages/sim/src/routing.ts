import type { SimConfig, SimNode } from "./config";

type Topology = SimConfig["topology"];

/** How one node reaches one producer node: the link it sends on and the total one-way latency. */
export interface RouteHop {
  /** Index of the link in `topology.links`. */
  link: number;
  /** The node at the other end of that link (the next hop). */
  next: string;
  /** One-way latency from this node to the producer node along the route, ms. */
  latencyMs: number;
}

/** A path from a node to a producer node, both ends included. */
export interface RoutePath {
  nodes: string[];
  /** Indices of the links crossed, in order. */
  links: number[];
  latencyMs: number;
}

function kinds(t: Topology): Map<string, SimNode["kind"]> {
  return new Map(t.nodes.map((n) => [n.id, n.kind]));
}

/** True if candidate `(next, link)` should replace `cur` at equal latency. */
function better(next: string, link: number, cur: RouteHop): boolean {
  return next < cur.next || (next === cur.next && link < cur.link);
}

/**
 * Shortest paths toward one producer node (Dijkstra on link latency). Only forwarders relay:
 * agents and other producers are never crossed, though an agent or forwarder adjacent to the
 * producer reaches it directly. Ties are broken by the next hop's id, then by link index, so the
 * result is a deterministic, loop-free tree. Returns, for every node that can reach `producer`
 * (forwarders and agents; not the producer itself), the hop it takes.
 */
export function routesTo(topology: Topology, producer: string): Map<string, RouteHop> {
  const kind = kinds(topology);
  const out = new Map<string, RouteHop>();
  if (kind.get(producer) !== "producer") return out;
  const incident = new Map<string, number[]>();
  topology.links.forEach((l, i) => {
    if (l.a === l.b) return;
    for (const n of [l.a, l.b]) incident.set(n, [...(incident.get(n) ?? []), i]);
  });
  const dist = new Map<string, number>([[producer, 0]]);
  const done = new Set<string>();
  for (;;) {
    // Smallest tentative distance, ties by node id (graphs are small: O(V²) is fine).
    let u: string | undefined;
    for (const [n, d] of dist) {
      if (done.has(n)) continue;
      const du = u === undefined ? Number.POSITIVE_INFINITY : (dist.get(u) as number);
      if (d < du || (d === du && u !== undefined && n < u)) u = n;
    }
    if (u === undefined) break;
    done.add(u);
    // Agents are leaves; producers other than the target never relay.
    if (u !== producer && kind.get(u) !== "forwarder") continue;
    const du = dist.get(u) as number;
    for (const i of incident.get(u) ?? []) {
      const l = topology.links[i] as Topology["links"][number];
      const m = l.a === u ? l.b : l.a;
      const k = kind.get(m);
      if (done.has(m) || k === undefined || k === "producer") continue;
      const cost = du + l.latencyMs;
      const prev = dist.get(m);
      const hop = out.get(m);
      if (prev === undefined || cost < prev || (cost === prev && hop && better(u, i, hop))) {
        dist.set(m, cost);
        out.set(m, { link: i, next: u, latencyMs: cost });
      }
    }
  }
  return out;
}

/**
 * The shortest path from `from` (an agent or forwarder) to the producer node `producer`, or
 * `undefined` if there is none. The simulator routes every call this way (ADR-027).
 */
export function pathToProducer(topology: Topology, from: string, producer: string): RoutePath | undefined {
  const routes = routesTo(topology, producer);
  const first = routes.get(from);
  if (!first) return undefined;
  const nodes = [from];
  const links: number[] = [];
  let at = from;
  for (let hop = routes.get(at); hop; hop = routes.get(at)) {
    links.push(hop.link);
    nodes.push(hop.next);
    at = hop.next;
    if (at === producer) break;
  }
  return { nodes, links, latencyMs: first.latencyMs };
}

/**
 * Producer nodes an agent can reach through forwarders (or over a direct link), nearest first
 * (ties by node id). The editor uses it to offer only tools an agent can actually call.
 */
export function reachableProducers(topology: Topology, agentId: string): string[] {
  return topology.nodes
    .filter((n) => n.kind === "producer")
    .map((n) => ({ id: n.id, hop: routesTo(topology, n.id).get(agentId) }))
    .filter((r): r is { id: string; hop: RouteHop } => r.hop !== undefined)
    .sort((a, b) => a.hop.latencyMs - b.hop.latencyMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r) => r.id);
}
