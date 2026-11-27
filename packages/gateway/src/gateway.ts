import {
  type ContentStore,
  Fib,
  Forwarder,
  type ForwarderEvent,
  type Interest,
  type Manifest,
  type PitLimits,
  parseName,
  RealClock,
  TrustStore,
} from "@idem/core";
import { HttpUpstreamFace, RequestFace } from "./faces";
import { credentialOf } from "./producer-handler";
import { errorResponse, formatTrace, HEADERS, json, PATHS, routePath, type TraceHop } from "./wire";

/** An upstream next hop for a producer. */
export interface Upstream {
  /** Producer name, e.g. `demo.idem.dev`. */
  producer: string;
  /** Base URL of the next hop (the producer itself or another forwarder). */
  url: string;
  kind: "producer" | "forwarder";
  /**
   * Where to fetch the producer's signed manifest. Default: `<url>/.well-known/idem.json` for a
   * producer, `<url>/idem/v1/manifest/<producer>` for a forwarder.
   */
  manifestUrl?: string;
}

/** Options of {@link createGateway} (03-api). */
export interface GatewayOptions {
  /** Node id (events and traces). */
  id: string;
  upstreams: Upstream[];
  cs?: ContentStore;
  trust?: TrustStore;
  pit?: PitLimits;
  /** Edge secret for `authContext = HMAC(secret, credential)` [P-8.4]. */
  authSecret?: string;
  /** Clock tolerance of the signed-lifetime check [P-8.6]. Default `DEFAULT_CLOCK_TOLERANCE_MS`. */
  clockToleranceMs?: number;
  /** [P-7.1] experiment flag only. */
  verifyOnInsert?: boolean;
  /** Path prefix the handler is mounted under (e.g. `/api/edge`). */
  basePath?: string;
  /** Injected `fetch` (tests, service bindings). */
  fetch?: typeof fetch;
  onEvent?: (e: ForwarderEvent) => void;
}

/** A running HTTP forwarder. */
export interface Gateway {
  /** Web-standard handler for every IDEM route. */
  handle(req: Request): Promise<Response>;
  readonly forwarder: Forwarder;
  readonly trust: TrustStore;
}

const MAX_LIFETIME_MS = 30_000;

function sanitizeInterest(v: unknown): Interest | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const i = v as Partial<Interest>;
  if (typeof i.name !== "string" || typeof i.nonce !== "string" || i.nonce.length > 64) return undefined;
  if (!Number.isInteger(i.hopLimit)) return undefined;
  return {
    name: i.name,
    args: (i.args ?? {}) as Interest["args"],
    mustBeFresh: i.mustBeFresh !== false,
    lifetimeMs: Math.min(MAX_LIFETIME_MS, Math.max(100, Number(i.lifetimeMs) || 10_000)),
    nonce: i.nonce,
    hopLimit: i.hopLimit as number,
  };
}

/**
 * HTTP forwarder (edge or regional) running the `@idem/core` engine with the wall clock
 * (protocol §7, §9.1). Routes:
 *
 * - `POST /idem/v1/interest` — Interest → Data (from CS, PIT aggregation, or upstream)
 * - `POST /idem/v1/call` — passthrough for non-cacheable tools (bypass)
 * - `GET  /idem/v1/manifest/<producer>` — the signed manifest this node trusts
 * - `GET  /idem/v1/tools/<producer>` — the producer's tool list (proxied)
 *
 * Requests without the `idem-forwarder` header come from consumers: this node is their edge and
 * derives `authContext` from `Authorization: Bearer` [P-8.4]. Every response carries an
 * `idem-trace` header with the events the request caused at each hop.
 */
