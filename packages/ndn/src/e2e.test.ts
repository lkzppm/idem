// End to end over a real in-process NDN forwarder (@ndn/fw): Interest → Data and back.
// @ndn/fw has no Interest aggregation and no Content Store; those are NFD's in Mini-NDN (spec 05 E4).
import { jcs, keyPairFromSeed, TrustStore, utf8 } from "@idem/core";
import { consume } from "@ndn/endpoint";
import { Interest as NdnInterest } from "@ndn/packet";
import { afterEach, describe, expect, it } from "vitest";
import { decodeData, encodeInterest } from "./codec";
import { NdnConsumer } from "./consumer";
import { ndnUri, toNdnName } from "./name";
import { serveNdn } from "./producer";
import { calls, idemInterest, PRODUCER, setupNetwork, setupProducer } from "./testkit.test-helpers";

const URL3 = "https://corpus.idem.dev/doc/3";
let close: (() => void) | undefined;

afterEach(() => {
  close?.();
  close = undefined;
  for (const k of Object.keys(calls)) delete calls[k];
});

async function net() {
  const n = await setupNetwork();
  close = () => n.served.close();
  return n;
}

describe("native round trip", () => {
  it("fetches the manifest and tool list as named Data (TOFU [P-6.2])", async () => {
    const { consumer, manifest } = await net();
    const r = await consumer.init();
    expect(r.manifest).toEqual(manifest);
    expect(r.tools.map((t) => t.name)).toEqual(["fetch_page", "my_notes", "send_email"]);
    expect(consumer.trust.manifest(PRODUCER)?.version).toBe(manifest.version);
  });

  it("calls a public cacheable tool: one Interest, one verified Data", async () => {
    const { consumer } = await net();
    const out = await consumer.call("fetch_page", { url: URL3 });
    expect(out.error).toBeUndefined();
    expect(out.verify?.ok).toBe(true);
    expect(out.result.content[0]).toEqual({ type: "text", text: `page ${URL3}` });
    expect(out.ndnName.startsWith(`${out.name}/params-sha256=`)).toBe(true);
    expect(ndnUri(toNdnName(out.name))).toBe(out.name);
    expect(calls.fetch_page).toBe(1);
  });

  it("MUST name equivalent calls identically on the wire [P-2.1] [P-9.1]", async () => {
    const { consumer } = await net();
    const a = await consumer.call("fetch_page", { url: URL3 });
    const b = await consumer.call("fetch_page", { url: "https://CORPUS.idem.dev:443/doc/3#intro" });
    expect(b.name).toBe(a.name);
    expect(b.ndnName).toBe(a.ndnName);
  });

  it("MUST NOT send an Interest for a non-cacheable tool [P-4.2]", async () => {
    const { consumer } = await net();
    const out = await consumer.call("send_email", { to: "a@b.c" });
    expect(out.error?.code).toBe("NOT_CACHEABLE");
    expect(calls.send_email).toBeUndefined();
  });

  it("returns the producer's isError result with freshness 0 [P-5.3]", async () => {
    const { consumer } = await net();
    const out = await consumer.call("fetch_page", { url: "https://corpus.idem.dev/missing" });
    expect(out.verify?.ok).toBe(true);
    expect(out.result.isError).toBe(true);
    expect(out.data?.meta.freshnessMs).toBe(0);
  });

  it("answers results over MAX_PACKET_SIZE with UPSTREAM_ERROR (no segmentation)", async () => {
    const { consumer } = await net();
    const out = await consumer.call("fetch_page", { url: "https://corpus.idem.dev/huge" });
    expect(out.error?.code).toBe("UPSTREAM_ERROR");
    expect(out.data).toBeUndefined();
  });

  it("fails closed when the manifest key is not the pinned one [P-6.2]", async () => {
    const { fw } = await net();
    const trust = new TrustStore();
    await trust.pin(PRODUCER, (await keyPairFromSeed(new Uint8Array(32).fill(9))).publicKeyJwk);
    const consumer = new NdnConsumer({ producer: PRODUCER, fw, trust });
    await expect(consumer.init()).rejects.toThrow(/manifest rejected/);
  });
});

describe("producer checks on the native binding", () => {
  it("MUST reject forged ApplicationParameters with DIGEST_MISMATCH [P-4.3] [P-9.2]", async () => {
    const { producer, fw } = await net();
    const I = await idemInterest(producer, "fetch_page", { url: URL3 });
    const forged = new NdnInterest(toNdnName(I.name), utf8(jcs({ url: "https://evil.example/" })));
    await forged.updateParamsDigest();
    const answer = decodeData(await consume(forged, { fw }));
    expect(answer).toMatchObject({ kind: "nack", code: "DIGEST_MISMATCH" });
    expect(calls.fetch_page).toBeUndefined();
  });

  it("MUST recompute the name from the arguments [P-5.1]", async () => {
    // Non-canonical args whose own digest is in the name: passes [P-4.3], fails [P-5.1].
    const { producer, fw } = await net();
    const raw = { url: "https://CORPUS.idem.dev:443/doc/3" };
    const I = await idemInterest(producer, "fetch_page", raw);
    const parts = I.name.split("/");
    const { sha256b64u } = await import("@idem/core");
    parts[parts.length - 1] = await sha256b64u(jcs(raw));
    const sneaky = await encodeInterest({ ...I, name: parts.join("/"), args: raw });
    const answer = decodeData(await consume(sneaky, { fw }));
    expect(answer).toMatchObject({ kind: "nack", code: "DIGEST_MISMATCH" });
    expect(calls.fetch_page).toBeUndefined();
  });

  it("refuses to serve with a key the manifest does not list", async () => {
    const { producer } = await setupProducer();
    await expect(
      serveNdn({ producer, key: await keyPairFromSeed(new Uint8Array(32).fill(3)) }),
    ).rejects.toThrow(/BAD_POLICY/);
  });
});

describe("private never leaks on the native binding (golden rule 4)", () => {
  it("MUST NOT express a native Interest for a private tool [P-8.3] [P-9.4]", async () => {
    const { consumer } = await net();
    expect(await consumer.prepare("my_notes", {})).toBeUndefined();
    const out = await consumer.call("my_notes", {});
    expect(out.error?.code).toBe("NOT_CACHEABLE");
    expect(out.data).toBeUndefined();
    expect(calls.my_notes).toBeUndefined();
  });

  it("MUST NOT answer a private Interest with Data, nor run the tool [P-8.3] [P-9.4]", async () => {
    // A consumer that ignores the rule and sends the Interest anyway (e.g. a hand-made packet).
    const { producer, fw } = await net();
    const I = await idemInterest(producer, "my_notes", {});
    const answer = decodeData(await consume(await encodeInterest(I), { fw }));
    expect(answer).toMatchObject({ kind: "nack", code: "NOT_CACHEABLE" });
    expect(calls.my_notes).toBeUndefined();
    // Two users asking the same name get the same Nack, never anyone's notes.
    const again = decodeData(await consume(await encodeInterest({ ...I, nonce: "BBBBBBBBBBB" }), { fw }));
    expect(again.kind).toBe("nack");
    expect(JSON.stringify(again)).not.toContain("notes of");
  });
});
