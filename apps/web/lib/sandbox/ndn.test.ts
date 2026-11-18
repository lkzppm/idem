import {
  buildInterest,
  cacheablePolicy,
  type Data,
  type JsonValue,
  keyPairFromSeed,
  Producer,
  type ProducerTool,
  TrustStore,
} from "@idem/core";
import type { TlvNode } from "@idem/ndn";
import { describe, expect, it } from "vitest";
import { hexLines, makeTranslator, ndnExchange, tlvRange } from "./ndn";

const tools: ProducerTool[] = [
  {
    name: "fetch_page",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    policy: { cacheable: true, ttlMs: 300_000, scope: "public", normalizers: { "/url": ["url:sortQuery"] } },
    handler: (args) => ({ content: [{ type: "text", text: `page ${(args as { url: string }).url}` }] }),
  },
  {
    name: "my_notes",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    policy: { cacheable: true, ttlMs: 60_000, scope: "private" },
    handler: (_a, ctx) => ({ content: [{ type: "text", text: `notes of ${ctx.auth ?? "?"}` }] }),
  },
];

/** What Live mode holds for a call: the name, canonical args, the overlay Data and the client's trust. */
async function row(tool: string, args: unknown, auth?: string) {
  const key = await keyPairFromSeed(new Uint8Array(32).fill(5));
  const producer = new Producer({ producer: "demo.idem.dev", key, tools });
  const manifest = await producer.manifest();
  const trust = new TrustStore();
  await trust.addManifest(manifest);
  const info = producer.toolList().find((t) => t.name === tool);
  const c = info && (await cacheablePolicy(manifest, info));
  if (!c) throw new Error(tool);
  const { interest } = await buildInterest({
    producer: "demo.idem.dev",
    identity: c.identity,
    policy: c.policy,
    args,
  });
  const data = await producer.handleInterest(interest, auth ? { auth } : {});
  return { name: interest.name, canonical: interest.args as JsonValue, nonce: interest.nonce, data, trust };
}

function find(nodes: TlvNode[], type: number): TlvNode | undefined {
  for (const n of nodes) {
    if (n.type === type) return n;
    const inner = n.children && find(n.children, type);
    if (inner) return inner;
  }
  return undefined;
}

describe("ndnExchange", () => {
  it("builds the native Interest and Data and verifies both signatures from the wire", async () => {
    const r = await row("fetch_page", { url: "https://corpus.idem.dev/doc/3" });
    const v = await ndnExchange({
      interest: { name: r.name, args: r.canonical },
      data: r.data,
      trust: r.trust,
      translator: await makeTranslator(),
    });
    expect(v.unavailable).toBeUndefined();
    expect(v.interest?.tree[0]?.typeName).toBe("Interest");
    expect(v.data?.tree[0]?.typeName).toBe("Data");
    // Name: six GenericNameComponents + the ParametersSha256DigestComponent (ADR-026).
    const name = find(v.interest?.tree ?? [], 7);
    expect(name?.children?.map((c) => c.type)).toEqual([8, 8, 8, 8, 8, 8, 2]);
    expect(name?.children?.[3]?.preview).toBe("fetch_page");
    expect(find(v.interest?.tree ?? [], 36)?.preview).toBe('{"url":"https://corpus.idem.dev/doc/3"}');
    expect(v.data?.name).toBe(v.interest?.name);
    expect(find(v.data?.tree ?? [], 25)?.preview).toBe("300000 ms");
    expect(find(v.data?.tree ?? [], 27)?.preview).toBe("5 (SignatureEd25519)");
    expect(find(v.data?.tree ?? [], 21)?.preview?.startsWith('{"content":')).toBe(true);
    expect(v.data?.hex.length).toBe((v.data?.wire.length ?? 0) * 2);
    expect(v.verify?.ok).toBe(true);
    expect(v.verify?.outer.ok).toBe(true);
    expect(v.verify?.inner.ok).toBe(true);
    expect(v.translatorKeyLocator?.startsWith("/localhost/idem-sandbox/KEY/")).toBe(true);
    expect(v.interest?.overlayBytes).toBeGreaterThan(0);
  });

  it("gives equivalent calls the same native name (Q1, ADR-026) [P-2.1] [P-9.1]", async () => {
    const a = await row("fetch_page", { url: "https://corpus.idem.dev/doc/3" });
    const b = await row("fetch_page", { url: "https://CORPUS.idem.dev:443/doc/3#intro" });
    const [va, vb] = await Promise.all([
      ndnExchange({ interest: { name: a.name, args: a.canonical, nonce: "AAAAAAAAAAA" } }),
      ndnExchange({ interest: { name: b.name, args: b.canonical, nonce: "AAAAAAAAAAA" } }),
    ]);
    expect(vb.interest?.name).toBe(va.interest?.name);
    // Same nonce → the very same Interest bytes.
    expect(vb.interest?.hex).toBe(va.interest?.hex);
  });

  it("MUST NOT encode a private exchange at all: private never leaks [P-8.3] [P-9.4]", async () => {
    const r = await row("my_notes", {}, "alice");
    const v = await ndnExchange({
      interest: { name: r.name, args: r.canonical },
      data: r.data,
      trust: r.trust,
    });
    expect(v.unavailable?.reason).toBe("private");
    expect(v.interest).toBeUndefined();
    expect(v.data).toBeUndefined();
    // Known private from the manifest even before the Data arrives.
    const early = await ndnExchange({ interest: { name: r.name, args: r.canonical }, trust: r.trust });
    expect(early.unavailable?.reason).toBe("private");
    expect(early.interest).toBeUndefined();
  });

  it("shows a tampered overlay Data failing the producer's IDEM signature, not the translator's", async () => {
    const r = await row("fetch_page", { url: "https://corpus.idem.dev/doc/3" });
    const evil: Data = { ...r.data, content: { content: [{ type: "text", text: "evil" }] } };
    const v = await ndnExchange({
      interest: { name: r.name, args: r.canonical },
      data: evil,
      trust: r.trust,
    });
    expect(v.verify?.outer.ok).toBe(true);
    expect(v.verify?.inner.ok).toBe(false);
    expect(v.verify?.ok).toBe(false);
  });

  it("reports plain calls and broken input instead of throwing", async () => {
    expect((await ndnExchange({})).unavailable?.reason).toBe("plain");
    const r = await row("fetch_page", { url: "https://corpus.idem.dev/doc/3" });
    const bad = await ndnExchange({ interest: { name: r.name, args: { url: "https://evil.example/" } } });
    expect(bad.unavailable?.reason).toBe("error");
    expect(bad.unavailable?.message).toMatch(/DIGEST_MISMATCH/);
  });

  it("omits verification without a trust store", async () => {
    const r = await row("fetch_page", { url: "https://corpus.idem.dev/doc/3" });
    const v = await ndnExchange({ interest: { name: r.name, args: r.canonical }, data: r.data });
    expect(v.data).toBeDefined();
    expect(v.verify).toBeUndefined();
  });
});

describe("hex helpers", () => {
  it("splits hex into offset lines and maps TLV nodes to byte ranges", () => {
    const lines = hexLines("00010203040506070809", 4);
    expect(lines).toEqual([
      { offset: 0, bytes: ["00", "01", "02", "03"] },
      { offset: 4, bytes: ["04", "05", "06", "07"] },
      { offset: 8, bytes: ["08", "09"] },
    ]);
    expect(tlvRange({ type: 7, offset: 2, headerLength: 2, length: 5 })).toEqual([2, 9]);
  });
});
