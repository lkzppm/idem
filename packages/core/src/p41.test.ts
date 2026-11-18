import { describe, expect, it } from "vitest";
import { buildInterest, cacheablePolicy } from "./consumer";
import { keyPairFromSeed } from "./crypto";
import { parseName } from "./name";
import { Producer, type ProducerTool } from "./producer";
import type { Manifest } from "./types";

const PRODUCER = "demo.idem.dev";

function tool(over: Partial<ProducerTool> = {}): ProducerTool {
  return {
    name: "fetch_page",
    description: "Fetch a page",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" }, limit: { type: "integer", default: 10 } },
      required: ["url"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    policy: { cacheable: true, ttlMs: 60_000, scope: "public", normalizers: { "/url": ["url:sortQuery"] } },
    handler: (args) => ({ content: [{ type: "text", text: `page ${(args as { url: string }).url}` }] }),
    ...over,
  };
}

async function producerOf(t: ProducerTool): Promise<Producer> {
  return new Producer({
    producer: PRODUCER,
    key: await keyPairFromSeed(new Uint8Array(32).fill(41)),
    tools: [t],
  });
}

/** What a consumer holds: the signed manifest and the `tools/list` entry. Nothing else. */
async function consumerName(manifest: Manifest, p: Producer, args: unknown): Promise<string> {
  const info = p.toolList().find((t) => t.name === "fetch_page");
  if (!info) throw new Error("tool not listed");
  const c = await cacheablePolicy(manifest, info);
  if (!c) throw new Error("not cacheable");
  const { interest } = await buildInterest({
    producer: PRODUCER,
    identity: c.identity,
    policy: c.policy,
    args,
  });
  return interest.name;
}

describe("Interest names (protocol §4)", () => {
  it("consumer MUST compute the name locally from the manifest and the arguments [P-4.1]", async () => {
    const p = await producerOf(tool());
    const manifest = await p.manifest();

    // Locally: no packet is exchanged to learn the name; the manifest policy and the arguments suffice.
    const name = await consumerName(manifest, p, { url: "https://EX.com:443/p?b=2&a=1#top" });
    const parsed = parseName(name);
    expect(parsed.producer).toBe(PRODUCER);
    expect(parsed.tool).toBe("fetch_page");
    expect(parsed.schemaDigest).toBe(manifest.tools[0]?.schemaDigest);

    // From the arguments: equivalent surface forms (declared normalizer, schema default) give one name.
    expect(await consumerName(manifest, p, { limit: 10, url: "https://ex.com/p?a=1&b=2" })).toBe(name);
    expect(await consumerName(manifest, p, { url: "https://ex.com/p?a=1&b=3" })).not.toBe(name);

    // It is the very name the producer derives on its own [P-5.1], so the Interest is answered as named.
    const { interest } = await buildInterest({
      producer: PRODUCER,
      identity: p.identity("fetch_page"),
      policy: manifest.tools[0] as Manifest["tools"][number],
      args: { url: "https://EX.com:443/p?b=2&a=1#top" },
    });
    expect(interest.name).toBe(name);
    expect((await p.handleInterest(interest)).name).toBe(name);
  });

  it("the name a consumer computes follows the manifest: normalizers and policyVersion [P-4.1]", async () => {
    const args = { url: "https://ex.com/p?b=2&a=1" };
    const sorted = await producerOf(tool());
    const plain = await producerOf(
      tool({ policy: { cacheable: true, ttlMs: 60_000, scope: "public", normalizers: { "/url": ["url"] } } }),
    );
    const bumped = await producerOf(tool({ policyVersion: 2 }));

    const a = await consumerName(await sorted.manifest(), sorted, args);
    const b = await consumerName(await plain.manifest(), plain, args);
    const c = await consumerName(await bumped.manifest(), bumped, args);

    // Same schema and policyVersion, different normalizer: same schema-digest, different args-digest.
    expect(parseName(b).schemaDigest).toBe(parseName(a).schemaDigest);
    expect(parseName(b).argsDigest).not.toBe(parseName(a).argsDigest);
    // A policyVersion bump in the manifest moves the call to a new name [P-2.2].
    expect(parseName(c).schemaDigest).not.toBe(parseName(a).schemaDigest);
    expect(parseName(c).argsDigest).toBe(parseName(a).argsDigest);
  });
});
