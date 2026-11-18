import { describe, expect, it } from "vitest";
import { InstanceList } from "../render/shapes";
import { PALETTES } from "../theme-colors";
import { innerFrame, layoutTopology, TopologyScene } from "./scene";

const star = (n: number) => ({
  nodes: [
    ...Array.from({ length: n }, (_, i) => ({ id: `agent-${i}`, kind: "agent" as const })),
    { id: "edge", kind: "forwarder" as const },
    { id: "producer", kind: "producer" as const },
  ],
  links: [
    ...Array.from({ length: n }, (_, i) => ({ a: `agent-${i}`, b: "edge" })),
    { a: "edge", b: "producer" },
  ],
});

const frame = { x: 0, y: 0, w: 800, h: 500 };
const opts = { reduced: false, dense: false };

describe("layoutTopology", () => {
  it("puts agents left, the producer right and keeps everything in [0, 1]", () => {
    const nodes = layoutTopology(star(12));
    for (const n of nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(1);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(1);
    }
    const producer = nodes.find((n) => n.id === "producer");
    const edge = nodes.find((n) => n.id === "edge");
    expect(producer?.x).toBe(1);
    expect(edge?.x).toBeGreaterThan(0);
    expect(edge?.x).toBeLessThan(1);
    expect(Math.max(...nodes.filter((n) => n.kind === "agent").map((n) => n.x))).toBeLessThan(0.1);
  });
});

describe("TopologyScene", () => {
  it("finds the node under the pointer inside its frame", () => {
    const s = new TopologyScene();
    s.setTopology(star(4), 0);
    const p = s.screen(frame, "producer");
    expect(p).toBeDefined();
    const [x, y] = p as [number, number];
    expect(s.nodeAt(frame, x + 3, y - 2)).toBe("producer");
    expect(s.nodeAt(frame, x - 300, 2)).toBeUndefined();
    const inner = innerFrame(frame);
    expect(x).toBeCloseTo(inner.x + inner.w);
  });

  it("draws, drops packets that arrived, and keeps those in flight", () => {
    const s = new TopologyScene();
    s.setTopology(star(3), 0);
    s.addPacket({ from: "agent-0", to: "edge", kind: "interest", t0: 0, t1: 100 });
    s.addPacket({ from: "edge", to: "producer", kind: "interest", t0: 100, t1: 200, label: "n" });
    s.addPacket({ from: "producer", to: "edge", kind: "data", t0: 200, t1: 300, lost: true });
    s.setState("edge", { pit: 1, cs: 2, fresh: 0.5 });
    s.flash("edge", "cs", 0);
    const list = new InstanceList();
    s.build(list, frame, PALETTES.dark, 150, 1000, opts);
    expect(list.count).toBeGreaterThan(10);
    expect(s.inFlight(150)).toBe(2);
    expect(s.packets).toHaveLength(2);
    list.clear();
    s.build(list, frame, PALETTES.light, 400, 1100, { reduced: true, dense: true });
    expect(s.packets).toHaveLength(0);
  });

  it("keeps nodes that survive a topology change and drops stale selection", () => {
    const s = new TopologyScene();
    s.setTopology(star(5), 0);
    s.selected = "agent-4";
    s.hover = "agent-4";
    s.setTopology(star(2), 1000);
    expect(s.nodes.size).toBe(4);
    expect(s.selected).toBeUndefined();
    expect(s.hover).toBeUndefined();
  });
});
