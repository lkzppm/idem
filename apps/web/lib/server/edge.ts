import { createGateway, type Gateway } from "@idem/gateway";
import { DEMO_PRODUCER } from "./demo-producer";

let gateway: Gateway | undefined;

/**
 * The edge gateway (one per server instance, so its PIT and CS live in this instance's memory).
 * Its upstream is the demo producer, reached over real HTTP: `IDEM_PRODUCER_URL`, or this
 * deployment's own `/api/producer`.
 */
export function edgeGateway(req: Request): Gateway {
  if (!gateway) {
    const url = process.env.IDEM_PRODUCER_URL ?? `${new URL(req.url).origin}/api/producer`;
    gateway = createGateway({
      id: "edge",
      basePath: "/api/edge",
      upstreams: [{ producer: DEMO_PRODUCER, url, kind: "producer" }],
      authSecret: process.env.IDEM_EDGE_SECRET ?? "idem-demo-edge-secret",
    });
  }
  return gateway;
}
