/**
 * The network editor's model: what the visitor builds on the stage. Pure data and pure functions
 * (no React, no simulator), so it is tested on its own and turned into a simulator config elsewhere.
 *
 * Positions are world units (CSS px at zoom 1). A network is saved in `localStorage` and shared in
 * the URL hash; both go through {@link encodeNetwork} / {@link decodeNetwork}, which validate and
 * repair what they read.
 */

/** A node's kind on the stage. Forwarders are edge or regional by where they sit, not by kind. */
export type NetNodeKind = "agent" | "forwarder" | "producer";

/** The demo tools (the producers' catalog). */
export const TOOL_IDS = ["fetch_page", "search_corpus", "weather", "my_notes", "send_email"] as const;
export type ToolId = (typeof TOOL_IDS)[number];

/** What a tool's result may do, per the producer's signed manifest. */
export interface ToolInfo {
  id: ToolId;
  scope: "public" | "private" | "none";
  /** Default freshness (s); 0 for a tool whose results are never cached. */
  ttl: number;
}

/** The catalog, with the same scopes and TTLs as the deployed demo producer (`lib/server/demo-producer.ts`). */
export const TOOLS: Record<ToolId, ToolInfo> = {
  fetch_page: { id: "fetch_page", scope: "public", ttl: 300 },
  search_corpus: { id: "search_corpus", scope: "public", ttl: 300 },
  weather: { id: "weather", scope: "public", ttl: 15 },
  my_notes: { id: "my_notes", scope: "private", ttl: 60 },
  send_email: { id: "send_email", scope: "none", ttl: 0 },
};

/** One entry of an agent's tool list: a tool of a given producer, and how often the agent calls it. */
export interface AgentTool {
  /** Producer node id. */
  producer: string;
  tool: ToolId;
  /** Relative weight in the agent's mix (> 0). */
  weight: number;
}

export interface AgentConfig {
  tools: AgentTool[];
  /** Calls the agent makes in a run. */
  calls: number;
  /** Mean think time between calls (ms). */
  thinkMs: number;
  /** Share (0..1) of fetch_page calls that go to the shared catalog (the rest are this agent's own). */
  overlap: number;
  /** Popularity skew of the shared catalog. */
  zipf: number;
}

export interface ForwarderConfig {
  /** Content Store size (KiB). */
  csKiB: number;
}

export interface ProducerConfig {
  /** The producer's name in IDEM names (`/idem/v1/<name>/…`). */
  name: string;
  /** Tools it serves, with their freshness (s). */
  tools: { tool: ToolId; ttl: number }[];
  /** Median time to run a tool (ms). */
  serviceMs: number;
}

interface NodeBase {
  id: string;
  x: number;
  y: number;
}
export type NetNode =
  | (NodeBase & { kind: "agent"; config: AgentConfig })
  | (NodeBase & { kind: "forwarder"; config: ForwarderConfig })
  | (NodeBase & { kind: "producer"; config: ProducerConfig });

export interface NetLink {
  id: string;
  a: string;
  b: string;
  /** One-way latency (ms). */
  latencyMs: number;
  /** Loss (0..100 %). */
  lossPct: number;
}

/** How a network runs. */
export interface RunSettings {
  seed: number;
  /** Virtual ms per real ms (IDEM engine only; the NDN engine runs in real time). */
  speed: number;
  /** Protocols compared side by side (IDEM engine). */
  compare: ("mcp-direct" | "mcp-local-cache" | "idem")[];
  /**
   * `idem`: the IDEM forwarders on the simulator's seeded virtual clock. `ndn`: real NDN routers
   * (YaNFD compiled to WebAssembly) in this browser, in real time.
   */
  engine: "idem" | "ndn";
}

export interface Network {
  v: 1;
  /** The example it started from (`blank` for a blank canvas). */
  from: string;
  nodes: NetNode[];
  links: NetLink[];
  run: RunSettings;
}

export const DEFAULT_RUN: RunSettings = {
  seed: 42,
  speed: 0.1,
  compare: ["mcp-direct", "idem"],
  engine: "idem",
};

export const DEFAULT_AGENT: AgentConfig = { tools: [], calls: 10, thinkMs: 300, overlap: 0.6, zipf: 0.9 };
export const DEFAULT_FORWARDER: ForwarderConfig = { csKiB: 8192 };
export const DEFAULT_LINK = { latencyMs: 10, lossPct: 0 };

/** A producer serving the whole catalog under `name`. */
export function defaultProducer(name: string): ProducerConfig {
  return { name, tools: TOOL_IDS.map((tool) => ({ tool, ttl: TOOLS[tool].ttl })), serviceMs: 150 };
}

// ---------------------------------------------------------------- editing

