import { describe, expect, it } from "vitest";
import {
  apparentAge,
  clockTolerance,
  DEFAULT_CLOCK_TOLERANCE_MS,
  isOutsideLifetime,
  lifetimeOf,
  lifetimeReason,
  lifetimeState,
} from "./lifetime";

const meta = (producedAt: number, freshnessMs: number) => ({ producedAt, freshnessMs });
const TOL = DEFAULT_CLOCK_TOLERANCE_MS;

describe("signed lifetime (protocol §8)", () => {
  it("defaults the clock tolerance to 60 s [P-8.6]", () => {
    expect(DEFAULT_CLOCK_TOLERANCE_MS).toBe(60_000);
    expect(clockTolerance(undefined)).toBe(60_000);
    expect(clockTolerance(0)).toBe(0);
    for (const bad of [-1, Number.NaN, "5" as unknown as number]) {
      expect(() => clockTolerance(bad)).toThrow(expect.objectContaining({ code: "BAD_POLICY" }));
    }
  });

  it("MUST treat Data as expired exactly at min(freshnessMs, ttlMs) + tolerance [P-8.6]", () => {
    const m = meta(1_000, 10_000);
    expect(lifetimeOf(m, Infinity)).toBe(10_000 + TOL);
    expect(lifetimeState(m, Infinity, 1_000 + 10_000 + TOL - 1)).toBe("within");
    expect(lifetimeState(m, Infinity, 1_000 + 10_000 + TOL)).toBe("expired");
    // Past its freshness but inside the tolerance: still within (bounded staleness).
    expect(isOutsideLifetime(m, Infinity, 1_000 + 10_000 + 1)).toBe(false);
    // A smaller tolerance tightens the bound.
    expect(isOutsideLifetime(m, Infinity, 1_000 + 10_500, 500)).toBe(true);
  });

  it("MUST cap the lifetime by the manifest ttlMs [P-8.2] [P-8.6]", () => {
    const m = meta(0, 300_000);
    expect(lifetimeOf(m, 1_000, 0)).toBe(1_000);
    expect(isOutsideLifetime(m, 1_000, 999, 0)).toBe(false);
    expect(isOutsideLifetime(m, 1_000, 1_000, 0)).toBe(true);
  });

  it("MUST give freshnessMs = 0 a lifetime of the tolerance alone [P-8.6]", () => {
    const m = meta(0, 0);
    expect(lifetimeState(m, 60_000, TOL - 1)).toBe("within");
    expect(lifetimeState(m, 60_000, TOL)).toBe("expired");
  });

  it("MUST refuse Data dated further in the future than the tolerance, and not clamp its age [P-8.6]", () => {
    const m = meta(100_000, 10_000);
    expect(apparentAge(m, 40_000)).toBe(-60_000);
    expect(lifetimeState(m, Infinity, 100_000 - TOL)).toBe("within");
    expect(lifetimeState(m, Infinity, 100_000 - TOL - 1)).toBe("future");
    expect(lifetimeReason(m, Infinity, 0)).toMatch(/future.*producedAt 100000.*local time 0/);
    expect(lifetimeReason(meta(0, 1), Infinity, 1e9)).toMatch(/past its signed lifetime/);
  });

  it("MUST fail closed on values that are not numbers [P-8.6]", () => {
    expect(lifetimeState(meta(Number.NaN, 10), Infinity, 0)).toBe("expired");
    expect(lifetimeState(meta(0, Number.NaN), Infinity, 0)).toBe("expired");
    expect(lifetimeState(meta(0, 10), Infinity, Number.NaN)).toBe("expired");
    expect(lifetimeState(meta(0, 10), Infinity, 0, Number.NaN)).toBe("expired");
  });
});
