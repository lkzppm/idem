import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonicalizeArgs } from "./canonical";
import { jcs } from "./jcs";
import { makeName, parseName, toolSchemaDigest } from "./name";
import { applyNormalizer, applyNormalizers } from "./normalize";
import type { ToolIdentity } from "./types";

const fetchPage: ToolIdentity = {
  name: "fetch_page",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string" },
      maxBytes: { type: "integer", minimum: 1, default: 65536 },
    },
    required: ["url"],
    additionalProperties: false,
  },
  policyVersion: 1,
};

const search: ToolIdentity = {
  name: "search_corpus",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", minLength: 1 },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["query"],
  },
  policyVersion: 1,
};

const urlPolicy = { normalizers: { "/url": ["url:sortQuery" as const] } };

describe("normalizers (protocol §3)", () => {
  it("url drops fragment and default port and lowercases scheme and host", () => {
    expect(applyNormalizer("url", "HTTPS://Example.COM:443/a/B?x=1#frag")).toBe(
      "https://example.com/a/B?x=1",
    );
  });

  it("url:sortQuery sorts parameters stably", () => {
    expect(applyNormalizer("url:sortQuery", "https://e.com/p?b=2&a=1&b=1#x")).toBe(
      "https://e.com/p?a=1&b=2&b=1",
    );
    expect(applyNormalizer("url:sortQuery", "https://e.com/p?")).toBe("https://e.com/p");
  });

  it("set dedupes and sorts by JCS", () => {
    expect(applyNormalizer("set", ["b", "a", "b", 3, { k: 1 }])).toEqual(["a", "b", 3, { k: 1 }]); // JCS text order: '"' < '3' < '{'
  });

  it("trim, lowercase, nfc", () => {
    expect(applyNormalizer("trim", "  Hi \n")).toBe("Hi");
    expect(applyNormalizer("lowercase", "ÀBÇ")).toBe("àbç");
    expect(applyNormalizer("nfc", "é")).toBe("é");
  });

  it("applies deeper pointers before their parents", () => {
    const out = applyNormalizers(
      { tags: [" b", "b ", "a"] },
      { "/tags": ["set"], "/tags/0": ["trim"], "/tags/1": ["trim"] },
    );
    expect(out).toEqual({ tags: ["a", "b"] });
  });

  it("rejects string normalizers on non-strings with BAD_POLICY", () => {
    expect(() => applyNormalizer("trim", 3)).toThrow(expect.objectContaining({ code: "BAD_POLICY" }));
  });
});

