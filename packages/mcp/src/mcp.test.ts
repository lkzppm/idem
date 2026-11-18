// Interop over real sockets with the unmodified official MCP v2 client.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { keyPairFromSeed, Producer, type ProducerTool } from "@idem/core";
import { createGateway, createProducerHandler } from "@idem/gateway";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMcpEdge, createMcpProducer, IdemConsumer } from "./index";

const PRODUCER = "demo.idem.dev";

async function serve(handler: (r: Request) => Promise<Response>): Promise<{ server: Server; url: string }> {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const response = await handler(
      new Request(`http://${req.headers.host}${req.url}`, {
        method: req.method,
        headers,
        ...(body && req.method !== "GET" && { body }),
      }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

let upstreamCalls = 0;
const tools: ProducerTool[] = [
  {
    name: "fetch_page",
    description: "Fetch a corpus page",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    policy: { cacheable: true, ttlMs: 60_000, scope: "public", normalizers: { "/url": ["url:sortQuery"] } },
    handler: async (args) => {
      upstreamCalls++;
      await new Promise((r) => setTimeout(r, 100));
      return { content: [{ type: "text", text: `page ${(args as { url: string }).url}` }] };
    },
  },
  {
    name: "send_email",
    inputSchema: { type: "object", properties: { to: { type: "string" } }, required: ["to"] },
    annotations: { readOnlyHint: false },
    handler: (a) => ({ content: [{ type: "text", text: `sent to ${(a as { to: string }).to}` }] }),
  },
];

const servers: Server[] = [];
let producerMcp: string;
let edgeMcp: string;
let manifestKey: JsonWebKey;

beforeAll(async () => {
  const key = await keyPairFromSeed(new Uint8Array(32).fill(4));
  manifestKey = key.publicKeyJwk;
  const producer = new Producer({ producer: PRODUCER, key, tools });
  const mcpProducer = createMcpProducer(producer, { name: "idem-demo-producer", version: "0.0.0" });
  const idemProducer = createProducerHandler(producer);
  const p = await serve((req) =>
    new URL(req.url).pathname === "/mcp" ? mcpProducer.fetch(req) : idemProducer(req),
  );
  const gateway = createGateway({
    id: "edge",
    upstreams: [{ producer: PRODUCER, url: p.url, kind: "producer" }],
  });
  const mcpEdge = await createMcpEdge({
    gateway,
    producer: PRODUCER,
    info: { name: "idem-edge", version: "0.0.0" },
  });
  const e = await serve((req) => mcpEdge.fetch(req));
  servers.push(p.server, e.server);
  producerMcp = `${p.url}/mcp`;
  edgeMcp = `${e.url}/mcp`;
});

afterAll(() => {
  for (const s of servers) s.close();
});

async function connect(url: string): Promise<Client> {
  const client = new Client({ name: "plain-mcp-client", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

type Result = { content: { type: string; text?: string }[]; _meta?: Record<string, unknown> };

describe("MCP binding (protocol §9.1)", () => {
  it("an unmodified MCP client calls an IDEM producer and still works (ignores _meta)", async () => {
    const client = await connect(producerMcp);
    const { tools: listed } = await client.listTools();
    expect(listed.map((t) => t.name).sort()).toEqual(["fetch_page", "send_email"]);
    const r = (await client.callTool({
      name: "fetch_page",
      arguments: { url: "https://ex.com/a?b=1&a=2" },
    })) as Result;
    expect(r.content[0]?.text).toBe("page https://ex.com/a?a=2&b=1");
    expect(r._meta?.["dev.idem/data"]).toBeDefined();
    // An IDEM-aware client verifies the very same result end to end.
    const consumer = new IdemConsumer();
    await consumer.pin(PRODUCER, [manifestKey]);
    expect(await consumer.verifyToolResult(r as never)).toMatchObject({ ok: true });
    await client.close();
  });

  it("plain MCP clients behind the IDEM edge share one upstream call and get verifiable results", async () => {
    upstreamCalls = 0;
    const clients = await Promise.all([1, 2, 3].map(() => connect(edgeMcp)));
    const urls = [
      "https://ex.com/p?x=1&y=2",
      "https://EX.com:443/p?y=2&x=1#frag",
      "https://ex.com/p?y=2&x=1",
    ];
    const results = (await Promise.all(
      clients.map((c, i) => c.callTool({ name: "fetch_page", arguments: { url: urls[i] } })),
    )) as Result[];
    expect(upstreamCalls).toBe(1);
    for (const r of results) expect(r.content[0]?.text).toBe("page https://ex.com/p?x=1&y=2");
    const late = (await clients[0]?.callTool({ name: "fetch_page", arguments: { url: urls[0] } })) as Result;
    expect(upstreamCalls).toBe(1);
    const consumer = new IdemConsumer();
    await consumer.pin(PRODUCER, [manifestKey]);
    expect(await consumer.verifyToolResult(late as never)).toMatchObject({ ok: true });
    const mail = (await clients[1]?.callTool({ name: "send_email", arguments: { to: "a@b.c" } })) as Result;
    expect(mail.content[0]?.text).toBe("sent to a@b.c");
    await Promise.all(clients.map((c) => c.close()));
  });
});
