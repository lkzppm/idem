import {
  assertSupportedSchema,
  type CallToolResult,
  type Clock,
  type Data,
  dataFromToolResult,
  IdemError,
  type IdemKeyPair,
  type Interest,
  type JsonObject,
  type JsonSchema,
  type JsonValue,
  jcs,
  type Manifest,
  META_KEYS,
  Producer,
  type ProducerTool,
  type ProducerToolPolicy,
  parseName,
  RealClock,
  type ToolIdentity,
  type ToolInfo,
} from "@idem/core";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

/** `_meta` key of the origin record a proxy-producer attaches to each tool it lists [P-9.5]. */
export const ORIGIN_META_KEY = "dev.idem/origin";

/**
 * What a proxy-producer says about the origin of a tool, in `_meta["dev.idem/origin"]` of its tool
 * list. Unsigned and informational: a consumer verifies the proxy's signature, never the origin's.
 */
export interface OriginRecord {
  /** The origin MCP endpoint the proxy calls (scheme, host and path; no query or userinfo). */
  origin: string;
  /**
   * Who stands behind the `readOnlyHint` shown in this listing: the origin's own `tools/list`
   * (`"origin"`), the operator of the proxy (`"operator"`, see `operatorAssertsReadOnly`), or nobody
   * (`"absent"`).
   */
  readOnlyHint: "origin" | "operator" | "absent";
}

/** Operator policy for one origin tool (protocol §9.1, [P-9.6]). */
export interface ProxyToolPolicy extends ProducerToolPolicy {
  /** Bump when the tool's semantics change without a schema change [P-2.2]. Default `1`. */
  policyVersion?: number;
  /**
   * The origin's `tools/list` gives this tool no `readOnlyHint`, and the operator of the proxy takes
   * responsibility for it being read-only. Without it such a tool is never offered as cacheable. It
   * cannot override an origin that says `readOnlyHint: false`.
   */
  operatorAssertsReadOnly?: boolean;
}

/** The MCP server a proxy-producer fronts. */
export interface ProxyUpstream {
  /** Streamable HTTP endpoint of the origin, e.g. `https://mcp.example.com/mcp`. */
  url: string | URL;
  /** Injected `fetch` (tests, service bindings). */
  fetch?: typeof fetch;
  /**
   * The proxy's own credential at the origin (`Authorization: Bearer`). Used for `tools/list` and for
   * every tool the operator declared `{ cacheable: true, scope: "public" }`, which never sees an end
   * user's credential, even while held or refused [P-9.7]. Default: none.
   */
  credential?: string;
  /** Client identity sent to the origin. Default `{ name: "idem-proxy-producer", version: "1" }`. */
  info?: { name: string; version: string };
}

/** A schema change of the origin seen by the proxy [P-9.8]. */
export interface SchemaChange {
  /** The tool whose `tools/list` entry changed (input/output schema or `readOnlyHint`), was added or removed. */
  tool: string;
  /** The manifest version that now marks it not cacheable. */
  manifestVersion: number;
}

/** Outcome of {@link ProxyProducer.refresh}. */
export interface ProxyRefresh {
  /** Whether the origin's tool list differed (or a tool was held), so a new manifest was built. */
  changed: boolean;
  manifestVersion: number;
  /** Tools the operator declared cacheable that the proxy does not offer as cacheable, with the reason. */
  refused: Record<string, string>;
}