/** The next free id with a prefix: `agent-0`, `agent-1`, … */
export function nextId(net: Network, prefix: string): string {
  const used = new Set([...net.nodes.map((n) => n.id), ...net.links.map((l) => l.id)]);
  for (let i = 0; ; i++) if (!used.has(`${prefix}-${i}`)) return `${prefix}-${i}`;
}

/** A unique producer name (`demo.idem.dev`, then `p1.idem.dev`, …). */
function nextProducerName(net: Network): string {
  const names = new Set(producerNodes(net).map((p) => p.config.name));
  if (!names.has("demo.idem.dev")) return "demo.idem.dev";
  for (let i = 1; ; i++) if (!names.has(`p${i}.idem.dev`)) return `p${i}.idem.dev`;
}

/** Add a node of `kind` at (x, y), with default settings. Returns the new network and the node's id. */
export function addNode(net: Network, kind: NetNodeKind, x: number, y: number): [Network, string] {
  const prefix = kind === "agent" ? "agent" : kind === "forwarder" ? "fwd" : "producer";
  const id = nextId(net, prefix);
  const node: NetNode =
    kind === "agent"
      ? { id, kind, x, y, config: { ...DEFAULT_AGENT, tools: [] } }
      : kind === "forwarder"
        ? { id, kind, x, y, config: { ...DEFAULT_FORWARDER } }
        : { id, kind, x, y, config: defaultProducer(nextProducerName(net)) };
  return [{ ...net, nodes: [...net.nodes, node] }, id];
}

/** Move a node. */
export function moveNode(net: Network, id: string, x: number, y: number): Network {
  return { ...net, nodes: net.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) };
}

/** Remove a node, its links, and the tool-list entries that pointed at it (if it was a producer). */
export function removeNode(net: Network, id: string): Network {
  return {
    ...net,
    nodes: net.nodes
      .filter((n) => n.id !== id)
      .map((n) =>
        n.kind === "agent"
          ? { ...n, config: { ...n.config, tools: n.config.tools.filter((t) => t.producer !== id) } }
          : n,
      ),
    links: net.links.filter((l) => l.a !== id && l.b !== id),
  };
}

/** Why two nodes cannot be linked, or `undefined` when they can. */
export type LinkProblem =
  | "same"
  | "exists"
  | "agent-agent"
  | "agent-producer"
  | "producer-producer"
  | "missing";

export function linkProblem(net: Network, a: string, b: string): LinkProblem | undefined {
  if (a === b) return "same";
  const na = net.nodes.find((n) => n.id === a);
  const nb = net.nodes.find((n) => n.id === b);
  if (!na || !nb) return "missing";
  if (net.links.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))) return "exists";
  const kinds = [na.kind, nb.kind].sort().join("-");
  // Agents reach producers through forwarders (that is where IDEM aggregates and caches).
  if (kinds === "agent-agent") return "agent-agent";
  if (kinds === "agent-producer") return "agent-producer";
  if (kinds === "producer-producer") return "producer-producer";
  return undefined;
}

/** Link two nodes (if allowed). Returns the network unchanged when {@link linkProblem} objects. */
export function addLink(net: Network, a: string, b: string): [Network, string | undefined] {
  if (linkProblem(net, a, b)) return [net, undefined];
  const id = nextId(net, "link");
  return [{ ...net, links: [...net.links, { id, a, b, ...DEFAULT_LINK }] }, id];
}

export function removeLink(net: Network, id: string): Network {
  return { ...net, links: net.links.filter((l) => l.id !== id) };
}

/** Replace a node's config (kind-checked by the caller's types). */
export function setNodeConfig<K extends NetNodeKind>(
  net: Network,
  id: string,
  config: Extract<NetNode, { kind: K }>["config"],
): Network {
  return { ...net, nodes: net.nodes.map((n) => (n.id === id ? ({ ...n, config } as NetNode) : n)) };
}

export function setLink(
  net: Network,
  id: string,
  patch: Partial<Pick<NetLink, "latencyMs" | "lossPct">>,
): Network {
  return { ...net, links: net.links.map((l) => (l.id === id ? { ...l, ...patch } : l)) };
}

/**
 * Give an agent with an empty tool list something to call: every cacheable public tool that the
 * producers it can reach serve (`fetch_page` weighted up, the way the examples mix it). An agent
 * that already has tools, or reaches no producer, is left alone.
 */
