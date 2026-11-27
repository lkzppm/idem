import { describe, expect, it } from "vitest";
import { acceptData } from "./accept";
import { generateKeyPair, signData } from "./crypto";
import { PRODUCER, setup } from "./testkit.test-helpers";
import type { Data } from "./types";

/** The shared consumer decision (`acceptData`): one function, used by every shipped consumer. */
describe("acceptData: the consumer's decision on a Data [P-5.5] [P-8.7]", () => {
  async function rig() {
    const s = await setup();
    const interest = await s.interest("fetch_page", { url: "https://example.com/a" });
    const at = 1_000_000;
    const make = (producedAt: number, extra: Partial<Data> = {}) =>
      signData(
        {
          name: interest.name,
          content: { content: [{ type: "text", text: "page" }] },
          producedAt,
          freshnessMs: 60_000,
          scope: "public",
          policyVersion: 1,
        },
        s.key,
      ).then((d) => ({ ...d, ...extra }));
    const decide = (d: Data, mustBeFresh = true, name = interest.name) =>
      acceptData(d, { trust: s.trust, now: at, name, mustBeFresh });
    return { s, interest, at, make, decide };
  }

  it("accepts genuine fresh Data for the name asked", async () => {
    const r = await rig();
    expect(await r.decide(await r.make(r.at - 1_000))).toMatchObject({
      ok: true,
      verify: { ok: true, producer: PRODUCER },
    });
  });

  it("MUST refuse Data for another name, a changed content and a foreign key, with distinct codes [P-5.5]", async () => {
    const r = await rig();
    const d = await r.make(r.at);
    const other = await r.s.interest("fetch_page", { url: "https://example.com/b" });
    expect(await r.decide(d, true, other.name)).toMatchObject({ ok: false, code: "BAD_SIGNATURE" });
    const changed = { ...d, content: { content: [{ type: "text" as const, text: "evil" }] } };
    expect(await r.decide(changed)).toMatchObject({ ok: false, code: "BAD_SIGNATURE" });
    const rogue = await signData(
      {
        name: r.interest.name,
        content: d.content,
        producedAt: r.at,
        freshnessMs: 60_000,
        scope: "public",
        policyVersion: 1,
      },
      await generateKeyPair(),
    );
    expect(await r.decide(rogue)).toMatchObject({ ok: false, code: "UNTRUSTED_KEY" });
  });

  it("MUST refuse verified Data outside its signed lifetime when fresh Data was asked; EXPIRED, verify.ok [P-8.7]", async () => {
    const r = await rig();
    for (const producedAt of [r.at - 120_000, r.at + 61_000]) {
      const v = await r.decide(await r.make(producedAt));
      expect(v).toMatchObject({ ok: false, code: "EXPIRED", verify: { ok: true } });
      expect((await r.decide(await r.make(producedAt), false)).ok).toBe(true); // mustBeFresh: false
    }
    // Inside the tolerance: the bounded-staleness limit, accepted.
    expect((await r.decide(await r.make(r.at - 100_000))).ok).toBe(true);
  });

  it("MUST refuse Data stale by its ageMs when fresh Data was asked; none without ageMs [P-8.7] [P-8.1]", async () => {
    const r = await rig();
    const stale = await r.make(r.at - 10_000, { ageMs: 60_000 });
    const v = await r.decide(stale);
    expect(v).toMatchObject({ ok: false, code: "EXPIRED", verify: { ok: true } });
    expect(v.ok || v.reason).toMatch(/stale by its age/);
    expect((await r.decide(stale, false)).ok).toBe(true);
    expect((await r.decide(await r.make(r.at - 10_000, { ageMs: 59_999 }))).ok).toBe(true);
    expect((await r.decide(await r.make(r.at - 10_000))).ok).toBe(true);
  });
});
