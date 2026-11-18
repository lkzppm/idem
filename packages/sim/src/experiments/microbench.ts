import {
  canonicalizeArgs,
  keyPairFromSeed,
  makeName,
  Producer,
  type ProducerTool,
  signData,
  type ToolIdentity,
  type ToolPolicy,
  TrustStore,
  type UnsignedData,
  utf8Length,
  verifyData,
} from "@idem/core";
import { Rng } from "../rng";
import type { MicrobenchConfig, MicrobenchOp } from "./spec";
import { mean, percentileSorted, sampleSd } from "./stats";

/** One (operation, payload size) cell of E1. One line of `metrics.csv`; times in microseconds. */
export interface MicrobenchRow {
  op: MicrobenchOp;
  /** Nominal payload size (the swept value). */
  size_bytes: number;
  /** Bytes the operation actually processed (JSON of the arguments or of the result). */
  input_bytes: number;
  iterations: number;
  warmup: number;
  min_us: number;
  p05_us: number;
  p25_us: number;
  p50_us: number;
  mean_us: number;
  p75_us: number;
  p95_us: number;
  p99_us: number;
  max_us: number;
  sd_us: number;
}

export const MICROBENCH_COLUMNS = [
  "op",
  "size_bytes",
  "input_bytes",
  "iterations",
  "warmup",
  "min_us",
  "p05_us",
  "p25_us",
  "p50_us",
  "mean_us",
  "p75_us",
  "p95_us",
  "p99_us",
  "max_us",
  "sd_us",
] as const satisfies readonly (keyof MicrobenchRow)[];

const PRODUCER = "bench.idem.dev";

/** The tool E1 exercises: a small URL with a normalizer, a default, and one large text field. */
const BENCH_TOOL: ProducerTool = {
  name: "bench_lookup",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", minLength: 1 },
      text: { type: "string" },
      limit: { type: "integer", minimum: 1, default: 10 },
    },
    required: ["url", "text"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  policy: {
    cacheable: true,
    ttlMs: 60_000,
    scope: "public",
    normalizers: { "/url": ["url:sortQuery"], "/text": ["trim"] },
  },
  handler: () => ({ content: [] }),
};

const WORDS = [
  "named",
  "data",
  "interest",
  "forwarder",
  "producer",
  "signature",
  "cache",
  "digest",
  "manifest",
  "consumer",
  "freshness",
  "scope",
];

/** `bytes` bytes of seeded ASCII prose (words and spaces, no leading or trailing space). */
export function payloadText(rng: Rng, bytes: number): string {
  const parts: string[] = [];
  let n = 0;
  while (n < bytes) {
    const w = WORDS[rng.int(WORDS.length)] as string;
    parts.push(w);
    n += w.length + 1;
  }
  const s = parts.join(" ").slice(0, bytes);
  return s.endsWith(" ") ? `${s.slice(0, -1)}.` : s;
}

/** Order statistics of a sample of durations (µs). */
export function describe(
  samples: Float64Array,
): Omit<MicrobenchRow, "op" | "size_bytes" | "input_bytes" | "iterations" | "warmup"> {
  const sorted = Float64Array.from(samples).sort();
  const list = Array.from(sorted);
  // Nanosecond precision is all `performance.now()` offers; more digits are float noise.
  const r = (us: number) => Math.round(us * 1000) / 1000;
  return {
    min_us: r(sorted[0] ?? Number.NaN),
    p05_us: r(percentileSorted(sorted, 5)),
    p25_us: r(percentileSorted(sorted, 25)),
    p50_us: r(percentileSorted(sorted, 50)),
    mean_us: r(mean(list)),
    p75_us: r(percentileSorted(sorted, 75)),
    p95_us: r(percentileSorted(sorted, 95)),
    p99_us: r(percentileSorted(sorted, 99)),
    max_us: r(sorted[sorted.length - 1] ?? Number.NaN),
    sd_us: r(sampleSd(list)),
  };
}

