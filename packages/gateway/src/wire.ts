import type { ForwarderEvent, IdemWireErrorCode } from "@idem/core";

/** HTTP paths of the IDEM overlay binding (protocol §9.1). */
export const PATHS = {
  interest: "/idem/v1/interest",
  call: "/idem/v1/call",
  manifest: "/.well-known/idem.json",
  tools: "/idem/v1/tools",
} as const;

/** HTTP headers of the overlay binding. */
export const HEADERS = {
  /** Set by forwarders on upstream requests: the downstream is a forwarder, not a consumer. */
  forwarder: "idem-forwarder",
  /** Response: compact trace of the forwarder events this request caused, hop by hop (JSON). */
  trace: "idem-trace",
} as const;

/** Error body `{ code, message }` (protocol §9.1). */
export interface WireError {
  code: IdemWireErrorCode;
  message: string;
}

const STATUS: Record<IdemWireErrorCode, number> = {
  DIGEST_MISMATCH: 400,
  NOT_CACHEABLE: 422,
  BAD_SIGNATURE: 502,
  EXPIRED: 502,
  UNTRUSTED_KEY: 502,
  UPSTREAM_ERROR: 502,
  TIMEOUT: 504,
  HOP_LIMIT: 508,
  LOOP: 508,
};

const CODES = new Set(Object.keys(STATUS));

/** HTTP status for a wire error code. */
export function statusFor(code: IdemWireErrorCode): number {
  return STATUS[code];
}

/** Type guard for a wire error body. */
export function isWireError(v: unknown): v is WireError {
  return typeof v === "object" && v !== null && CODES.has((v as WireError).code);
}

/** JSON response helper. */
export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}

/** Error response helper. */
export function errorResponse(code: IdemWireErrorCode, message: string, headers?: HeadersInit): Response {
  return json({ code, message } satisfies WireError, {
    status: statusFor(code),
    ...(headers && { headers }),
  });
}

/** One hop of a request trace: the events one node emitted for this request. */
export interface TraceHop {
  node: string;
  /** Forwarder events (minus `node`/`name`), or binding events such as the producer's `produce`. */
  events: { kind: ForwarderEvent["kind"] | "produce"; t: number; [field: string]: unknown }[];
}

/** Parse the `idem-trace` header (never throws). */
export function parseTrace(h: string | null): TraceHop[] {
  if (!h) return [];
  try {
    const v = JSON.parse(h) as unknown;
    return Array.isArray(v) ? (v as TraceHop[]) : [];
  } catch {
    return [];
  }
}

/** Serialize a trace for the `idem-trace` header (ASCII JSON, bounded size). */
export function formatTrace(hops: TraceHop[]): string {
  const s = JSON.stringify(hops);
  return s.length > 6000 ? JSON.stringify(hops.slice(0, 1)) : s;
}

/** Strip the path prefix a framework mounted the handler under (e.g. `/api/edge`). */
export function routePath(req: Request, basePath = ""): string {
  const p = new URL(req.url).pathname;
  return basePath && p.startsWith(basePath) ? p.slice(basePath.length) || "/" : p;
}
