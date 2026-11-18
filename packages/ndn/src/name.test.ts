import { makeName, parseName, utf8 } from "@idem/core";
import { Component, Name, ParamsDigest, TT } from "@ndn/packet";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { encodeInterest } from "./codec";
import { fromNdnName, hasParamsDigest, toNdnName } from "./name";
import { idemInterest, setupProducer } from "./testkit.test-helpers";

describe("IDEM name ⇄ NDN name", () => {
  it("maps each part to one GenericNameComponent and back", async () => {
    const { producer } = await setupProducer();
    const I = await idemInterest(producer, "fetch_page", { url: "https://corpus.idem.dev/doc/3" });
    const n = toNdnName(I.name);
    expect(n.length).toBe(6);
    expect(n.comps.every((c) => c.type === TT.GenericNameComponent)).toBe(true);
    expect(new TextDecoder().decode(n.at(2).value)).toBe("demo.idem.dev");
    expect(fromNdnName(n)).toBe(I.name);
  });

  it("maps key locators (reserved names [P-2.4]) too", () => {
    const loc = "/idem/v1/demo.idem.dev/_key/abcdEFGH12345678";
    expect(fromNdnName(toNdnName(loc))).toBe(loc);
  });

  it("strips NDN's trailing digest component when recovering the IDEM name", async () => {
    const { producer } = await setupProducer();
    const I = await idemInterest(producer, "fetch_page", { url: "https://corpus.idem.dev/doc/1" });
    const wire = await encodeInterest(I);
    expect(hasParamsDigest(wire.name)).toBe(true);
    expect(fromNdnName(wire.name)).toBe(I.name);
  });

  it("rejects names that are not IDEM names", () => {
    expect(() => toNdnName("/ndn/edu/ufrj")).toThrow(/BAD_NAME/);
    expect(() => toNdnName("/idem/v1//x")).toThrow(/BAD_NAME/);
    expect(() => fromNdnName(new Name("/ndn/edu"))).toThrow(/BAD_NAME/);
    const binary = new Name([
      new Component(TT.GenericNameComponent, utf8("idem")),
      new Component(TT.GenericNameComponent, utf8("v1")),
      new Component(TT.GenericNameComponent, new Uint8Array([0xff, 0xfe])),
    ]);
    expect(() => fromNdnName(binary)).toThrow(/BAD_NAME/);
    const typed = new Name("/idem/v1/demo.idem.dev").append(new Component(32, "x"));
    expect(() => fromNdnName(typed)).toThrow(/BAD_NAME/);
  });

  it("round-trips any well-formed tool-call name", async () => {
    const digest = fc.stringMatching(/^[A-Za-z0-9_-]{43}$/);
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[a-z][a-z0-9_]{0,15}$/),
        fc.stringMatching(/^[A-Za-z0-9_-]{22}$/),
        digest,
        async (tool, schemaDigest, argsDigest) => {
          const name = `/idem/v1/demo.idem.dev/${tool}/${schemaDigest}/${argsDigest}`;
          expect(parseName(name).tool).toBe(tool);
          expect(fromNdnName(toNdnName(name))).toBe(name);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// Q1 resolved by ADR-026: args-digest stays an explicit component; NDN appends its
// ParametersSha256DigestComponent over AppParameters = JCS(canonical args).
describe("Q1: args-digest and ParametersSha256Digest (ADR-026)", () => {
  it("MUST give two equivalent calls identical names in both bindings [P-2.1] [P-9.1]", async () => {
    const { producer } = await setupProducer();
    const a = await idemInterest(producer, "fetch_page", { url: "https://corpus.idem.dev/doc/3?b=2&a=1" });
    const b = await idemInterest(
      producer,
      "fetch_page",
      { url: "https://CORPUS.idem.dev:443/doc/3?a=1&b=2#intro" },
      { nonce: "zzzzzzzzzzz", lifetimeMs: 2_000, hopLimit: 3, mustBeFresh: false },
    );
    // Overlay: the same IDEM name.
    expect(b.name).toBe(a.name);
    // Native: the same NDN name, whatever the nonce, lifetime, hop limit or freshness flag.
    const [na, nb] = await Promise.all([encodeInterest(a), encodeInterest(b)]);
    expect(nb.name.toString()).toBe(na.name.toString());
    // The NDN name is the IDEM name plus exactly one ParametersSha256DigestComponent.
    expect(na.name.getPrefix(-1).equals(toNdnName(a.name))).toBe(true);
    expect(ParamsDigest.match(na.name.at(-1))).toBe(true);
    expect(fromNdnName(na.name)).toBe(a.name);
  });

  it("MUST give different calls different names in both bindings [P-2.1] [P-9.1]", async () => {
    const { producer } = await setupProducer();
    const a = await idemInterest(producer, "fetch_page", { url: "https://corpus.idem.dev/doc/3" });
    const c = await idemInterest(producer, "fetch_page", { url: "https://corpus.idem.dev/doc/4" });
    expect(c.name).not.toBe(a.name);
    const [na, nc] = await Promise.all([encodeInterest(a), encodeInterest(c)]);
    expect(nc.name.toString()).not.toBe(na.name.toString());
    expect(nc.name.at(-1).equals(na.name.at(-1))).toBe(false);
  });

  it("keeps the args in the native name only as digests [P-2.3]", async () => {
    const { producer } = await setupProducer();
    const I = await idemInterest(producer, "fetch_page", { url: "https://corpus.idem.dev/doc/3" });
    const n = await encodeInterest(I);
    expect(n.name.toString()).not.toContain("corpus");
    // The IDEM name the overlay computes from the same JCS bytes is the native name's prefix.
    const again = await makeName({
      producer: producer.producer,
      tool: producer.identity("fetch_page"),
      args: { jcs: new TextDecoder().decode(n.appParameters) },
    });
    expect(again).toBe(I.name);
  });
});
