import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { repoRoot } from "./experiments/node-io";
import {
  applyParam,
  EVAL_MODE_IDS,
  parseExperimentConfig,
  parseProcessingCosts,
  simConfigFor,
} from "./experiments/spec";
import { extraCases, type FingerprintCase, fingerprint } from "./fingerprint.test-helpers";

/**
 * Golden rule 7: a run is a function of its configuration and seed, never of the order in which
 * concurrent WebCrypto operations complete. WebCrypto resolves on a thread pool, so two digests in
 * flight at one virtual instant may finish in either order. This test makes that order adversarial:
 * it delays every `subtle` operation by a number of event-loop turns that depends on its position
 * (reversing and shuffling completion order), then requires the full fingerprint (every
 * transmission, call record, event and metric) to equal the unperturbed run's.
 */

const subtle = globalThis.crypto.subtle as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
const OPS = ["digest", "sign", "verify"] as const;
const real = Object.fromEntries(OPS.map((op) => [op, subtle[op]?.bind(globalThis.crypto.subtle)]));

/** Delay the n-th WebCrypto call's completion by `pattern(n)` turns of the event loop. */
function perturb(pattern: (n: number) => number): void {
  let n = 0;
  for (const op of OPS) {
    const f = real[op] as (...a: unknown[]) => Promise<unknown>;
    subtle[op] = (...a: unknown[]) => {
      const d = pattern(n++);
      return f(...a).then(async (v) => {
        for (let i = 0; i < d; i++) await new Promise((r) => setImmediate(r));
        return v;
      });
    };
  }
}

afterEach(() => {
  for (const op of OPS) subtle[op] = real[op] as (...a: unknown[]) => Promise<unknown>;
});

const PATTERNS: [string, (n: number) => number][] = [
  ["descending", (n) => 2 * (3 - (n % 4))],
  ["shuffled", (n) => (n * 7919) % 5],
];

/** The first seed of `e2-code-burst` at burst sizes above 1, in every evaluation mode. */
function burstCases(): FingerprintCase[] {
  const dir = join(repoRoot(), "experiments", "configs");
  const cfg = parseExperimentConfig(JSON.parse(readFileSync(join(dir, "e2-code-burst.json"), "utf8")));
  if (cfg.kind !== "sweep") throw new Error("e2-code-burst is not a sweep");
  const costs = parseProcessingCosts(
    JSON.parse(readFileSync(join(import.meta.dirname, "__snapshots__", "legacy.processing.json"), "utf8")),
  );
  return [4, 16].flatMap((size) =>
    EVAL_MODE_IDS.map((mode) => ({
      id: `burst=${size}/${mode}`,
      cfg: simConfigFor(applyParam(cfg.base, cfg.sweep.param, size), mode, costs),
      seed: cfg.seeds.first,
    })),
  );
}

describe("runs do not depend on the completion order of concurrent WebCrypto calls (golden rule 7)", () => {
  const cases = [...burstCases(), ...extraCases().filter((c) => c.id === "tree-loss/idem")];
  for (const c of cases) {
    it(`same seed, same fingerprint, whatever order digests complete in: ${c.id}`, async () => {
      const reference = await fingerprint(c);
      expect(await fingerprint(c), "rerun").toBe(reference);
      for (const [name, pattern] of PATTERNS) {
        perturb(pattern);
        try {
          expect(await fingerprint(c), name).toBe(reference);
        } finally {
          for (const op of OPS) subtle[op] = real[op] as (...a: unknown[]) => Promise<unknown>;
        }
      }
    }, 120_000);
  }
});
