import { edgeGateway } from "@/lib/server/edge";

// The edge forwarder (PIT, CS, FIB) running @idem/core with the wall clock.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function handle(req: Request): Promise<Response> {
  return edgeGateway(req).handle(req);
}

export { handle as GET, handle as POST };
