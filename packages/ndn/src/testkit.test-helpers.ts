// Test-only harness: a core Producer with a few demo-like tools, served on an in-process NDNts forwarder.
import {
  buildInterest,
  cacheablePolicy,
  type IdemKeyPair,
  type Interest,
  keyPairFromSeed,
  Producer,
  type ProducerTool,
  TrustStore,
  VirtualClock,
} from "@idem/core";
import { Forwarder } from "@ndn/fw";
import { NdnConsumer } from "./consumer";
import { serveNdn } from "./producer";

export const PRODUCER = "demo.idem.dev";

export const calls: Record<string, number> = {};

function count(tool: string): void {
  calls[tool] = (calls[tool] ?? 0) + 1;
}

export const TOOLS: ProducerTool[] = [
  {
    name: "fetch_page",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    policy: { cacheable: true, ttlMs: 60_000, scope: "public", normalizers: { "/url": ["url:sortQuery"] } },
    handler: (args) => {
      count("fetch_page");
      const url = (args as { url: string }).url;
      if (url.endsWith("/missing")) return { content: [{ type: "text", text: "404" }], isError: true };
      if (url.endsWith("/huge")) return { content: [{ type: "text", text: "x".repeat(20_000) }] };
      return { content: [{ type: "text", text: `page ${url}` }] };
    },
  },
  {
    name: "my_notes",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    policy: { cacheable: true, ttlMs: 60_000, scope: "private" },
    handler: (_args, ctx) => {
      count("my_notes");
      return { content: [{ type: "text", text: `notes of ${ctx.auth ?? "anonymous"}` }] };
    },
  },
  {
    name: "send_email",
    inputSchema: { type: "object", properties: { to: { type: "string" } }, required: ["to"] },
    annotations: { readOnlyHint: false },
    handler: (args) => {
      count("send_email");
      return { content: [{ type: "text", text: `sent to ${(args as { to: string }).to}` }] };
    },
  },
];

export async function keyFrom(byte: number): Promise<IdemKeyPair> {
  return keyPairFromSeed(new Uint8Array(32).fill(byte));
}

/** A producer, its manifest and a trust store that accepted it. */
export async function setupProducer(opts: { producer?: string; keyByte?: number } = {}) {
  const key = await keyFrom(opts.keyByte ?? 7);
  const clock = new VirtualClock();
  const producer = new Producer({ producer: opts.producer ?? PRODUCER, key, tools: TOOLS, clock });
  const manifest = await producer.manifest();
  const trust = new TrustStore();
  await trust.addManifest(manifest, { now: 0 });
  return { key, clock, producer, manifest, trust };
}

/** Build the IDEM Interest a consumer would send (core's consumer helpers). */
export async function idemInterest(
  producer: Producer,
  tool: string,
  args: unknown,
  extra: Partial<Interest> = {},
): Promise<Interest> {
  const info = producer.toolList().find((t) => t.name === tool);
  if (!info) throw new Error(tool);
  const c = await cacheablePolicy(await producer.manifest(), info);
  if (!c) throw new Error(`${tool} is not cacheable`);
  const { interest } = await buildInterest({
    producer: producer.producer,
    identity: c.identity,
    policy: c.policy,
    args,
    nonce: "AAECAwQFBgc",
  });
  return { ...interest, ...extra };
}

/** Producer served on a fresh in-process forwarder, and a consumer on the same forwarder. */
export async function setupNetwork() {
  const p = await setupProducer();
  const fw = Forwarder.create();
  const served = await serveNdn({ producer: p.producer, key: p.key, fw });
  // The consumer reads the producer's (virtual) clock: the signed lifetime needs them to agree [P-8.6].
  const consumer = new NdnConsumer({ producer: PRODUCER, fw, clock: p.clock });
  return { ...p, fw, served, consumer };
}
