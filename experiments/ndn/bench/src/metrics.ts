/**
 * From one run's raw material (calls, counters before/after, role stats) to the rows of
 * `metrics.csv` and `hops.csv`, and from all runs to `summary.csv` and `latency_cdf.csv`.
 * Pure functions; every aggregate of E4 is computed here.
 */
import { percentileSorted, summarize } from "../../../../packages/sim/src/experiments/stats";
import { type E4Mode, MODES, type RunKey } from "./config";
import { faceHost, type IfCounters, type NfdFace } from "./probe";
import type { CallRow } from "./roles/agents";
import { LINKS, type LinkId, linksOf, type NodeId } from "./topology";

export type ForwarderNode = "edge1" | "edge2" | "regional" | "producer";

/** Counters of every namespace at one instant. */
export interface Snapshot {
  /** Interface counters per node, keyed by link (the interface the node has on that link). */
  ifs: Record<NodeId, Partial<Record<LinkId, IfCounters>>>;
  snmp: Record<NodeId, Record<string, number>>;
  faces: Record<ForwarderNode, Map<number, NfdFace>>;
  cs: Record<ForwarderNode, { hits: number; misses: number; entries: number }>;
}

export interface ProducerStats {
  invocations: number;
  distinctArgs: number;
  repeatedInvocations: number;
}

export interface GatewayStats {
  node: string;
  events: Record<string, number>;
  verifyUs: { n: number; p50: number; p95: number; mean: number };
}

export interface RunInput {
  key: RunKey;
  calls: CallRow[];
  before: Snapshot;
  after: Snapshot;
  producer: ProducerStats;
  gateways: GatewayStats[];
  agents: { wallMs: number; cpuUserMs: number; cpuSystemMs: number; maxTimerGapMs: number };
  oracle: { calls: number; distinctNames: number };
}

export const METRIC_COLUMNS = [
  "mode",
  "binding",
  "topology",
  "loss_pct",
  "seed",
  "calls",
  "ok",
  "failed",
  "timeouts",
  "tool_errors",
  "success_ratio",
  "upstream_calls",
  "repeated_upstream",
  "distinct_names",
  "oracle_reduction",
  "upstream_reduction_vs_b0",
  "latency_p50_ms",
  "latency_p95_ms",
  "latency_p99_ms",
  "latency_mean_ms",
  "latency_max_ms",
  "requests_sent",
  "retransmissions",
  "producer_link_bytes",
  "producer_link_packets",
  "producer_link_bytes_reduction_vs_b0",
  "all_links_bytes",
  "access_links_bytes",
  "tcp_retrans_segs",
  "verify_consumer_p50_ms",
  "verify_consumer_mean_ms",
  "verify_forwarder_p50_us",
  "edge_cs_hits",
  "regional_cs_hits",
  "producer_nfd_cs_hits",
  "edge_aggregated",
  "regional_aggregated",
  "max_timer_gap_ms",
  "wall_ms",
  "agents_cpu_ms",
] as const;
export type MetricColumn = (typeof METRIC_COLUMNS)[number];
export type MetricRow = Record<MetricColumn, string | number>;

export const HOP_COLUMNS = [
  "mode",
  "loss_pct",
  "seed",
  "node",
  "interests_in",
  "cs_hits",
  "aggregated",
  "upstream_out",
] as const;
export type HopRow = Record<(typeof HOP_COLUMNS)[number], string | number>;

const RANK: Record<NodeId, number> = { agents: 0, edge1: 1, edge2: 1, regional: 2, producer: 3 };
const NODE_OF_IP = new Map<string, NodeId>(
  Object.values(LINKS).flatMap((l) => [
    [l.down.ip, l.down.node],
    [l.up.ip, l.up.node],
  ]),
);

function sub(a: number | undefined, b: number | undefined): number {
  return (a ?? 0) - (b ?? 0);
}

/** Bytes and packets that arrived over `link` (both directions): the receivers' rx counters. */
export function linkDelta(
  before: Snapshot,
  after: Snapshot,
  link: LinkId,
): { bytes: number; packets: number } {
  const l = LINKS[link];
  let bytes = 0;
  let packets = 0;
  for (const end of [l.down.node, l.up.node]) {
    bytes += sub(after.ifs[end][link]?.rxBytes, before.ifs[end][link]?.rxBytes);
    packets += sub(after.ifs[end][link]?.rxPackets, before.ifs[end][link]?.rxPackets);
  }
  return { bytes, packets };
}

