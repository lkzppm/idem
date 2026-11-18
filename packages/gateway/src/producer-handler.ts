import { type Interest, isIdemError, type Producer, wireCode } from "@idem/core";
import { errorResponse, formatTrace, HEADERS, json, PATHS, routePath } from "./wire";

/** Extract the end-user credential from `Authorization: Bearer <token>`. */
export function credentialOf(req: Request): string | undefined {
  const h = req.headers.get("authorization");
  if (!h) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? (m[1] as string) : undefined;
}

/** Options of {@link createProducerHandler}. */
export interface ProducerHandlerOptions {
  /** Path prefix the handler is mounted under (e.g. `/api/producer`). */
  basePath?: string;
  /** Node id used in traces. Default `"producer"`. */
  id?: string;
}

/**
 * Serve a {@link Producer} over the IDEM HTTP binding (protocol §9.1):
 *
 * - `GET  /.well-known/idem.json` — signed manifest
 * - `GET  /idem/v1/tools` — tool list (what MCP `tools/list` returns)
 * - `POST /idem/v1/interest` — Interest JSON → Data JSON, or `{ code, message }`
 * - `POST /idem/v1/call` — `{ tool, args }` → `CallToolResult` (passthrough, with signed `_meta`
 *   for cacheable tools)
 *
 * The credential travels in `Authorization: Bearer`. The handler is a Web-standard
 * `(Request) => Promise<Response>`.
 */
export function createProducerHandler(producer: Producer, opts: ProducerHandlerOptions = {}) {
  const node = opts.id ?? "producer";
  return async function handle(req: Request): Promise<Response> {
    const path = routePath(req, opts.basePath);
    const auth = credentialOf(req);
    const ctx = auth !== undefined ? { auth } : {};
    if (req.method === "GET" && path === PATHS.manifest) {
      return json(await producer.manifest(), { headers: { "cache-control": "public, max-age=60" } });
    }
    if (req.method === "GET" && path === PATHS.tools) return json(producer.toolList());
    if (req.method === "POST" && path === PATHS.interest) {
      let interest: Interest;
      try {
        interest = (await req.json()) as Interest;
      } catch {
        return errorResponse("NOT_CACHEABLE", "body is not JSON");
      }
      const t0 = Date.now();
      try {
        const data = await producer.handleInterest(interest, ctx);
        const trace = formatTrace([{ node, events: [{ kind: "produce", t: t0, ms: Date.now() - t0 }] }]);
        return json(data, { headers: { [HEADERS.trace]: trace } });
      } catch (e) {
        return errorResponse(wireCode(e), e instanceof Error ? e.message : "error");
      }
    }
    if (req.method === "POST" && path === PATHS.call) {
      try {
        const body = (await req.json()) as { tool: string; args: unknown };
        return json(await producer.handleCall(body.tool, body.args, ctx));
      } catch (e) {
        if (isIdemError(e)) return errorResponse(wireCode(e), e.message);
        return errorResponse("UPSTREAM_ERROR", e instanceof Error ? e.message : "error");
      }
    }
    return json({ error: "not found" }, { status: 404 });
  };
}