export function autoTools(net: Network, agent: string): Network {
  const a = net.nodes.find((n) => n.id === agent);
  if (!a || a.kind !== "agent" || a.config.tools.length > 0) return net;
  const tools: AgentTool[] = [];
  for (const pid of reachableProducers(net, agent)) {
    const p = net.nodes.find((n) => n.id === pid);
    if (p?.kind !== "producer") continue;
    for (const t of p.config.tools)
      if (TOOLS[t.tool].scope === "public")
        tools.push({ producer: pid, tool: t.tool, weight: t.tool === "fetch_page" ? 3 : 1 });
  }
  return tools.length === 0 ? net : setNodeConfig<"agent">(net, agent, { ...a.config, tools });
}

/** Fill the empty tool lists of every agent (after a link or a producer changed what they reach). */
export function autoToolsAll(net: Network): Network {
  let out = net;
  for (const n of net.nodes) if (n.kind === "agent") out = autoTools(out, n.id);
  return out;
}

/** The link between two nodes, either way round. */
export function linkBetween(net: Network, a: string, b: string): NetLink | undefined {
  return net.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
}

/**
 * Where a new node of `kind` goes when it is added next to `near`: agents to its left, producers to
 * its right, forwarders below, stepping down past nodes already there.
 */
export function placeNear(net: Network, near: NetNode, kind: NetNodeKind): [number, number] {
  const dx = kind === "agent" ? -170 : kind === "producer" ? 220 : near.kind === "agent" ? 170 : 0;
  const dy = kind === "forwarder" && near.kind !== "agent" ? 150 : 0;
  let [x, y] = [near.x + dx, near.y + dy];
  for (let i = 0; i < 40 && net.nodes.some((n) => Math.hypot(n.x - x, n.y - y) < 36); i++) y += 44;
  return [x, y];
}

// ---------------------------------------------------------------- reading

export function producerNodes(net: Network): Extract<NetNode, { kind: "producer" }>[] {
  return net.nodes.filter((n): n is Extract<NetNode, { kind: "producer" }> => n.kind === "producer");
}

/**
 * Producers an agent can reach: through forwarders only (never through another agent or producer).
 */
export function reachableProducers(net: Network, agent: string): string[] {
  const kind = new Map(net.nodes.map((n) => [n.id, n.kind]));
  const adj = new Map<string, string[]>();
  for (const l of net.links) {
    adj.set(l.a, [...(adj.get(l.a) ?? []), l.b]);
    adj.set(l.b, [...(adj.get(l.b) ?? []), l.a]);
  }
  const seen = new Set([agent]);
  const out: string[] = [];
  const q = [agent];
  while (q.length > 0) {
    const n = q.shift() as string;
    for (const m of adj.get(n) ?? []) {
      if (seen.has(m)) continue;
      seen.add(m);
      const k = kind.get(m);
      if (k === "producer") out.push(m);
      else if (k === "forwarder") q.push(m);
    }
  }
  return out.sort();
}

/** Problems that stop a network from running, shown in the editor. */
export type Issue =
  | { kind: "no-agents" }
  | { kind: "no-producers" }
  | { kind: "agent-no-tools"; node: string }
  | { kind: "tool-unreachable"; node: string; producer: string; tool: ToolId }
  | { kind: "tool-not-served"; node: string; producer: string; tool: ToolId };

export function issues(net: Network): Issue[] {
  const out: Issue[] = [];
  const agents = net.nodes.filter((n) => n.kind === "agent");
  if (agents.length === 0) out.push({ kind: "no-agents" });
  if (producerNodes(net).length === 0) out.push({ kind: "no-producers" });
  const serves = new Map(producerNodes(net).map((p) => [p.id, new Set(p.config.tools.map((t) => t.tool))]));
  for (const a of agents) {
    if (a.kind !== "agent") continue;
    if (a.config.tools.length === 0) {
      out.push({ kind: "agent-no-tools", node: a.id });
      continue;
    }
    const reach = new Set(reachableProducers(net, a.id));
    for (const t of a.config.tools) {
      if (!reach.has(t.producer))
        out.push({ kind: "tool-unreachable", node: a.id, producer: t.producer, tool: t.tool });
      else if (!serves.get(t.producer)?.has(t.tool))
        out.push({ kind: "tool-not-served", node: a.id, producer: t.producer, tool: t.tool });
    }
  }
  return out;
}

// ---------------------------------------------------------------- saving and sharing