/** Options of {@link createProxyProducer}. */
export interface ProxyProducerOptions {
  upstream: ProxyUpstream;
  /** The proxy's own producer name (e.g. `proxy.example.com`). Never the origin's [P-9.5]. */
  name: string;
  /** The proxy's own signing key. */
  key: IdemKeyPair;
  /** Operator policy per origin tool. A tool without one, or with `cacheable: false`, is relayed. */
  tools: Record<string, ProxyToolPolicy>;
  clock?: Clock;
  /**
   * First manifest version; each rebuild adds 1. Default: the clock's time in seconds, and each
   * rebuild `max(previous + 1, seconds)`, so a restarted proxy never goes below a version edges
   * already accepted [P-6.3]. An explicit value must be persisted across restarts by the operator.
   */
  manifestVersion?: number;
  /** Max cached origin clients (one per credential). Default 512. */
  maxClients?: number;
  /**
   * Called when the proxy sees the origin's tool list change. The tool is not cacheable from then on
   * until {@link ProxyProducer.refresh}; calling `refresh()` from here re-enables it automatically.
   */
  onSchemaChange?: (change: SchemaChange) => void;
}

interface State {
  inner: Producer;
  /** Per-tool fingerprint of what the manifest was built from: schemas and `readOnlyHint`. */
  prints: Map<string, string>;
  records: Map<string, OriginRecord>;
  refused: Record<string, string>;
  /** Fingerprint of the whole origin listing (descriptions included). */
  listing: string;
  version: number;
}

const NOT_RELAYED: CallToolResult = {
  content: [
    { type: "text", text: "multi-round-trip results are not relayed by this proxy-producer [P-5.4]" },
  ],
  isError: true,
};

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function fingerprint(t: ToolInfo | undefined): string {
  if (!t) return "absent";
  return jcs({
    inputSchema: t.inputSchema as JsonValue,
    outputSchema: (t.outputSchema ?? null) as JsonValue,
    readOnlyHint: t.annotations?.readOnlyHint ?? null,
  });
}

/** Tools present in either listing whose fingerprint differs. */
function changedTools(prints: Map<string, string>, fresh: ToolInfo[]): Set<string> {
  const now = new Map(fresh.map((t) => [t.name, fingerprint(t)]));
  const out = new Set<string>();
  for (const [name, p] of prints) if (now.get(name) !== p) out.add(name);
  for (const [name, p] of now) if (prints.get(name) !== p) out.add(name);
  return out;
}

function withoutData(result: CallToolResult): CallToolResult {
  const meta: JsonObject = { ...(result._meta ?? {}) };
  delete meta[META_KEYS.data];
  const { _meta: _drop, ...rest } = result;
  return Object.keys(meta).length > 0 ? { ...rest, _meta: meta } : rest;
}

/**
 * Proxy-producer (protocol §9.1, "Legacy producer"): an IDEM {@link Producer} for the tools of an MCP
 * server that knows nothing about IDEM. It has its own producer name, key and manifest; it calls the
 * origin over plain MCP and signs the results itself, so trust moves to the proxy and every Data says
 * so in its name and `keyLocator` [P-9.5]. Cache policy is the operator's, per tool [P-9.6]. Serve it
 * like any producer, with `createProducerHandler` (`@idem/gateway`) or {@link createMcpProducer}.
 * Create it with {@link createProxyProducer}.
 */
export class ProxyProducer extends Producer {
  /** The origin endpoint, as recorded in `_meta["dev.idem/origin"]`. */
  readonly origin: string;
  readonly #o: ProxyProducerOptions;
  readonly #url: URL;
  readonly #clock: Clock;
  readonly #clients = new Map<string, Promise<Client>>();
  readonly #held = new Set<string>();
  #state: State;
  #serial: Promise<unknown> = Promise.resolve();

