import { describe, expect, it } from "vitest";
import { isRunId, isSourceFile, runId, sourceDigest } from "./provenance";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("provenance", () => {
  it("selects package sources and leaves tests, helpers and snapshots out", () => {
    expect(isSourceFile("packages/core/src/forwarder.ts")).toBe(true);
    expect(isSourceFile("packages/sim/src/experiments/sweep.ts")).toBe(true);
    expect(isSourceFile("packages/core/src/forwarder.test.ts")).toBe(false);
    expect(isSourceFile("packages/core/src/testkit.test-helpers.ts")).toBe(false);
    expect(isSourceFile("packages/core/src/__snapshots__/canonical.test.ts.snap")).toBe(false);
    expect(isSourceFile("packages/core/dist/index.js")).toBe(false);
    expect(isSourceFile("packages/sim/scripts/ts-resolve.mjs")).toBe(false);
    expect(isSourceFile("apps/web/app/page.tsx")).toBe(false);
  });

  it("digests the sorted sources: order-independent, sensitive to content and to paths", async () => {
    const a = { path: "packages/a/src/x.ts", content: bytes("one") };
    const b = { path: "packages/b/src/y.ts", content: bytes("two") };
    const d = await sourceDigest([a, b]);
    expect(d).toMatch(/^[0-9a-f]{64}$/);
    expect(await sourceDigest([b, a])).toBe(d);
    expect(await sourceDigest([a, { ...b, content: bytes("twO") }])).not.toBe(d);
    expect(await sourceDigest([a, { ...b, path: "packages/b/src/z.ts" }])).not.toBe(d);
    expect(await sourceDigest([a])).not.toBe(d);
    // Moving bytes between a path and its content must change the digest.
    const moved = [
      { path: "packages/a/src/x.tsone", content: bytes("") },
      { path: "packages/b/src/y.ts", content: bytes("two") },
    ];
    expect(await sourceDigest(moved)).not.toBe(d);
  });

  it("names runs by UTC time and source digest", () => {
    const id = runId(new Date("2026-11-17T04:09:01.331Z"), "c075463e8c6ccbcd");
    expect(id).toBe("20261117T040901Z-c075463e");
    expect(isRunId(id)).toBe(true);
    expect(isRunId("latest")).toBe(false);
    // Lexicographic order is chronological order.
    expect(runId(new Date("2026-11-17T04:09:02Z"), "00000000") > id).toBe(true);
  });
});
