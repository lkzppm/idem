import {
  type IdemKeyPair,
  importKeyPair,
  keyPairFromSeed,
  Producer,
  type ProducerTool,
  sha256,
  utf8,
} from "@idem/core";
import { CORPUS, CORPUS_ORIGIN, pageAt } from "@/corpus";

/** Logical producer name of the demo (protocol §2: the producer component of every name). */
export const DEMO_PRODUCER = process.env.IDEM_PRODUCER ?? "demo.idem.dev";

const text = (t: string) => ({ content: [{ type: "text", text: t }] });

const tools: ProducerTool[] = [
  {
    name: "fetch_page",
    description: "Return a page of the static demo corpus (https://corpus.idem.dev/doc/<n>).",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", minLength: 1, description: "Corpus URL" } },
      required: ["url"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    policy: { cacheable: true, ttlMs: 300_000, scope: "public", normalizers: { "/url": ["url:sortQuery"] } },
    handler: async (args) => {
      const url = new URL((args as { url: string }).url);
      const page = pageAt(url);
      await delay(250); // stands in for a real origin fetch
      if (!page) return { ...text(`404: ${url.href} is not in the corpus`), isError: true };
      return {
        ...text(`# ${page.title}\n\n${page.body}`),
        structuredContent: { id: page.id, title: page.title, url: `${CORPUS_ORIGIN}/doc/${page.id}` },
      };
    },
  },
  {
    name: "search_corpus",
    description: "Rank corpus pages by word overlap with the query.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1 },
        limit: { type: "integer", minimum: 1, maximum: 12, default: 3 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    policy: {
      cacheable: true,
      ttlMs: 300_000,
      scope: "public",
      normalizers: { "/query": ["trim", "lowercase"] },
    },
    handler: async (args) => {
      const { query, limit } = args as { query: string; limit: number };
      const words = new Set(query.split(/\W+/).filter((w) => w.length > 2));
      const ranked = CORPUS.map((p) => ({
        p,
        score: `${p.title} ${p.body}`
          .toLowerCase()
          .split(/\W+/)
          .filter((w) => words.has(w)).length,
      }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score || a.p.id - b.p.id)
        .slice(0, limit);
      await delay(180);
      const hits = ranked.map((r) => ({
        url: `${CORPUS_ORIGIN}/doc/${r.p.id}`,
        title: r.p.title,
        score: r.score,
      }));
      return {
        ...text(hits.map((h) => `${h.title} — ${h.url}`).join("\n") || "no results"),
        structuredContent: { hits },
      };
    },
  },
  {
    name: "weather",
    description: "Deterministic pseudo-weather for a city (changes every 15 s). Short TTL: shows expiry.",
    inputSchema: {
      type: "object",
      properties: { city: { type: "string", minLength: 1 } },
      required: ["city"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    policy: {
      cacheable: true,
      ttlMs: 15_000,
      scope: "public",
      normalizers: { "/city": ["trim", "lowercase", "nfc"] },
    },
    handler: async (args, ctx) => {
      const city = (args as { city: string }).city;
      const bucket = Math.floor(ctx.now / 15_000);
      const h = await sha256(utf8(`${city}|${bucket}`));
      const tempC = 12 + ((h[0] as number) % 20);
      const sky = ["clear", "cloudy", "rain", "fog", "wind"][(h[1] as number) % 5] as string;
      await delay(120);
      return {
        ...text(`${city}: ${tempC} °C, ${sky} (pseudo-data)`),
        structuredContent: { city, tempC, sky, bucket },
      };
    },
  },
  {
    name: "my_notes",
    description: "The caller's private notes (scope: private).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    policy: { cacheable: true, ttlMs: 60_000, scope: "private" },
    handler: async (_args, ctx) => {
      await delay(150);
      if (!ctx.auth) return text("No credential: anonymous users have no notes.");
      const id = (await sha256(utf8(ctx.auth)))[0] as number;
      return {
        ...text(`Notes for ${ctx.auth}: remember item #${id}.`),
        structuredContent: { owner: ctx.auth },
      };
    },
  },
  {
    name: "send_email",
    description: "Pretend to send an email (side effect: never cached).",
    inputSchema: {
      type: "object",
      properties: { to: { type: "string", minLength: 3 }, body: { type: "string" } },
      required: ["to", "body"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    handler: async (args) => {
      await delay(200);
      return text(`Queued (fake) email to ${(args as { to: string }).to}.`);
    },
  },
];

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadKey(): Promise<IdemKeyPair> {
  const jwk = process.env.IDEM_PRODUCER_KEY;
  if (jwk) return importKeyPair(JSON.parse(jwk) as JsonWebKey);
  // Demo fallback: a fixed, PUBLIC seed so every serverless instance signs with the same key.
  // Anyone can forge Data for this key; set IDEM_PRODUCER_KEY for anything beyond the demo.
  console.warn("[idem] IDEM_PRODUCER_KEY not set: using the public demo key");
  return keyPairFromSeed(await sha256(utf8("idem demo producer key — public, do not use in production")));
}

let producer: Promise<Producer> | undefined;

/** The demo producer (one per server instance). */
export function demoProducer(): Promise<Producer> {
  producer ??= loadKey().then((key) => new Producer({ producer: DEMO_PRODUCER, key, tools }));
  return producer;
}