/**
 * Per-hop counters of an NFD from its face counters: Interests from downstream faces, Interests
 * sent upstream (to the next forwarder, or to the producer app's TCP face), and the CS hits. What
 * came in and did not go up was absorbed: a CS hit, a PIT aggregation, or a suppressed
 * retransmission.
 */
export function nfdHop(
  node: ForwarderNode,
  before: Snapshot,
  after: Snapshot,
): { interestsIn: number; upstreamOut: number; csHits: number } {
  let interestsIn = 0;
  let upstreamOut = 0;
  for (const [id, f] of after.faces[node]) {
    const b = before.faces[node].get(id);
    const host = faceHost(f.remote);
    const peer = host === "127.0.0.1" ? "app" : host ? NODE_OF_IP.get(host) : undefined;
    if (!peer) continue;
    const up = peer === "app" ? node === "producer" : RANK[peer] > RANK[node];
    if (up) upstreamOut += sub(f.outI, b?.outI);
    else interestsIn += sub(f.inI, b?.inI);
  }
  return { interestsIn, upstreamOut, csHits: sub(after.cs[node].hits, before.cs[node].hits) };
}

export function hopRows(input: RunInput): HopRow[] {
  const { key } = input;
  const mode = MODES[key.mode];
  const nodes: ForwarderNode[] =
    mode.topology === "star" ? ["edge1", "producer"] : ["edge1", "edge2", "regional", "producer"];
  const base = { mode: key.mode, loss_pct: key.lossPct, seed: key.seed };
  if (mode.binding === "native") {
    return nodes.map((node) => {
      const h = nfdHop(node, input.before, input.after);
      return {
        ...base,
        node: node === "producer" ? "producer-nfd" : node,
        interests_in: h.interestsIn,
        cs_hits: h.csHits,
        aggregated: h.interestsIn - h.upstreamOut - h.csHits,
        upstream_out: h.upstreamOut,
      };
    });
  }
  return input.gateways.map((g) => ({
    ...base,
    node: g.node,
    interests_in: g.events.interest_in ?? 0,
    cs_hits: g.events.cs_hit ?? 0,
    aggregated: g.events.pit_aggregate ?? 0,
    upstream_out: g.events.upstream_out ?? 0,
  }));
}

function median(xs: number[]): number {
  return percentileSorted(
    [...xs].sort((a, b) => a - b),
    50,
  );
}

export function metricRow(input: RunInput): MetricRow {
  const { key, calls, before, after } = input;
  const mode = MODES[key.mode];
  const ok = calls.filter((c) => c.ok);
  const lat = ok.map((c) => c.latencyMs).sort((a, b) => a - b);
  const { used, producerLink } = linksOf(mode.topology);
  const prod = linkDelta(before, after, producerLink);
  const all = used.map((l) => linkDelta(before, after, l).bytes).reduce((a, b) => a + b, 0);
  const access = used
    .filter((l) => l === "a1" || l === "a2")
    .map((l) => linkDelta(before, after, l).bytes)
    .reduce((a, b) => a + b, 0);
  const nodes = Object.keys(after.snmp) as NodeId[];
  const tcpRetrans = nodes
    .map((n) => sub(after.snmp[n]?.["Tcp.RetransSegs"], before.snmp[n]?.["Tcp.RetransSegs"]))
    .reduce((a, b) => a + b, 0);
  const verify = calls.map((c) => c.verifyMs).filter((v): v is number => v !== null);
  const hops = hopRows(input);
  const hop = (n: string) =>
    hops.filter((h) => h.node === n || (n === "edge" && /^edge/.test(String(h.node))));
  const sumOf = (rows: HopRow[], k: "cs_hits" | "aggregated") => rows.reduce((a, r) => a + Number(r[k]), 0);
  const requests = calls.reduce((a, c) => a + c.attempts, 0);
  const fwdVerify = input.gateways.map((g) => g.verifyUs.p50).filter((v) => Number.isFinite(v));
  return {
    mode: key.mode,
    binding: mode.binding,
    topology: mode.topology,
    loss_pct: key.lossPct,
    seed: key.seed,
    calls: calls.length,
    ok: ok.length,
    failed: calls.length - ok.length,
    timeouts: calls.filter((c) => c.code === "TIMEOUT").length,
    tool_errors: calls.filter((c) => c.code === "TOOL_ERROR").length,
    success_ratio: calls.length ? ok.length / calls.length : Number.NaN,
    upstream_calls: input.producer.invocations,
    repeated_upstream: input.producer.repeatedInvocations,
    distinct_names: input.oracle.distinctNames,
    oracle_reduction: 1 - input.oracle.distinctNames / input.oracle.calls,
    upstream_reduction_vs_b0: Number.NaN,
    latency_p50_ms: percentileSorted(lat, 50),
    latency_p95_ms: percentileSorted(lat, 95),
    latency_p99_ms: percentileSorted(lat, 99),
    latency_mean_ms: lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : Number.NaN,
    latency_max_ms: lat.length ? (lat[lat.length - 1] as number) : Number.NaN,
    requests_sent: requests,
    retransmissions: requests - calls.filter((c) => c.attempts > 0).length,
    producer_link_bytes: prod.bytes,
    producer_link_packets: prod.packets,
    producer_link_bytes_reduction_vs_b0: Number.NaN,
    all_links_bytes: all,
    access_links_bytes: access,
    tcp_retrans_segs: tcpRetrans,
    verify_consumer_p50_ms: median(verify),
    verify_consumer_mean_ms: verify.length ? verify.reduce((a, b) => a + b, 0) / verify.length : Number.NaN,
    verify_forwarder_p50_us: fwdVerify.length ? median(fwdVerify) : Number.NaN,
    edge_cs_hits: sumOf(hop("edge"), "cs_hits"),
    regional_cs_hits: sumOf(hop("regional"), "cs_hits"),
    producer_nfd_cs_hits: sumOf(hop("producer-nfd"), "cs_hits"),
    edge_aggregated: sumOf(hop("edge"), "aggregated"),
    regional_aggregated: sumOf(hop("regional"), "aggregated"),
    max_timer_gap_ms: input.agents.maxTimerGapMs,
    wall_ms: input.agents.wallMs,
    agents_cpu_ms: input.agents.cpuUserMs + input.agents.cpuSystemMs,
  };
}

