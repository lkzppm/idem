import { describe, expect, it } from "vitest";
import { BOUNDED_STALENESS, runSafety, SAFETY_VARIANTS, tally } from "./safety";

/**
 * Documented limit of v1 (ADR-034): a replay younger than freshness + clockToleranceMs is accepted
 * (bounded staleness). Measured, and accepted in every trial with exactly that mechanism; anything
 * else accepted there (Data served past its signed lifetime) is a broken claim.
 */
const DOCUMENTED_LIMITS = ["replay/in-tolerance@upstream", "replay/in-tolerance@last-hop"];
/** Claims that were open findings or limits before Q7 and Q6 closed them (ADR-033, ADR-034). */
const CLOSED = [
  "private/authcontext-known",
  "replay/expired@upstream",
  "replay/expired@last-hop",
  "replay/understated-age@core",
  "replay/future-dated@upstream",
];
/** Declared, undefended risk (07-decisions Q3): measured, expected to leak. */
const DECLARED_LEAKS = ["timing/cache-probe"];
/**
 * The same attacks against B5, the unsigned shared gateway cache (ADR-036): accepted there by
 * construction, shown next to the IDEM variant each one mirrors. Not IDEM claims.
 */
const BASELINE = ["baseline/tamper-cache@edge", "baseline/tamper@upstream", "baseline/private-miskeyed@edge"];
const IDEM_VARIANTS = SAFETY_VARIANTS.filter((v) => v.expected !== "baseline");
/**
 * The layer that must stop each claim, and the check it uses there, as the trial's mechanism
 * reports it (from forwarder events or the consumer's verdict, never from the judge). A claim that
 * holds only because another layer caught it (an edge check missing, the consumer refusing instead)
 * fails here, so each defence is tested on its own.
 */
const STOPPED_BY: Record<string, RegExp> = {
  "tamper/content@upstream": /^forwarder verify_fail → Nack BAD_SIGNATURE$/,
  "tamper/content@last-hop": /^consumer refused: BAD_SIGNATURE$/,
  "tamper/freshness@upstream": /^forwarder verify_fail → Nack BAD_SIGNATURE$/,
  "tamper/signature@upstream": /^forwarder verify_fail → Nack BAD_SIGNATURE$/,
  "tamper/swap-name@upstream": /^forwarder drop: unsolicited → /,
  "tamper/swap-name@last-hop": /^consumer refused: name mismatch$/,
  "tamper/scope@upstream": /^forwarder verify_fail → Nack BAD_SIGNATURE$/,
  "forge/args-swap@edge": /^edge drop → Nack DIGEST_MISMATCH$/,
  "forge/random-digest@edge": /^edge drop → Nack DIGEST_MISMATCH$/,
  "forge/args-swap@producer": /^producer refuses: DIGEST_MISMATCH$/,
  "replay/expired-cache": /^edge refetched from the producer$/,
  "replay/expired@upstream": /^edge EXPIRED → Nack EXPIRED$/,
  "replay/expired@last-hop": /^consumer refused: EXPIRED$/,
  "replay/understated-age@core": /^edge EXPIRED → Nack EXPIRED$/,
  "replay/future-dated@upstream": /^edge EXPIRED → Nack EXPIRED$/,
  "replay/unsolicited@consumer-face": /^edge drop: unsolicited$/,
  "private/sequential": /^got its own result; no shared cache or PIT entry$/,
  "private/concurrent": /^got its own result; no shared cache or PIT entry$/,
  "private/anonymous": /^got its own result; no shared cache or PIT entry$/,
  "private/tree": /^got its own result; no shared cache or PIT entry$/,
  "private/authcontext-guess": /^got its own result; no shared cache or PIT entry$/,
  "private/authcontext-known": /^got its own result; no shared cache or PIT entry$/,
  "poison/unknown-key@upstream": /^forwarder verify_fail → Nack BAD_SIGNATURE$/,
  "poison/spoofed-key-id@upstream": /^forwarder verify_fail → Nack BAD_SIGNATURE$/,
  "poison/other-producer@upstream": /^forwarder verify_fail → Nack BAD_SIGNATURE$/,
  "poison/rogue-manifest@upstream": /^manifest refused: UNTRUSTED_KEY; forwarder verify_fail → /,
  "poison/unknown-key@last-hop": /^consumer refused: UNTRUSTED_KEY$/,
  "poison/unsolicited@consumer-face": /^edge drop: unsolicited$/,
};

const TRIALS = 4;

