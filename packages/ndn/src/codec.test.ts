import { jcs, sha256b64u, utf8, verifyData } from "@idem/core";
import { Name, Interest as NdnInterest, ParamsDigest, SigType } from "@ndn/packet";
import { describe, expect, it } from "vitest";
import {
  CONTENT_TYPE,
  dataFromWire,
  decodeData,
  decodeInterest,
  encodeData,
  encodeInterest,
  encodeNack,
  interestFromWire,
  MAX_PACKET_SIZE,
  ndnNonce,
  toWire,
} from "./codec";
import { producerSigner } from "./keys";
import { toNdnName } from "./name";
import { idemInterest, PRODUCER, setupProducer } from "./testkit.test-helpers";

const URL3 = { url: "https://corpus.idem.dev/doc/3" };

describe("Interest codec", () => {
  it("MUST send unsigned Interests whose AppParameters are JCS(canonical args) [P-9.1]", async () => {
    const { producer } = await setupProducer();
    const I = await idemInterest(producer, "fetch_page", URL3, { lifetimeMs: 2_500, hopLimit: 5 });
    const n = await encodeInterest(I);
    expect(n.mustBeFresh).toBe(true);
    expect(n.canBePrefix).toBe(false);
    expect(n.lifetime).toBe(2_500);
    expect(n.hopLimit).toBe(5);
    expect(n.nonce).toBe(ndnNonce(I.nonce));
    expect(n.sigInfo).toBeUndefined();
    // AppParameters are exactly the bytes args-digest hashes.
    expect(new TextDecoder().decode(n.appParameters)).toBe(jcs(I.args));
  });

  it("never encodes authContext [P-8.4]", async () => {
    const { producer } = await setupProducer();
    const I = await idemInterest(producer, "fetch_page", URL3, { authContext: "SECRET-CONTEXT-1234567" });
    const wire = toWire(await encodeInterest(I));
    expect(new TextDecoder().decode(wire)).not.toContain("SECRET-CONTEXT");
    expect((await decodeInterest(interestFromWire(wire))).authContext).toBeUndefined();
  });

  it("round-trips through the wire", async () => {
    const { producer } = await setupProducer();
    const I = await idemInterest(producer, "fetch_page", URL3);
    const back = await decodeInterest(interestFromWire(toWire(await encodeInterest(I))));
    expect(back.name).toBe(I.name);
    expect(back.args).toEqual(I.args);
    expect(back.mustBeFresh).toBe(true);
    expect(back.lifetimeMs).toBe(I.lifetimeMs);
    expect(back.hopLimit).toBe(I.hopLimit);
  });

  it("MUST refuse to encode arguments that do not match args-digest [P-4.3]", async () => {
    const { producer } = await setupProducer();
    const I = await idemInterest(producer, "fetch_page", URL3);
    await expect(encodeInterest({ ...I, args: { url: "https://evil.example/" } })).rejects.toThrow(
      /DIGEST_MISMATCH/,
    );
  });

  it("MUST reject AppParameters that do not match args-digest [P-4.3] [P-9.2]", async () => {
    const { producer } = await setupProducer();
    const I = await idemInterest(producer, "fetch_page", URL3);
    // A well-formed NDN Interest (correct ParametersSha256Digest) whose parameters are other args.
    const forged = new NdnInterest(toNdnName(I.name), utf8(jcs({ url: "https://evil.example/" })));
    await forged.updateParamsDigest();
    await expect(decodeInterest(forged)).rejects.toThrow(/DIGEST_MISMATCH/);
  });

  it("rejects a wrong ParametersSha256DigestComponent", async () => {
    const { producer } = await setupProducer();
    const I = await idemInterest(producer, "fetch_page", URL3);
    const good = await encodeInterest(I);
    const bad = new NdnInterest(good);
    bad.name = good.name.replaceAt(-1, ParamsDigest.create(new Uint8Array(32)));
    await expect(decodeInterest(bad)).rejects.toThrow(/DIGEST_MISMATCH/);
  });

  it("MUST refuse Interests without parameters and signed Interests [P-9.1]", async () => {
    const { producer, key } = await setupProducer();
    const I = await idemInterest(producer, "fetch_page", URL3);
    await expect(decodeInterest(new NdnInterest(toNdnName(I.name)))).rejects.toThrow(/NOT_CACHEABLE/);
    const signed = await encodeInterest(I);
    await producerSigner(PRODUCER, key).sign(signed);
    expect(signed.sigInfo?.type).toBe(SigType.Ed25519);
    await expect(decodeInterest(signed)).rejects.toThrow(/NOT_CACHEABLE/);
  });
});

