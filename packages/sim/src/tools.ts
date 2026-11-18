import type { CallToolResult, JsonValue, Normalizer, ProducerTool, Scope } from "@idem/core";
import type { ToolId } from "./config";
import { Rng } from "./rng";

/**
 * The tools a simulated producer can serve. They mirror the live demo producer
 * (`apps/web/lib/server/demo-producer.ts`): same names, normalizers, scope and, by default, TTLs;
 * results are generated from the run seed instead of a corpus or the network, so a run stays
 * deterministic and needs no I/O.
 */

/** Origin of the simulated page corpus. */
export const CORPUS_ORIGIN = "https://corpus.idem.dev";

/** How a tool behaves for the cache, as its producer's manifest declares it. */
export interface ToolCatalogEntry {
  tool: ToolId;
  description: string;
  /** MCP `readOnlyHint`. */
  readOnly: boolean;
  /** Whether the manifest declares it cacheable; a non-cacheable call always passes through. */
  cacheable: boolean;
  /** Cache scope; meaningful only when `cacheable`. */
  scope: Scope;
  /** Default manifest TTL, ms (0 when not cacheable). */
  ttlMs: number;
  /** Argument normalizers by JSON pointer. */
  normalizers: Readonly<Record<string, readonly Normalizer[]>>;
}

/** Every tool of the simulator, with its defaults (the editor lists these). */
export const TOOL_CATALOG: readonly ToolCatalogEntry[] = [
  {
    tool: "fetch_page",
    description: "Return a page of the static corpus.",
    readOnly: true,
    cacheable: true,
    scope: "public",
    ttlMs: 300_000,
    normalizers: { "/url": ["url:sortQuery"] },
  },
  {
    tool: "search_corpus",
    description: "Rank corpus pages by word overlap with the query.",
    readOnly: true,
    cacheable: true,
    scope: "public",
    ttlMs: 300_000,
    normalizers: { "/query": ["trim", "lowercase"] },
  },
  {
    tool: "weather",
    description: "Deterministic pseudo-weather for a city (changes every 15 s). Short TTL: shows expiry.",
    readOnly: true,
    cacheable: true,
    scope: "public",
    ttlMs: 15_000,
    normalizers: { "/city": ["trim", "lowercase", "nfc"] },
  },
  {
    tool: "my_notes",
    description: "The caller's private notes.",
    readOnly: true,
    cacheable: true,
    scope: "private",
    ttlMs: 60_000,
    normalizers: {},
  },
  {
    tool: "send_email",
    description: "Send an email (fake side effect).",
    readOnly: false,
    cacheable: false,
    scope: "public",
    ttlMs: 0,
    normalizers: {},
  },
];

/** Every tool id, in catalog order. */
export const TOOL_IDS: readonly ToolId[] = TOOL_CATALOG.map((t) => t.tool);

/** Type guard for {@link ToolId}. */
export function isToolId(x: unknown): x is ToolId {
  return typeof x === "string" && (TOOL_IDS as readonly string[]).includes(x);
}

/** The catalog entry of a tool. */
export function toolInfo(tool: ToolId): ToolCatalogEntry {
  return TOOL_CATALOG.find((t) => t.tool === tool) as ToolCatalogEntry;
}

/** What a simulated tool needs from its producer and run. */
export interface SimToolContext {
  /** Run seed: result contents and sizes are a function of it and of the canonical arguments. */
  seed: number;
  /** Manifest TTL of the tool, ms. */
  ttlMs: number;
  /** Median page size, bytes (log-normal, sigma 0.7). */
  pageBytesMedian: number;
  /** Largest result text, bytes. */
  maxResultBytes: number;
}

const LOREM =
  "Named data networking retrieves content by name rather than by host address. Every packet carries a name, " +
  "every Data packet is signed, and any node on the path may answer from its cache. ";

function filler(bytes: number): string {
  return LOREM.repeat(Math.ceil(Math.max(0, bytes) / LOREM.length)).slice(0, Math.max(0, bytes));
}

