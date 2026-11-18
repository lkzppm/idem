/**
 * The bench topology of `compose.yaml`: nodes, addresses and links. Every node is one network
 * namespace with an NFD container and a Node sidecar (except `agents`, a Node container alone).
 */
import type { E4Config, ModeInfo } from "./config";

export type NodeId = "agents" | "edge1" | "edge2" | "regional" | "producer";
export type LinkId = "a1" | "a2" | "e1p" | "e1r" | "e2r" | "rp";

export const PRODUCER_NAME = "demo.idem.dev";
/** NDN prefix the producer registers and the forwarders route. */
export const NDN_PREFIX = `/idem/v1/${PRODUCER_NAME}`;
export const HTTP_PORT = 8080;
export const NDN_PORT = 6363;

/** Containers per node: the Node sidecar (tc, roles) and the NFD (absent for `agents`). */
export const CONTAINERS: Record<NodeId, { node: string; nfd?: string }> = {
  agents: { node: "idem-bench-agents" },
  edge1: { node: "idem-bench-edge1", nfd: "idem-bench-nfd-edge1" },
  edge2: { node: "idem-bench-edge2", nfd: "idem-bench-nfd-edge2" },
  regional: { node: "idem-bench-regional", nfd: "idem-bench-nfd-regional" },
  producer: { node: "idem-bench-producer", nfd: "idem-bench-nfd-producer" },
};

export interface LinkInfo {
  id: LinkId;
  /** Lower end (toward the agents) and upper end (toward the producer), with their addresses. */
  down: { node: NodeId; ip: string };
  up: { node: NodeId; ip: string };
}

export const LINKS: Record<LinkId, LinkInfo> = {
  a1: { id: "a1", down: { node: "agents", ip: "10.231.1.20" }, up: { node: "edge1", ip: "10.231.1.10" } },
  a2: { id: "a2", down: { node: "agents", ip: "10.231.2.20" }, up: { node: "edge2", ip: "10.231.2.10" } },
  e1p: { id: "e1p", down: { node: "edge1", ip: "10.231.3.10" }, up: { node: "producer", ip: "10.231.3.20" } },
  e1r: { id: "e1r", down: { node: "edge1", ip: "10.231.4.10" }, up: { node: "regional", ip: "10.231.4.20" } },
  e2r: { id: "e2r", down: { node: "edge2", ip: "10.231.5.10" }, up: { node: "regional", ip: "10.231.5.20" } },
  rp: {
    id: "rp",
    down: { node: "regional", ip: "10.231.6.10" },
    up: { node: "producer", ip: "10.231.6.20" },
  },
};

/** One-way delay of a link (both ends' egress get it, so each direction sees it once). */
export function linkDelayMs(cfg: E4Config, id: LinkId): number {
  switch (id) {
    case "a1":
    case "a2":
      return cfg.links.agentMs;
    case "e1p":
      return cfg.links.starProducerMs;
    case "e1r":
    case "e2r":
      return cfg.links.treeCoreMs;
    case "rp":
      return cfg.links.treeProducerMs;
  }
}

/** A forwarder's next hop toward the producer in a topology. */
export interface Hop {
  node: Exclude<NodeId, "agents" | "producer">;
  /** Link to the next hop and the next hop's address on it. */
  link: LinkId;
  nextHop: NodeId;
}

export function hopsOf(topology: ModeInfo["topology"]): Hop[] {
  return topology === "star"
    ? [{ node: "edge1", link: "e1p", nextHop: "producer" }]
    : [
        { node: "edge1", link: "e1r", nextHop: "regional" },
        { node: "edge2", link: "e2r", nextHop: "regional" },
        { node: "regional", link: "rp", nextHop: "producer" },
      ];
}

/** Links a topology uses, and which of them reaches the producer. */
export function linksOf(topology: ModeInfo["topology"]): { used: LinkId[]; producerLink: LinkId } {
  return topology === "star"
    ? { used: ["a1", "e1p"], producerLink: "e1p" }
    : { used: ["a1", "a2", "e1r", "e2r", "rp"], producerLink: "rp" };
}

/** The edge agent `i` attaches to: all on edge1 in the star, `i % 2` in the tree (as `buildTopology`). */
export function edgeOf(topology: ModeInfo["topology"], i: number): { node: "edge1" | "edge2"; link: LinkId } {
  if (topology === "star" || i % 2 === 0) return { node: "edge1", link: "a1" };
  return { node: "edge2", link: "a2" };
}

/** Address of `node` on `link`. */
export function ipOn(link: LinkId, node: NodeId): string {
  const l = LINKS[link];
  if (l.down.node === node) return l.down.ip;
  if (l.up.node === node) return l.up.ip;
  throw new Error(`${node} is not on link ${link}`);
}

/** Every (node, link) end, i.e. every interface that gets a netem qdisc. */
export function interfaces(): { node: NodeId; link: LinkId; ip: string }[] {
  return Object.values(LINKS).flatMap((l) => [
    { node: l.down.node, link: l.id, ip: l.down.ip },
    { node: l.up.node, link: l.id, ip: l.up.ip },
  ]);
}