  /** Use {@link createProxyProducer}: the proxy must read the origin's tool list before serving. */
  constructor(opts: ProxyProducerOptions) {
    super({ producer: opts.name, key: opts.key, tools: [], ...(opts.clock && { clock: opts.clock }) });
    this.#o = opts;
    this.#url = new URL(opts.upstream.url);
    this.origin = `${this.#url.protocol}//${this.#url.host}${this.#url.pathname}`;
    if (opts.name === this.#url.host || opts.name === this.#url.hostname) {
      throw new IdemError("BAD_POLICY", "a proxy-producer MUST NOT sign under the origin's name [P-9.5]");
    }
    this.#clock = opts.clock ?? new RealClock();
    this.#state = {
      inner: new Producer({ producer: opts.name, key: opts.key, tools: [], clock: this.#clock }),
      prints: new Map(),
      records: new Map(),
      refused: {},
      listing: "",
      version: (opts.manifestVersion ?? Math.floor(this.#clock.now() / 1000)) - 1,
    };
  }

  /** Same as {@link createProxyProducer}. */
  static async create(opts: ProxyProducerOptions): Promise<ProxyProducer> {
    const proxy = new ProxyProducer(opts);
    proxy.#build(await proxy.#list(), true);
    return proxy;
  }

  // --- Producer surface, delegated to the producer built from the current origin listing ---

  override toolList(): ToolInfo[] {
    const { inner, records } = this.#state;
    return inner
      .toolList()
      .map((t) => Object.assign({}, t, { _meta: { [ORIGIN_META_KEY]: { ...records.get(t.name) } } }));
  }

  override identity(tool: string): ToolIdentity {
    return this.#state.inner.identity(tool);
  }

  override manifest(): Promise<Manifest> {
    return this.#state.inner.manifest();
  }

  /** The current manifest version. */
  get manifestVersion(): number {
    return this.#state.version;
  }

  /**
   * Answer an Interest by calling the origin, then sign as the proxy. If the origin's tool list has
   * changed for this tool since the manifest was built, the Data is discarded and the Interest is
   * answered `NOT_CACHEABLE` [P-9.8].
   */
  override async handleInterest(interest: Interest, ctx: { auth?: string } = {}): Promise<Data> {
    const state = this.#state;
    const data = await state.inner.handleInterest(interest, ctx);
    const { tool } = parseName(interest.name);
    if (await this.#drifted(tool, state)) {
      throw new IdemError("NOT_CACHEABLE", `the origin's schema for "${tool}" changed; not signed [P-9.8]`);
    }
    return data;
  }

  /**
   * Plain call. A tool the manifest does not offer as cacheable is relayed to the origin and comes
   * back unsigned; it carries the end user's credential unless the operator declared it public
   * [P-9.7]. A cacheable tool is answered by the inner producer
   * (signed in `_meta["dev.idem/data"]`), unless the origin's schema changed, in which case the
   * origin's result is returned unsigned [P-9.8].
   */
  override async handleCall(
    tool: string,
    args: unknown,
    ctx: { auth?: string } = {},
  ): Promise<CallToolResult> {
    const state = this.#state;
    const policy = (await state.inner.manifest()).tools.find((t) => t.tool === tool);
    if (!policy?.cacheable) {
      try {
        const r = await this.#call(tool, args, this.#credential(tool, ctx.auth));
        return r.resultType === "input_required" ? NOT_RELAYED : r;
      } catch (e) {
        return errorResult(e instanceof Error ? e.message : "origin call failed");
      }
    }
    const result = await state.inner.handleCall(tool, args, ctx);
    if (result.resultType === "input_required") return NOT_RELAYED;
    if (!dataFromToolResult(result)) return result;
    return (await this.#drifted(tool, state)) ? withoutData(result) : result;
  }

  /**
   * Re-read the origin's tool list and, if it changed or a tool is held after a schema change, build
   * a new manifest (version bump). Held tools become cacheable again under their new `schema-digest`
   * when the operator's policy still holds; otherwise they are listed in `refused`.
   */
  refresh(): Promise<ProxyRefresh> {
    return this.#exclusive(async () => {
      const fresh = await this.#list();
      const changed = this.#held.size > 0 || jcs(fresh as unknown as JsonValue) !== this.#state.listing;
      this.#held.clear();
      if (changed) this.#build(fresh, false);
      return { changed, manifestVersion: this.#state.version, refused: { ...this.#state.refused } };
    });
  }

  // --- internals ---

  #exclusive<T>(f: () => Promise<T>): Promise<T> {
    const run = this.#serial.then(f, f);
    this.#serial = run.catch(() => undefined);
    return run;
  }

  /** Did the origin's entry for `tool` change since `state` was built? Holds every changed tool. */
  async #drifted(tool: string, state: State): Promise<boolean> {
    const fresh = await this.#list();
    const mine = fresh.find((t) => t.name === tool);
    const drifted = fingerprint(mine) !== state.prints.get(tool);
    if (changedTools(this.#state.prints, fresh).size > 0) {
      await this.#exclusive(async () => {
        const changed = changedTools(this.#state.prints, fresh);
        if (changed.size === 0) return;
        for (const t of changed) this.#held.add(t);
        this.#build(fresh, false);
        for (const t of changed) this.#o.onSchemaChange?.({ tool: t, manifestVersion: this.#state.version });
      });
    }
    return drifted;
  }

  /**
   * The credential an origin call for `tool` carries [P-9.7]. Chosen from the operator's declared
   * policy, never from the tool's current state: a tool declared `{ cacheable: true, scope: "public" }`
   * gets the proxy's own credential (or none) whether it is offered as cacheable, held after a schema
   * change or refused, so an origin cannot obtain user credentials by editing its tool list. Any other
   * tool (undeclared, declared not cacheable, or `private`) gets the end user's.
   */
  #credential(tool: string, auth: string | undefined): string | undefined {
    const p = this.#o.tools[tool];
    return p?.cacheable === true && p.scope === "public" ? this.#o.upstream.credential : auth;
  }

