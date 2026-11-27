import {
  type CallToolResult,
  type Clock,
  type Face,
  type Packet,
  type ReplacementPolicy,
  utf8Length,
} from "@idem/core";

/**
 * The industry baseline B5 (`mcp-gateway-cache`, 05-evaluation §1, ADR-036): a response cache at an
 * MCP gateway as shipped today. Plain MCP end to end (no names, no signatures, no manifest); the
 * gateway keeps one cache shared by every client behind it, keyed by producer, tool and the
 * arguments as sent; entries live for a TTL the operator sets per tool; misses go upstream
 * (cache-aside, no coalescing of identical calls in flight); error results are not stored. It lives
 * in the simulator, not in `@idem/core`: it is what IDEM is compared against, not part of IDEM.
 */

/**
 * JSON with object keys sorted at every level and no whitespace, like FastMCP's
 * `json.dumps(sort_keys=True, separators=(",", ":"))`: key order does not change a key, any other
 * difference in spelling does.
 */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : stableJson(x))).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/**
 * The gateway's cache key of a call: producer, tool and the arguments as sent, serialized with
 * {@link stableJson}. No producer-declared normalization: `HTTP://Example.com:80/a` and
 * `http://example.com/a` are two keys. No credential unless `partition` is given: a gateway that
 * caches a per-user tool under the shared key shares it between users (the E5 row
 * `baseline/private-miskeyed@edge`). With `partition` (the caller's credential, `""` for none) the
 * entry is that caller's alone, as FastMCP's per-token key makes it.
 */
export function gatewayCacheKey(producer: string, tool: string, args: unknown, partition?: string): string {
  return stableJson(
    partition === undefined ? [producer, tool, args ?? null] : [producer, tool, args ?? null, partition],
  );
}

/** One stored result. */
export interface GatewayCacheEntry {
  key: string;
  /** The stored result. Mutable on purpose: nothing protects it (E5 `baseline/tamper-cache@edge`). */
  result: CallToolResult;
  /** Gateway time the result was stored. */
  storedAt: number;
  /** TTL the operator configured for the tool, ms. */
  ttlMs: number;
  /** Size accounted against the byte budget: the UTF-8 length of the result's JSON. */
  bytes: number;
  /** Lookups served by this entry. */
  hits: number;
}

/**
 * A byte-budgeted response cache with the Content Store's replacement policies (LRU, LFU, FIFO;
 * the same budget and policy as the IDEM edge it stands in for). An entry is fresh while
 * `now − storedAt < ttlMs`; an expired entry is a miss and is dropped on lookup.
 */
export class GatewayCache {
  readonly #maxBytes: number;
  readonly #policy: ReplacementPolicy;
  // Map iteration order is insertion order: LRU re-inserts on access, FIFO never does.
  readonly #entries = new Map<string, GatewayCacheEntry>();
  #bytes = 0;
  #evictions = 0;

  constructor(opts: { maxBytes: number; policy?: ReplacementPolicy }) {
    this.#maxBytes = opts.maxBytes;
    this.#policy = opts.policy ?? "lru";
  }

  /** The fresh entry for `key`, recording the access for the replacement policy; else `undefined`. */
  get(key: string, now: number): GatewayCacheEntry | undefined {
    const e = this.#entries.get(key);
    if (!e) return undefined;
    if (now - e.storedAt >= e.ttlMs) {
      this.#delete(key);
      return undefined;
    }
    e.hits++;
    if (this.#policy === "lru") {
      this.#entries.delete(key);
      this.#entries.set(key, e);
    }
    return e;
  }

  /** Store (or replace) a result. Not inserted when it alone exceeds the budget. */
  put(
    key: string,
    result: CallToolResult,
    ttlMs: number,
    now: number,
  ): { inserted: boolean; evicted: number } {
    this.#delete(key);
    const bytes = utf8Length(JSON.stringify(result));
    if (bytes > this.#maxBytes || !(ttlMs > 0)) return { inserted: false, evicted: 0 };
    let evicted = 0;
    while (this.#bytes + bytes > this.#maxBytes) {
      const victim = this.#victim();
      if (!victim) break;
      this.#delete(victim.key);
      this.#evictions++;
      evicted++;
    }
    this.#entries.set(key, { key, result, storedAt: now, ttlMs, bytes, hits: 0 });
    this.#bytes += bytes;
    return { inserted: true, evicted };
  }

  /** Stored entries, fresh or not (oldest first for LRU and FIFO). */
  entries(): IterableIterator<GatewayCacheEntry> {
    return this.#entries.values();
  }

  stats(): { entries: number; bytes: number; maxBytes: number; evictions: number } {
    return {
      entries: this.#entries.size,
      bytes: this.#bytes,
      maxBytes: this.#maxBytes,
      evictions: this.#evictions,
    };
  }

  #delete(key: string): void {
    const e = this.#entries.get(key);
    if (!e) return;
    this.#entries.delete(key);
    this.#bytes -= e.bytes;
  }

