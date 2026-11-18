import { parseName } from "@idem/core";
import { HEADERS, PATHS, parseTrace } from "@idem/gateway";

/**
 * What the deployed edge saw, so the Live example can show that its cache is shared between
 * visitors (ADR-030). The edge route records, for each call that reaches it, which tab sent it (an
 * anonymous id the page makes up, `idem-visitor`), the tool, the args digest (public names only)
 * and how the edge answered. It never records arguments, results or credentials, and private
 * names and plain calls are listed without a digest.
 *
 * It also tells a caller whose call was answered from the Content Store or joined a pending
 * Interest whether that name was first fetched by this tab or by another one (`idem-filled-by`).
 * All of this lives in the memory of the instance that also holds the edge's CS, so what it says is
 * true of that instance; `idem-edge-instance` names it.
 */

export const VISITOR_HEADER = "idem-visitor";
export const FILLED_HEADER = "idem-filled-by";
export const INSTANCE_HEADER = "idem-edge-instance";

/** How the edge answered a call. */
export type Outcome = "hit" | "aggregate" | "miss" | "bypass" | "error";

/** One call at the edge, as recorded. */
export interface ActivityEntry {
  seq: number;
  /** Wall-clock ms. */
  t: number;
  /** The sender's anonymous id (never sent back to other visitors). */
  visitor: string;
  tool: string;
  /** First characters of the args digest (public names only). */
  digest?: string;
  outcome: Outcome;
  /** For a hit or an aggregation: whether the sender itself or another visitor filled the name. */
  filled?: "self" | "other";
}

/** An entry as one visitor sees it. */
export interface ActivityView {
  seq: number;
  /** Ms before the response was made. */
  ago: number;
  mine: boolean;
  /** A short label for the sender, the same for one visitor across entries (not its id). */
  who: string;
  tool: string;
  digest?: string;
  outcome: Outcome;
  filled?: "self" | "other";
}

const KEEP = 200;
const WINDOW_MS = 10 * 60_000;
const OWNERS = 2000;
const VISITOR_RE = /^[A-Za-z0-9_-]{8,40}$/;

/** The visitor id on a request, if it is well formed. */
export function visitorOf(req: Request): string | undefined {
  const v = req.headers.get(VISITOR_HEADER);
  return v && VISITOR_RE.test(v) ? v : undefined;
}

/** A short, stable label for a visitor id (FNV-1a, salted per instance). */
function label(visitor: string, salt: string): string {
  let h = 0x811c9dc5;
  for (const c of salt + visitor) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).slice(-4).padStart(4, "0");
}

/** The edge's activity log and the name owners, for one instance. */
export class EdgeActivity {
  readonly instance: string;
  readonly #now: () => number;
  readonly #entries: ActivityEntry[] = [];
  /** Who first fetched each public name (the call that went upstream). */
  readonly #owners = new Map<string, { visitor: string; t: number }>();
  #seq = 0;

  constructor(opts: { instance?: string; now?: () => number } = {}) {
    this.instance = opts.instance ?? Math.random().toString(36).slice(2, 8);
    this.#now = opts.now ?? Date.now;
  }

  /**
   * Run `handle` for an edge request and record it. Only `POST` Interests and calls are recorded;
   * everything else passes through untouched (but for the instance header).
   */
  async record(req: Request, handle: (req: Request) => Promise<Response>): Promise<Response> {
    const path = new URL(req.url).pathname;
    const isInterest = req.method === "POST" && path.endsWith(PATHS.interest);
    const isCall = req.method === "POST" && path.endsWith(PATHS.call);
    if (!isInterest && !isCall) return this.#withHeaders(await handle(req), {});
    const visitor = visitorOf(req) ?? "anonymous";
    const body = (await req
      .clone()
      .json()
      .catch(() => undefined)) as { name?: unknown; tool?: unknown } | undefined;
    let name: string | undefined;
    let tool = typeof body?.tool === "string" ? body.tool.slice(0, 64) : "?";
    let digest: string | undefined;
    if (isInterest && typeof body?.name === "string") {
      try {
        const p = parseName(body.name);
        name = body.name;
        tool = p.tool.slice(0, 64);
        digest = p.argsDigest.slice(0, 8);
      } catch {
        name = undefined;
      }
    }
    // The first asker of a name not yet owned owns it while its Interest is pending, so a call
    // that joins that Interest knows who it is waiting for.
    const now = this.#now();
    const owner = name ? this.#owners.get(name) : undefined;
    if (name && (!owner || now - owner.t > WINDOW_MS)) this.#own(name, visitor, now);

    const res = await handle(req);
    const kinds = new Set((parseTrace(res.headers.get(HEADERS.trace))[0]?.events ?? []).map((e) => e.kind));
    let outcome: Outcome;
    if (isCall) outcome = res.ok ? "bypass" : "error";
    else if (!res.ok) outcome = "error";
    else if (kinds.has("cs_hit")) outcome = "hit";
    else if (kinds.has("pit_aggregate")) outcome = "aggregate";
    else outcome = "miss";

    // A private answer is per credential: no digest, no owner.
    let scope: unknown;
    if (isInterest && res.ok) {
      const data = (await res
        .clone()
        .json()
        .catch(() => undefined)) as { meta?: { scope?: unknown } } | undefined;
      scope = data?.meta?.scope;
    }
    const shared = name !== undefined && scope === "public";
    if (!shared) digest = undefined;
    if (shared && name && outcome === "miss") this.#own(name, visitor, this.#now());

    let filled: "self" | "other" | undefined;
    if (shared && name && (outcome === "hit" || outcome === "aggregate")) {
      const o = this.#owners.get(name);
      if (o) filled = o.visitor === visitor ? "self" : "other";
    }
    this.#push({
      seq: ++this.#seq,
      t: this.#now(),
      visitor,
      tool,
      ...(digest && { digest }),
      outcome,
      ...(filled && { filled }),
    });
    return this.#withHeaders(res, filled ? { [FILLED_HEADER]: filled } : {});
  }

  /** Entries after `after`, as `visitor` sees them (newest last). */
  view(visitor: string | undefined, after = 0): { instance: string; seq: number; entries: ActivityView[] } {
    const now = this.#now();
    this.#prune(now);
    return {
      instance: this.instance,
      seq: this.#seq,
      entries: this.#entries
        .filter((e) => e.seq > after)
        .map((e) => ({
          seq: e.seq,
          ago: Math.max(0, now - e.t),
          mine: visitor !== undefined && e.visitor === visitor,
          who: label(e.visitor, this.instance),
          tool: e.tool,
          ...(e.digest && { digest: e.digest }),
          outcome: e.outcome,
          ...(e.filled && { filled: e.filled }),
        })),
    };
  }

  #own(name: string, visitor: string, t: number): void {
    this.#owners.delete(name);
    this.#owners.set(name, { visitor, t });
    while (this.#owners.size > OWNERS) {
      const oldest = this.#owners.keys().next().value;
      if (oldest === undefined) break;
      this.#owners.delete(oldest);
    }
  }

  #push(e: ActivityEntry): void {
    this.#entries.push(e);
    this.#prune(e.t);
  }

  #prune(now: number): void {
    while (this.#entries.length > KEEP) this.#entries.shift();
    while (this.#entries[0] && now - this.#entries[0].t > WINDOW_MS) this.#entries.shift();
  }

  #withHeaders(res: Response, extra: Record<string, string>): Response {
    const headers = new Headers(res.headers);
    headers.set(INSTANCE_HEADER, this.instance);
    for (const [k, v] of Object.entries(extra)) headers.set(k, v);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
}
