import { generateKeyPair, jcs, TrustStore, utf8 } from "@idem/core";
import { Name, Data as NdnData } from "@ndn/packet";
import { describe, expect, it } from "vitest";
import { encodeData, encodeInterest } from "./codec";
import { ndnSigner, producerSigner } from "./keys";
import { ndnUri, toNdnName } from "./name";
import { idemInterest, keyFrom, PRODUCER, setupProducer } from "./testkit.test-helpers";
import { verifyNdnData } from "./verify";

async function native() {
  const s = await setupProducer();
  const I = await idemInterest(s.producer, "fetch_page", { url: "https://corpus.idem.dev/doc/3" });
  const data = await s.producer.handleInterest(I);
  const ni = await encodeInterest(I);
  const pkt = await encodeData(data, ni.name, producerSigner(PRODUCER, s.key));
  return { ...s, I, data, ni, pkt };
}

describe("verifyNdnData", () => {
  it("MUST verify both the NDN and the IDEM signature before delivering [P-9.3]", async () => {
    const { pkt, trust, data } = await native();
    const v = await verifyNdnData(pkt, trust, { now: 0 });
    expect(v.ok).toBe(true);
    expect(v.outer).toEqual({ ok: true, keyLocator: data.signature.keyLocator });
    expect(v.inner.ok).toBe(true);
    expect(v.data?.name).toBe(data.name);
  });

  it("MUST reject tampered content: the NDN signature breaks [P-5.5] [P-9.3]", async () => {
    const { pkt, trust } = await native();
    const evil = new NdnData(pkt);
    evil.content = utf8(new TextDecoder().decode(pkt.content).replace("page ", "evil "));
    const v = await verifyNdnData(evil, trust, { now: 0 });
    expect(v.ok).toBe(false);
    expect(v.outer.ok).toBe(false);
    // The IDEM content digest catches it as well.
    expect(v.inner.ok).toBe(false);
  });

  it("MUST reject content re-signed by a key the producer does not list [P-5.2] [P-9.3]", async () => {
    const { pkt, trust, data } = await native();
    const attacker = await keyFrom(9);
    const evil = new NdnData(pkt.name, NdnData.FreshnessPeriod(pkt.freshnessPeriod), pkt.content);
    // Same KeyLocator as the producer's, different private key.
    await ndnSigner(attacker.privateKey, toNdnName(data.signature.keyLocator)).sign(evil);
    const v = await verifyNdnData(evil, trust, { now: 0 });
    expect(v.ok).toBe(false);
    expect(v.code).toBe("BAD_SIGNATURE");
    expect(v.outer.ok).toBe(false);
  });

  it("MUST reject a KeyLocator of another producer [P-5.2] [P-9.3]", async () => {
    const { pkt, trust } = await native();
    const other = await setupProducer({ producer: "evil.example", keyByte: 9 });
    await trust.addManifest(other.manifest, { now: 0 });
    const evil = new NdnData(pkt.name, NdnData.FreshnessPeriod(pkt.freshnessPeriod), pkt.content);
    await producerSigner("evil.example", other.key).sign(evil);
    const v = await verifyNdnData(evil, trust, { now: 0 });
    expect(v.ok).toBe(false);
    expect(v.code).toBe("UNTRUSTED_KEY");
    expect(v.outer.ok === false && v.outer.reason).toMatch(/another producer/);
  });

  it("MUST reject a Data whose producer key is not trusted [P-6.2]", async () => {
    const { pkt } = await native();
    const v = await verifyNdnData(pkt, new TrustStore(), { now: 0 });
    expect(v.ok).toBe(false);
    expect(v.code).toBe("UNTRUSTED_KEY");
  });

  it("accepts a translator's outer key only when asked, and still requires the producer's IDEM signature", async () => {
    const { pkt, trust, data } = await native();
    const translator = await generateKeyPair();
    const kl = new Name("/localhost/idem-translator/KEY/test");
    const re = new NdnData(pkt.name, NdnData.FreshnessPeriod(pkt.freshnessPeriod), pkt.content);
    await ndnSigner(translator.privateKey, kl).sign(re);
    expect((await verifyNdnData(re, trust, { now: 0 })).ok).toBe(false);
    const outerKey = { keyLocator: kl, publicKey: translator.publicKey };
    const ok = await verifyNdnData(re, trust, { now: 0, outerKey });
    expect(ok.ok).toBe(true);
    expect(ok.outer).toEqual({ ok: true, keyLocator: ndnUri(kl) });
    // The translator cannot change content: the inner IDEM signature is the producer's.
    const env = JSON.parse(new TextDecoder().decode(pkt.content)) as { content: { content: unknown[] } };
    env.content.content = [{ type: "text", text: "rewritten by the translator" }];
    const forged = new NdnData(
      pkt.name,
      NdnData.FreshnessPeriod(pkt.freshnessPeriod),
      utf8(jcs(env as never)),
    );
    await ndnSigner(translator.privateKey, kl).sign(forged);
    const bad = await verifyNdnData(forged, trust, { now: 0, outerKey });
    expect(bad.ok).toBe(false);
    expect(bad.outer.ok).toBe(true);
    expect(bad.inner).toMatchObject({ ok: false, code: "BAD_SIGNATURE" });
    expect(data.content.content).not.toEqual(env.content.content);
  });

  it("MUST refuse private Data even when correctly signed [P-8.3] [P-9.4]", async () => {
    // A misbehaving producer that signs private Data and puts it on NDN anyway.
    const s = await setupProducer();
    const I = await idemInterest(s.producer, "my_notes", {});
    const data = await s.producer.handleInterest(I, { auth: "alice" });
    expect(data.meta.scope).toBe("private");
    const ni = await encodeInterest(I);
    const pkt = new NdnData(
      ni.name,
      NdnData.FreshnessPeriod(0),
      utf8(jcs({ content: data.content, meta: data.meta, signature: data.signature } as never)),
    );
    await producerSigner(PRODUCER, s.key).sign(pkt);
    const v = await verifyNdnData(pkt, s.trust, { now: 0 });
    expect(v.outer.ok).toBe(true);
    expect(v.inner.ok).toBe(true);
    expect(v.ok).toBe(false);
    expect(v.code).toBe("NOT_CACHEABLE");
  });

  it("never throws on garbage", async () => {
    const { trust } = await native();
    const junk = new NdnData(toNdnName("/idem/v1/demo.idem.dev/x"), utf8("not json"));
    const v = await verifyNdnData(junk, trust);
    expect(v.ok).toBe(false);
  });
});
