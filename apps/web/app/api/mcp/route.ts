import { createMcpEdge } from "@idem/mcp";
import { DEMO_PRODUCER } from "@/lib/server/demo-producer";
import { edgeGateway } from "@/lib/server/edge";

// The IDEM edge as a plain MCP endpoint (Streamable HTTP, stateless). Any MCP client can connect;
// read-only cacheable calls are named, aggregated, cached and verified on the way.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

let handler: ReturnType<typeof createMcpEdge> | undefined;

async function handle(req: Request): Promise<Response> {
  handler ??= createMcpEdge({
    gateway: edgeGateway(req),
    producer: DEMO_PRODUCER,
    info: { name: "idem-edge", version: "0.0.0" },
  }).catch((e: unknown) => {
    handler = undefined;
    throw e;
  });
  return (await handler).fetch(req);
}

export { handle as DELETE, handle as GET, handle as POST };
