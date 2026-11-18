import { describe, expect, it } from "vitest";
import { runSafety, SAFETY_VARIANTS, tally } from "./safety";

/**
 * A variant the engine should stop and does not. It is a finding of E5 (spec/07-decisions.md,
 * ADR-023, Q7), not accepted behavior: when it is fixed, its test here fails, and the E5 results
 * must be rerun with it.
 */
const OPEN_FINDINGS = ["private/authcontext-known"];
/** Documented limits of v1 (ADR-025): measured, accepted in every trial until Q6 lands. */
const DOCUMENTED_LIMITS = ["replay/expired@upstream", "replay/expired@last-hop"];
/** Declared, undefended risk (07-decisions Q3): measured, expected to leak. */
const DECLARED_LEAKS = ["timing/cache-probe"];

const TRIALS = 4;

describe("E5 safety suite", () => {
  it("covers every attack class of spec 05 §4, each variant with a unique id", () => {
    const ids = SAFETY_VARIANTS.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const attack of ["tamper", "forge", "replay", "private", "poison"]) {
      expect(SAFETY_VARIANTS.filter((v) => v.attack === attack).length, attack).toBeGreaterThanOrEqual(3);
    }
    for (const v of SAFETY_VARIANTS) {
      expect(v.id.startsWith(`${v.attack}/`), v.id).toBe(true);
      const expected = DECLARED_LEAKS.includes(v.id)
        ? "leaks"
        : DOCUMENTED_LIMITS.includes(v.id)
          ? "limit"
          : "rejected";
      expect(v.expected, v.id).toBe(expected);
    }
    for (const id of [...OPEN_FINDINGS, ...DOCUMENTED_LIMITS, ...DECLARED_LEAKS]) expect(ids).toContain(id);
  });

  for (const v of SAFETY_VARIANTS) {
    const finding = OPEN_FINDINGS.includes(v.id);
    const limit = DOCUMENTED_LIMITS.includes(v.id);
    const open = finding || limit;
    const leak = DECLARED_LEAKS.includes(v.id);
    const title = finding
      ? `OPEN FINDING (ADR-023, Q7): ${v.id} is accepted`
      : limit
        ? `documented v1 limit (ADR-025): ${v.id} is accepted`
        : leak
          ? `declared leak (Q3): ${v.id}`
          : `rejects ${v.id}`;
    it(title, async () => {
      for (let seed = 1; seed <= TRIALS; seed++) {
        const o = await v.run(seed);
        expect(o.rejected, `seed ${seed}: ${o.mechanism}`).toBe(!open && !leak);
        expect(o.mechanism.startsWith("ACCEPTED"), `seed ${seed}: ${o.mechanism}`).toBe(open);
        expect(o.mechanism).not.toMatch(/setup failed/);
      }
    });
  }

  it("is deterministic for a seed", async () => {
    for (const v of SAFETY_VARIANTS) expect(await v.run(17), v.id).toEqual(await v.run(17));
  });

  it("MUST NEVER accept tampered Data nor serve a private result across contexts without the edge's own secret [H3]", async () => {
    const { rows } = await runSafety({ experiment: "t", kind: "safety", seed: 100, trials: TRIALS });
    for (const r of rows.filter(
      (x) => x.attack === "tamper" || x.attack === "forge" || x.attack === "poison",
    )) {
      expect(r.accepted, r.variant).toBe(0);
    }
    for (const r of rows.filter((x) => x.attack === "private" && !OPEN_FINDINGS.includes(x.variant))) {
      expect(r.accepted, r.variant).toBe(0);
    }
    // Every claim the engine keeps: all variants expected to be rejected, but the open finding.
    for (const r of rows.filter((x) => x.expected === "rejected" && !OPEN_FINDINGS.includes(x.variant))) {
      expect(r.accepted, r.variant).toBe(0);
    }
  });

  it("runs the selected variants and tallies trials and mechanisms", async () => {
    const { rows, trials } = await runSafety({
      experiment: "t",
      kind: "safety",
      seed: 7,
      trials: 3,
      variants: ["forge/args-swap@edge", "replay/expired@upstream"],
    });
    expect(rows.map((r) => [r.variant, r.trials, r.rejected, r.accepted])).toEqual([
      ["forge/args-swap@edge", 3, 3, 0],
      ["replay/expired@upstream", 3, 0, 3],
    ]);
    expect(rows[0]?.mechanisms).toBe("edge drop → Nack DIGEST_MISMATCH=3");
    expect(trials.map((t) => [t.variant, t.trial, t.seed])).toEqual([
      ["forge/args-swap@edge", 0, 7],
      ["forge/args-swap@edge", 1, 8],
      ["forge/args-swap@edge", 2, 9],
      ["replay/expired@upstream", 0, 7],
      ["replay/expired@upstream", 1, 8],
      ["replay/expired@upstream", 2, 9],
    ]);
    await expect(
      runSafety({ experiment: "t", kind: "safety", seed: 1, trials: 1, variants: ["nope"] }),
    ).rejects.toThrow(/unknown safety variant/);
  });

  it("orders mechanisms by frequency in the tally", () => {
    const v = SAFETY_VARIANTS[0] as (typeof SAFETY_VARIANTS)[number];
    const row = tally(v, [
      { rejected: true, mechanism: "b" },
      { rejected: true, mechanism: "a" },
      { rejected: false, mechanism: "ACCEPTED: x" },
      { rejected: true, mechanism: "a" },
    ]);
    expect(row).toMatchObject({
      trials: 4,
      rejected: 3,
      accepted: 1,
      mechanisms: "a=2 | ACCEPTED: x=1 | b=1",
    });
  });
});
