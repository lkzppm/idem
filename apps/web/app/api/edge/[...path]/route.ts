import { edgeActivity, edgeGateway } from "@/lib/server/edge";
import { visitorOf } from "@/lib/server/edge-activity";

// The edge forwarder (PIT, CS, FIB) running @idem/core with the wall clock. `activity` lists what
// this instance's edge saw (ADR-030); it lives on the same route so it shares the edge's memory.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname === "/api/edge/activity") {
    const after = Number(url.searchParams.get("after")) || 0;
    const body = edgeActivity().view(visitorOf(req), after);
    return Promise.resolve(Response.json(body, { headers: { "cache-control": "no-store" } }));
  }
  const gateway = edgeGateway(req);
  return edgeActivity().record(req, (r) => gateway.handle(r));
}

export { handle as GET, handle as POST };