describe("Data codec", () => {
  async function signed(args: unknown = URL3) {
    const s = await setupProducer();
    const I = await idemInterest(s.producer, "fetch_page", args);
    const data = await s.producer.handleInterest(I);
    const ni = await encodeInterest(I);
    return { ...s, I, data, ni, signer: producerSigner(PRODUCER, s.key) };
  }

  it("carries name, freshness and the JCS envelope (ADR-004, ADR-026)", async () => {
    const { data, ni, signer } = await signed();
    const pkt = await encodeData(data, ni.name, signer);
    expect(pkt.name.equals(ni.name)).toBe(true);
    expect(pkt.freshnessPeriod).toBe(data.meta.freshnessMs);
    expect(pkt.contentType).toBe(CONTENT_TYPE.blob);
    expect(new TextDecoder().decode(pkt.content)).toBe(
      jcs({ content: data.content, meta: data.meta, signature: data.signature } as never),
    );
    expect(pkt.sigInfo.type).toBe(SigType.Ed25519);
    expect(pkt.sigInfo.keyLocator?.name?.equals(toNdnName(data.signature.keyLocator))).toBe(true);
    expect(await pkt.canSatisfy(ni)).toBe(true);
  });

  it("decodes back into a Data that @idem/core verifies unchanged [P-5.5]", async () => {
    const { data, ni, signer, trust } = await signed();
    const wire = toWire(await encodeData(data, ni.name, signer));
    expect(wire.length).toBeLessThanOrEqual(MAX_PACKET_SIZE);
    const back = decodeData(dataFromWire(wire));
    if (back.kind !== "data") throw new Error("expected data");
    expect(back.data).toEqual(data);
    expect((await verifyData(back.data, trust, { now: 0 })).ok).toBe(true);
  });

  it("MUST carry freshness 0 for isError results [P-5.3]", async () => {
    const { data, ni, signer } = await signed({ url: "https://corpus.idem.dev/missing" });
    expect(data.content.isError).toBe(true);
    expect((await encodeData(data, ni.name, signer)).freshnessPeriod).toBe(0);
  });

  it("MUST NOT encode private Data: private never leaves the overlay [P-8.3] [P-9.4]", async () => {
    const { data, ni, signer } = await signed();
    const priv = { ...data, meta: { ...data.meta, scope: "private" as const } };
    await expect(encodeData(priv, ni.name, signer)).rejects.toThrow(/NOT_CACHEABLE/);
  });

  it("refuses a Data for another Interest name", async () => {
    const { data, ni, signer } = await signed();
    await expect(encodeData(data, ni.name.getPrefix(-1), signer)).rejects.toThrow(/DIGEST_MISMATCH/);
    const other = await encodeInterest({ ...(await signed({ url: "https://corpus.idem.dev/doc/9" })).I });
    await expect(encodeData(data, other.name, signer)).rejects.toThrow(/DIGEST_MISMATCH/);
  });

  it("refuses packets over MAX_PACKET_SIZE (no segmentation, ADR-026)", async () => {
    const { data, ni, signer } = await signed({ url: "https://corpus.idem.dev/huge" });
    await expect(encodeData(data, ni.name, signer)).rejects.toThrow(/BAD_ENCODING/);
  });

  it("encodes application Nacks with ContentType NACK and freshness 0 [P-7.2]", async () => {
    const { ni, signer } = await signed();
    const pkt = await encodeNack(ni.name, "DIGEST_MISMATCH", "nope", signer);
    expect(pkt.contentType).toBe(CONTENT_TYPE.nack);
    expect(pkt.freshnessPeriod).toBe(0);
    expect(decodeData(dataFromWire(toWire(pkt)))).toEqual({
      kind: "nack",
      name: (await signed()).I.name,
      code: "DIGEST_MISMATCH",
      message: "nope",
    });
  });

  it("rejects content that is not an IDEM envelope", async () => {
    const { ni, signer, data } = await signed();
    const pkt = await encodeData(data, ni.name, signer);
    pkt.content = utf8("{}");
    expect(() => decodeData(pkt)).toThrow(/BAD_ENCODING/);
    pkt.content = new Uint8Array([0xff]);
    expect(() => decodeData(pkt)).toThrow(/BAD_ENCODING/);
    expect(() => decodeData({ ...pkt, name: new Name("/x") } as never)).toThrow(/BAD_NAME/);
  });

  it("hashes AppParameters bytes exactly as args-digest does", async () => {
    const { I, ni } = await signed();
    expect(await sha256b64u(new TextDecoder().decode(ni.appParameters))).toBe(I.name.split("/").at(-1));
  });
});
