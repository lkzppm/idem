import { describe, expect, it } from "vitest";
import { EXAMPLE_IDS, example } from "./examples";
import {
  addLink,
  addNode,
  decodeNetwork,
  encodeNetwork,
  issues,
  linkProblem,
  moveNode,
  type Network,
  reachableProducers,
  removeNode,
  sanitizeNetwork,
} from "./network";
import { TopologyScene } from "./scene";

const blank = (): Network => example("blank") as Network;

describe("editing", () => {
  it("adds nodes with fresh ids and a unique producer name", () => {
    let net = blank();
    let p1: string;
    let p2: string;
    [net, p1] = addNode(net, "producer", 0, 0);
    [net, p2] = addNode(net, "producer", 10, 0);
    expect([p1, p2]).toEqual(["producer-0", "producer-1"]);
    const names = net.nodes.map((n) => (n.kind === "producer" ? n.config.name : ""));
    expect(new Set(names).size).toBe(2);
  });

  it("only links agents to forwarders, never straight to producers or each other", () => {
    let net = blank();
    let a: string;
    let b: string;
    let f: string;
    let p: string;
    [net, a] = addNode(net, "agent", 0, 0);
    [net, b] = addNode(net, "agent", 0, 50);
    [net, f] = addNode(net, "forwarder", 100, 0);
    [net, p] = addNode(net, "producer", 200, 0);
    expect(linkProblem(net, a, p)).toBe("agent-producer");
    expect(linkProblem(net, a, b)).toBe("agent-agent");
    expect(linkProblem(net, a, a)).toBe("same");
    expect(linkProblem(net, a, f)).toBeUndefined();
    [net] = addLink(net, a, f);
    expect(linkProblem(net, f, a)).toBe("exists");
  });

  it("removing a producer removes its links and the tool entries that used it", () => {
    let net = example("two-producers") as Network;
    net = removeNode(net, "weather");
    expect(net.links.some((l) => l.a === "weather" || l.b === "weather")).toBe(false);
    for (const n of net.nodes)
      if (n.kind === "agent") expect(n.config.tools.every((t) => t.producer !== "weather")).toBe(true);
  });

  it("moving a node keeps everything else", () => {
    const net = example("swarm") as Network;
    const moved = moveNode(net, "edge", 5, 6);
    expect(moved.nodes.find((n) => n.id === "edge")).toMatchObject({ x: 5, y: 6 });
    expect(moved.links).toEqual(net.links);
  });
});

describe("reachability and issues", () => {
  it("reaches producers through forwarders only", () => {
    const net = example("regional") as Network;
    expect(reachableProducers(net, "agent-0")).toEqual(["producer"]);
  });

  it("every example (but blank) is ready to run", () => {
    for (const id of EXAMPLE_IDS) {
      const net = example(id);
      if (!net || id === "blank") continue;
      expect(issues(net), id).toEqual([]);
    }
  });

  it("names what stops a network from running", () => {
    let net = blank();
    expect(issues(net).map((i) => i.kind)).toEqual(["no-agents", "no-producers"]);
    let a: string;
    [net, a] = addNode(net, "agent", 0, 0);
    [net] = addNode(net, "producer", 100, 0);
    expect(issues(net)).toEqual([{ kind: "agent-no-tools", node: a }]);
  });
});

describe("saving and sharing", () => {
  it("round-trips every example through the URL form", () => {
    for (const id of EXAMPLE_IDS) {
      const net = example(id);
      if (!net) continue;
      expect(decodeNetwork(encodeNetwork(net)), id).toEqual(net);
    }
  });

  it("repairs what it reads: dangling links, unknown tools, out-of-range numbers", () => {
    const raw = {
      v: 1,
      from: "x",
      nodes: [
        {
          id: "a",
          kind: "agent",
          x: 0,
          y: 0,
          config: { tools: [{ producer: "p", tool: "rm_rf", weight: 1 }], calls: 1e9 },
        },
        {
          id: "p",
          kind: "producer",
          x: 1,
          y: 1,
          config: { name: "BAD NAME", tools: [{ tool: "weather", ttl: -5 }] },
        },
        { id: "bad id!", kind: "agent", x: 0, y: 0 },
      ],
      links: [
        { id: "l1", a: "a", b: "ghost" },
        { id: "l2", a: "a", b: "p", latencyMs: 1e9 },
      ],
      run: { engine: "other", compare: ["nope"] },
    };
    const net = sanitizeNetwork(raw) as Network;
    expect(net.nodes.map((n) => n.id)).toEqual(["a", "p"]);
    const a = net.nodes[0];
    expect(a?.kind === "agent" && a.config.tools).toEqual([]);
    expect(a?.kind === "agent" && a.config.calls).toBe(200);
    const p = net.nodes[1];
    expect(p?.kind === "producer" && p.config.name).toBe("p.idem.dev");
    expect(p?.kind === "producer" && p.config.tools[0]?.ttl).toBe(0);
    expect(net.links.map((l) => l.id)).toEqual(["l2"]);
    expect(net.links[0]?.latencyMs).toBe(2000);
    expect(net.run.engine).toBe("idem");
    expect(net.run.compare).toEqual(["idem"]);
  });

  it("rejects what is not a network", () => {
    expect(decodeNetwork("not base64 json")).toBeUndefined();
    expect(sanitizeNetwork({ v: 2, nodes: [], links: [] })).toBeUndefined();
  });
});

describe("scene camera", () => {
  const frame = { x: 0, y: 0, w: 800, h: 600 };

  it("keeps given positions and maps world ↔ screen through the camera", () => {
    const scene = new TopologyScene();
    scene.camera = { x: 0, y: 0, zoom: 2 };
    const net = example("swarm") as Network;
    scene.setTopology(net);
    expect(scene.nodes.get("edge")).toMatchObject({ x: 0, y: 0 });
    expect(scene.screen(frame, "edge")).toEqual([400, 300]);
    expect(scene.toWorld(frame, 500, 300)).toEqual([50, 0]);
    scene.move("edge", 50, 0);
    expect(scene.nodeAt(frame, 500, 300)).toBe("edge");
  });

  it("fits every node inside the pane", () => {
    const scene = new TopologyScene();
    scene.camera = { x: 0, y: 0, zoom: 1 };
    scene.setTopology(example("regional") as Network);
    scene.fit(frame);
    for (const id of scene.nodes.keys()) {
      const [x, y] = scene.screen(frame, id) as [number, number];
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(frame.w);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(frame.h);
    }
  });

  it("finds the link under the pointer", () => {
    const scene = new TopologyScene();
    scene.camera = { x: 0, y: 0, zoom: 1 };
    const net = example("swarm") as Network;
    scene.setTopology(net);
    const i = scene.linkAt(frame, 400 + 140, 300 + 2);
    expect(i !== undefined && scene.links[i]).toEqual(["edge", "producer"]);
  });

  it("keeps packets on links that survive an edit", () => {
    const scene = new TopologyScene();
    scene.camera = { x: 0, y: 0, zoom: 1 };
    scene.setTopology(example("swarm") as Network);
    scene.addPacket({ from: "edge", to: "producer", kind: "interest", t0: 0, t1: 10 });
    scene.addPacket({ from: "agent-0", to: "edge", kind: "interest", t0: 0, t1: 10 });
    const net = removeNode(example("swarm") as Network, "agent-0");
    scene.setTopology(net, performance.now(), true);
    expect(scene.packets.map((p) => p.from)).toEqual(["edge"]);
  });
});