const clampNum = (v: unknown, lo: number, hi: number, dflt: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
const isTool = (t: unknown): t is ToolId =>
  typeof t === "string" && (TOOL_IDS as readonly string[]).includes(t);
const isId = (s: unknown): s is string => typeof s === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(s);

/**
 * Read a network from untrusted JSON (storage or a shared link): unknown fields are dropped, numbers
 * clamped, dangling links and tool entries removed. Returns `undefined` when it is not a network.
 */
export function sanitizeNetwork(raw: unknown): Network | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || !Array.isArray(r.nodes) || !Array.isArray(r.links)) return undefined;
  const nodes: NetNode[] = [];
  const ids = new Set<string>();
  for (const n of r.nodes.slice(0, 200) as Record<string, unknown>[]) {
    if (!n || !isId(n.id) || ids.has(n.id)) continue;
    const x = clampNum(n.x, -1e5, 1e5, 0);
    const y = clampNum(n.y, -1e5, 1e5, 0);
    const c = (n.config ?? {}) as Record<string, unknown>;
    if (n.kind === "agent") {
      const tools = (Array.isArray(c.tools) ? c.tools : [])
        .slice(0, 20)
        .filter((t: Record<string, unknown>) => t && isId(t.producer) && isTool(t.tool))
        .map((t: Record<string, unknown>) => ({
          producer: t.producer as string,
          tool: t.tool as ToolId,
          weight: clampNum(t.weight, 0.01, 100, 1),
        }));
      nodes.push({
        id: n.id,
        kind: "agent",
        x,
        y,
        config: {
          tools,
          calls: Math.round(clampNum(c.calls, 1, 200, DEFAULT_AGENT.calls)),
          thinkMs: clampNum(c.thinkMs, 0, 60_000, DEFAULT_AGENT.thinkMs),
          overlap: clampNum(c.overlap, 0, 1, DEFAULT_AGENT.overlap),
          zipf: clampNum(c.zipf, 0, 3, DEFAULT_AGENT.zipf),
        },
      });
    } else if (n.kind === "forwarder") {
      nodes.push({
        id: n.id,
        kind: "forwarder",
        x,
        y,
        config: { csKiB: clampNum(c.csKiB, 16, 65_536, 8192) },
      });
    } else if (n.kind === "producer") {
      const name =
        typeof c.name === "string" && /^[a-z0-9.-]{1,63}$/.test(c.name) ? c.name : `${n.id}.idem.dev`;
      const tools = (Array.isArray(c.tools) ? c.tools : [])
        .filter((t: Record<string, unknown>) => t && isTool(t.tool))
        .map((t: Record<string, unknown>) => ({
          tool: t.tool as ToolId,
          ttl: clampNum(t.ttl, 0, 86_400, 60),
        }));
      nodes.push({
        id: n.id,
        kind: "producer",
        x,
        y,
        config: { name, tools, serviceMs: clampNum(c.serviceMs, 1, 60_000, 150) },
      });
    } else continue;
    ids.add(n.id);
  }
  const links: NetLink[] = [];
  const linkIds = new Set<string>();
  for (const l of r.links.slice(0, 400) as Record<string, unknown>[]) {
    if (!l || !isId(l.id) || linkIds.has(l.id) || !isId(l.a) || !isId(l.b)) continue;
    if (!ids.has(l.a) || !ids.has(l.b) || l.a === l.b) continue;
    if (links.some((m) => (m.a === l.a && m.b === l.b) || (m.a === l.b && m.b === l.a))) continue;
    linkIds.add(l.id);
    links.push({
      id: l.id,
      a: l.a,
      b: l.b,
      latencyMs: clampNum(l.latencyMs, 0, 2000, DEFAULT_LINK.latencyMs),
      lossPct: clampNum(l.lossPct, 0, 50, 0),
    });
  }
  // Tool entries must point at producers that exist.
  const producers = new Set(nodes.filter((n) => n.kind === "producer").map((n) => n.id));
  for (const n of nodes)
    if (n.kind === "agent") n.config.tools = n.config.tools.filter((t) => producers.has(t.producer));
  const run = (r.run ?? {}) as Record<string, unknown>;
  const compare = (Array.isArray(run.compare) ? run.compare : DEFAULT_RUN.compare).filter((m: unknown) =>
    ["mcp-direct", "mcp-local-cache", "idem"].includes(m as string),
  ) as RunSettings["compare"];
  return {
    v: 1,
    from: typeof r.from === "string" ? r.from.slice(0, 40) : "blank",
    nodes,
    links,
    run: {
      seed: Math.round(clampNum(run.seed, 0, 1e9, DEFAULT_RUN.seed)),
      speed: clampNum(run.speed, 0.01, 2, DEFAULT_RUN.speed),
      compare: compare.length > 0 ? compare : ["idem"],
      engine: run.engine === "ndn" ? "ndn" : "idem",
    },
  };
}

/** Network → URL-safe text (base64url of its JSON). */
export function encodeNetwork(net: Network): string {
  const bytes = new TextEncoder().encode(JSON.stringify(net));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** URL-safe text → network, validated; `undefined` when unreadable. */
export function decodeNetwork(text: string): Network | undefined {
  try {
    const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return sanitizeNetwork(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return undefined;
  }
}
