// End-to-end over real TCP sockets: client → edge (node:http) → producer (node:http).
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { type ForwarderEvent, keyPairFromSeed, Producer, type ProducerTool } from "@idem/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IdemClient } from "./client";
import { createGateway } from "./gateway";
import { createProducerHandler } from "./producer-handler";

const PRODUCER = "demo.idem.dev";

async function serve(handler: (r: Request) => Promise<Response>): Promise<{ server: Server; url: string }> {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const url = `http://${req.headers.host}${req.url}`;
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(url, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      ...(body && req.method !== "GET" && { body }),
    });
    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

let calls = 0;
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
    handler: async (args) => {
      calls++;
      await new Promise((r) => setTimeout(r, 150)); // slow upstream: makes aggregation observable
      return { content: [{ type: "text", text: `page ${(args as { url: string }).url}` }] };
    },
  },
  {
    name: "my_notes",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    policy: { cacheable: true, ttlMs: 60_000, scope: "private" },
    handler: (_a, ctx) => ({ content: [{ type: "text", text: `notes of ${ctx.auth}` }] }),
  },
  {
    name: "send_email",
    inputSchema: { type: "object", properties: { to: { type: "string" } }, required: ["to"] },
    annotations: { readOnlyHint: false },
    handler: (a) => ({ content: [{ type: "text", text: `sent to ${(a as { to: string }).to}` }] }),
  },
];

let producerSrv: { server: Server; url: string };
let edgeSrv: { server: Server; url: string };
const edgeEvents: ForwarderEvent[] = [];

beforeAll(async () => {
  const key = await keyPairFromSeed(new Uint8Array(32).fill(9));
  const producer = new Producer({ producer: PRODUCER, key, tools });
  producerSrv = await serve(createProducerHandler(producer));
  const edge = createGateway({
    id: "edge",
    upstreams: [{ producer: PRODUCER, url: producerSrv.url, kind: "producer" }],
    authSecret: "edge-secret",
    onEvent: (e) => edgeEvents.push(e),
  });
  edgeSrv = await serve(edge.handle);
});

afterAll(() => {
  producerSrv.server.close();
  edgeSrv.server.close();
});

describe("HTTP overlay binding over real sockets (protocol §9.1)", () => {
  it("3 concurrent agents → 1 upstream call; a 4th agent → CS hit; every Data verified", async () => {
    const agents = ["a", "b", "c", "d"].map(
      (id) => new IdemClient({ edge: edgeSrv.url, producer: PRODUCER, credential: `token-${id}` }),
    );
    calls = 0;
    const urls = ["https://ex.com/p?b=2&a=1", "https://EX.com:443/p?a=1&b=2#top", "https://ex.com/p?a=1&b=2"];
    const out = await Promise.all(agents.slice(0, 3).map((c, i) => c.call("fetch_page", { url: urls[i] })));
    expect(calls).toBe(1);
    for (const o of out) {
      expect(o.via).toBe("idem");
      expect(o.verify?.ok).toBe(true);
      expect(o.result.content[0]).toEqual({ type: "text", text: "page https://ex.com/p?a=1&b=2" });
    }
    expect(new Set(out.map((o) => o.name)).size).toBe(1);
    const kinds = out.flatMap((o) => o.trace[0]?.events.map((e) => e.kind) ?? []);
    expect(kinds.filter((k) => k === "pit_aggregate")).toHaveLength(2);

    const fourth = await agents[3]?.call("fetch_page", { url: "https://ex.com/p?a=1&b=2" });
    expect(calls).toBe(1);
    expect(fourth?.trace[0]?.events.map((e) => e.kind)).toContain("cs_hit");
    expect(fourth?.verify?.ok).toBe(true);
  });

  it("never serves one user's private result to another [P-8.3]", async () => {
    const alice = new IdemClient({ edge: edgeSrv.url, producer: PRODUCER, credential: "alice" });
    const bob = new IdemClient({ edge: edgeSrv.url, producer: PRODUCER, credential: "bob" });
    const [a, b] = await Promise.all([alice.call("my_notes", {}), bob.call("my_notes", {})]);
    expect(a.result.content[0]).toMatchObject({ text: "notes of alice" });
    expect(b.result.content[0]).toMatchObject({ text: "notes of bob" });
    const b2 = await bob.call("my_notes", {});
    expect(b2.result.content[0]).toMatchObject({ text: "notes of bob" });
    expect(b2.trace[0]?.events.map((e) => e.kind)).toContain("cs_hit");
  });

  it("passes side-effecting tools through without caching", async () => {
    const c = new IdemClient({ edge: edgeSrv.url, producer: PRODUCER });
    const r = await c.call("send_email", { to: "x@y.z" });
    expect(r.via).toBe("call");
    expect(r.result.content[0]).toMatchObject({ text: "sent to x@y.z" });
  });

  it("rejects a forged Interest with DIGEST_MISMATCH [P-4.3]", async () => {
    const c = new IdemClient({ edge: edgeSrv.url, producer: PRODUCER });
    const I = await c.prepare("fetch_page", { url: "https://ex.com/a" });
    const r = await c.sendInterest({
      ...(I as NonNullable<typeof I>),
      args: { url: "https://evil.example/" },
    });
    expect(r.error?.code).toBe("DIGEST_MISMATCH");
  });

  it("detects Data tampered on the last hop and retries without cache [P-5.5]", async () => {
    const c = new IdemClient({
      edge: edgeSrv.url,
      producer: PRODUCER,
      intercept: (d) => ({ ...d, content: { content: [{ type: "text", text: "evil" }] } }),
    });
    const r = await c.call("fetch_page", { url: "https://ex.com/p?a=1&b=2" });
    expect(r.retried).toBe(true);
    expect(r.verify?.ok).toBe(true);
    expect(r.result.content[0]).toMatchObject({ text: "page https://ex.com/p?a=1&b=2" });
  });
});