describe("canonicalizeArgs", () => {
  it("MUST fall back to plain MCP on invalid arguments [P-3.1]", async () => {
    await expect(canonicalizeArgs({ nope: 1 }, fetchPage, urlPolicy)).rejects.toMatchObject({
      code: "INVALID_ARGS",
    });
    await expect(canonicalizeArgs({ url: 42 }, fetchPage, urlPolicy)).rejects.toMatchObject({
      code: "INVALID_ARGS",
    });
    await expect(canonicalizeArgs({ url: "not a url" }, fetchPage, urlPolicy)).rejects.toMatchObject({
      code: "INVALID_ARGS",
    });
  });

  it("MUST apply schema defaults [P-3.2]", async () => {
    const a = await canonicalizeArgs({ url: "https://e.com/" }, fetchPage, urlPolicy);
    const b = await canonicalizeArgs({ url: "https://e.com/", maxBytes: 65536 }, fetchPage, urlPolicy);
    expect(a.value).toEqual({ url: "https://e.com/", maxBytes: 65536 });
    expect(a.jcs).toBe(b.jcs);
  });

  it("MUST apply only declared normalizers, never inferred ones [P-3.3]", async () => {
    // `query` looks like a URL but no normalizer is declared for it: it must stay untouched.
    const a = await canonicalizeArgs({ query: "HTTPS://E.com/#x" }, search, { normalizers: {} });
    expect(a.value).toMatchObject({ query: "HTTPS://E.com/#x" });
    const b = await canonicalizeArgs({ query: "https://e.com/" }, search, { normalizers: {} });
    expect(a.jcs).not.toBe(b.jcs);
  });

  it("MUST serialize with JCS [P-3.4]", async () => {
    const a = await canonicalizeArgs({ url: "https://e.com/?b=1&a=2#f", maxBytes: 10 }, fetchPage, urlPolicy);
    expect(a.jcs).toBe('{"maxBytes":10,"url":"https://e.com/?a=2&b=1"}');
  });

  it("MUST treat schemas outside the v1 subset as not cacheable [P-3.6]", async () => {
    const tool = { inputSchema: { type: "object", $ref: "#/$defs/x" } };
    await expect(canonicalizeArgs({}, tool, { normalizers: {} })).rejects.toMatchObject({
      code: "UNSUPPORTED_SCHEMA",
    });
  });

  // ---- [P-3.5] property tests ----
  const argsArb = fc.record(
    {
      query: fc.string({ minLength: 1, maxLength: 20 }),
      limit: fc.integer({ min: 1, max: 50 }),
      tags: fc.array(fc.string({ maxLength: 6 }), { maxLength: 6 }),
    },
    { requiredKeys: ["query"] },
  );
  const searchPolicy = {
    normalizers: {
      "/query": ["trim" as const, "lowercase" as const, "nfc" as const],
      "/tags": ["set" as const],
    },
  };

  it("MUST be idempotent: canon(canon(a)) == canon(a) [P-3.5]", async () => {
    await fc.assert(
      fc.asyncProperty(argsArb, async (a) => {
        let once: Awaited<ReturnType<typeof canonicalizeArgs>>;
        try {
          once = await canonicalizeArgs(a, search, searchPolicy);
        } catch {
          return; // invalid after normalization (e.g. whitespace-only query): passthrough, fine
        }
        const twice = await canonicalizeArgs(once.value, search, searchPolicy);
        expect(twice.jcs).toBe(once.jcs);
      }),
      { numRuns: 300 },
    );
  });

  it("MUST give the same name when object keys are permuted [P-3.5]", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(fc.string({ maxLength: 5 }), fc.jsonValue({ maxDepth: 2 })),
        async (obj) => {
          const tool: ToolIdentity = { name: "t", inputSchema: { type: "object" }, policyVersion: 1 };
          const reversed = Object.fromEntries(Object.entries(obj).reverse());
          const a = await canonicalizeArgs(obj, tool, { normalizers: {} });
          const b = await canonicalizeArgs(reversed, tool, { normalizers: {} });
          const na = await makeName({ producer: "p.dev", tool, args: a });
          const nb = await makeName({ producer: "p.dev", tool, args: b });
          expect(na).toBe(nb);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("names (protocol §2)", () => {
  it("MUST be a function only of producer, tool identity and canonical args [P-2.1]", async () => {
    const a = await canonicalizeArgs({ url: "https://E.com/x?b=1&a=1#top" }, fetchPage, urlPolicy);
    const b = await canonicalizeArgs(
      { maxBytes: 65536, url: "https://e.com:443/x?a=1&b=1" },
      fetchPage,
      urlPolicy,
    );
    const na = await makeName({ producer: "demo.idem.dev", tool: fetchPage, args: a });
    const nb = await makeName({ producer: "demo.idem.dev", tool: fetchPage, args: b });
    expect(na).toBe(nb);
    expect(na).toMatch(/^\/idem\/v1\/demo\.idem\.dev\/fetch_page\/[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{43}$/);
    const other = await makeName({ producer: "other.dev", tool: fetchPage, args: a });
    expect(other).not.toBe(na);
  });

  it("MUST change schema-digest with schema or policyVersion, never with description [P-2.2]", async () => {
    const base = await toolSchemaDigest(fetchPage);
    const withDescription = { ...fetchPage, description: "Fetch a page" } as ToolIdentity;
    expect(await toolSchemaDigest(withDescription)).toBe(base);
    expect(await toolSchemaDigest({ ...fetchPage, policyVersion: 2 })).not.toBe(base);
    expect(await toolSchemaDigest({ ...fetchPage, inputSchema: { type: "object" } })).not.toBe(base);
    expect(base).toHaveLength(22);
  });

  it("MUST NOT contain arguments in clear text [P-2.3]", async () => {
    const secret = "https://secret.example/token=abc123";
    const a = await canonicalizeArgs({ url: secret }, fetchPage, { normalizers: {} });
    const name = await makeName({ producer: "demo.idem.dev", tool: fetchPage, args: a });
    expect(name).not.toContain("secret");
    expect(name).not.toContain("abc123");
    expect(parseName(name).argsDigest).toHaveLength(43);
  });

  it("MUST reserve names starting with /idem/v1/<producer>/_ [P-2.4]", async () => {
    const tool: ToolIdentity = { name: "_manifest", inputSchema: { type: "object" }, policyVersion: 1 };
    const args = await canonicalizeArgs({}, tool, { normalizers: {} });
    await expect(makeName({ producer: "p.dev", tool, args })).rejects.toMatchObject({ code: "BAD_NAME" });
    expect(() => parseName(`/idem/v1/p.dev/_key/${"a".repeat(22)}/${"b".repeat(43)}`)).toThrow();
  });

  it("percent-encodes tool names and round-trips them", async () => {
    const tool: ToolIdentity = { name: "files/read (v2)", inputSchema: { type: "object" }, policyVersion: 1 };
    const args = await canonicalizeArgs({}, tool, { normalizers: {} });
    const name = await makeName({ producer: "p.dev", tool, args });
    expect(name).toContain("/files%2Fread%20%28v2%29/");
    expect(parseName(name).tool).toBe("files/read (v2)");
  });

  it("rejects malformed names", () => {
    for (const bad of [
      "/idem/v2/p/t/x/y",
      "/idem/v1/P.dev/t/aaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "/idem/v1/p.dev/t/short/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "/idem/v1/p.dev/t/aaaaaaaaaaaaaaaaaaaaaa/bbb",
    ]) {
      expect(() => parseName(bad)).toThrow(expect.objectContaining({ code: "BAD_NAME" }));
    }
  });

  it("is stable across runs (golden vector)", async () => {
    const tool: ToolIdentity = { name: "echo", inputSchema: { type: "object" }, policyVersion: 1 };
    const args = await canonicalizeArgs({ b: 1, a: "x" }, tool, { normalizers: {} });
    expect(args.jcs).toBe(jcs({ a: "x", b: 1 }));
    const name = await makeName({ producer: "demo.idem.dev", tool, args });
    // Recomputed independently: any change here is a wire-format change (needs /idem/v2 + ADR).
    expect(name).toMatchSnapshot();
  });
});
