import { createProducerHandler } from "@idem/gateway";
import { createMcpProducer } from "@idem/mcp";
import { demoProducer } from "@/lib/server/demo-producer";

// The demo IDEM producer. Two bindings over HTTP (protocol §9.1):
//   /api/producer/mcp                      MCP Streamable HTTP (results carry signed _meta)
//   /api/producer/.well-known/idem.json    signed manifest
//   /api/producer/idem/v1/{interest,call,tools}
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let mcp: ReturnType<typeof createMcpProducer> | undefined;

async function handle(req: Request): Promise<Response> {
  const producer = await demoProducer();
  if (new URL(req.url).pathname === "/api/producer/mcp") {
    mcp ??= createMcpProducer(producer, { name: "idem-demo-producer", version: "0.0.0" });
    return mcp.fetch(req);
  }
  return createProducerHandler(producer, { basePath: "/api/producer" })(req);
}

export { handle as DELETE, handle as GET, handle as POST };
