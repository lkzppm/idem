/**
 * `@idem/gateway`: the IDEM HTTP overlay binding (protocol §9.1). A producer endpoint, an HTTP
 * forwarder (edge or regional) running the `@idem/core` engine, and a verifying consumer client.
 * Everything is a Web-standard `(Request) => Promise<Response>` handler or uses `fetch`.
 *
 * @packageDocumentation
 */

export { type CallOutcome, IdemClient, type IdemClientOptions } from "./client";
export { HttpUpstreamFace, RequestFace } from "./faces";
export { createGateway, type Gateway, type GatewayOptions, type Upstream } from "./gateway";
export { createProducerHandler, credentialOf, type ProducerHandlerOptions } from "./producer-handler";
export {
  errorResponse,
  formatTrace,
  HEADERS,
  isWireError,
  json,
  PATHS,
  parseTrace,
  routePath,
  statusFor,
  type TraceHop,
  type WireError,
} from "./wire";
