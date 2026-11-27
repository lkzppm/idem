// The MCP edge is the consumer on behalf of an unmodified MCP client, so [P-5.5] is its duty.
// In process: MCP client → createMcpEdge → gateway (with an attacker on its consumer side) → producer.
import {
  type CallToolResult,
  type Clock,
  type Data,
  keyPairFromSeed,
  Producer,
  type ProducerTool,
  RealClock,
} from "@idem/core";
import { createGateway, createProducerHandler, type Gateway, PATHS } from "@idem/gateway";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { createMcpEdge, IdemConsumer } from "./index";

const PRODUCER = "demo.idem.dev";

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
    policy: { cacheable: true, ttlMs: 60_000, scope: "public" },
    handler: (args) => ({ content: [{ type: "text", text: `page ${(args as { url: string }).url}` }] }),
  },
];

type Rewrite = (path: string, body: unknown) => unknown;
type Result = {
  content: { type: string; text?: string }[];
  isError?: boolean;
  _meta?: Record<string, unknown>;
};

/** An MCP client connected to an edge whose answers to its own consumer side pass through `attacker`. */
async function connect(attacker: Rewrite, clock?: Clock): Promise<Client> {
  const key = await keyPairFromSeed(new Uint8Array(32).fill(5));
  const producer = createProducerHandler(
    new Producer({ producer: PRODUCER, key, tools, ...(clock && { clock }) }),
  );
  const honest = createGateway({
    id: "edge",
    upstreams: [{ producer: PRODUCER, url: "http://producer.internal", kind: "producer" }],
    fetch: (input, init) => producer(new Request(input, init)),
  });
  const gateway: Gateway = {
    forwarder: honest.forwarder,
    trust: honest.trust,
    async handle(req) {
      const res = await honest.handle(req);
      if (req.method !== "POST" || !res.ok) return res;
      const body = attacker(new URL(req.url).pathname, await res.json());
      return new Response(JSON.stringify(body), { status: res.status, headers: res.headers });
    },
  };
  const edge = await createMcpEdge({ gateway, producer: PRODUCER, info: { name: "edge", version: "0.0.0" } });
  const client = new Client({ name: "plain-mcp-client", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://edge.internal/mcp"), {
      fetch: (input, init) => edge.fetch(new Request(input, init)),
    }),
  );
  return client;
}

const evil = { content: [{ type: "text", text: "evil" }] } satisfies CallToolResult;
const tamperData: Rewrite = (path, body) =>
  path === PATHS.interest ? { ...(body as Data), content: evil } : body;
const call = { name: "fetch_page", arguments: { url: "https://ex.com/a" } };

describe("MCP edge as the consumer (protocol §9.1)", () => {
  it("MUST verify before handing content to the MCP client, retrying a tampered answer [P-5.5]", async () => {
    const client = await connect(tamperData);
    const r = (await client.callTool(call)) as Result;
    expect(r.content[0]?.text).toBe("page https://ex.com/a");
    expect(r._meta?.["dev.idem/data"]).toBeDefined();
    await client.close();
  });

  it("MUST NOT hand over content when the retried result does not verify either [P-5.5]", async () => {
    const stripped: Rewrite = (path, body) => (path === PATHS.call ? evil : tamperData(path, body));
    const rewritten: Rewrite = (path, body) =>
      path === PATHS.call ? { ...(body as CallToolResult), content: evil.content } : tamperData(path, body);
    for (const attacker of [stripped, rewritten]) {
      const client = await connect(attacker);
      const r = (await client.callTool(call)) as Result;
      expect(r.isError).toBe(true);
      expect(r.content[0]?.text).toMatch(/^BAD_SIGNATURE/);
      expect(JSON.stringify(r)).not.toContain("evil");
      await client.close();
    }
  });

  it("MUST fail closed with CLOCK_SKEW when even the retry is outside its signed lifetime [P-8.7]", async () => {
    // The producer's clock runs ten minutes behind: the edge answers EXPIRED, the retry is old too.
    const real = new RealClock();
    const behind: Clock = {
      now: () => Date.now() - 10 * 60_000,
      setTimeout: (f, ms) => real.setTimeout(f, ms),
      clearTimeout: (h) => real.clearTimeout(h),
    };
    const client = await connect((_p, b) => b, behind);
    const r = (await client.callTool(call)) as Result;
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toMatch(/^CLOCK_SKEW: .*producedAt \d+, local time \d+/);
    expect(JSON.stringify(r)).not.toContain("page https://ex.com/a");
    await client.close();
  });

  it("IdemConsumer reports a verified but expired result as EXPIRED, apart from BAD_SIGNATURE [P-8.7]", async () => {
    const key = await keyPairFromSeed(new Uint8Array(32).fill(5));
    const p = new Producer({ producer: PRODUCER, key, tools });
    const result = await p.handleCall("fetch_page", call.arguments);
    const consumer = new IdemConsumer();
    await consumer.pin(PRODUCER, [key.publicKeyJwk]);
    expect(await consumer.verifyToolResult(result)).toMatchObject({ ok: true });
    const real = new RealClock();
    const later = new IdemConsumer({
      trust: consumer.trust,
      clock: {
        now: () => Date.now() + 365 * 86_400_000,
        setTimeout: real.setTimeout,
        clearTimeout: real.clearTimeout,
      },
    });
    expect(await later.verifyToolResult(result)).toMatchObject({ ok: false, code: "EXPIRED" });
  });
});
