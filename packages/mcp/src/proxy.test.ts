// Proxy-producer (protocol §9.1, "Legacy producer"). In process, no sockets:
// plain MCP clients → createMcpEdge → gateway (edge) → createProducerHandler(proxy) → unmodified MCP server.
import {
  buildInterest,
  type CallToolResult,
  type Data,
  dataFromToolResult,
  generateKeyPair,
  isIdemError,
  keyPairFromSeed,
  parseName,
} from "@idem/core";
import { createGateway, createProducerHandler } from "@idem/gateway";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  createMcpHandler,
  fromJsonSchema,
  type JsonSchemaType,
  McpServer,
} from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { createMcpEdge, IdemConsumer } from "./index";
import {
  createProxyProducer,
  ORIGIN_META_KEY,
  type ProxyProducerOptions,
  type ProxyToolPolicy,
} from "./proxy";

const PROXY = "proxy.example.com";
const ORIGIN_URL = "http://origin.example.com/mcp";
const SERVICE = "proxy-service-token";

type Seen = { tool: string; args: unknown; bearer: string | undefined };
type Ctx = { http?: { req?: Request } };

const CITY = {
  type: "object",
  properties: { city: { type: "string" } },
  required: ["city"],
  additionalProperties: false,
};

/** An MCP v2 server with no IDEM anywhere: the origin. `weatherSchema` is mutable to model a redeploy. */
function makeOrigin() {
  const state = {
    seen: [] as Seen[],
    weatherSchema: { ...CITY } as Record<string, unknown>,
    weatherHint: true as boolean,
    flakyFails: 1,
  };
  const bearerOf = (ctx: Ctx) => ctx.http?.req?.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const tool = (
    s: McpServer,
    name: string,
    annotations: Record<string, unknown> | undefined,
    schema: () => Record<string, unknown>,
    run: (
      args: Record<string, unknown>,
      bearer: string | undefined,
    ) => CallToolResult | Promise<CallToolResult>,
  ) =>
    s.registerTool(
      name,
      {
        description: `origin tool ${name}`,
        inputSchema: fromJsonSchema(schema() as JsonSchemaType),
        ...(annotations && { annotations }),
      },
      async (args: unknown, ctx: Ctx) => {
        const bearer = bearerOf(ctx);
        state.seen.push({ tool: name, args, bearer });
        return (await run(args as Record<string, unknown>, bearer)) as never;
      },
    );
  const handler = createMcpHandler(() => {
    const s = new McpServer({ name: "legacy-origin", version: "1.0.0" }, { capabilities: { tools: {} } });
    const city = () => CITY;
    const text = (t: string): CallToolResult => ({ content: [{ type: "text", text: t }] });
    tool(
      s,
      "get_weather",
      { readOnlyHint: state.weatherHint },
      () => state.weatherSchema,
      async (a) => {
        await new Promise((r) => setTimeout(r, 50));
        return text(`weather in ${a.city}`);
      },
    );
    tool(s, "lookup", undefined, city, (a) => text(`lookup ${a.city}`));
    tool(s, "send_email", { readOnlyHint: false }, city, (a) => text(`sent to ${a.city}`));
    tool(s, "my_inbox", { readOnlyHint: true }, city, (_a, b) => text(`inbox of ${b ?? "nobody"}`));
    tool(s, "flaky", { readOnlyHint: true }, city, (a) => {
      if (state.flakyFails-- > 0) return { ...text("origin overloaded"), isError: true };
      return text(`flaky ${a.city}`);
    });
    tool(s, "broken", { readOnlyHint: true }, city, () => {
      throw new Error("origin crashed");
    });
    return s;
  });
  const fetchOrigin: typeof fetch = (input, init) => handler.fetch(new Request(input, init));
  const calls = (name: string) => state.seen.filter((x) => x.tool === name);
  return { state, fetch: fetchOrigin, calls };
}

const POLICIES: Record<string, ProxyToolPolicy> = {
  get_weather: {
    cacheable: true,
    ttlMs: 60_000,
    scope: "public",
    normalizers: { "/city": ["trim", "lowercase"] },
  },
  my_inbox: { cacheable: true, ttlMs: 60_000, scope: "private" },
  flaky: { cacheable: true, ttlMs: 60_000, scope: "public" },
  broken: { cacheable: true, ttlMs: 60_000, scope: "public" },
};

