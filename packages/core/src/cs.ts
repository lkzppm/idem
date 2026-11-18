import { utf8Length } from "./encoding";
import type { Data } from "./types";

/** A cached Data object. */
export interface CsEntry {
  /** Cache key: the name, or the name partitioned by `authContext` for `private` Data. */
  key: string;
  data: Data;
  /** Local time the Data was inserted. */
  receivedAt: number;
  /** Size accounted against the byte budget. */
  bytes: number;
  /** Lookups served by this entry. */
  hits: number;
}

/** Occupancy counters. Hit/miss metrics come from forwarder events, not from here. */
export interface CsStats {
  entries: number;
  bytes: number;
  maxBytes: number;
  inserts: number;
  evictions: number;
}

/** Content Store interface (protocol §7). Implementations must respect a byte budget [P-7.4]. */
export interface ContentStore {
  /** Return the entry for `key` (fresh or not) and record the access for the replacement policy. */
  get(key: string, now: number): CsEntry | undefined;
  /**
   * Insert or replace. `inserted` is false when the Data alone exceeds the budget; `evicted` lists
   * the entries removed to make room.
   */
  put(key: string, data: Data, now: number): { inserted: boolean; evicted: CsEntry[] };
  delete(key: string): boolean;
  stats(): CsStats;
}

/** Replacement policies (protocol [P-7.4]). */
export type ReplacementPolicy = "lru" | "lfu" | "fifo";

const sizes = new WeakMap<Data, number>();

/** UTF-8 size of a Data object's JSON encoding (memoized per object). */
export function dataBytes(d: Data): number {
  let n = sizes.get(d);
  if (n === undefined) {
    n = utf8Length(JSON.stringify(d));
    sizes.set(d, n);
  }
  return n;
}

/**
 * Residual age of a cached entry at `now`: `ageMs + (now − receivedAt)` [P-8.1].
 */
export function entryAge(entry: Pick<CsEntry, "data" | "receivedAt">, now: number): number {
  return (entry.data.ageMs ?? 0) + (now - entry.receivedAt);
}

/**
 * Freshness check [P-8.1], with the effective freshness capped by the manifest TTL [P-8.2].
 */
export function isFresh(
  entry: Pick<CsEntry, "data" | "receivedAt">,
  now: number,
  ttlCapMs = Infinity,
): boolean {
  return entryAge(entry, now) < Math.min(entry.data.meta.freshnessMs, ttlCapMs);
}

/** In-memory, byte-budgeted Content Store with LRU (default), LFU or FIFO replacement. */
export class MemoryContentStore implements ContentStore {
  readonly #maxBytes: number;
  readonly #policy: ReplacementPolicy;
  // Map iteration order is insertion order: LRU re-inserts on access, FIFO never does.
  readonly #entries = new Map<string, CsEntry>();
  #bytes = 0;
  #inserts = 0;
  #evictions = 0;

  constructor(opts: { maxBytes: number; policy?: ReplacementPolicy }) {
    this.#maxBytes = opts.maxBytes;
    this.#policy = opts.policy ?? "lru";
  }

  get(key: string, _now: number): CsEntry | undefined {
    const e = this.#entries.get(key);
    if (!e) return undefined;
    e.hits++;
    if (this.#policy === "lru") {
      this.#entries.delete(key);
      this.#entries.set(key, e);
    }
    return e;
  }

  put(key: string, data: Data, now: number): { inserted: boolean; evicted: CsEntry[] } {
    this.delete(key);
    const entry: CsEntry = { key, data, receivedAt: now, bytes: dataBytes(data), hits: 0 };
    if (entry.bytes > this.#maxBytes) return { inserted: false, evicted: [] };
    const evicted: CsEntry[] = [];
    while (this.#bytes + entry.bytes > this.#maxBytes) {
      const victim = this.#victim();
      if (!victim) break;
      this.delete(victim.key);
      this.#evictions++;
      evicted.push(victim);
    }
    this.#entries.set(key, entry);
    this.#bytes += entry.bytes;
    this.#inserts++;
    return { inserted: true, evicted };
  }

  delete(key: string): boolean {
    const e = this.#entries.get(key);
    if (!e) return false;
    this.#entries.delete(key);
    this.#bytes -= e.bytes;
    return true;
  }

  stats(): CsStats {
    return {
      entries: this.#entries.size,
      bytes: this.#bytes,
      maxBytes: this.#maxBytes,
      inserts: this.#inserts,
      evictions: this.#evictions,
    };
  }

  /** Iterate over cached entries (oldest first for LRU/FIFO). */
  entries(): IterableIterator<CsEntry> {
    return this.#entries.values();
  }

  #victim(): CsEntry | undefined {
    if (this.#policy !== "lfu") return this.#entries.values().next().value;
    let best: CsEntry | undefined;
    for (const e of this.#entries.values()) if (!best || e.hits < best.hits) best = e;
    return best;
  }
}
