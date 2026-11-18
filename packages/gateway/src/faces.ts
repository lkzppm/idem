import { type Data, type Face, type Packet, randomNonce } from "@idem/core";
import { HEADERS, isWireError, PATHS, parseTrace, type TraceHop } from "./wire";

/**
 * Upstream face over HTTP: Interests become `POST /idem/v1/interest`, calls become
 * `POST /idem/v1/call`. Each HTTP response is turned back into a Data / Nack / Result packet
 * carrying the request's nonce (HTTP gives the hop-by-hop correlation for free).
 */
export class HttpUpstreamFace implements Face {
  readonly id: string;
  readonly #url: string;
  readonly #fetch: typeof fetch;
  readonly #fromForwarder: string;
  #cb: ((p: Packet) => void | Promise<void>) | undefined;
  #closed = false;
  /** Latest upstream trace per name (attached to downstream responses). */
  readonly traces = new Map<string, TraceHop[]>();

  constructor(opts: {
    id: string;
    url: string;
    fetch?: typeof fetch;
    forwarderId: string;
  }) {
    this.id = opts.id;
    this.#url = opts.url.replace(/\/$/, "");
    this.#fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.#fromForwarder = opts.forwarderId;
  }

  onReceive(cb: (p: Packet) => void | Promise<void>): void {
    this.#cb = cb;
  }

  close(): void {
    this.#closed = true;
  }

  #deliver(p: Packet): void {
    if (!this.#closed) void this.#cb?.(p);
  }

  #headers(auth: string | undefined): Headers {
    const h = new Headers();
    h.set("content-type", "application/json");
    h.set(HEADERS.forwarder, this.#fromForwarder);
    if (auth !== undefined) h.set("authorization", `Bearer ${auth}`);
    return h;
  }

  send(p: Packet): void {
    if (this.#closed) return;
    if (p.type === "interest") void this.#sendInterest(p);
    else if (p.type === "call") void this.#sendCall(p);
  }

  async #sendInterest(p: Extract<Packet, { type: "interest" }>): Promise<void> {
    const I = p.interest;
    try {
      const res = await this.#fetch(`${this.#url}${PATHS.interest}`, {
        method: "POST",
        headers: this.#headers(p.auth),
        body: JSON.stringify(I),
        signal: AbortSignal.timeout(I.lifetimeMs),
      });
      this.traces.set(I.name, parseTrace(res.headers.get(HEADERS.trace)));
      const body = (await res.json()) as unknown;
      if (res.ok) this.#deliver({ type: "data", nonce: I.nonce, data: body as Data });
      else if (isWireError(body)) {
        this.#deliver({ type: "nack", nonce: I.nonce, name: I.name, code: body.code, message: body.message });
      } else
        this.#deliver({
          type: "nack",
          nonce: I.nonce,
          name: I.name,
          code: "UPSTREAM_ERROR",
          message: `HTTP ${res.status}`,
        });
    } catch (e) {
      const timeout = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
      this.#deliver({
        type: "nack",
        nonce: I.nonce,
        name: I.name,
        code: timeout ? "TIMEOUT" : "UPSTREAM_ERROR",
        message: e instanceof Error ? e.message : "fetch failed",
      });
    }
  }

  async #sendCall(p: Extract<Packet, { type: "call" }>): Promise<void> {
    try {
      const res = await this.#fetch(`${this.#url}${PATHS.call}`, {
        method: "POST",
        headers: this.#headers(p.auth),
        body: JSON.stringify({ producer: p.producer, tool: p.tool, args: p.args }),
        signal: AbortSignal.timeout(p.lifetimeMs ?? 30_000),
      });
      const body = (await res.json()) as unknown;
      if (res.ok) this.#deliver({ type: "result", id: p.id, result: body as never });
      else {
        const err = isWireError(body)
          ? body
          : { code: "UPSTREAM_ERROR" as const, message: `HTTP ${res.status}` };
        this.#deliver({ type: "nack", nonce: p.id, code: err.code, message: err.message });
      }
    } catch (e) {
      this.#deliver({
        type: "nack",
        nonce: p.id,
        code: "UPSTREAM_ERROR",
        message: e instanceof Error ? e.message : "fetch failed",
      });
    }
  }
}

/**
 * Downstream face for one HTTP request: the forwarder's answer (Data, Nack or Result) resolves
 * {@link RequestFace.answer}.
 */
export class RequestFace implements Face {
  readonly id = `req:${randomNonce()}`;
  readonly answer: Promise<Packet>;
  #resolve!: (p: Packet) => void;

  constructor() {
    this.answer = new Promise((r) => {
      this.#resolve = r;
    });
  }
  send(p: Packet): void {
    if (p.type === "data" || p.type === "nack" || p.type === "result") this.#resolve(p);
  }
  onReceive(): void {}
  close(): void {}
}
