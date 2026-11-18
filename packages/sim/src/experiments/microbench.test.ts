import { describe, expect, it } from "vitest";
import { Rng } from "../rng";
import { describe as describeSamples, payloadText, runMicrobench, timeLoop } from "./microbench";
import type { MicrobenchConfig } from "./spec";

const CONFIG: MicrobenchConfig = {
  experiment: "e1-test",
  kind: "microbench",
  seed: 1,
  ops: ["canonicalizeArgs", "makeName", "signData", "verifyData"],
  sizesBytes: [1024, 8192],
  iterations: [30, 20],
  warmupFraction: 0.2,
};

describe("E1 microbenchmarks", () => {
  it("builds seeded payloads of the exact size, with nothing for `trim` to remove", () => {
    for (const bytes of [1, 7, 1024, 4096, 65_536]) {
      const text = payloadText(new Rng(3), bytes);
      expect(text).toHaveLength(bytes);
      expect(text.trim()).toBe(text);
      expect(/^[\x20-\x7e]+$/.test(text)).toBe(true);
    }
    expect(payloadText(new Rng(3), 512)).toBe(payloadText(new Rng(3), 512));
    expect(payloadText(new Rng(4), 512)).not.toBe(payloadText(new Rng(3), 512));
  });

  it("times one call per iteration, after the warm-up", async () => {
    let calls = 0;
    let t = 0;
    // A clock that advances 0.25 ms per reading: each timed call measures exactly 250 µs.
    const samples = await timeLoop(
      async () => {
        calls++;
      },
      5,
      3,
      () => {
        t += 0.25;
        return t;
      },
    );
    expect(calls).toBe(8);
    expect(Array.from(samples)).toEqual([250, 250, 250, 250, 250]);
  });

  it("describes a sample by its order statistics, in whole nanoseconds", () => {
    const d = describeSamples(Float64Array.from({ length: 100 }, (_, i) => 100 - i));
    expect(d).toMatchObject({
      min_us: 1,
      p05_us: 5,
      p25_us: 25,
      p50_us: 50,
      p75_us: 75,
      p95_us: 95,
      p99_us: 99,
    });
    expect(d.max_us).toBe(100);
    expect(d.mean_us).toBe(50.5);
    expect(describeSamples(Float64Array.of(1.23456789)).p50_us).toBe(1.235);
  });

  it("measures every operation at every size and reports what it processed", async () => {
    const rows = await runMicrobench(CONFIG);
    expect(rows.map((r) => `${r.op}@${r.size_bytes}`)).toEqual([
      "canonicalizeArgs@1024",
      "makeName@1024",
      "signData@1024",
      "verifyData@1024",
      "canonicalizeArgs@8192",
      "makeName@8192",
      "signData@8192",
      "verifyData@8192",
    ]);
    for (const r of rows) {
      expect(r.iterations).toBe(r.size_bytes === 1024 ? 30 : 20);
      expect(r.warmup).toBe(20);
      // The swept size is the payload; the envelope around it adds a little.
      expect(r.input_bytes).toBeGreaterThanOrEqual(r.size_bytes);
      expect(r.input_bytes).toBeLessThan(r.size_bytes + 128);
      expect(r.min_us).toBeGreaterThan(0);
      expect(r.p50_us).toBeGreaterThanOrEqual(r.min_us);
      expect(r.max_us).toBeGreaterThanOrEqual(r.p99_us);
    }
  });

  it("is driven only by its clock: an injected clock makes the output exact", async () => {
    let t = 0;
    const rows = await runMicrobench(
      { ...CONFIG, ops: ["signData"], sizesBytes: [1024], iterations: [10] },
      {
        now: () => {
          t += 0.5;
          return t;
        },
      },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ min_us: 500, p50_us: 500, p99_us: 500, max_us: 500, sd_us: 0 });
  });
});