/** Time `fn` once per iteration with `now()` (ms), after `warmup` untimed calls. Returns µs. */
export async function timeLoop(
  fn: () => Promise<unknown>,
  iterations: number,
  warmup: number,
  now: () => number = () => performance.now(),
): Promise<Float64Array> {
  for (let i = 0; i < warmup; i++) await fn();
  const out = new Float64Array(iterations);
  for (let i = 0; i < iterations; i++) {
    const t0 = now();
    await fn();
    out[i] = (now() - t0) * 1000;
  }
  return out;
}

/**
 * E1 (05-evaluation §4): wall-clock cost of `canonicalizeArgs`, `makeName`, `signData` and
 * `verifyData` per payload size, one call per timed iteration. Web APIs only (`performance.now`,
 * WebCrypto), so the same code can run in a browser. Sizes run in the configured order and the
 * four operations run one after another for each size.
 */
export async function runMicrobench(
  cfg: MicrobenchConfig,
  opts: { onProgress?: (done: number, total: number) => void; now?: () => number } = {},
): Promise<MicrobenchRow[]> {
  const rng = new Rng(cfg.seed);
  const key = await keyPairFromSeed(rng.fork("key").bytes(32));
  const producer = new Producer({ producer: PRODUCER, key, tools: [BENCH_TOOL] });
  const manifest = await producer.manifest();
  const trust = new TrustStore();
  await trust.addManifest(manifest, { now: 0 });
  const identity: ToolIdentity = producer.identity(BENCH_TOOL.name);
  const policy = manifest.tools.find((t) => t.tool === BENCH_TOOL.name) as ToolPolicy;

  const rows: MicrobenchRow[] = [];
  const total = cfg.sizesBytes.length * cfg.ops.length;
  let done = 0;
  const textRng = rng.fork("text");
  for (let s = 0; s < cfg.sizesBytes.length; s++) {
    const size = cfg.sizesBytes[s] as number;
    const iterations = cfg.iterations[s] as number;
    const warmup = Math.max(20, Math.round(iterations * cfg.warmupFraction));
    const text = payloadText(textRng, size);
    // Arguments as a model would write them: unsorted query, default port, a fragment, no `limit`.
    const args = { url: "https://Bench.idem.dev:443/lookup?v=1&lang=en#top", text };
    const canonical = await canonicalizeArgs(args, identity, policy);
    const name = await makeName({ producer: PRODUCER, tool: identity, args: canonical });
    const unsigned: UnsignedData = {
      name,
      content: { content: [{ type: "text", text }] },
      producedAt: 1_000,
      freshnessMs: 60_000,
      scope: "public",
      policyVersion: 1,
    };
    const data = await signData(unsigned, key);
    const argBytes = utf8Length(JSON.stringify(args));
    const resultBytes = utf8Length(JSON.stringify(unsigned.content));
    const cases: Record<MicrobenchOp, { bytes: number; fn: () => Promise<unknown> }> = {
      canonicalizeArgs: { bytes: argBytes, fn: () => canonicalizeArgs(args, identity, policy) },
      makeName: {
        bytes: utf8Length(canonical.jcs),
        fn: () => makeName({ producer: PRODUCER, tool: identity, args: canonical }),
      },
      signData: { bytes: resultBytes, fn: () => signData(unsigned, key) },
      verifyData: {
        bytes: resultBytes,
        fn: async () => {
          const r = await verifyData(data, trust, { now: 2_000 });
          if (!r.ok) throw new Error(`verifyData failed in the benchmark: ${r.reason}`);
        },
      },
    };
    for (const op of cfg.ops) {
      const c = cases[op];
      const samples = await timeLoop(c.fn, iterations, warmup, opts.now);
      rows.push({ op, size_bytes: size, input_bytes: c.bytes, iterations, warmup, ...describe(samples) });
      opts.onProgress?.(++done, total);
    }
  }
  return rows;
}