export function createGateway(opts: GatewayOptions): Gateway {
  const clock = new RealClock();
  const trust = opts.trust ?? new TrustStore();
  const fib = new Fib();
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  /**
   * Per-request trace: events caused by this request's face, plus the shared upstream events
   * (data_in, verify, cs_insert, pit_satisfy) of the PIT entry it created or joined.
   */
  const collectors = new Set<{
    name: string;
    face: string;
    joined: boolean;
    events: Record<string, unknown>[];
  }>();

  const forwarder = new Forwarder({
    id: opts.id,
    clock,
    fib,
    trust,
    ...(opts.cs && { cs: opts.cs }),
    ...(opts.pit && { pit: opts.pit }),
    ...(opts.authSecret !== undefined && { authSecret: opts.authSecret }),
    ...(opts.clockToleranceMs !== undefined && { clockToleranceMs: opts.clockToleranceMs }),
    ...(opts.verifyOnInsert !== undefined && { verifyOnInsert: opts.verifyOnInsert }),
    onEvent: (e) => {
      for (const c of collectors) {
        if (!("name" in e) || e.name !== c.name) continue;
        const face = "face" in e ? e.face : undefined;
        const mine = face === c.face;
        if (mine && (e.kind === "upstream_out" || e.kind === "pit_aggregate")) c.joined = true;
        if (mine || (face === undefined && c.joined)) {
          const {
            node: _n,
            name: _name,
            face: _f,
            ...rest
          } = e as ForwarderEvent & { name: string; face?: string };
          c.events.push(rest);
        }
      }
      opts.onEvent?.(e);
    },
  });

  const faces = new Map<string, HttpUpstreamFace>();
  for (const u of opts.upstreams) {
    const face = new HttpUpstreamFace({
      id: `up:${u.producer}`,
      url: u.url,
      fetch: doFetch,
      forwarderId: opts.id,
    });
    forwarder.addFace(face);
    fib.addProducer(u.producer, face.id);
    faces.set(u.producer, face);
  }

  const manifests = new Map<string, Promise<Manifest | undefined>>();
  const tools = new Map<string, Promise<unknown>>();
  const base = (u: Upstream) => u.url.replace(/\/$/, "");

  function ensureManifest(producer: string): Promise<Manifest | undefined> {
    let p = manifests.get(producer);
    if (!p) {
      const u = opts.upstreams.find((x) => x.producer === producer);
      p = (async () => {
        if (!u) return undefined;
        const url =
          u.manifestUrl ??
          (u.kind === "producer" ? `${base(u)}${PATHS.manifest}` : `${base(u)}/idem/v1/manifest/${producer}`);
        const res = await doFetch(url, { headers: { [HEADERS.forwarder]: opts.id } });
        if (!res.ok) throw new Error(`manifest fetch failed: HTTP ${res.status}`);
        const m = (await res.json()) as Manifest;
        if (m.producer !== producer) throw new Error("manifest is for another producer");
        const v = await trust.addManifest(m);
        if (!v.ok) throw new Error(`manifest rejected: ${v.reason}`);
        return m;
      })().catch((e) => {
        manifests.delete(producer); // retry on the next request
        throw e;
      });
      manifests.set(producer, p);
    }
    return p;
  }

  async function onInterest(req: Request): Promise<Response> {
    let interest: Interest | undefined;
    try {
      interest = sanitizeInterest(await req.json());
    } catch {
      interest = undefined;
    }
    if (!interest) return errorResponse("NOT_CACHEABLE", "malformed Interest");
    let producer: string;
    try {
      producer = parseName(interest.name).producer;
      await ensureManifest(producer);
    } catch (e) {
      return errorResponse("UPSTREAM_ERROR", e instanceof Error ? e.message : "bad name");
    }
    const face = new RequestFace();
    const fromForwarder = req.headers.has(HEADERS.forwarder);
    forwarder.addFace(face, { consumer: !fromForwarder });
    const collector = {
      name: interest.name,
      face: face.id,
      joined: false,
      events: [] as Record<string, unknown>[],
    };
    collectors.add(collector);
    const auth = credentialOf(req);
    try {
      await forwarder.receive(face.id, { type: "interest", interest, ...(auth !== undefined && { auth }) });
      const answer = await face.answer;
      const kinds = new Set(collector.events.map((e) => e.kind));
      const upstream =
        kinds.has("upstream_out") || kinds.has("pit_aggregate")
          ? (faces.get(producer)?.traces.get(interest.name) ?? [])
          : [];
      const trace: TraceHop[] = [
        { node: opts.id, events: collector.events as TraceHop["events"] },
        ...upstream,
      ];
      const headers = { [HEADERS.trace]: formatTrace(trace) };
      if (answer.type === "data") return json(answer.data, { headers });
      if (answer.type === "nack") return errorResponse(answer.code, answer.message ?? answer.code, headers);
      return errorResponse("UPSTREAM_ERROR", "unexpected answer", headers);
    } finally {
      collectors.delete(collector);
      forwarder.removeFace(face.id);
    }
  }

  async function onCall(req: Request): Promise<Response> {
    let body: { producer?: string; tool?: string; args?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return errorResponse("UPSTREAM_ERROR", "body is not JSON");
    }
    const producer = body.producer ?? opts.upstreams[0]?.producer;
    if (!producer || typeof body.tool !== "string")
      return errorResponse("UPSTREAM_ERROR", "missing producer or tool");
    const face = new RequestFace();
    forwarder.addFace(face, { consumer: !req.headers.has(HEADERS.forwarder) });
    const auth = credentialOf(req);
    const id = face.id.slice(4);
    try {
      await forwarder.receive(face.id, {
        type: "call",
        id,
        producer,
        tool: body.tool,
        args: (body.args ?? {}) as never,
        ...(auth !== undefined && { auth }),
      });
      const answer = await face.answer;
      const trace = formatTrace([
        { node: opts.id, events: [{ kind: "bypass", t: Date.now() }] as TraceHop["events"] },
      ]);
      if (answer.type === "result") return json(answer.result, { headers: { [HEADERS.trace]: trace } });
      if (answer.type === "nack") return errorResponse(answer.code, answer.message ?? answer.code);
      return errorResponse("UPSTREAM_ERROR", "unexpected answer");
    } finally {
      forwarder.removeFace(face.id);
    }
  }

  async function handle(req: Request): Promise<Response> {
    const path = routePath(req, opts.basePath);
    {
      if (req.method === "POST" && path === PATHS.interest) return await onInterest(req);
      if (req.method === "POST" && path === PATHS.call) return await onCall(req);
      const m = /^\/idem\/v1\/(manifest|tools)\/([^/]+)$/.exec(path);
      if (req.method === "GET" && m) {
        const producer = decodeURIComponent(m[2] as string);
        const u = opts.upstreams.find((x) => x.producer === producer);
        if (!u) return json({ error: "unknown producer" }, { status: 404 });
        if (m[1] === "manifest") {
          try {
            return json(await ensureManifest(producer), {
              headers: { "cache-control": "public, max-age=60" },
            });
          } catch (e) {
            return errorResponse("UPSTREAM_ERROR", e instanceof Error ? e.message : "manifest unavailable");
          }
        }
        let t = tools.get(producer);
        if (!t) {
          const url =
            u.kind === "producer" ? `${base(u)}${PATHS.tools}` : `${base(u)}/idem/v1/tools/${producer}`;
          t = doFetch(url, { headers: { [HEADERS.forwarder]: opts.id } }).then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
          });
          t.catch(() => tools.delete(producer));
          tools.set(producer, t);
        }
        try {
          return json(await t, { headers: { "cache-control": "public, max-age=60" } });
        } catch (e) {
          return errorResponse("UPSTREAM_ERROR", e instanceof Error ? e.message : "tools unavailable");
        }
      }
      return json({ error: "not found" }, { status: 404 });
    }
  }

  return { handle, forwarder, trust };
}