async function setup(over: Partial<ProxyProducerOptions> = {}) {
  const origin = makeOrigin();
  const key = await keyPairFromSeed(new Uint8Array(32).fill(9));
  const proxy = await createProxyProducer({
    upstream: { url: ORIGIN_URL, fetch: origin.fetch, credential: SERVICE },
    name: PROXY,
    key,
    tools: POLICIES,
    ...over,
  });
  const serveProxy = createProducerHandler(proxy, { id: "proxy" });
  const gateway = createGateway({
    id: "edge",
    upstreams: [{ producer: PROXY, url: "http://proxy.internal", kind: "producer" }],
    fetch: (input, init) => serveProxy(new Request(input, init)),
    authSecret: "edge-secret",
  });
  const edge = await createMcpEdge({ gateway, producer: PROXY, info: { name: "edge", version: "0.0.0" } });
  const connect = async (credential?: string) => {
    const client = new Client({ name: "plain-mcp-client", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://edge.internal/mcp"), {
        fetch: (input, init) => edge.fetch(new Request(input, init)),
        ...(credential && { requestInit: { headers: { authorization: `Bearer ${credential}` } } }),
      }),
    );
    return client;
  };
  return { origin, key, proxy, connect };
}

type Result = CallToolResult & { content: { type: string; text?: string }[] };
const textOf = (r: unknown) => (r as Result).content[0]?.text;

