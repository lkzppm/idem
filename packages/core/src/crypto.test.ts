import { describe, expect, it } from "vitest";
import { canonicalizeArgs } from "./canonical";
import {
  dataSignedBytes,
  deriveAuthContext,
  exportPrivateKeyJwk,
  generateKeyPair,
  importKeyPair,
  keyPairFromSeed,
  signData,
  signManifest,
  verifyData,
} from "./crypto";
import { makeName } from "./name";
import { attachData, dataFromToolResult, Producer } from "./producer";
import { PRODUCER, TOOLS } from "./testkit.test-helpers";
import { TrustStore } from "./trust";
import type { Data, Manifest, ToolIdentity } from "./types";

const tool: ToolIdentity = { name: "echo", inputSchema: { type: "object" }, policyVersion: 1 };

async function fixture(seed = 1) {
  const key = await keyPairFromSeed(new Uint8Array(32).fill(seed));
  const producer = new Producer({ producer: PRODUCER, key, tools: TOOLS });
  const manifest = await producer.manifest();
  const trust = new TrustStore();
  expect((await trust.addManifest(manifest)).ok).toBe(true);
  const args = await canonicalizeArgs({ q: 1 }, tool, { normalizers: {} });
  const name = await makeName({ producer: PRODUCER, tool, args });
  const data = await signData(
    {
      name,
      content: { content: [{ type: "text", text: "hi" }] },
      producedAt: 1,
      freshnessMs: 1000,
      scope: "public",
      policyVersion: 1,
    },
    key,
  );
  return { key, producer, manifest, trust, name, data };
}

describe("keys", () => {
  it("derives deterministic keys from a seed and round-trips JWKs", async () => {
    const a = await keyPairFromSeed(new Uint8Array(32).fill(3));
    const b = await keyPairFromSeed(new Uint8Array(32).fill(3));
    expect(a.keyId).toBe(b.keyId);
    expect(a.keyId).toHaveLength(16);
    const c = await importKeyPair(await exportPrivateKeyJwk(a));
    expect(c.keyId).toBe(a.keyId);
    const fresh = await generateKeyPair();
    expect(fresh.keyId).not.toBe(a.keyId);
  });
});

describe("Data signatures (protocol §5)", () => {
  it("MUST sign exactly JCS({ name, ...meta }) [P-5.2]", async () => {
    const { data } = await fixture();
    expect(dataSignedBytes(data.name, data.meta)).toBe(
      JSON.stringify({
        contentDigest: data.meta.contentDigest,
        freshnessMs: 1000,
        name: data.name,
        policyVersion: 1,
        producedAt: 1,
        scope: "public",
      }),
    );
    expect(data.signature.keyLocator).toMatch(/^\/idem\/v1\/demo\.idem\.dev\/_key\/[A-Za-z0-9_-]{16}$/);
  });

  it("MUST verify signature and contentDigest before use [P-5.5]", async () => {
    const { data, trust } = await fixture();
    expect(await verifyData(data, trust)).toMatchObject({ ok: true, producer: PRODUCER });

    const tamperedContent: Data = { ...data, content: { content: [{ type: "text", text: "evil" }] } };
    expect(await verifyData(tamperedContent, trust)).toMatchObject({ ok: false, code: "BAD_SIGNATURE" });

    const tamperedMeta: Data = { ...data, meta: { ...data.meta, freshnessMs: 10_000_000 } };
    expect(await verifyData(tamperedMeta, trust)).toMatchObject({ ok: false, code: "BAD_SIGNATURE" });

    const tamperedScope: Data = { ...data, meta: { ...data.meta, scope: "private" } };
    expect(await verifyData(tamperedScope, trust)).toMatchObject({ ok: false, code: "BAD_SIGNATURE" });

    // ageMs is hop-by-hop and unsigned.
    expect(await verifyData({ ...data, ageMs: 500 }, trust)).toMatchObject({ ok: true });
  });

  it("rejects Data signed by an untrusted key or for another producer's name", async () => {
    const { data, trust } = await fixture();
    const mallory = await keyPairFromSeed(new Uint8Array(32).fill(66));
    const forged = await signData(
      {
        name: data.name,
        content: data.content,
        producedAt: 1,
        freshnessMs: 1000,
        scope: "public",
        policyVersion: 1,
      },
      mallory,
    );
    expect(await verifyData(forged, trust)).toMatchObject({ ok: false, code: "UNTRUSTED_KEY" });
    const wrongLocator: Data = {
      ...data,
      signature: { ...data.signature, keyLocator: data.signature.keyLocator.replace(PRODUCER, "other.dev") },
    };
    expect(await verifyData(wrongLocator, trust)).toMatchObject({ ok: false, code: "UNTRUSTED_KEY" });
  });

  it("MUST give error results freshnessMs = 0 [P-5.3]", async () => {
    const { key, name } = await fixture();
    await expect(
      signData(
        {
          name,
          content: { content: [], isError: true },
          producedAt: 1,
          freshnessMs: 5,
          scope: "public",
          policyVersion: 1,
        },
        key,
      ),
    ).rejects.toMatchObject({ code: "BAD_POLICY" });
  });

  it("excludes the top-level _meta from content (ephemeral)", async () => {
    const { data, trust } = await fixture();
    const result = attachData({ ...data.content, _meta: { trace: "abc" } }, data);
    const rebuilt = dataFromToolResult(result) as Data;
    expect(rebuilt.content).toEqual(data.content);
    expect(await verifyData(rebuilt, trust)).toMatchObject({ ok: true });
  });
});