/** Fill the columns paired by (seed, loss) against B0 of the same cell. */
export function pairWithB0(rows: MetricRow[]): void {
  const b0 = new Map(rows.filter((r) => r.mode === "B0").map((r) => [`${r.seed}|${r.loss_pct}`, r]));
  for (const r of rows) {
    const base = b0.get(`${r.seed}|${r.loss_pct}`);
    if (!base) continue;
    r.upstream_reduction_vs_b0 = 1 - Number(r.upstream_calls) / Number(base.upstream_calls);
    r.producer_link_bytes_reduction_vs_b0 =
      1 - Number(r.producer_link_bytes) / Number(base.producer_link_bytes);
  }
}

export const SUMMARY_COLUMNS = [
  "mode",
  "loss_pct",
  "metric",
  "n",
  "mean",
  "sd",
  "ci95",
  "min",
  "max",
] as const;

/** Numeric metrics summarized over seeds per (mode, loss). */
export const SUMMARIZED: MetricColumn[] = METRIC_COLUMNS.filter(
  (c) => !["mode", "binding", "topology", "loss_pct", "seed"].includes(c),
);

export function summaryRows(rows: MetricRow[]): Record<(typeof SUMMARY_COLUMNS)[number], string | number>[] {
  const cells = new Map<string, MetricRow[]>();
  for (const r of rows) {
    const k = `${r.mode}|${r.loss_pct}`;
    cells.set(k, [...(cells.get(k) ?? []), r]);
  }
  const out: Record<(typeof SUMMARY_COLUMNS)[number], string | number>[] = [];
  for (const [k, list] of cells) {
    const [mode, loss] = k.split("|") as [E4Mode, string];
    for (const metric of SUMMARIZED) {
      const s = summarize(list.map((r) => Number(r[metric])));
      out.push({ mode, loss_pct: Number(loss), metric, ...s });
    }
  }
  return out;
}

export const CDF_COLUMNS = ["mode", "loss_pct", "percentile", "latency_ms"] as const;

/** Percentiles 0..100 of every successful call's latency, pooled over seeds, per (mode, loss). */
export function cdfRows(
  calls: { mode: E4Mode; loss_pct: number; ok: boolean; latencyMs: number }[],
): Record<(typeof CDF_COLUMNS)[number], string | number>[] {
  const cells = new Map<string, number[]>();
  for (const c of calls) {
    if (!c.ok) continue;
    const k = `${c.mode}|${c.loss_pct}`;
    const list = cells.get(k) ?? [];
    list.push(c.latencyMs);
    cells.set(k, list);
  }
  const out: Record<(typeof CDF_COLUMNS)[number], string | number>[] = [];
  for (const [k, list] of cells) {
    const [mode, loss] = k.split("|") as [E4Mode, string];
    const sorted = list.sort((a, b) => a - b);
    for (let p = 0; p <= 100; p++) {
      out.push({ mode, loss_pct: Number(loss), percentile: p, latency_ms: percentileSorted(sorted, p) });
    }
  }
  return out;
}
