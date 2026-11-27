// End to end over a real in-process NDN forwarder (@ndn/fw): Interest → Data and back.
// @ndn/fw has no Interest aggregation and no Content Store; those are NFD's in Mini-NDN (spec 05 E4).
import { jcs, keyPairFromSeed, Producer, signData, TrustStore, utf8, VirtualClock } from "@idem/core";
import { consume, produce } from "@ndn/endpoint";
import { Forwarder, FwPacket } from "@ndn/fw";
import { Name, Data as NdnData, Interest as NdnInterest } from "@ndn/packet";
import { afterEach, describe, expect, it } from "vitest";
import { decodeData, encodeData, encodeInterest } from "./codec";
import { NdnConsumer } from "./consumer";
import { producerSigner } from "./keys";
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

describe("consumer verdicts on forged native Data [P-9.3]", () => {
  // A rogue producer on a longer prefix answers first (longest-prefix match), as on NFD.
  async function forge(scope: "public" | "private", keyByte: number) {
    const { producer, fw, consumer, key } = await net();
    await consumer.init();
    const I = await idemInterest(producer, "fetch_page", { url: URL3 });
    const signer = keyByte === 7 ? key : await keyPairFromSeed(new Uint8Array(32).fill(keyByte));
    const forged = await signData(
      {
        name: I.name,
        content: { content: [{ type: "text", text: "forged" }] },
        producedAt: 0,
        freshnessMs: 60_000,
        scope,
        policyVersion: 1,
      },
      signer,
    );
    const sign = producerSigner(PRODUCER, signer);
    const rogue = produce(
      toNdnName(I.name),
      async (i) => {
        if (scope === "public") return encodeData(forged, i.name, sign);
        // encodeData refuses private Data [P-9.4]: build the packet by hand, as a rogue would.
        const pkt = new NdnData(
          i.name,
          NdnData.FreshnessPeriod(60_000),
          utf8(jcs({ content: forged.content, meta: forged.meta, signature: forged.signature })),
        );
        await sign.sign(pkt);
        return pkt;
      },
      { fw },
    );
    const closeNet = close;
    close = () => {
      rogue.close();
      closeNet?.();
    };
    return consumer.call("fetch_page", { url: URL3 });
  }

  it("MUST fail closed with UNTRUSTED_KEY when a key is not the producer's trusted key [P-9.3]", async () => {
    const out = await forge("public", 9);
    expect(out.error?.code).toBe("UNTRUSTED_KEY");
    expect(out.verify?.code).toBe("UNTRUSTED_KEY");
    expect(out.data).toBeUndefined();
    expect(out.result.isError).toBe(true);
    expect(calls.fetch_page).toBeUndefined();
  });

  it("MUST reject validly signed private Data with NOT_CACHEABLE [P-9.4]", async () => {
    const out = await forge("private", 7);
    expect(out.verify?.outer.ok).toBe(true);
    expect(out.verify?.inner.ok).toBe(true);
    expect(out.error?.code).toBe("NOT_CACHEABLE");
    expect(out.data).toBeUndefined();
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

describe("retransmission on the native binding", () => {
  /** A producer whose first `slow` call outlives the consumer's InterestLifetime. */
  async function slowNet() {
    let runs = 0;
    const key = await keyPairFromSeed(new Uint8Array(32).fill(5));
    const producer = new Producer({
      producer: PRODUCER,
      key,
      tools: [
        {
          name: "slow",
          inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
          annotations: { readOnlyHint: true },
          policy: { cacheable: true, ttlMs: 60_000, scope: "public" },
          handler: async (args) => {
            runs++;
            if (runs === 1) await new Promise((r) => setTimeout(r, 400));
            return { content: [{ type: "text", text: `answer ${(args as { q: string }).q}` }] };
          },
        },
      ],
    });
    const fw = Forwarder.create();
    const served = await serveNdn({ producer, key, fw });
    close = () => served.close();
    const nonces: number[] = [];
    fw.addEventListener("pktrx", (e) => {
      const l3 = e.packet.l3;
      if (l3 instanceof NdnInterest && l3.appParameters) nonces.push(l3.nonce ?? -1);
    });
    return { fw, nonces, runs: () => runs };
  }

  it("sends a timed-out Interest again with a fresh Nonce and the same name", async () => {
    const { fw, nonces, runs } = await slowNet();
    const consumer = new NdnConsumer({ producer: PRODUCER, fw, interestLifetimeMs: 200, retransmissions: 2 });
    const out = await consumer.call("slow", { q: "x" });
    expect(out.error).toBeUndefined();
    expect(out.verify?.ok).toBe(true);
    expect(out.attempts).toBe(2);
    expect(out.verifyMs).toBeGreaterThan(0);
    expect(runs()).toBe(2);
    expect(nonces).toHaveLength(2);
    expect(nonces[0]).not.toBe(nonces[1]);
  });

  it("fails with TIMEOUT after the last attempt, and sends one Interest by default", async () => {
    const { fw, nonces } = await slowNet();
    const consumer = new NdnConsumer({ producer: PRODUCER, fw, interestLifetimeMs: 200 });
    const out = await consumer.call("slow", { q: "y" });
    expect(out.error?.code).toBe("TIMEOUT");
    expect(out.attempts).toBe(1);
    expect(out.data).toBeUndefined();
    expect(nonces).toHaveLength(1);
  });
});

describe("handshake over a lossy path", () => {
  /** Two forwarders joined by a link that drops the first `drop` Interests from a to b. */
  function lossyLink(a: Forwarder, b: Forwarder, drop: number, prefix: string) {
    const pipe = () => {
      const q: FwPacket[] = [];
      let wake: (() => void) | undefined;
      let open = true;
      return {
        push(p: FwPacket) {
          q.push(p);
          wake?.();
        },
        close() {
          open = false;
          wake?.();
        },
        async *rx() {
          while (open) {
            const p = q.shift();
            if (p) yield p;
            else await new Promise<void>((r) => (wake = r));
          }
        },
      };
    };
    const toB = pipe();
    const toA = pipe();
    let dropped = 0;
    const fa = a.addFace({
      rx: toA.rx(),
      async tx(it) {
        for await (const p of it) {
          if (p.l3 instanceof NdnInterest && dropped < drop) {
            dropped++;
            continue;
          }
          toB.push(FwPacket.create(p.l3));
        }
      },
    });
    const fb = b.addFace({
      rx: toB.rx(),
      async tx(it) {
        for await (const p of it) toA.push(FwPacket.create(p.l3));
      },
    });
    fa.addRoute(new Name(prefix));
    return {
      dropped: () => dropped,
      close() {
        toA.close();
        toB.close();
        fa.close();
        fb.close();
      },
    };
  }

  it("retransmits a lost manifest Interest instead of failing init", async () => {
    const { producer, key } = await setupProducer();
    const far = Forwarder.create();
    const served = await serveNdn({ producer, key, fw: far });
    const near = Forwarder.create();
    const link = lossyLink(near, far, 1, ndnUri(toNdnName(`/idem/v1/${PRODUCER}`)));
    close = () => {
      link.close();
      served.close();
    };
    const lossy = new NdnConsumer({ producer: PRODUCER, fw: near, lifetimeMs: 200, retransmissions: 2 });
    const r = await lossy.init();
    expect(r.tools.length).toBeGreaterThan(0);
    expect(link.dropped()).toBe(1);
  });
});

describe("signed lifetime on the native binding", () => {
  it("MUST fail closed with EXPIRED on a verified Data outside its lifetime: no plain call on NDN [P-8.7]", async () => {
    const n = await setupNetwork();
    close = () => n.served.close();
    // The consumer's clock reads 10 min after the producer's: Data made "now" is expired here.
    const ahead = new NdnConsumer({ producer: PRODUCER, fw: n.fw, clock: new VirtualClock(10 * 60_000) });
    const out = await ahead.call("fetch_page", { url: "https://ex.com/life" });
    expect(out.verify?.ok).toBe(true);
    expect(out.error?.code).toBe("EXPIRED");
    expect(out.error?.message).toMatch(/past its signed lifetime/);
    expect(out.data).toBeUndefined();
    expect(out.result.isError).toBe(true);
  });

  it("MUST fail closed with EXPIRED on Data dated beyond the tolerance in its future [P-8.6] [P-8.7]", async () => {
    const n = await setupNetwork();
    close = () => n.served.close();
    await n.clock.runUntil(10 * 60_000); // the producer's clock moves on; this consumer's stays at 0
    const behind = new NdnConsumer({ producer: PRODUCER, fw: n.fw, clock: new VirtualClock(0) });
    const out = await behind.call("fetch_page", { url: "https://ex.com/future" });
    expect(out.error?.code).toBe("EXPIRED");
    expect(out.error?.message).toMatch(/future/);
  });
});