describe("E5 safety suite", () => {
  it("covers every attack class of spec 05 §4, each variant with a unique id", () => {
    const ids = SAFETY_VARIANTS.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const attack of ["tamper", "forge", "replay", "private", "poison"]) {
      expect(IDEM_VARIANTS.filter((v) => v.attack === attack).length, attack).toBeGreaterThanOrEqual(3);
    }
    expect(SAFETY_VARIANTS.filter((v) => v.expected === "baseline").map((v) => v.id)).toEqual(BASELINE);
    for (const v of SAFETY_VARIANTS.filter((x) => x.expected === "baseline")) {
      // A baseline row names the IDEM variant of the same attack class it stands next to.
      const twin = IDEM_VARIANTS.find((x) => x.id === v.mirrors);
      expect(twin?.attack, v.id).toBe(v.attack);
      expect(twin?.expected, v.id).toBe("rejected");
    }
    for (const v of IDEM_VARIANTS) {
      expect(v.id.startsWith(`${v.attack}/`), v.id).toBe(true);
      expect(v.mirrors, v.id).toBeUndefined();
      const expected = DECLARED_LEAKS.includes(v.id)
        ? "leaks"
        : DOCUMENTED_LIMITS.includes(v.id)
          ? "limit"
          : "rejected";
      expect(v.expected, v.id).toBe(expected);
    }
    for (const id of [...CLOSED, ...DOCUMENTED_LIMITS, ...DECLARED_LEAKS]) expect(ids).toContain(id);
    // Every claim names the layer that must stop it, and nothing else does.
    const claims = IDEM_VARIANTS.filter((v) => v.expected === "rejected").map((v) => v.id);
    expect(Object.keys(STOPPED_BY).sort()).toEqual([...claims].sort());
  });

  for (const v of SAFETY_VARIANTS.filter((x) => x.expected === "baseline")) {
    it(`baseline (B5, ADR-036): ${v.id} is accepted, where IDEM rejects ${v.mirrors}`, async () => {
      for (let seed = 1; seed <= TRIALS; seed++) {
        const o = await v.run(seed);
        expect(o.rejected, `seed ${seed}: ${o.mechanism}`).toBe(false);
        expect(o.mechanism, `seed ${seed}`).toMatch(/^ACCEPTED: /);
      }
    });
  }

  for (const v of IDEM_VARIANTS) {
    const limit = DOCUMENTED_LIMITS.includes(v.id);
    const leak = DECLARED_LEAKS.includes(v.id);
    const title = limit
      ? `documented v1 limit (ADR-034): ${v.id} is accepted inside the tolerance only`
      : leak
        ? `declared leak (Q3): ${v.id}`
        : `rejects ${v.id}`;
    it(title, async () => {
      for (let seed = 1; seed <= TRIALS; seed++) {
        const o = await v.run(seed);
        expect(o.rejected, `seed ${seed}: ${o.mechanism}`).toBe(!limit && !leak);
        if (limit) expect(o.mechanism, `seed ${seed}`).toBe(BOUNDED_STALENESS);
        else expect(o.mechanism.startsWith("ACCEPTED"), `seed ${seed}: ${o.mechanism}`).toBe(false);
        if (!limit && !leak)
          expect(o.mechanism, `seed ${seed}: stopped by`).toMatch(STOPPED_BY[v.id] as RegExp);
        expect(o.mechanism).not.toMatch(/setup failed/);
      }
    });
  }

  it("is deterministic for a seed", async () => {
    for (const v of SAFETY_VARIANTS) expect(await v.run(17), v.id).toEqual(await v.run(17));
  });

  it("MUST NEVER accept tampered, forged, expired or cross-context Data: every claim holds [H3] [P-8.4] [P-8.6]", async () => {
    const { rows } = await runSafety({ experiment: "t", kind: "safety", seed: 100, trials: TRIALS });
    const idem = rows.filter((x) => x.expected !== "baseline");
    for (const r of idem.filter(
      (x) => x.attack === "tamper" || x.attack === "forge" || x.attack === "poison",
    )) {
      expect(r.accepted, r.variant).toBe(0);
    }
    for (const r of idem.filter((x) => x.attack === "private")) expect(r.accepted, r.variant).toBe(0);
    // Every claim: all variants expected to be rejected, with no exception.
    const claims = rows.filter((x) => x.expected === "rejected");
    expect(claims.length).toBe(IDEM_VARIANTS.length - DOCUMENTED_LIMITS.length - DECLARED_LEAKS.length);
    for (const r of claims) expect(r.accepted, r.variant).toBe(0);
    // The baseline rows: the same attacks are accepted by B5 in every trial, and say what they mirror.
    const baseline = rows.filter((x) => x.expected === "baseline");
    expect(baseline.map((r) => r.variant)).toEqual(BASELINE);
    for (const r of baseline) {
      expect(r.accepted, r.variant).toBe(r.trials);
      expect(r.mirrors, r.variant).not.toBe("");
    }
    for (const r of idem) expect(r.mirrors, r.variant).toBe("");
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
      ["replay/expired@upstream", 3, 3, 0],
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