describe("manifest trust (protocol §6)", () => {
  async function rotate(
    manifest: Manifest,
    signer: Awaited<ReturnType<typeof keyPairFromSeed>>,
    version: number,
  ) {
    const { signature: _s, ...rest } = manifest;
    return signManifest(
      { ...rest, version, keys: [{ keyId: signer.keyId, publicKeyJwk: signer.publicKeyJwk }] },
      signer,
    );
  }

  it("MUST accept on first contact and then require an already-trusted signer [P-6.2]", async () => {
    const { manifest, trust, key } = await fixture();
    const mallory = await keyPairFromSeed(new Uint8Array(32).fill(99));
    const hijack = await rotate(manifest, mallory, 2);
    expect(await trust.addManifest(hijack)).toMatchObject({ ok: false, code: "UNTRUSTED_KEY" });

    // Legitimate rotation: v2 signed by the trusted key lists both keys; v3 is then signed by the new key.
    const next = await keyPairFromSeed(new Uint8Array(32).fill(2));
    const { signature: _s, ...rest } = manifest;
    const v2 = await signManifest(
      {
        ...rest,
        version: 2,
        keys: [
          { keyId: key.keyId, publicKeyJwk: key.publicKeyJwk },
          { keyId: next.keyId, publicKeyJwk: next.publicKeyJwk },
        ],
      },
      key,
    );
    expect((await trust.addManifest(v2)).ok).toBe(true);
    const v3 = await rotate(v2, next, 3);
    expect((await trust.addManifest(v3)).ok).toBe(true);
    // The rotated-out key can no longer sign manifests.
    const stale = await rotate(v3, key, 4);
    expect(await trust.addManifest(stale)).toMatchObject({ ok: false, code: "UNTRUSTED_KEY" });
  });

  it("MUST verify pinned producers only against pinned keys [P-6.2]", async () => {
    const { manifest, key } = await fixture();
    const trust = new TrustStore();
    const other = await keyPairFromSeed(new Uint8Array(32).fill(5));
    await trust.pin(PRODUCER, other.publicKeyJwk);
    expect(await trust.addManifest(manifest)).toMatchObject({ ok: false, code: "UNTRUSTED_KEY" });
    await trust.pin(PRODUCER, key.publicKeyJwk);
    expect((await trust.addManifest(manifest)).ok).toBe(true);
  });

  it("MUST reject manifest rollback [P-6.3]", async () => {
    const { manifest, trust, key } = await fixture();
    const { signature: _s, ...rest } = manifest;
    const v5 = await signManifest({ ...rest, version: 5 }, key);
    expect((await trust.addManifest(v5)).ok).toBe(true);
    expect(await trust.addManifest(manifest)).toMatchObject({ ok: false, code: "BAD_MANIFEST" });
  });

  it("rejects a manifest whose key id does not match its JWK, or that was tampered with", async () => {
    const { manifest } = await fixture();
    const bad = { ...manifest, tools: manifest.tools.map((t) => ({ ...t, ttlMs: t.ttlMs + 1 })) };
    expect(await new TrustStore().addManifest(bad)).toMatchObject({ ok: false, code: "BAD_SIGNATURE" });
    const other = await keyPairFromSeed(new Uint8Array(32).fill(8));
    const lying = {
      ...manifest,
      keys: [{ keyId: manifest.keys[0]?.keyId as string, publicKeyJwk: other.publicKeyJwk }],
    };
    expect(await new TrustStore().addManifest(lying)).toMatchObject({ ok: false, code: "BAD_MANIFEST" });
  });

  it("producer refuses cacheable tools without readOnlyHint [P-6.1]", () => {
    expect(
      () =>
        new Producer({
          producer: PRODUCER,
          key: {} as never,
          tools: [
            {
              name: "t",
              inputSchema: { type: "object" },
              policy: { cacheable: true, ttlMs: 1, scope: "public" },
              handler: () => ({ content: [] }),
            },
          ],
        }),
    ).toThrow(expect.objectContaining({ code: "BAD_POLICY" }));
  });
});

describe("authContext [P-8.4]", () => {
  it("MUST be derived non-reversibly (HMAC) and be stable per secret", async () => {
    const a = await deriveAuthContext("secret", "token-alice");
    expect(a).toHaveLength(22);
    expect(a).not.toContain("alice");
    expect(await deriveAuthContext("secret", "token-alice")).toBe(a);
    expect(await deriveAuthContext("other", "token-alice")).not.toBe(a);
    expect(await deriveAuthContext("secret", "token-bob")).not.toBe(a);
  });
});