  #victim(): GatewayCacheEntry | undefined {
    if (this.#policy !== "lfu") return this.#entries.values().next().value;
    let best: GatewayCacheEntry | undefined;
    for (const e of this.#entries.values()) if (!best || e.hits < best.hits) best = e;
    return best;
  }
}

/** How long a relayed call waits for its result (the core forwarder's default call lifetime). */
const CALL_LIFETIME_MS = 30_000;

/** What the gateway operator configured, and what to report. */
export interface GatewayRelayOptions {
  cache: GatewayCache;
  clock: Clock;
  /** TTL the operator set for `tool` of `producer`, ms; `undefined` passes the call through. */
  ttlFor(producer: string, tool: string): number | undefined;
  /**
   * `true` when the operator partitions `tool`'s entries per caller credential (a per-user tool).
   * Default: no partition, one entry shared by every caller.
   */
  perCredential?(producer: string, tool: string): boolean;
  /** A call answered from the cache. */
  onHit?(key: string): void;
  /** A cacheable call that missed; `inFlight` is true when an identical call is already upstream. */
  onMiss?(key: string, inFlight: boolean): void;
}

/**
 * A caching gateway in front of a relay: one cache and one view of the calls in flight, shared by
 * every client face it wraps ({@link GatewayRelay.face}).
 */
export class GatewayRelay {
  readonly #opts: GatewayRelayOptions;
  /** Calls relayed upstream and not answered yet, by `<face id>\n<call id>`. */
  readonly #pending = new Map<string, { key: string; ttlMs: number; until: number }>();
  /** Per cache key, the pending calls for it. */
  readonly #inFlight = new Map<string, Set<string>>();

  constructor(opts: GatewayRelayOptions) {
    this.#opts = opts;
  }

  get cache(): GatewayCache {
    return this.#opts.cache;
  }

  /**
   * The client-side face of the gateway, wrapped around the link to one client: a cacheable `call`
   * answered from the cache never reaches the relay behind it; a miss is relayed and its `result`,
   * on its way back, is stored unless it is an error (`isError`), as FastMCP and `mcp-proxy` do.
   * Nothing is checked: whatever comes back from upstream is stored and served.
   */
  face(inner: Face): Face {
    const opts = this.#opts;
    const token = (id: string) => `${inner.id}\n${id}`;
    return {
      id: inner.id,
      send: (p: Packet): void => {
        if (p.type === "result") {
          const call = this.#settle(token(p.id));
          if (call && p.result.isError !== true) {
            opts.cache.put(call.key, p.result, call.ttlMs, opts.clock.now());
          }
        } else if (p.type === "nack") this.#settle(token(p.nonce));
        inner.send(p);
      },
      onReceive: (cb: (p: Packet) => void | Promise<void>): void => {
        inner.onReceive((p) => {
          if (p.type !== "call") return cb(p);
          const ttlMs = opts.ttlFor(p.producer, p.tool);
          if (ttlMs === undefined) return cb(p);
          const key = gatewayCacheKey(
            p.producer,
            p.tool,
            p.args,
            opts.perCredential?.(p.producer, p.tool) ? (p.auth ?? "") : undefined,
          );
          const now = opts.clock.now();
          const hit = opts.cache.get(key, now);
          if (hit) {
            opts.onHit?.(key);
            inner.send({ type: "result", id: p.id, result: hit.result });
            return;
          }
          opts.onMiss?.(key, this.#upstream(key, now) > 0);
          const t = token(p.id);
          const ids = this.#inFlight.get(key) ?? new Set<string>();
          ids.add(t);
          this.#inFlight.set(key, ids);
          this.#pending.set(t, { key, ttlMs, until: now + (p.lifetimeMs ?? CALL_LIFETIME_MS) });
          return cb(p);
        });
      },
      close: (): void => {
        inner.close();
      },
    };
  }

  #settle(t: string): { key: string; ttlMs: number } | undefined {
    const p = this.#pending.get(t);
    if (!p) return undefined;
    this.#pending.delete(t);
    const ids = this.#inFlight.get(p.key);
    ids?.delete(t);
    if (ids?.size === 0) this.#inFlight.delete(p.key);
    return p;
  }

  /** Identical calls still upstream; a call whose answer never came stops counting at its lifetime. */
  #upstream(key: string, now: number): number {
    const ids = this.#inFlight.get(key);
    if (!ids) return 0;
    for (const t of ids) if ((this.#pending.get(t)?.until ?? 0) <= now) this.#settle(t);
    return this.#inFlight.get(key)?.size ?? 0;
  }
}
