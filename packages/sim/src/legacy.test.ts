import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pinnedFingerprints } from "./fingerprint.test-helpers";

/**
 * Regression guard (ADR-027): configurations without `producers` must run exactly as they did
 * before the simulator learned arbitrary graphs and several producers. Each pinned case (first
 * seed of every E2 sweep point, plus the default, tree-with-loss, attack and trace runs) is
 * hashed at full precision and compared with the hash the *pre-change* code produced.
 *
 * Why one set of hashes per platform. A run is deterministic on one platform but not bit-identical
 * across platforms: V8's `Math.log` returns different last bits on macOS and on Linux for the same
 * input (the result is not correctly rounded; Node 24 and 26 on darwin-arm64 agree with each
 * other, Linux arm64 and amd64 agree with each other, the two families do not). `Rng.exp` and
 * `Rng.normal` use `Math.log`, so think and service times differ by an ulp, and that is not
 * confined to the last digit of a time: a Data packet carries its signed `producedAt` as JSON, so
 * its byte count follows the number of decimal digits of a virtual timestamp (8083 bytes on one
 * platform, 8082 on the other), and with it the transmission and charged CPU time. Rounding the
 * hash or comparing with a tolerance would therefore either hide real differences or still flip.
 * So the strict hashes are pinned per `process.platform`, each recorded on that platform from the
 * code before the change (`pnpm --filter @idem/sim run fingerprint --pinned`); the full 30-seed
 * before/after comparison runs on one machine with the same script.
 */

const PINNED = JSON.parse(
  readFileSync(join(import.meta.dirname, "__snapshots__", "legacy.fingerprints.json"), "utf8"),
) as Record<string, Record<string, string>>;

const expected = PINNED[process.platform];

describe("legacy configurations run unchanged (ADR-027)", () => {
  it.skipIf(expected === undefined)(
    `every pinned case matches the pre-change run on ${process.platform}`,
    async () => {
      // Runs added later (B5 in the sweeps, the H5/H6 sweeps) were not recorded and are not
      // compared; a recorded run that is no longer produced makes the objects differ.
      expect(await pinnedFingerprints(new Set(Object.keys(expected ?? {})))).toEqual(expected);
    },
    180_000,
  );

  it("pins every platform the project runs on (macOS for the author, Linux for CI)", () => {
    expect(Object.keys(PINNED).sort()).toEqual(["darwin", "linux"]);
    expect(Object.keys(PINNED.darwin ?? {})).toEqual(Object.keys(PINNED.linux ?? {}));
  });
});
