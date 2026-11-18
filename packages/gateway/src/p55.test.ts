// The consumer's retry after a bad signature [P-5.5], in process: client → edge → producer through
// injected `fetch` functions, with an attacker sitting on the consumer's link.
import { type CallToolResult, type Data, keyPairFromSeed, Producer, type ProducerTool } from "@idem/core";
import { beforeEach, describe, expect, it } from "vitest";
import { IdemClient } from "./client";
import { createGateway } from "./gateway";
import { createProducerHandler } from "./producer-handler";
import { PATHS } from "./wire";

const PRODUCER = "demo.idem.dev";
const EDGE = "http://edge.internal";
const ORIGIN = "http://producer.internal";

let runs = 0;
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
    policy: { cacheable: true, ttlMs: 60_000, scope: "public", normalizers: { "/url": ["url:sortQuery"] } },
    handler: (args) => {
      runs++;
      return { content: [{ type: "text", text: `page ${(args as { url: string }).url}` }] };
    },
  },
];

type Rewrite = (path: string, body: unknown) => unknown;

/** A consumer whose link is controlled by `attacker`: it may rewrite any JSON answer. */
async function world(attacker: Rewrite, opts: { direct?: boolean } = {}) {
  const key = await keyPairFromSeed(new Uint8Array(32).fill(55));
  const producer = createProducerHandler(new Producer({ producer: PRODUCER, key, tools }));
  const edge = createGateway({
    id: "edge",
    upstreams: [{ producer: PRODUCER, url: ORIGIN, kind: "producer" }],
    fetch: (input, init) => producer(new Request(input, init)),
  });
  const asked: string[] = [];
  const link: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    asked.push(`${url.origin}${url.pathname}`);
    const res = await (url.origin === ORIGIN ? producer(req) : edge.handle(req));
    if (req.method !== "POST" || !res.ok) return res;
    return new Response(JSON.stringify(attacker(url.pathname, await res.json())), {
      status: res.status,
      headers: res.headers,
    });
  };
  const client = new IdemClient({
    edge: EDGE,
    producer: PRODUCER,
    fetch: link,
    ...(opts.direct && { producerUrl: ORIGIN }),
  });
  return { client, asked };
}

const evil = { content: [{ type: "text", text: "evil" }] } satisfies CallToolResult;
/** Rewrite the content of the Data answering the Interest: the first answer fails verification. */
const tamperData: Rewrite = (path, body) =>
  path === PATHS.interest ? { ...(body as Data), content: evil } : body;
const text = (r: CallToolResult) => (r.content[0] as { text: string }).text;
const args = { url: "https://ex.com/p?b=2&a=1" };

describe("consumer retry after a bad signature (protocol §5)", () => {
  beforeEach(() => {
    runs = 0;
  });

  it("MUST verify before handing content to the agent; the retry is a plain call no cache answers [P-5.5]", async () => {
    const { client, asked } = await world(tamperData);
    const out = await client.call("fetch_page", args);
    expect(out.retried).toBe(true);
    expect(out.verify?.ok).toBe(true);
    expect(out.error).toBeUndefined();
    expect(text(out.result)).toBe("page https://ex.com/p?a=1&b=2");
    // Through the edge by default, as a passthrough call: the tool ran again, the CS did not answer.
    expect(asked.slice(-2)).toEqual([`${EDGE}${PATHS.interest}`, `${EDGE}${PATHS.call}`]);
    expect(runs).toBe(2);
  });

  it("retries at the producer itself when the consumer can reach it [P-5.5]", async () => {
    const { client, asked } = await world(tamperData, { direct: true });
    const out = await client.call("fetch_page", args);
    expect(out.retried).toBe(true);
    expect(out.verify?.ok).toBe(true);
    expect(text(out.result)).toBe("page https://ex.com/p?a=1&b=2");
    expect(asked.at(-1)).toBe(`${ORIGIN}${PATHS.call}`);
  });

  it("MUST NOT accept a retried result that is unsigned, tampered or signed for another name [P-5.5]", async () => {
    const stripped: Rewrite = (path, body) => (path === PATHS.call ? evil : tamperData(path, body));
    const rewritten: Rewrite = (path, body) =>
      path === PATHS.call ? { ...(body as CallToolResult), content: evil.content } : tamperData(path, body);
    // A genuine, correctly signed result of a different call.
    const other = await (await world((_p, b) => b)).client.call("fetch_page", {
      url: "https://ex.com/other",
    });
    const swapped: Rewrite = (path, body) =>
      path === PATHS.call
        ? { ...other.result, _meta: { "dev.idem/data": { ...other.data, content: undefined } } }
        : tamperData(path, body);

    for (const [attacker, why] of [
      [stripped, /no signed Data/],
      [rewritten, /digest/],
      [swapped, /another name/],
    ] as const) {
      const { client } = await world(attacker);
      const out = await client.call("fetch_page", args);
      expect(out.retried).toBe(true);
      expect(out.error?.code).toBe("BAD_SIGNATURE");
      expect(out.error?.message).toMatch(why);
      expect(out.result.isError).toBe(true);
      expect(JSON.stringify(out.result)).not.toContain("evil");
      expect(JSON.stringify(out.result)).not.toContain("ex.com/other");
    }
  });
});
