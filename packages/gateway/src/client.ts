import {
  type AcceptVerdict,
  acceptData,
  buildInterest,
  type CallToolResult,
  type Clock,
  cacheablePolicy,
  clockTolerance,
  type Data,
  dataFromToolResult,
  type IdemLocalErrorCode,
  type IdemWireErrorCode,
  type Interest,
  isIdemError,
  type Manifest,
  RealClock,
  type ToolIdentity,
  type ToolInfo,
  type ToolPolicy,
  TrustStore,
  type VerifyResult,
  verifyData,
} from "@idem/core";
import { HEADERS, isWireError, PATHS, parseTrace, type TraceHop, type WireError } from "./wire";

/**
 * Why a call failed: a wire error `{ code, message }` (protocol §10), or the local `CLOCK_SKEW` when
 * the verified plain-call retry is still outside its signed lifetime [P-8.7].
 */
export interface CallError {
  code: IdemWireErrorCode | Extract<IdemLocalErrorCode, "CLOCK_SKEW">;
  message: string;
}

/** Outcome of {@link IdemClient.call}. */
export interface CallOutcome {
  tool: string;
  result: CallToolResult;
  /** How the call travelled: as a named Interest, or as a plain passthrough call. */
  via: "idem" | "call";
  /** The IDEM name (cacheable calls only). */
  name?: string;
  /** The verified Data (cacheable calls only). */
  data?: Data;
  /** Signature verification at this consumer [P-5.5]. */
  verify?: VerifyResult;
  /**
   * True when a first answer failed verification [P-5.5] or was outside its signed lifetime [P-8.7]
   * (`BAD_SIGNATURE` or `EXPIRED`, here or at a forwarder), and the call was retried as a plain call
   * that no cache may answer. The retried answer is checked too: if it is unsigned, signed for another
   * name or invalid, `error` is `BAD_SIGNATURE`; if it verifies but is outside its lifetime,
   * `CLOCK_SKEW`. Either way `result` is an error result.
   */
  retried: boolean;
  /** Events at each hop, from the `idem-trace` response header. */
  trace: TraceHop[];
  latencyMs: number;
  /** Error answer, if any. */
  error?: CallError;
}

/** Options of {@link IdemClient}. */
export interface IdemClientOptions {
  /** Base URL of the edge gateway (the consumer's first hop). */
  edge: string;
  /** Producer name, e.g. `demo.idem.dev`. */
  producer: string;
  /**
   * Base URL of the producer, for consumers that can reach it: the cache-free retry after a bad
   * signature [P-5.5] then goes straight to it. Default: the retry is a passthrough call through
   * the edge (no PIT, no CS). Either way the retried answer is verified end to end.
   */
  producerUrl?: string;
  /** End-user credential, sent as `Authorization: Bearer`. */
  credential?: string;
  trust?: TrustStore;
  fetch?: typeof fetch;
  /** Time source of the signed-lifetime check [P-8.7] and of key expiry. Default `RealClock`. */
  clock?: Clock;
  /** Clock tolerance of the signed-lifetime check [P-8.6]. Default `DEFAULT_CLOCK_TOLERANCE_MS`. */
  clockToleranceMs?: number;
  /**
   * Test/demo hook: rewrite a Data answer before verification (simulates an on-path attacker
   * between the edge and this consumer).
   */
  intercept?: (d: Data) => Data;
}

/**
 * IDEM consumer over HTTP. Computes names locally [P-4.1], sends Interests to its edge,
 * verifies every Data before returning it [P-5.5], and falls back to plain calls for
 * non-cacheable tools [P-4.2] or arguments outside the schema [P-3.1]. Works in browsers,
 * Node and edge runtimes (fetch + WebCrypto only).
 */
export class IdemClient {
  readonly trust: TrustStore;
  readonly #o: IdemClientOptions;
  readonly #fetch: typeof fetch;
  readonly #clock: Clock;
  readonly #tolerance: number;
  #ready?: Promise<{ manifest: Manifest; tools: ToolInfo[] }>;
  readonly #policies = new Map<string, { policy: ToolPolicy; identity: ToolIdentity } | undefined>();