describe("proxy-producer (protocol §9.1, legacy producer)", () => {
  it("MUST sign as the proxy: an unmodified MCP server behind it is called once for three clients, then hit [P-9.5]", async () => {
    const { origin, key, connect } = await setup();
    const clients = await Promise.all(["alice", "bob", "carol"].map((c) => connect(c)));
    const results = await Promise.all(
      clients.map((c, i) =>
        c.callTool({ name: "get_weather", arguments: { city: [" Rio", "rio ", "RIO"][i] } }),
      ),
    );
    expect(origin.calls("get_weather")).toHaveLength(1);
    for (const r of results) expect(textOf(r)).toBe("weather in rio");
    const late = await clients[0]?.callTool({ name: "get_weather", arguments: { city: "rio" } });
    expect(origin.calls("get_weather")).toHaveLength(1); // CS hit at the edge
    const data = dataFromToolResult(late as never) as Data;
    expect(parseName(data.name).producer).toBe(PROXY);
    expect(data.signature.keyLocator).toBe(`/idem/v1/${PROXY}/_key/${key.keyId}`);
    const consumer = new IdemConsumer();
    await consumer.pin(PROXY, [key.publicKeyJwk]);
    expect(await consumer.verifyToolResult(late as never)).toMatchObject({ ok: true, producer: PROXY });
    // The tool list says where the answers come from, and who vouches for readOnlyHint.
    const { tools } = await clients[0]!.listTools();
    expect(tools.find((t) => t.name === "get_weather")?._meta?.[ORIGIN_META_KEY]).toEqual({
      origin: ORIGIN_URL,
      readOnlyHint: "origin",
    });
    await Promise.all(clients.map((c) => c.close()));
  });

  it("MUST NOT forward the end user's credential for a public tool [P-9.7]", async () => {
    const { origin, connect } = await setup();
    const c = await connect("alice");
    await c.callTool({ name: "get_weather", arguments: { city: "paris" } });
    expect(origin.calls("get_weather").map((s) => s.bearer)).toEqual([SERVICE]);
    await c.close();
  });

  it("MUST NOT let a consumer that trusts the origin accept proxy-signed Data as the origin's [P-9.5]", async () => {
    const { proxy } = await setup();
    const result = await proxy.handleCall("get_weather", { city: "lima" });
    const data = dataFromToolResult(result) as Data;
    // A consumer pinned to the origin's name (with some key the origin would hold) has no key for
    // the proxy: the Data is not the origin's, and nothing about it claims to be.
    const originKey = await generateKeyPair();
    const consumer = new IdemConsumer();
    await consumer.pin("origin.example.com", [originKey.publicKeyJwk]);
    expect(await consumer.verifyToolResult(result)).toMatchObject({ ok: false, code: "UNTRUSTED_KEY" });
    // Relabelling it as the origin's breaks it, whichever field is rewritten [P-5.2].
    const asOrigin = (d: Data): CallToolResult => ({
      ...result,
      _meta: { "dev.idem/data": { name: d.name, meta: { ...d.meta }, signature: { ...d.signature } } },
    });
    const renamed = { ...data, name: data.name.replace(PROXY, "origin.example.com") };
    const relocated = {
      ...renamed,
      signature: { ...data.signature, keyLocator: `/idem/v1/origin.example.com/_key/${originKey.keyId}` },
    };
    expect(await consumer.verifyToolResult(asOrigin(renamed))).toMatchObject({
      ok: false,
      code: "UNTRUSTED_KEY",
    });
    expect(await consumer.verifyToolResult(asOrigin(relocated))).toMatchObject({
      ok: false,
      code: "BAD_SIGNATURE",
    });
    // And the proxy refuses to be configured under the origin's own name.
    await expect(setup({ name: "origin.example.com" })).rejects.toMatchObject({ code: "BAD_POLICY" });
  });

  it("relays a tool the operator did not declare, with the user's credential, never signed or cached [P-9.6]", async () => {
    const { origin, connect } = await setup();
    const c = await connect("alice");
    const a = await c.callTool({ name: "send_email", arguments: { city: "x@y.z" } });
    const b = await c.callTool({ name: "send_email", arguments: { city: "x@y.z" } });
    expect(textOf(a)).toBe("sent to x@y.z");
    expect(textOf(b)).toBe("sent to x@y.z");
    expect(dataFromToolResult(b as never)).toBeUndefined();
    expect(origin.calls("send_email").map((s) => s.bearer)).toEqual(["alice", "alice"]);
    await c.close();
  });

  it("MUST NOT cache a tool without readOnlyHint unless the operator asserts it, nor one marked false [P-6.1, P-9.6]", async () => {
    const lookup = { cacheable: true, ttlMs: 60_000, scope: "public" } as const;
    await expect(setup({ tools: { ...POLICIES, lookup } })).rejects.toMatchObject({ code: "BAD_POLICY" });
    await expect(
      setup({ tools: { ...POLICIES, send_email: { ...lookup, operatorAssertsReadOnly: true } } }),
    ).rejects.toMatchObject({ code: "BAD_POLICY" });
    const { origin, proxy, connect } = await setup({
      tools: { ...POLICIES, lookup: { ...lookup, operatorAssertsReadOnly: true } },
    });
    const listed = proxy.toolList().find((t) => t.name === "lookup") as unknown as {
      annotations?: { readOnlyHint?: boolean };
      _meta: Record<string, unknown>;
    };
    expect(listed.annotations?.readOnlyHint).toBe(true);
    expect(listed._meta[ORIGIN_META_KEY]).toEqual({ origin: ORIGIN_URL, readOnlyHint: "operator" });
    const c = await connect();
    await c.callTool({ name: "lookup", arguments: { city: "oslo" } });
    await c.callTool({ name: "lookup", arguments: { city: "oslo" } });
    expect(origin.calls("lookup")).toHaveLength(1);
    await c.close();
  });

  it("MUST forward the user's credential for a private tool and sign it private: no cross-user answers [P-9.7]", async () => {
    const { origin, connect } = await setup();
    const [alice, bob] = await Promise.all([connect("alice"), connect("bob")]);
    const args = { name: "my_inbox", arguments: { city: "any" } };
    const [ra, rb] = await Promise.all([alice.callTool(args), bob.callTool(args)]);
    expect(textOf(ra)).toBe("inbox of alice");
    expect(textOf(rb)).toBe("inbox of bob");
    expect(dataFromToolResult(ra as never)?.meta.scope).toBe("private");
    const again = [await alice.callTool(args), await bob.callTool(args)];
    expect(again.map(textOf)).toEqual(["inbox of alice", "inbox of bob"]);
    expect(
      origin
        .calls("my_inbox")
        .map((s) => s.bearer)
        .sort(),
    ).toEqual(["alice", "bob"]); // then hits
    await Promise.all([alice.close(), bob.close()]);
  });

  it("MUST NOT cache an origin error or isError result [P-5.3, P-7.2]", async () => {
    const { origin, connect } = await setup();
    const c = await connect();
    const call = { name: "flaky", arguments: { city: "rome" } };
    const first = (await c.callTool(call)) as Result;
    expect(first.isError).toBe(true);
    expect(dataFromToolResult(first)?.meta.freshnessMs ?? 0).toBe(0);
    expect(textOf(await c.callTool(call))).toBe("flaky rome");
    expect(textOf(await c.callTool(call))).toBe("flaky rome");
    expect(origin.calls("flaky")).toHaveLength(2);
    const broken = { name: "broken", arguments: { city: "rome" } };
    expect(((await c.callTool(broken)) as Result).isError).toBe(true);
    expect(((await c.callTool(broken)) as Result).isError).toBe(true);
    expect(origin.calls("broken")).toHaveLength(2);
    await c.close();
  });

  it("MUST NOT sign under a stale schema digest after the origin changes; refresh() re-enables it [P-9.8]", async () => {
    const changes: string[] = [];
    const { origin, proxy } = await setup({
      onSchemaChange: (c) => changes.push(c.tool),
      manifestVersion: 7,
    });
    const m1 = await proxy.manifest();
    expect(m1.version).toBe(7);
    const p1 = m1.tools.find((t) => t.tool === "get_weather");
    const old = await buildInterest({
      producer: PROXY,
      identity: proxy.identity("get_weather"),
      policy: p1!,
      args: { city: "rio" },
    });
    expect((await proxy.handleInterest(old.interest)).name).toBe(old.interest.name);

    // The origin redeploys get_weather with a new optional field.
    origin.state.weatherSchema = {
      ...CITY,
      properties: { city: { type: "string" }, units: { type: "string" } },
    };
    const err = await proxy.handleInterest({ ...old.interest, nonce: "n2" }).catch((e: unknown) => e);
    expect(isIdemError(err, "NOT_CACHEABLE")).toBe(true);
    expect(changes).toEqual(["get_weather"]);
    const m2 = await proxy.manifest();
    expect(m2.version).toBe(8);
    expect(m2.tools.find((t) => t.tool === "get_weather")?.cacheable).toBe(false);
    // Held: a plain call still answers, unsigned; an Interest for the old name gets no answer.
    // The tool is still the operator's public tool, so the origin never sees the user's bearer [P-9.7].
    const plain = await proxy.handleCall("get_weather", { city: "rio" }, { auth: "alice" });
    expect(textOf(plain)).toBe("weather in rio");
    expect(dataFromToolResult(plain)).toBeUndefined();
    expect(new Set(origin.calls("get_weather").map((s) => s.bearer))).toEqual(new Set([SERVICE]));
    await expect(proxy.handleInterest({ ...old.interest, nonce: "n3" })).rejects.toMatchObject({
      code: "NOT_CACHEABLE",
    });

    const r = await proxy.refresh();
    expect(r).toMatchObject({ changed: true, refused: {} });
    const m3 = await proxy.manifest();
    expect(m3.version).toBe(9);
    const p3 = m3.tools.find((t) => t.tool === "get_weather");
    expect(p3?.cacheable).toBe(true);
    expect(p3?.schemaDigest).not.toBe(p1?.schemaDigest);
    // The old name never gets an answer again; the new name does.
    await expect(proxy.handleInterest({ ...old.interest, nonce: "n4" })).rejects.toMatchObject({
      code: "DIGEST_MISMATCH",
    });
    const fresh = await buildInterest({
      producer: PROXY,
      identity: proxy.identity("get_weather"),
      policy: p3!,
      args: { city: "rio" },
    });
    expect((await proxy.handleInterest(fresh.interest)).name).not.toBe(old.interest.name);
    expect(await proxy.refresh()).toMatchObject({ changed: false, manifestVersion: m3.version });
  });

  it("MUST NOT forward the user's credential for a declared public tool once held or refused [P-9.7]", async () => {
    // The origin, not the operator, decides when a tool is held or refused, so the credential must
    // follow the operator's declaration, not the tool's current cacheable state.
    const { origin, proxy } = await setup();
    const alice = { auth: "alice" };
    expect(dataFromToolResult(await proxy.handleCall("get_weather", { city: "rio" }, alice))).toBeDefined();
    origin.state.weatherSchema = {
      ...CITY,
      properties: { city: { type: "string" }, units: { type: "string" } },
    };
    await proxy.handleCall("get_weather", { city: "rio" }, alice); // sees the drift: held
    await proxy.handleCall("get_weather", { city: "rio" }, alice); // relayed while held
    origin.state.weatherHint = false;
    expect((await proxy.refresh()).refused).toHaveProperty("get_weather");
    const relayed = await proxy.handleCall("get_weather", { city: "rio" }, alice); // refused: relayed
    expect(dataFromToolResult(relayed)).toBeUndefined();
    expect(origin.calls("get_weather").map((s) => s.bearer)).toEqual([SERVICE, SERVICE, SERVICE, SERVICE]);
    // A tool with no declaration, or declared private, is relayed with the user's credential.
    await proxy.handleCall("send_email", { city: "x@y.z" }, alice);
    expect(origin.calls("send_email").map((s) => s.bearer)).toEqual(["alice"]);
  });
});
