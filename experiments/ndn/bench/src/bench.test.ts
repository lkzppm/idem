// Pure parts of the E4 harness: run plan, workload determinism, counter parsers, per-run metrics.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, runLabel, runPlan } from "./config";
import { hopRows, linkDelta, metricRow, nfdHop, pairWithB0, type RunInput, type Snapshot } from "./metrics";
import { faceHost, parseCsInfo, parseFaces, parseIpAddr, parseNetDev, parseSnmp } from "./probe";
import { edgeOf, interfaces, linksOf } from "./topology";
import { oracle, pageBytes, planCalls } from "./workload";

const CFG = loadConfig(join(import.meta.dirname, "..", "configs", "e4.json"));

describe("run plan and workload", () => {
  it("runs every mode of a (seed, loss) cell back to back", () => {
    const plan = runPlan(CFG);
    expect(plan).toHaveLength(CFG.seeds.count * CFG.lossPct.length * CFG.modes.length);
    expect(plan.slice(0, CFG.modes.length).map((k) => k.mode)).toEqual(CFG.modes);
    expect(runLabel(plan[0] as (typeof plan)[0])).toBe("B0-loss0-seed1");
  });

  it("plans the same calls and think times for a seed, and different ones for another", () => {
    const a = planCalls(CFG, 1);
    expect(planCalls(CFG, 1)).toEqual(a);
    expect(planCalls(CFG, 2)).not.toEqual(a);
    expect(a).toHaveLength(CFG.workload.agents);
    expect(a.every((p) => p.length === CFG.workload.callsPerAgent)).toBe(true);
    expect(a.flat().every((c) => c.tool === "fetch_page" && c.thinkMs >= 0)).toBe(true);
  });

  it("keeps every page inside one NDN packet's budget", () => {
    for (let i = 0; i < 500; i++) {
      const b = pageBytes(CFG, 1, i);
      expect(b).toBeGreaterThanOrEqual(CFG.producer.pageBytesMin);
      expect(b).toBeLessThanOrEqual(CFG.producer.pageBytesMax);
    }
  });

  it("counts distinct names after canonicalization (the oracle)", async () => {
    const o = await oracle(CFG, 1);
    expect(o.calls).toBe(CFG.workload.agents * CFG.workload.callsPerAgent);
    expect(o.distinctNames).toBeGreaterThan(0);
    expect(o.distinctNames).toBeLessThan(o.calls);
  });

  it("attaches agents like buildTopology: all to edge1 in the star, i % 2 in the tree", () => {
    expect([0, 1, 2, 3].map((i) => edgeOf("star", i).node)).toEqual(["edge1", "edge1", "edge1", "edge1"]);
    expect([0, 1, 2, 3].map((i) => edgeOf("tree", i).node)).toEqual(["edge1", "edge2", "edge1", "edge2"]);
    expect(linksOf("tree").producerLink).toBe("rp");
    expect(interfaces()).toHaveLength(12);
  });
});

describe("counter parsers", () => {
  it("reads /proc/net/dev, /proc/net/snmp and ip addr", () => {
    const dev = parseNetDev(
      "Inter-|   Receive |  Transmit\n face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed\n" +
        "  eth1: 1000 10 0 2 0 0 0 0 2000 20 0 0 0 0 0 0\n",
    );
    expect(dev.get("eth1")).toEqual({
      rxBytes: 1000,
      rxPackets: 10,
      rxDrop: 2,
      txBytes: 2000,
      txPackets: 20,
    });
    const snmp = parseSnmp("Tcp: RtoAlgorithm RetransSegs\nTcp: 1 7\nUdp: InDatagrams\nUdp: 42\n");
    expect(snmp["Tcp.RetransSegs"]).toBe(7);
    expect(snmp["Udp.InDatagrams"]).toBe(42);
    const ips = parseIpAddr("12: eth1    inet 10.231.3.10/24 brd 10.231.3.255 scope global eth1\\ ...");
    expect(ips.get("10.231.3.10")).toBe("eth1");
  });

  it("reads nfdc face list and cs info", () => {
    const faces = parseFaces(
      "faceid=262 remote=udp4://10.231.3.10:6363 local=udp4://10.231.3.20:6363 expires=598s mtu=8800 counters={in={13i 0d 1n 684B} out={0i 13d 0n 7225B}} flags={non-local}",
    );
    expect(faces.get(262)).toMatchObject({ remote: "udp4://10.231.3.10:6363", inI: 13, inN: 1, outD: 13 });
    expect(parseCsInfo("  nEntries=108\n     nHits=1\n   nMisses=699")).toEqual({
      entries: 108,
      hits: 1,
      misses: 699,
    });
    expect(faceHost("tcp4://127.0.0.1:45370")).toBe("127.0.0.1");
    expect(faceHost("internal://")).toBeUndefined();
  });
});

