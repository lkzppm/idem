import type { ForwarderEvent, ForwarderEventKind } from "@idem/core";
import { percentile } from "./rng";
import type { CallRecord, Transmission } from "./simulation";

/** Metrics of a run (05-evaluation §3). Forwarder metrics come only from the event stream. */
export interface Metrics {
  calls: number;
  completed: number;
  failed: number;
  /** Failed calls whose producer the agent could not reach (no path; `CallRecord.error`). */
  noRoute: number;
  /** `tools/call` requests (Interests + passthrough calls) that reached a producer node. */
  upstreamCalls: number;
  csHits: number;
  pitAggregations: number;
  /** Interests received by edge forwarders (first hop of agents). */
  edgeInterests: number;
  csHitRatio: number;
  pitAggregationRatio: number;
  localCacheHits: number;
  latencyMs: { p50: number; p95: number; p99: number; mean: number };
  producerLinkBytes: number;
  verifyFailures: number;
  /** Data handed to an agent with `ageMs ≥ min(freshnessMs, ttlMs)` [P-8.1, P-8.2]. Must be 0. */
  staleServes: number;
  safetyViolations: number;
  retries: number;
  durationMs: number;
  /** CS hits at forwarders beyond the edge (the regional node of a tree). */
  coreCsHits: number;
  /** Passthrough events at the edges (non-cacheable calls and PIT overflow). */
  bypasses: number;
  /** Entries evicted from any Content Store. */
  csEvictions: number;
  /**
   * Data handed to an agent when `now − producedAt ≥ min(freshnessMs, ttlMs)` on the simulation's
   * single clock. Informative: [P-8.1] counts age from each hop's receipt, so the time a Data
   * spends in transit and waiting in a PIT is not part of `ageMs`.
   */
  lateServes: number;
  /** Largest `now − producedAt − min(freshnessMs, ttlMs)` among late serves, in ms (0 if none). */
  maxLateMs: number;
  /** B5 only: calls answered from an edge's gateway cache (`mcp-gateway-cache`, ADR-036). */
  gatewayCacheHits: number;
  /**
   * B5 only: cacheable calls that missed the gateway cache while an identical call was already
   * upstream, so they went upstream too (no coalescing). What a PIT would have aggregated.
   */
  gatewayInflightDuplicates: number;
}

const KINDS: ForwarderEventKind[] = [
  "interest_in",
  "cs_hit",
  "pit_aggregate",
  "upstream_out",
  "data_in",
  "verify_ok",
  "verify_fail",
  "cs_insert",
  "cs_evict",
  "pit_satisfy",
  "pit_expire",
  "drop",
  "bypass",
];

/** Accumulates metrics incrementally (so the sandbox can read them live). */
export class MetricsCollector {
  readonly counts = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<ForwarderEventKind, number>;
  readonly #producerLinks: Set<string>;
  readonly #edges: Set<string>;
  readonly #producers: Set<string>;
  readonly latencies: number[] = [];
  calls = 0;
  completed = 0;
  failed = 0;
  noRoute = 0;
  upstreamCalls = 0;
  producerLinkBytes = 0;
  edgeInterests = 0;
  edgeCsHits = 0;
  edgePitAggregations = 0;
  edgeBypasses = 0;
  coreCsHits = 0;
  lateServes = 0;
  maxLateMs = 0;
  localCacheHits = 0;
  gatewayCacheHits = 0;
  gatewayInflightDuplicates = 0;
  staleServes = 0;
  retries = 0;
  consumerVerifyFailures = 0;
  readonly violations: string[] = [];

  /**
   * `producerLinks`: ids of the links that touch a producer node (byte accounting). `edges`:
   * forwarders adjacent to an agent. `producers`: producer node ids, the destinations counted as
   * upstream (default: the single node `producer` of the topology presets).
   */
  constructor(opts: { producerLinks: Set<string>; edges: Set<string>; producers?: Set<string> }) {
    this.#producerLinks = opts.producerLinks;
    this.#edges = opts.edges;
    this.#producers = opts.producers ?? new Set(["producer"]);
  }

  event(e: ForwarderEvent): void {
    this.counts[e.kind]++;
    if (!this.#edges.has(e.node)) {
      if (e.kind === "cs_hit") this.coreCsHits++;
      return;
    }
    if (e.kind === "interest_in") this.edgeInterests++;
    else if (e.kind === "cs_hit") this.edgeCsHits++;
    else if (e.kind === "pit_aggregate") this.edgePitAggregations++;
    else if (e.kind === "bypass") this.edgeBypasses++;
  }

  transmit(tx: Transmission): void {
    if (!this.#producerLinks.has(tx.link)) return;
    this.producerLinkBytes += tx.bytes;
    if (!tx.lost && this.#producers.has(tx.to) && (tx.kind === "interest" || tx.kind === "call"))
      this.upstreamCalls++;
  }

  call(r: CallRecord): void {
    this.calls++;
    if (r.ok) {
      this.completed++;
      this.latencies.push(r.latencyMs);
    } else this.failed++;
    if (r.via === "local-cache") this.localCacheHits++;
    if (r.stale) this.staleServes++;
    if (r.lateMs !== undefined) {
      this.lateServes++;
      this.maxLateMs = Math.max(this.maxLateMs, r.lateMs);
    }
    if (r.error === "NO_ROUTE") this.noRoute++;
    this.retries += Math.max(0, r.attempts - 1);
  }

  /** A call answered from a gateway cache (B5). */
  gatewayHit(): void {
    this.gatewayCacheHits++;
  }

  /** A cacheable call that missed a gateway cache (B5); `inFlight`: an identical one was upstream. */
  gatewayMiss(inFlight: boolean): void {
    if (inFlight) this.gatewayInflightDuplicates++;
  }

  consumerVerifyFail(): void {
    this.consumerVerifyFailures++;
  }

  safetyViolation(kind: string): void {
    this.violations.push(kind);
  }

  snapshot(now: number): Metrics {
    const lat = this.latencies;
    return {
      calls: this.calls,
      completed: this.completed,
      failed: this.failed,
      noRoute: this.noRoute,
      upstreamCalls: this.upstreamCalls,
      csHits: this.edgeCsHits,
      pitAggregations: this.edgePitAggregations,
      edgeInterests: this.edgeInterests,
      csHitRatio: this.edgeInterests ? this.edgeCsHits / this.edgeInterests : 0,
      pitAggregationRatio: this.edgeInterests ? this.edgePitAggregations / this.edgeInterests : 0,
      localCacheHits: this.localCacheHits,
      latencyMs: {
        p50: percentile(lat, 50),
        p95: percentile(lat, 95),
        p99: percentile(lat, 99),
        mean: lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : Number.NaN,
      },
      producerLinkBytes: this.producerLinkBytes,
      verifyFailures: this.counts.verify_fail + this.consumerVerifyFailures,
      staleServes: this.staleServes,
      safetyViolations: this.violations.length,
      retries: this.retries,
      durationMs: now,
      coreCsHits: this.coreCsHits,
      bypasses: this.edgeBypasses,
      csEvictions: this.counts.cs_evict,
      lateServes: this.lateServes,
      maxLateMs: this.maxLateMs,
      gatewayCacheHits: this.gatewayCacheHits,
      gatewayInflightDuplicates: this.gatewayInflightDuplicates,
    };
  }
}
