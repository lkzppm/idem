/**
 * `@idem/mcp`: IDEM for the Model Context Protocol (SDK v2, spec 2026-07-28).
 *
 * - {@link createMcpProducer}: serve an IDEM {@link Producer} as a stateless MCP server. Results of
 *   cacheable tools carry the signed Data in `_meta["dev.idem/data"]`; clients unaware of IDEM
 *   ignore it (protocol §9.1).
 * - {@link createMcpEdge}: a transparent MCP endpoint backed by an IDEM edge gateway. Unmodified MCP
 *   clients (any agent) connect to it; read-only cacheable calls are named, aggregated, cached and
 *   verified on the way.
 * - {@link IdemConsumer}: verify a `CallToolResult` received over MCP [P-5.5].
 *
 * @packageDocumentation
 */

import {
  type CallToolResult,
  dataFromToolResult,
  type JsonSchema,
  META_KEYS,
  type Producer,
  type ToolInfo,
  TrustStore,
  type VerifyResult,
  verifyData,
} from "@idem/core";
import { type Gateway, IdemClient } from "@idem/gateway";
import {
  createMcpHandler,
  fromJsonSchema,
  type JsonSchemaType,
  type CallToolResult as McpCallToolResult,
  type McpHttpHandler,
  McpServer,
} from "@modelcontextprotocol/server";

/** MCP server identity. */
export interface McpServerInfo {
  name: string;
  version: string;
}

function bearer(h: string | null | undefined): string | undefined {
  const m = h ? /^Bearer\s+(.+)$/i.exec(h.trim()) : null;
  return m ? (m[1] as string) : undefined;
}

type Ctx = { http?: { req?: Request } };

function register(
  server: McpServer,
  tool: ToolInfo,
  run: (args: unknown, auth: string | undefined) => Promise<CallToolResult>,
): void {
  server.registerTool(
    tool.name,
    {
      ...(tool.description !== undefined && { description: tool.description }),
      inputSchema: fromJsonSchema(tool.inputSchema as JsonSchemaType),
      ...(tool.annotations !== undefined && { annotations: tool.annotations }),
    },
    async (args: unknown, ctx: Ctx) =>
      (await run(args, bearer(ctx.http?.req?.headers.get("authorization")))) as unknown as McpCallToolResult,
  );
}

/**
 * Serve a {@link Producer} over MCP Streamable HTTP (stateless, 2026-07-28 plus 2025-era clients).
 * `tools/call` runs {@link Producer.handleCall}: cacheable results are signed and carry
 * `_meta["dev.idem/data"]`. The credential is `Authorization: Bearer`.
 */
export function createMcpProducer(producer: Producer, info: McpServerInfo): McpHttpHandler {
  const tools = producer.toolList();
  return createMcpHandler(() => {
    const server = new McpServer(info, { capabilities: { tools: {} } });
    for (const t of tools) {
      register(server, t, (args, auth) =>
        producer.handleCall(t.name, args, auth !== undefined ? { auth } : {}),
      );
    }
    return server;
  });
}

/** Options of {@link createMcpEdge}. */
export interface McpEdgeOptions {
  /** The IDEM edge gateway this MCP endpoint fronts. */
  gateway: Gateway;
  /** Producer whose tools are exposed. */
  producer: string;
  info: McpServerInfo;
  /** Max cached per-credential clients. Default 512. */
  maxClients?: number;
}

/**
 * A transparent MCP endpoint backed by an IDEM edge (protocol §9.1, "consumer → edge: plain MCP").
 * It lists the producer's tools; each `tools/call` goes through the edge's forwarder engine
 * in-process: cacheable calls become Interests (PIT aggregation, CS, signature verification),
 * others pass through. Results keep `_meta["dev.idem/data"]` so IDEM-aware clients can re-verify.
 *
 * Async because it must learn the tool list (and verify the manifest) before serving.
 */
export async function createMcpEdge(opts: McpEdgeOptions): Promise<McpHttpHandler> {
  const inProcess: typeof fetch = (input, init) => opts.gateway.handle(new Request(input, init));
  const trust = new TrustStore();
  const make = (credential?: string) =>
    new IdemClient({
      edge: "http://edge.internal",
      producer: opts.producer,
      fetch: inProcess,
      trust,
      ...(credential !== undefined && { credential }),
    });
  const anonymous = make();
  const { tools } = await anonymous.init();
  const clients = new Map<string, IdemClient>();
  const clientFor = (credential: string | undefined): IdemClient => {
    if (credential === undefined) return anonymous;
    let c = clients.get(credential);
    if (!c) {
      if (clients.size >= (opts.maxClients ?? 512)) clients.delete(clients.keys().next().value as string);
      c = make(credential);
      clients.set(credential, c);
    }
    return c;
  };

  return createMcpHandler(() => {
    const server = new McpServer(opts.info, { capabilities: { tools: {} } });
    for (const t of tools) {
      register(server, t, async (args, auth) => {
        const out = await clientFor(auth).call(t.name, args);
        // Plain call, or an answer that failed verification even after the retry: `out.result` is
        // then the tool's own result or an error result, never unverified content [P-5.5].
        if (!out.data || !out.verify?.ok) return out.result;
        // Return the verified content plus the signed envelope for end-to-end re-verification.
        const meta = { ...(out.result._meta ?? {}) };
        meta[META_KEYS.data] = {
          name: out.data.name,
          meta: { ...out.data.meta },
          signature: { ...out.data.signature },
        };
        return { ...out.data.content, _meta: meta };
      });
    }
    return server;
  });
}

/**
 * Verifies IDEM-signed tool results received over MCP (03-api, `IdemConsumer`). Results without
 * `_meta["dev.idem/data"]` are reported as unsigned, not as failures.
 */
export class IdemConsumer {
  readonly trust: TrustStore;

  constructor(opts: { trust?: TrustStore } = {}) {
    this.trust = opts.trust ?? new TrustStore();
  }

  /** Pin producer keys [P-6.2]. */
  async pin(producer: string, keys: JsonWebKey[]): Promise<void> {
    for (const k of keys) await this.trust.pin(producer, k);
  }

  /** Verify the signed Data carried by a tool result. */
  async verifyToolResult(
    result: CallToolResult,
  ): Promise<VerifyResult | { ok: false; code: "UNSIGNED"; reason: string }> {
    const data = dataFromToolResult(result);
    if (!data) return { ok: false, code: "UNSIGNED", reason: "result carries no dev.idem/data" };
    return verifyData(data, this.trust);
  }
}

export type { JsonSchema };