  #reason(t: ToolInfo, p: ProxyToolPolicy): string | undefined {
    if (t.name.startsWith("_")) return `tool names starting with "_" are reserved [P-2.4]`;
    if (this.#held.has(t.name)) return "the origin's tool list changed; call refresh() to re-read it [P-9.8]";
    const hint = t.annotations?.readOnlyHint;
    if (hint === false) return "the origin marks it readOnlyHint: false [P-9.6]";
    if (hint !== true && p.operatorAssertsReadOnly !== true)
      return "the origin gives no readOnlyHint; set operatorAssertsReadOnly to take responsibility [P-9.6]";
    try {
      assertSupportedSchema(t.inputSchema); // [P-3.6]
    } catch (e) {
      return e instanceof Error ? e.message : "unsupported inputSchema [P-3.6]";
    }
    return undefined;
  }

  #build(fresh: ToolInfo[], strict: boolean): void {
    const refused: Record<string, string> = {};
    const records = new Map<string, OriginRecord>();
    const tools: ProducerTool[] = [];
    for (const name of Object.keys(this.#o.tools)) {
      if (this.#o.tools[name]?.cacheable && !fresh.some((t) => t.name === name))
        refused[name] = "the origin does not list this tool";
    }
    for (const t of fresh) {
      const p = this.#o.tools[t.name];
      const why = p?.cacheable ? this.#reason(t, p) : undefined;
      if (why) refused[t.name] = why;
      if (t.name.startsWith("_")) continue; // reserved names cannot be served under a producer [P-2.4]
      const cacheable = p?.cacheable === true && why === undefined;
      let hint: OriginRecord["readOnlyHint"] =
        t.annotations?.readOnlyHint === undefined ? "absent" : "origin";
      let annotations = t.annotations;
      if (cacheable && t.annotations?.readOnlyHint !== true) {
        annotations = { ...t.annotations, readOnlyHint: true };
        hint = "operator";
      }
      records.set(t.name, { origin: this.origin, readOnlyHint: hint });
      tools.push({
        name: t.name,
        ...(t.description !== undefined && { description: t.description }),
        inputSchema: t.inputSchema,
        ...(t.outputSchema !== undefined && { outputSchema: t.outputSchema }),
        ...(annotations !== undefined && { annotations }),
        ...(p?.policyVersion !== undefined && { policyVersion: p.policyVersion }),
        ...(cacheable &&
          p && {
            policy: {
              cacheable: true,
              ttlMs: p.ttlMs,
              scope: p.scope,
              ...(p.normalizers !== undefined && { normalizers: p.normalizers }),
            },
          }),
        // A public answer is shared, so it must not depend on who asked [P-9.7].
        handler: (args, ctx) => this.#call(t.name, args, this.#credential(t.name, ctx.auth)),
      });
    }
    if (strict && Object.keys(refused).length > 0) {
      const list = Object.entries(refused).map(([k, v]) => `${k}: ${v}`);
      throw new IdemError("BAD_POLICY", `proxy-producer cannot cache as declared: ${list.join("; ")}`);
    }
    const next = this.#state.version + 1;
    const version =
      this.#o.manifestVersion === undefined ? Math.max(next, Math.floor(this.#clock.now() / 1000)) : next;
    this.#state = {
      inner: new Producer({
        producer: this.#o.name,
        key: this.#o.key,
        tools,
        clock: this.#clock,
        manifestVersion: version,
      }),
      prints: new Map(fresh.map((t) => [t.name, fingerprint(t)])),
      records,
      refused,
      listing: jcs(fresh as unknown as JsonValue),
      version,
    };
  }