function emptySnapshot(): Snapshot {
  const fw = { edge1: new Map(), edge2: new Map(), regional: new Map(), producer: new Map() };
  const cs = { hits: 0, misses: 0, entries: 0 };
  return {
    ifs: { agents: {}, edge1: {}, edge2: {}, regional: {}, producer: {} },
    snmp: { agents: {}, edge1: {}, edge2: {}, regional: {}, producer: {} },
    faces: fw,
    cs: { edge1: cs, edge2: cs, regional: cs, producer: cs },
  };
}

const IF = (rxBytes: number) => ({ rxBytes, rxPackets: 1, txBytes: 0, txPackets: 0, rxDrop: 0 });
const FACE = (id: number, remote: string, inI: number, outI: number) => ({
  id,
  remote,
  inI,
  inD: 0,
  inN: 0,
  outI,
  outD: 0,
  outN: 0,
});

describe("per-run metrics", () => {
  it("counts a link's bytes as what both ends received", () => {
    const b = emptySnapshot();
    const a = emptySnapshot();
    b.ifs.edge1.e1p = IF(100);
    b.ifs.producer.e1p = IF(1000);
    a.ifs.edge1.e1p = IF(600);
    a.ifs.producer.e1p = IF(1300);
    expect(linkDelta(b, a, "e1p").bytes).toBe(800);
  });

  it("splits an NFD's faces into downstream and upstream", () => {
    const b = emptySnapshot();
    const a = emptySnapshot();
    a.faces.edge1.set(300, FACE(300, "udp4://10.231.1.20:41000", 10, 0)); // an agent, new this run
    b.faces.edge1.set(270, FACE(270, "udp4://10.231.3.20:6363", 0, 5));
    a.faces.edge1.set(270, FACE(270, "udp4://10.231.3.20:6363", 0, 9)); // the producer
    a.cs.edge1 = { hits: 3, misses: 0, entries: 0 };
    expect(nfdHop("edge1", b, a)).toEqual({ interestsIn: 10, upstreamOut: 4, csHits: 3 });
    a.faces.producer.set(301, FACE(301, "tcp4://127.0.0.1:45370", 0, 4)); // the producer app
    a.faces.producer.set(302, FACE(302, "udp4://10.231.3.10:6363", 4, 0));
    expect(nfdHop("producer", b, a)).toMatchObject({ interestsIn: 4, upstreamOut: 4 });
  });

  it("computes latency, retransmissions and the reductions paired with B0", () => {
    const call = (latencyMs: number, attempts: number, ok = true) => ({
      agent: 0,
      k: 0,
      edge: "edge1",
      startMs: 0,
      latencyMs,
      ok,
      code: ok ? "" : "TIMEOUT",
      attempts,
      verifyMs: 0.5,
      servedBy: "",
      resultBytes: 10,
    });
    const input = (mode: "B0" | "N2", upstream: number): RunInput => ({
      key: { mode, lossPct: 1, seed: 1 },
      calls: [call(100, 1), call(300, 3), call(5000, 5, false)],
      before: emptySnapshot(),
      after: emptySnapshot(),
      producer: { invocations: upstream, distinctArgs: upstream, repeatedInvocations: 0 },
      gateways: [],
      agents: { wallMs: 1, cpuUserMs: 1, cpuSystemMs: 1, maxTimerGapMs: 0 },
      oracle: { calls: 3, distinctNames: 2 },
    });
    const n2 = metricRow(input("N2", 1));
    expect(n2).toMatchObject({ ok: 2, failed: 1, timeouts: 1, requests_sent: 9, retransmissions: 6 });
    expect(n2.latency_p50_ms).toBe(100);
    expect(hopRows(input("N2", 1)).map((h) => h.node)).toEqual(["edge1", "producer-nfd"]);
    const rows = [metricRow(input("B0", 4)), n2];
    pairWithB0(rows);
    expect(rows[1]?.upstream_reduction_vs_b0).toBe(0.75);
    expect(rows[0]?.upstream_reduction_vs_b0).toBe(0);
  });
});
