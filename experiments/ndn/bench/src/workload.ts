/**
 * The E4 workload: W-syn from `@idem/sim` (`planWorkload`), think times and page sizes drawn from
 * the run seed, and the producer's single tool. The same seed gives the same calls, think times
 * and pages in every mode, so the five modes see one workload.
 */
import {
  buildInterest,
  cacheablePolicy,
  type IdemKeyPair,
  type JsonValue,
  keyPairFromSeed,
  Producer,
  type ProducerTool,
} from "@idem/core";
import { planWorkload, Rng, type SimConfig } from "@idem/sim";
import type { E4Config } from "./config";
import { PRODUCER_NAME } from "./topology";

export interface PlannedCall {
  agent: number;
  k: number;
  tool: string;
  args: JsonValue;
  /** Wait before issuing this call: after the start for `k = 0`, after the previous call otherwise. */
  thinkMs: number;
}

/** Per-agent call plans of a seed. */
export function planCalls(cfg: E4Config, seed: number): PlannedCall[][] {
  const w = cfg.workload;
  const simCfg = {
    workload: { kind: "synthetic", privateFraction: 0, sideEffectFraction: 0, ...w },
  } as unknown as SimConfig;
  const plans = planWorkload(simCfg, new Rng(seed).fork("workload"));
  const think = new Rng(seed).fork("think");
  return plans.map((plan, agent) => {
    const r = think.fork(`agent-${agent}`);
    return plan.map((spec, k) => ({
      agent,
      k,
      tool: spec.tool,
      args: spec.args as JsonValue,
      // As the simulator: uniform start in [0, think), then exponential think times.
      thinkMs: k === 0 ? r.next() * w.thinkTimeMs : r.exp(w.thinkTimeMs),
    }));
  });
}

const LOREM =
  "Named data networking retrieves content by name rather than by host address. Every packet carries a name, " +
  "every Data packet is signed, and any node on the path may answer from its cache. ";

/**
 * Size of document `i` for a seed: log-normal around `pageBytesMedian`, clamped so every result
 * fits one NDN packet (v1 does not segment, protocol §9.2). Stable per document.
 */
export function pageBytes(cfg: E4Config, seed: number, i: number): number {
  const p = cfg.producer;
  const v = new Rng(i * 7919 + seed).lognormal(Math.log(p.pageBytesMedian), p.pageBytesSigma);
  return Math.min(p.pageBytesMax, Math.max(p.pageBytesMin, Math.round(v)));
}

export function pageText(i: number, bytes: number): string {
  const head = `# Document ${i}\n\n`;
  return head + LOREM.repeat(Math.ceil(bytes / LOREM.length)).slice(0, Math.max(0, bytes - head.length));
}

/** The producer key: fixed, so every run and every consumer sees the same manifest. */
export function producerKey(): Promise<IdemKeyPair> {
  return keyPairFromSeed(new Uint8Array(32).fill(0x4e));
}

export interface ToolStats {
  /** Handler invocations: the calls that reached the tool (upstream calls). */
  invocations: number;
  /** Invocations per IDEM name or per raw URL (plain calls). */
  perKey: Map<string, number>;
}

/** `fetch_page` over the static corpus, with a seeded log-normal service time. */
export function benchTools(cfg: E4Config, seed: number, stats: ToolStats): ProducerTool[] {
  const service = new Rng(seed).fork("service");
  const p = cfg.producer;
  return [
    {
      name: "fetch_page",
      description: "Return a page of the static corpus.",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string", minLength: 1 } },
        required: ["url"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      policy: {
        cacheable: true,
        ttlMs: p.ttlMs,
        scope: "public",
        normalizers: { "/url": ["url:sortQuery"] },
      },
      handler: async (args) => {
        stats.invocations++;
        const url = new URL((args as { url: string }).url);
        // Same key for every surface form of a URL (plain calls carry the raw form).
        url.hash = "";
        url.searchParams.sort();
        stats.perKey.set(url.href, (stats.perKey.get(url.href) ?? 0) + 1);
        const ms = service.lognormal(Math.log(p.serviceMedianMs), p.serviceSigma);
        await new Promise((r) => setTimeout(r, ms));
        const m = /^\/doc\/(\d+)$/.exec(url.pathname);
        if (url.origin !== "https://corpus.idem.dev" || !m) {
          return { content: [{ type: "text", text: `404 ${url.href}` }], isError: true };
        }
        const i = Number(m[1]);
        return { content: [{ type: "text", text: pageText(i, pageBytes(cfg, seed, i)) }] };
      },
    },
  ];
}

/** A producer for a seed (not attached to any network). */
export async function benchProducer(cfg: E4Config, seed: number, stats: ToolStats): Promise<Producer> {
  return new Producer({
    producer: PRODUCER_NAME,
    key: await producerKey(),
    tools: benchTools(cfg, seed, stats),
  });
}

/**
 * What the plan asks for before anything runs: calls, distinct IDEM names, and the oracle
 * reduction `1 − distinct / calls` (spec 05 §3; every call here is cacheable).
 */
export async function oracle(cfg: E4Config, seed: number): Promise<{ calls: number; distinctNames: number }> {
  const producer = await benchProducer(cfg, seed, { invocations: 0, perKey: new Map() });
  const manifest = await producer.manifest();
  const info = producer.toolList()[0];
  const c = info && (await cacheablePolicy(manifest, info));
  if (!c) throw new Error("fetch_page is not cacheable");
  const names = new Set<string>();
  let calls = 0;
  for (const plan of planCalls(cfg, seed)) {
    for (const call of plan) {
      calls++;
      const { interest } = await buildInterest({
        producer: PRODUCER_NAME,
        identity: c.identity,
        policy: c.policy,
        args: call.args,
        nonce: "x",
      });
      names.add(interest.name);
    }
  }
  return { calls, distinctNames: names.size };
}