function pageText(i: number, bytes: number): string {
  const head = `# Document ${i}\n\n`;
  return head + filler(bytes - head.length);
}

/** 32-bit FNV-1a of a string. */
function fnv32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function seeded(seed: number, label: string): Rng {
  return new Rng((fnv32(label) ^ seed) >>> 0);
}

function clampText(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

const text = (t: string): CallToolResult => ({ content: [{ type: "text", text: t }] });

/**
 * Page sizes, stable per document whatever the request order: log-normal around the median,
 * clamped to [512, max] bytes.
 */
export function pageSizes(seed: number, median: number, max: number): (i: number) => number {
  const cache = new Map<number, number>();
  return (i) => {
    let s = cache.get(i);
    if (s === undefined) {
      s = Math.min(max, Math.max(512, Math.round(new Rng(i * 7919 + seed).lognormal(Math.log(median), 0.7))));
      cache.set(i, s);
    }
    return s;
  };
}

/** Build the producer-side definition of a simulated tool. */
export function simTool(tool: ToolId, ctx: SimToolContext): ProducerTool {
  const info = toolInfo(tool);
  const policy = (extra: { normalizers?: Record<string, Normalizer[]> } = {}) => ({
    cacheable: true,
    ttlMs: ctx.ttlMs,
    scope: info.scope,
    ...extra,
  });
  switch (tool) {
    case "fetch_page": {
      const sizes = pageSizes(ctx.seed, ctx.pageBytesMedian, ctx.maxResultBytes);
      return {
        name: "fetch_page",
        description: info.description,
        inputSchema: {
          type: "object",
          properties: { url: { type: "string", minLength: 1 } },
          required: ["url"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        policy: policy({ normalizers: { "/url": ["url:sortQuery"] } }),
        handler: (args) => {
          const url = new URL((args as { url: string }).url);
          const m = /^\/doc\/(\d+)$/.exec(url.pathname);
          if (url.origin !== CORPUS_ORIGIN || !m) {
            return { content: [{ type: "text", text: `404 ${url.href}` }], isError: true };
          }
          const i = Number(m[1]);
          return text(pageText(i, sizes(i)));
        },
      };
    }
    case "search_corpus":
      return {
        name: "search_corpus",
        description: info.description,
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
        policy: policy({ normalizers: { "/query": ["trim", "lowercase"] } }),
        handler: (args) => {
          const { query, limit } = args as { query: string; limit: number };
          const r = seeded(ctx.seed, `search|${query}`);
          const hits = Array.from({ length: limit }, (_, k) => {
            const id = r.int(100);
            const snippet = Math.min(400, Math.max(60, Math.round(r.lognormal(Math.log(160), 0.4))));
            return { url: `${CORPUS_ORIGIN}/doc/${id}`, title: `Document ${id}`, score: limit - k, snippet };
          });
          const body = hits.map((h) => `${h.title} — ${h.url}\n${filler(h.snippet)}`).join("\n\n");
          return {
            ...text(clampText(body || "no results", ctx.maxResultBytes)),
            structuredContent: { hits: hits.map(({ url, title, score }) => ({ url, title, score })) },
          };
        },
      };
    case "weather":
      return {
        name: "weather",
        description: info.description,
        inputSchema: {
          type: "object",
          properties: { city: { type: "string", minLength: 1 } },
          required: ["city"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        policy: policy({ normalizers: { "/city": ["trim", "lowercase", "nfc"] } }),
        handler: (args, c) => {
          const city = (args as { city: string }).city;
          const bucket = Math.floor(c.now / 15_000);
          const r = seeded(ctx.seed, `weather|${city}|${bucket}`);
          const tempC = 12 + r.int(20);
          const sky = ["clear", "cloudy", "rain", "fog", "wind"][r.int(5)] as string;
          return {
            ...text(clampText(`${city}: ${tempC} °C, ${sky} (pseudo-data)`, ctx.maxResultBytes)),
            structuredContent: { city, tempC, sky, bucket },
          };
        },
      };
    case "my_notes":
      return {
        name: "my_notes",
        description: info.description,
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true },
        policy: policy(),
        handler: (_args, c) => text(`notes of ${c.auth ?? "anonymous"}`),
      };
    case "send_email":
      return {
        name: "send_email",
        description: info.description,
        inputSchema: {
          type: "object",
          properties: { to: { type: "string" }, body: { type: "string" } },
          required: ["to", "body"],
        },
        annotations: { readOnlyHint: false },
        handler: (args) => text(`queued for ${(args as { to: string }).to}`),
      };
  }
}

// ---------------------------------------------------------------- workload arguments

/** Search queries of the simulated workload, most popular first (canonical form). */
export const SEARCH_QUERIES: readonly string[] = [
  "named data networking",
  "content store eviction",
  "interest aggregation",
  "signed data packets",
  "longest prefix match",
  "cache hit ratio",
  "producer manifest",
  "zipf popularity",
  "tool call canonicalization",
  "private scope",
  "freshness and ttl",
  "forwarding strategy",
];

/** Cities of the simulated workload, most popular first (canonical form, NFC). */
export const CITIES: readonly string[] = [
  "rio de janeiro",
  "são paulo",
  "niterói",
  "lisbon",
  "zürich",
  "tokyo",
  "berlin",
  "montréal",
  "nairobi",
  "sydney",
];

/** A corpus URL for document `i`, in an equivalent surface form with probability `variation`. */
export function docUrl(i: number, rng: Rng, variation: number): string {
  if (!rng.chance(variation)) return `${CORPUS_ORIGIN}/doc/${i}?lang=en&v=1`;
  switch (rng.int(3)) {
    case 0:
      return `https://CORPUS.idem.dev/doc/${i}?v=1&lang=en`;
    case 1:
      return `${CORPUS_ORIGIN}/doc/${i}?lang=en&v=1#section-${rng.int(5)}`;
    default:
      return `https://corpus.idem.dev:443/doc/${i}?v=1&lang=en`;
  }
}

function titleCase(s: string): string {
  return s.replace(/(^|\s)(\p{L})/gu, (_, sp: string, c: string) => sp + c.toUpperCase());
}

/**
 * `search_corpus` arguments for a query, in an equivalent surface form with probability
 * `variation`: case and surrounding spaces (the `trim`, `lowercase` normalizers) or the default
 * `limit` written out (schema defaults [P-3.2]).
 */
export function searchArgs(query: string, rng: Rng, variation: number): JsonValue {
  if (!rng.chance(variation)) return { query };
  switch (rng.int(3)) {
    case 0:
      return { query: titleCase(query) };
    case 1:
      return { query: `  ${query.toUpperCase()} ` };
    default:
      return { query, limit: 3 };
  }
}

/**
 * `weather` arguments for a city, in an equivalent surface form with probability `variation`:
 * case, surrounding spaces, or Unicode NFD (the `trim`, `lowercase`, `nfc` normalizers).
 */
export function weatherArgs(city: string, rng: Rng, variation: number): JsonValue {
  if (!rng.chance(variation)) return { city };
  switch (rng.int(3)) {
    case 0:
      return { city: titleCase(city) };
    case 1:
      return { city: ` ${city} ` };
    default:
      return { city: city.normalize("NFD") };
  }
}

/**
 * Two different, valid argument sets of a cacheable public tool, or `undefined` if it has none
 * (the forge attack names one and sends the other).
 */
export function distinctArgs(tool: ToolId): [JsonValue, JsonValue] | undefined {
  switch (tool) {
    case "fetch_page":
      return [{ url: `${CORPUS_ORIGIN}/doc/0` }, { url: `${CORPUS_ORIGIN}/doc/1` }];
    case "search_corpus":
      return [{ query: SEARCH_QUERIES[0] as string }, { query: SEARCH_QUERIES[1] as string }];
    case "weather":
      return [{ city: CITIES[0] as string }, { city: CITIES[1] as string }];
    default:
      return undefined;
  }
}
