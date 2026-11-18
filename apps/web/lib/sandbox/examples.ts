/**
 * The networks the editor can start from. Every example is a plain {@link Network}, built here in
 * code (positions in world units, the stage centered on 0, 0) so tests can check them. The "Live"
 * example is not a network: it is the deployed edge and producer over real HTTP, handled by its own
 * runner (`components/sandbox/live-mode.tsx`).
 */
import {
  type AgentTool,
  DEFAULT_AGENT,
  DEFAULT_FORWARDER,
  DEFAULT_LINK,
  DEFAULT_RUN,
  defaultProducer,
  type NetLink,
  type NetNode,
  type Network,
  type ToolId,
} from "./network";

export type ExampleId = "blank" | "swarm" | "two-producers" | "regional" | "live";

/** Example ids in the picker's order. */
export const EXAMPLE_IDS: ExampleId[] = ["swarm", "two-producers", "regional", "live", "blank"];

function agent(id: string, x: number, y: number, tools: AgentTool[], calls = DEFAULT_AGENT.calls): NetNode {
  return { id, kind: "agent", x, y, config: { ...DEFAULT_AGENT, calls, tools } };
}
function forwarder(id: string, x: number, y: number): NetNode {
  return { id, kind: "forwarder", x, y, config: { ...DEFAULT_FORWARDER } };
}
function producer(id: string, x: number, y: number, name: string, tools?: ToolId[]): NetNode {
  const p = defaultProducer(name);
  return {
    id,
    kind: "producer",
    x,
    y,
    config: tools ? { ...p, tools: p.tools.filter((t) => tools.includes(t.tool)) } : p,
  };
}
function link(id: string, a: string, b: string, latencyMs = DEFAULT_LINK.latencyMs): NetLink {
  return { id, a, b, latencyMs, lossPct: 0 };
}

/** Agents fanned on an arc left of `cx`, all linked to `to`. */
function fan(
  prefix: string,
  n: number,
  cx: number,
  cy: number,
  to: string,
  tools: (i: number) => AgentTool[],
  start = 0,
): { nodes: NetNode[]; links: NetLink[] } {
  const nodes: NetNode[] = [];
  const links: NetLink[] = [];
  const span = Math.min(420, 60 + n * 46);
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0.5 : i / (n - 1);
    const id = `${prefix}-${start + i}`;
    nodes.push(agent(id, cx - 40 * Math.sin(Math.PI * f), cy + (f - 0.5) * span, tools(i)));
    links.push(link(`link-${id}`, id, to));
  }
  return { nodes, links };
}

/** Build an example network (a fresh copy every time). `undefined` for "live", which is not one. */
export function example(id: ExampleId): Network | undefined {
  switch (id) {
    case "blank":
      return { v: 1, from: "blank", nodes: [], links: [], run: { ...DEFAULT_RUN } };
    case "swarm": {
      // Today's swarm: 8 agents on one edge, one producer; most calls fetch pages from a shared catalog.
      const tools: AgentTool[] = [
        { producer: "producer", tool: "fetch_page", weight: 90 },
        { producer: "producer", tool: "my_notes", weight: 5 },
        { producer: "producer", tool: "send_email", weight: 5 },
      ];
      const f = fan("agent", 8, -260, 0, "edge", () => tools.map((t) => ({ ...t })));
      return {
        v: 1,
        from: "swarm",
        nodes: [...f.nodes, forwarder("edge", 0, 0), producer("producer", 280, 0, "demo.idem.dev")],
        links: [...f.links, link("link-edge-producer", "edge", "producer", 40)],
        run: { ...DEFAULT_RUN },
      };
    }
    case "two-producers": {
      // Two producers with different tools; each agent has its own list, some ask both.
      const docs = (i: number): AgentTool[] =>
        i % 3 === 2
          ? [
              { producer: "docs", tool: "search_corpus", weight: 1 },
              { producer: "weather", tool: "weather", weight: 1 },
            ]
          : i % 3 === 0
            ? [
                { producer: "docs", tool: "fetch_page", weight: 2 },
                { producer: "docs", tool: "search_corpus", weight: 1 },
              ]
            : [{ producer: "weather", tool: "weather", weight: 1 }];
      const f = fan("agent", 6, -260, 0, "edge", docs);
      return {
        v: 1,
        from: "two-producers",
        nodes: [
          ...f.nodes,
          forwarder("edge", 0, 0),
          producer("docs", 280, -110, "docs.idem.dev", ["fetch_page", "search_corpus"]),
          producer("weather", 280, 110, "weather.idem.dev", ["weather"]),
        ],
        links: [
          ...f.links,
          link("link-edge-docs", "edge", "docs", 40),
          link("link-edge-weather", "edge", "weather", 60),
        ],
        run: { ...DEFAULT_RUN },
      };
    }
    case "regional": {
      // Three edges under one regional forwarder: the regional cache serves what another edge fetched.
      const tools = (): AgentTool[] => [
        { producer: "producer", tool: "search_corpus", weight: 3 },
        { producer: "producer", tool: "fetch_page", weight: 1 },
      ];
      const edges = ["edge-0", "edge-1", "edge-2"];
      const nodes: NetNode[] = [];
      const links: NetLink[] = [];
      edges.forEach((e, k) => {
        const y = (k - 1) * 190;
        nodes.push(forwarder(e, -120, y));
        const f = fan("agent", 3, -360, y, e, tools, 3 * k);
        nodes.push(...f.nodes);
        links.push(...f.links, link(`link-${e}-regional`, e, "regional", 10));
      });
      return {
        v: 1,
        from: "regional",
        nodes: [...nodes, forwarder("regional", 110, 0), producer("producer", 330, 0, "demo.idem.dev")],
        links: [...links, link("link-regional-producer", "regional", "producer", 40)],
        run: { ...DEFAULT_RUN },
      };
    }
    case "live":
      return undefined;
  }
}