  /** The origin's tool list, fetched now (never from the MCP client's list cache). */
  async #list(): Promise<ToolInfo[]> {
    const client = await this.#client(this.#o.upstream.credential);
    const { tools } = await client.listTools(undefined, { cacheMode: "refresh" });
    return tools.map((t) => ({
      name: t.name,
      ...(t.description !== undefined && { description: t.description }),
      inputSchema: t.inputSchema as JsonSchema,
      ...(t.outputSchema !== undefined && { outputSchema: t.outputSchema as JsonSchema }),
      ...(t.annotations !== undefined && { annotations: { ...t.annotations } }),
    }));
  }

  async #call(tool: string, args: unknown, credential: string | undefined): Promise<CallToolResult> {
    const client = await this.#client(credential);
    const r = await client.callTool(
      { name: tool, arguments: (args ?? {}) as Record<string, unknown> },
      { allowInputRequired: true },
    );
    return r as unknown as CallToolResult;
  }

  /** One connected origin client per credential (LRU, `maxClients`). */
  #client(credential: string | undefined): Promise<Client> {
    const k = credential ?? "";
    const hit = this.#clients.get(k);
    if (hit) {
      this.#clients.delete(k);
      this.#clients.set(k, hit);
      return hit;
    }
    if (this.#clients.size >= (this.#o.maxClients ?? 512)) {
      const [oldest, evicted] = this.#clients.entries().next().value as [string, Promise<Client>];
      this.#clients.delete(oldest);
      evicted.then((c) => c.close()).catch(() => undefined);
    }
    const up = this.#o.upstream;
    const p = (async () => {
      const client = new Client(up.info ?? { name: "idem-proxy-producer", version: "1" }, {
        inputRequired: { autoFulfill: false },
      });
      await client.connect(
        new StreamableHTTPClientTransport(this.#url, {
          ...(up.fetch && { fetch: up.fetch }),
          ...(credential !== undefined && {
            requestInit: { headers: { authorization: `Bearer ${credential}` } },
          }),
        }),
      );
      return client;
    })();
    p.catch(() => {
      if (this.#clients.get(k) === p) this.#clients.delete(k);
    });
    this.#clients.set(k, p);
    return p;
  }
}

/**
 * Create a proxy-producer for an MCP server that knows nothing about IDEM (protocol §9.1, ADR-038).
 * Reads the origin's tool list, applies the operator's per-tool policy and builds the proxy's signed
 * manifest. Throws `BAD_POLICY` when a tool declared cacheable cannot be: absent at the origin,
 * `readOnlyHint: false`, no `readOnlyHint` without `operatorAssertsReadOnly`, or a schema outside
 * Appendix A [P-3.6].
 */
export async function createProxyProducer(opts: ProxyProducerOptions): Promise<ProxyProducer> {
  return ProxyProducer.create(opts);
}
