/**
 * Agents role (container `idem-bench-agents`): one consumer per agent, each with its own
 * connection to its edge (an undici pool for HTTP, an NDNts forwarder with its own UDP face for
 * NDN), replaying the seed's plan closed-loop: think, call, wait for the answer, think again.
 *
 * - B0: plain `POST /idem/v1/call` through the edge (no name, no cache, unsigned answer).
 * - B2/B3: `IdemClient` (names locally, verifies every Data [P-5.5]).
 * - N2/N3: `NdnConsumer` over UDP to the edge NFD, retransmitting with a fresh Nonce.
 *
 * Usage: `agents.ts <job.json>`. Handshakes (manifest, tool list), writes `agents.ready`, waits
 * for `go`, runs, writes `calls.jsonl` and `agents.json`, exits.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CallToolResult, verifyData } from "@idem/core";
import { type CallOutcome, IdemClient } from "@idem/gateway";
import { NdnConsumer } from "@idem/ndn";
import { Forwarder } from "@ndn/fw";
import { UdpTransport } from "@ndn/node-transport";
import { Agent, fetch as undiciFetch } from "undici";
import { MODES } from "../config";
import { edgeOf, HTTP_PORT, ipOn, NDN_PORT, PRODUCER_NAME } from "../topology";
import { type PlannedCall, planCalls } from "../workload";
import { readJob, sleep, waitForFile, writeJson } from "./common";

/** One call as the agent saw it. */
export interface CallRow {
  agent: number;
  k: number;
  edge: string;
  /** Issue time since `go`, ms. */
  startMs: number;
  latencyMs: number;
  ok: boolean;
  /** Error code, or `TOOL_ERROR` for an `isError` result, or "" when ok. */
  code: string;
  /** Interests sent (native), 1 for an HTTP request. */
  attempts: number;
  /** Consumer-side signature verification, ms (absent for B0). */
  verifyMs: number | null;
  /** Overlay: first hop that answered from its CS, `<node>:pit` when aggregated, or `producer`. */
  servedBy: string;
  /** Bytes of the JSON result handed to the agent. */
  resultBytes: number;
}

type Caller = (call: PlannedCall) => Promise<Omit<CallRow, "agent" | "k" | "edge" | "startMs" | "latencyMs">>;

const { job, cfg, work } = readJob();
const mode = MODES[job.mode];
const plans = planCalls(cfg, job.seed);

function resultBytes(r: CallToolResult | undefined): number {
  return r ? new TextEncoder().encode(JSON.stringify(r)).byteLength : 0;
}

function servedBy(out: CallOutcome): string {
  for (const hop of out.trace) {
    const kinds = new Set(hop.events.map((e) => e.kind));
    if (kinds.has("cs_hit")) return hop.node;
    if (kinds.has("pit_aggregate")) return `${hop.node}:pit`;
  }
  return "producer";
}

function httpFetch(): typeof fetch {
  const dispatcher = new Agent({ keepAliveTimeout: 120_000, keepAliveMaxTimeout: 120_000 });
  return ((input: string, init?: RequestInit) =>
    undiciFetch(input, { ...(init as object), dispatcher })) as unknown as typeof fetch;
}