  constructor(opts: IdemClientOptions) {
    this.#o = { ...opts, edge: opts.edge.replace(/\/$/, "") };
    this.trust = opts.trust ?? new TrustStore();
    this.#fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.#clock = opts.clock ?? new RealClock();
    this.#tolerance = clockTolerance(opts.clockToleranceMs);
  }

  /** The shared consumer decision [P-5.5, P-8.7] on this consumer's clock and tolerance. */
  #accept(data: Data, name: string, mustBeFresh: boolean): Promise<AcceptVerdict> {
    return acceptData(data, {
      trust: this.trust,
      now: this.#clock.now(),
      name,
      mustBeFresh,
      toleranceMs: this.#tolerance,
    });
  }

  /** Fetch and verify the producer manifest (TOFU or pinned [P-6.2]) and its tool list. */
  init(): Promise<{ manifest: Manifest; tools: ToolInfo[] }> {
    this.#ready ??= (async () => {
      const [m, t] = await Promise.all([
        this.#fetch(`${this.#o.edge}/idem/v1/manifest/${this.#o.producer}`).then(
          (r) => r.json() as Promise<Manifest>,
        ),
        this.#fetch(`${this.#o.edge}/idem/v1/tools/${this.#o.producer}`).then(
          (r) => r.json() as Promise<ToolInfo[]>,
        ),
      ]);
      const v = await this.trust.addManifest(m, { now: this.#clock.now() });
      if (!v.ok) throw new Error(`manifest rejected: ${v.reason}`);
      for (const tool of t) this.#policies.set(tool.name, await cacheablePolicy(m, tool));
      return { manifest: m, tools: t };
    })();
    this.#ready.catch(() => {
      this.#ready = undefined;
    });
    return this.#ready;
  }

  #headers(): Headers {
    const h = new Headers({ "content-type": "application/json" });
    if (this.#o.credential) h.set("authorization", `Bearer ${this.#o.credential}`);
    return h;
  }

  /** Compute the Interest a call would send (name, canonical args), without sending it. */
  async prepare(tool: string, args: unknown): Promise<Interest | undefined> {
    await this.init();
    const c = this.#policies.get(tool);
    if (!c) return undefined;
    try {
      return (
        await buildInterest({ producer: this.#o.producer, identity: c.identity, policy: c.policy, args })
      ).interest;
    } catch (e) {
      if (isIdemError(e)) return undefined;
      throw e;
    }
  }

  /** Call a tool. Cacheable calls travel as Interests; others as passthrough calls. */
  async call(tool: string, args: unknown): Promise<CallOutcome> {
    const t0 = performance.now();
    const interest = await this.prepare(tool, args);
    if (!interest) {
      const r = await this.#passthrough(this.#o.edge, tool, args);
      return { tool, via: "call", retried: false, latencyMs: performance.now() - t0, ...r };
    }
    const first = await this.sendInterest(interest);
    if (first.data && first.verify?.ok && !first.error) {
      return {
        tool,
        via: "idem",
        name: interest.name,
        retried: false,
        latencyMs: performance.now() - t0,
        ...first,
        result: first.data.content,
      };
    }
    if (first.error && first.error.code !== "BAD_SIGNATURE" && first.error.code !== "EXPIRED") {
      return {
        tool,
        via: "idem",
        name: interest.name,
        retried: false,
        latencyMs: performance.now() - t0,
        ...first,
        result: errorResult(first.error),
      };
    }
    // [P-5.5] BAD_SIGNATURE, or [P-8.7] EXPIRED (at a forwarder or here): retry once as a plain call,
    // which no cache may answer. The retry is held to the same checks: it must carry Data signed for
    // this very name, and be within its signed lifetime. Anything else is an error, never content.
    const direct = await this.#passthrough(this.#o.producerUrl ?? this.#o.edge, tool, args);
    const retry = {
      tool,
      via: "idem" as const,
      name: interest.name,
      retried: true,
      ...direct,
      trace: [...first.trace, ...direct.trace],
    };
    if (!direct.error && direct.verify?.ok && direct.data?.name === interest.name) {
      const v = await this.#accept(direct.data, interest.name, true);
      if (v.ok) return { ...retry, latencyMs: performance.now() - t0 };
      // Just produced, yet outside its lifetime: this clock and the producer's disagree, or the
      // retry's path replays too. The two look the same; fail closed [P-8.7].
      const error: CallError = {
        code: "CLOCK_SKEW",
        message: `the verified retry is still outside: ${v.reason}`,
      };
      return { ...retry, latencyMs: performance.now() - t0, error, result: errorResult(error) };
    }
    const error: CallError = direct.error ?? {
      code: "BAD_SIGNATURE",
      message: direct.data
        ? "the retried result is signed for another name"
        : "the retried result carries no signed Data",
    };
    return { ...retry, latencyMs: performance.now() - t0, error, result: errorResult(error) };
  }

  /**
   * Send a prepared (or deliberately forged) Interest and verify the answer [P-5.5]. When the
   * Interest asked for fresh Data, a verified answer outside its signed lifetime comes back with
   * `verify.ok` true and `error.code` `EXPIRED` [P-8.7]: the two verdicts stay distinct.
   */
  async sendInterest(
    interest: Interest,
  ): Promise<{ data?: Data; verify?: VerifyResult; error?: WireError; trace: TraceHop[] }> {
    let res: Response;
    try {
      res = await this.#fetch(`${this.#o.edge}${PATHS.interest}`, {
        method: "POST",
        headers: this.#headers(),
        body: JSON.stringify(interest),
        signal: AbortSignal.timeout(interest.lifetimeMs + 2_000),
      });
    } catch (e) {
      return {
        error: { code: "UPSTREAM_ERROR", message: e instanceof Error ? e.message : "fetch failed" },
        trace: [],
      };
    }
    const trace = parseTrace(res.headers.get(HEADERS.trace));
    const body = (await res.json().catch(() => undefined)) as unknown;
    if (!res.ok) {
      return {
        error: isWireError(body) ? body : { code: "UPSTREAM_ERROR", message: `HTTP ${res.status}` },
        trace,
      };
    }
    let data = body as Data;
    if (this.#o.intercept) data = this.#o.intercept(data);
    // The shared consumer decision: name, signature, signed lifetime and age [P-5.5, P-8.7].
    const v = await this.#accept(data, interest.name, interest.mustBeFresh);
    if (v.ok) return { data, verify: v.verify, trace };
    if (v.code !== "EXPIRED" && data.name !== interest.name) return { data, verify: v.verify, trace };
    return {
      data,
      verify: v.verify,
      error: { code: v.code === "EXPIRED" ? "EXPIRED" : "BAD_SIGNATURE", message: v.reason },
      trace,
    };
  }

  async #passthrough(
    base: string,
    tool: string,
    args: unknown,
  ): Promise<{
    result: CallToolResult;
    data?: Data;
    verify?: VerifyResult;
    error?: WireError;
    trace: TraceHop[];
  }> {
    const res = await this.#fetch(`${base.replace(/\/$/, "")}${PATHS.call}`, {
      method: "POST",
      headers: this.#headers(),
      body: JSON.stringify({ producer: this.#o.producer, tool, args }),
    });
    const trace = parseTrace(res.headers.get(HEADERS.trace));
    const body = (await res.json().catch(() => undefined)) as unknown;
    if (!res.ok) {
      const error = isWireError(body)
        ? body
        : ({ code: "UPSTREAM_ERROR", message: `HTTP ${res.status}` } as const);
      return { result: errorResult(error), error, trace };
    }
    const result = body as CallToolResult;
    const data = dataFromToolResult(result);
    if (!data) return { result, trace };
    const verify = await verifyData(data, this.trust, { now: this.#clock.now() });
    return {
      result,
      data,
      verify,
      trace,
      ...(!verify.ok && { error: { code: "BAD_SIGNATURE", message: verify.reason } }),
    };
  }
}

function errorResult(e: CallError): CallToolResult {
  return { content: [{ type: "text", text: `${e.code}: ${e.message}` }], isError: true };
}
