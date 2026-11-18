import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { example } from "./examples";
import { instantiate, type NdnCall, type NdnNetEvents, NdnNetwork } from "./ndn-net";
import type { Network } from "./network";

const DIR = join(import.meta.dirname, "../../public/ndn");
let mod: Promise<WebAssembly.Module>;

beforeAll(async () => {
  // Go's loader defines globalThis.Go; it is a script, so evaluate it in this realm.
  new Function(readFileSync(join(DIR, "wasm_exec.js"), "utf8"))();
  mod = WebAssembly.compile(readFileSync(join(DIR, "yanfd.wasm")));
  await mod;
});

/** A small, quick network: `agents` agents on one edge, one producer, a few fetch_page calls each. */
function small(from: "swarm" | "regional", agents: number, calls: number): Network {
  const net = example(from) as Network;
  const keep = new Set(
    net.nodes
      .filter((n) => n.kind === "agent")
      .slice(0, agents)
      .map((n) => n.id),
  );
  const nodes = net.nodes
    .filter((n) => n.kind !== "agent" || keep.has(n.id))
    .map((n) =>
      n.kind === "agent"
        ? {
            ...n,
            config: {
              ...n.config,
              calls,
              thinkMs: 20,
              overlap: 1,
              zipf: 2,
              tools: [{ producer: "producer", tool: "fetch_page" as const, weight: 1 }],
            },
          }
        : n,
    );
  const ids = new Set(nodes.map((n) => n.id));
  return {
    ...net,
    nodes,
    links: net.links.filter((l) => ids.has(l.a) && ids.has(l.b)).map((l) => ({ ...l, latencyMs: 2 })),
  };
}

async function run(net: Network, timeoutMs = 20_000) {
  const calls: NdnCall[] = [];
  const flashes: string[] = [];
  const events: NdnNetEvents = {
    packet: () => {},
    flash: (node, kind) => flashes.push(`${node}:${kind}`),
    call: (c) => calls.push(c),
  };
  const n = await NdnNetwork.create(net, () => instantiate(mod), events);
  n.start();
  const t0 = Date.now();
  while (n.stats().done < n.stats().calls && Date.now() - t0 < timeoutMs)
    await new Promise((r) => setTimeout(r, 50));
  n.stop();
  return { stats: n.stats(), calls, flashes };
}

describe("NDN engine: the editor's network on YaNFD routers", () => {
  it("answers every call with verified Data, and the edge's Content Store and PIT spare the producer", async () => {
    const { stats, calls } = await run(small("swarm", 4, 5));
    expect(stats.done).toBe(20);
    expect(calls.filter((c) => !c.ok).map((c) => c.error)).toEqual([]);
    // Zipf 2 over a shared catalog: most calls repeat a name, so few reach the producer.
    expect(stats.upstream).toBeLessThan(stats.done);
    expect(stats.csHits + stats.aggregated).toBeGreaterThan(0);
  }, 30_000);

  it("routes through a regional forwarder to the producer", async () => {
    const net = small("regional", 9, 2);
    const { stats } = await run(net);
    expect(stats.ok).toBe(stats.calls);
    expect(stats.forwarders.regional).toBeDefined();
  }, 30_000);

  it("keeps private and side-effect calls off NDN", async () => {
    const net = small("swarm", 1, 3);
    const a = net.nodes.find((n) => n.kind === "agent");
    if (a?.kind !== "agent") throw new Error("no agent");
    a.config.tools = [{ producer: "producer", tool: "my_notes", weight: 1 }];
    const { stats, calls } = await run(net);
    expect(stats.bypass).toBe(3);
    // Only the manifest and the tool list travel (the consumer fetches them before refusing).
    expect(stats.upstream).toBeLessThanOrEqual(2);
    expect(calls.every((c) => c.bypass && c.name === "")).toBe(true);
  }, 30_000);
});