const callers: Caller[] = [];
const edges: string[] = [];
const closers: (() => void)[] = [];
for (let i = 0; i < plans.length; i++) {
  const edge = edgeOf(mode.topology, i);
  edges.push(edge.node);
  const ip = ipOn(edge.link, edge.node);
  if (mode.binding === "native") {
    const fw = Forwarder.create();
    const face = await UdpTransport.createFace({ fw }, { host: ip, port: NDN_PORT });
    closers.push(() => face.close());
    const consumer = new NdnConsumer({
      producer: PRODUCER_NAME,
      fw,
      interestLifetimeMs: cfg.native.interestLifetimeMs,
      retransmissions: cfg.native.retransmissions,
    });
    await consumer.init();
    callers.push(async (call) => {
      const out = await consumer.call(call.tool, call.args);
      const toolError = !out.error && out.result.isError === true;
      return {
        ok: !out.error && !toolError,
        code: out.error?.code ?? (toolError ? "TOOL_ERROR" : ""),
        attempts: out.attempts,
        verifyMs: out.verifyMs ?? null,
        servedBy: "",
        resultBytes: resultBytes(out.error ? undefined : out.result),
      };
    });
  } else if (mode.plain) {
    const f = httpFetch();
    const base = `http://${ip}:${HTTP_PORT}`;
    callers.push(async (call) => {
      try {
        const res = await f(`${base}/idem/v1/call`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ producer: PRODUCER_NAME, tool: call.tool, args: call.args }),
          signal: AbortSignal.timeout(cfg.overlay.callTimeoutMs),
        });
        const body = (await res.json()) as CallToolResult & { code?: string };
        const toolError = res.ok && body.isError === true;
        return {
          ok: res.ok && !toolError,
          code: res.ok ? (toolError ? "TOOL_ERROR" : "") : (body.code ?? `HTTP_${res.status}`),
          attempts: 1,
          verifyMs: null,
          servedBy: "producer",
          resultBytes: res.ok ? resultBytes(body) : 0,
        };
      } catch (e) {
        const timeout = e instanceof DOMException && e.name === "TimeoutError";
        return {
          ok: false,
          code: timeout ? "TIMEOUT" : "UPSTREAM_ERROR",
          attempts: 1,
          verifyMs: null,
          servedBy: "",
          resultBytes: 0,
        };
      }
    });
  } else {
    const client = new IdemClient({
      edge: `http://${ip}:${HTTP_PORT}`,
      producer: PRODUCER_NAME,
      fetch: httpFetch(),
    });
    await client.init();
    callers.push(async (call) => {
      const out = await client.call(call.tool, call.args);
      let verifyMs: number | null = null;
      if (out.data && out.verify?.ok) {
        // The client verified inside `call`; time the same check once more to report its cost.
        const t = performance.now();
        await verifyData(out.data, client.trust);
        verifyMs = performance.now() - t;
      }
      const toolError = !out.error && out.result.isError === true;
      return {
        ok: !out.error && !toolError,
        code: out.error?.code ?? (toolError ? "TOOL_ERROR" : ""),
        attempts: 1,
        verifyMs,
        servedBy: servedBy(out),
        resultBytes: resultBytes(out.error ? undefined : out.result),
      };
    });
  }
}

writeJson(join(work, "agents.ready"), { pid: process.pid, agents: callers.length });
await waitForFile(join(work, "go"), 5 * 60_000);
const cpu0 = process.cpuUsage();
const t0 = performance.now();
// Host suspension guard: a 100 ms timer that fires late means the VM (or the laptop) was frozen,
// which would inflate every latency of the run. The orchestrator discards such runs.
let lastTick = t0;
let maxTimerGapMs = 0;
const ticker = setInterval(() => {
  const now = performance.now();
  maxTimerGapMs = Math.max(maxTimerGapMs, now - lastTick - 100);
  lastTick = now;
}, 100);
const rows: CallRow[] = [];
await Promise.all(
  plans.map(async (plan, agent) => {
    const caller = callers[agent] as Caller;
    for (const call of plan) {
      await sleep(call.thinkMs);
      const start = performance.now();
      const r = await caller(call);
      rows.push({
        agent,
        k: call.k,
        edge: edges[agent] as string,
        startMs: start - t0,
        latencyMs: performance.now() - start,
        ...r,
      });
    }
  }),
);
const wallMs = performance.now() - t0;
clearInterval(ticker);
const cpu = process.cpuUsage(cpu0);
rows.sort((a, b) => a.agent - b.agent || a.k - b.k);
writeFileSync(join(work, "calls.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
writeJson(join(work, "agents.json"), {
  wallMs,
  cpuUserMs: cpu.user / 1000,
  cpuSystemMs: cpu.system / 1000,
  maxTimerGapMs,
});
for (const c of closers) c();
process.exit(0);
