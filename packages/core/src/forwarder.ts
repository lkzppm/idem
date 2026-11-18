import type { Clock } from "./clock";
import { deriveAuthContext, verifyData } from "./crypto";
import { type ContentStore, dataBytes, entryAge, isFresh, MemoryContentStore } from "./cs";
import { sha256b64u } from "./encoding";
import type { IdemWireErrorCode } from "./errors";
import type { Face, Packet } from "./face";
import type { Fib } from "./fib";
import { jcs } from "./jcs";
import { type ParsedName, parseName } from "./name";
import type { TrustStore } from "./trust";
import type { Scope } from "./types";

/**
 * Every observable action of a forwarder (protocol §7). The sandbox and the experiments consume
 * exactly this stream; metrics are not computed anywhere else. `face` (when present) is the
 * downstream face whose packet caused the event, so bindings can build per-request traces.
 */
export type ForwarderEvent =
  | { t: number; node: string; kind: "interest_in"; name: string; face: string }
  | { t: number; node: string; kind: "cs_hit"; name: string; ageMs: number; face?: string }
  | { t: number; node: string; kind: "pit_aggregate"; name: string; waiting: number; face?: string }
  | { t: number; node: string; kind: "upstream_out"; name: string; nextHop: string; face?: string }
  | { t: number; node: string; kind: "data_in"; name: string; bytes: number }
  | { t: number; node: string; kind: "verify_ok" | "verify_fail"; name: string; us: number }
  | { t: number; node: string; kind: "cs_insert" | "cs_evict"; name: string; bytes: number }
  | { t: number; node: string; kind: "pit_satisfy"; name: string; faces: number }
  | {
      t: number;
      node: string;
      kind: "pit_expire" | "drop" | "bypass";
      name?: string;
      reason?: string;
      face?: string;
    };

/** Kinds of {@link ForwarderEvent}. */
export type ForwarderEventKind = ForwarderEvent["kind"];

/** PIT bounds [P-7.3]. */
export interface PitLimits {
  maxEntries: number;
  maxFacesPerEntry: number;
}

/** Options of a {@link Forwarder}. */
export interface ForwarderOptions {
  /** Node id used in events. */
  id: string;
  clock: Clock;
  /** Defaults to a 64 MiB LRU {@link MemoryContentStore}. */
  cs?: ContentStore;
  /** Defaults to 10 000 entries and 256 faces per entry. */
  pit?: PitLimits;
  fib: Fib;
  trust: TrustStore;
  /** Verify Data before caching [P-7.1]. Default `true`; `false` only in experiments (B4). */
  verifyOnInsert?: boolean;
  /**
   * Edge secret. When set, Interests arriving on consumer faces with a credential get an
   * `authContext = HMAC(secret, credential)` [P-8.4], which partitions `private` PIT and CS entries.
   */
  authSecret?: string;
  onEvent?: (e: ForwarderEvent) => void;
}

/** Per-face options. */
export interface FaceOptions {
  /** The face leads to consumers (agents): this forwarder is their first hop (edge). */
  consumer?: boolean;
}

interface InRecord {
  face: string;
  nonce: string;
}

interface PitEntry {
  key: string;
  name: string;
  scope: Scope;
  authContext?: string;
  inRecords: InRecord[];
  outFace: string;
  outNonce: string;
  expiresAt: number;
  timer: unknown;
}

interface BypassEntry {
  down: string;
  up: string;
  kind: "interest" | "call";
  name?: string;
  timer: unknown;
}

const SEP = "\u001f";
const DEFAULT_CALL_LIFETIME_MS = 30_000;

function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}

/**
 * The IDEM forwarder engine: PIT, CS and FIB (protocol §7). The same class runs in the HTTP
 * gateway, the simulator and the browser sandbox; only faces and clock differ.
 */
export class Forwarder {
  readonly id: string;
  readonly #clock: Clock;
  readonly #cs: ContentStore;
  readonly #limits: PitLimits;
  readonly #fib: Fib;
  readonly #trust: TrustStore;
  readonly #verify: boolean;
  readonly #authSecret: string | undefined;
  readonly #onEvent: ((e: ForwarderEvent) => void) | undefined;
  readonly #faces = new Map<string, { face: Face; consumer: boolean }>();
  readonly #pit = new Map<string, PitEntry>();
  /** nonce → PIT key, for in-records and out-records (loop detection and Data matching). */
  readonly #nonces = new Map<string, string>();
  /** Stateless passthrough: correlation id → faces. */
  readonly #bypass = new Map<string, BypassEntry>();

  constructor(opts: ForwarderOptions) {
    this.id = opts.id;
    this.#clock = opts.clock;
    this.#cs = opts.cs ?? new MemoryContentStore({ maxBytes: 64 * 1024 * 1024 });
    this.#limits = opts.pit ?? { maxEntries: 10_000, maxFacesPerEntry: 256 };
    this.#fib = opts.fib;
    this.#trust = opts.trust;
    this.#verify = opts.verifyOnInsert ?? true;
    this.#authSecret = opts.authSecret;
    this.#onEvent = opts.onEvent;
  }

  /** Attach a face. Packets it receives are processed by this forwarder. */
  addFace(face: Face, opts: FaceOptions = {}): void {
    this.#faces.set(face.id, { face, consumer: opts.consumer ?? false });
    face.onReceive((p) => this.receive(face.id, p));
  }

  /** Detach a face. */
  removeFace(id: string): void {
    this.#faces.get(id)?.face.close();
    this.#faces.delete(id);
  }

  /** The Content Store (for inspection). */
  get cs(): ContentStore {
    return this.#cs;
  }

  /** Pending Interests, for visualization: name and number of waiting downstream faces. */
  pit(): { name: string; waiting: number; scope: Scope }[] {
    return [...this.#pit.values()].map((e) => ({
      name: e.name,
      waiting: e.inRecords.length,
      scope: e.scope,
    }));
  }

  /** Process a packet that arrived on face `faceId`. Resolves when processing is complete. */
  async receive(faceId: string, p: Packet): Promise<void> {
    if (!this.#faces.has(faceId)) return;
    switch (p.type) {
      case "interest":
        return this.#onInterest(faceId, p);
      case "data":
        return this.#onData(faceId, p);
      case "nack":
        return this.#onNack(faceId, p);
      case "call":
        return this.#onCall(faceId, p);
      case "result":
        return this.#onResult(faceId, p);
    }
  }

  #emit(e: Record<string, unknown> & { kind: ForwarderEventKind }): void {
    this.#onEvent?.({ t: this.#clock.now(), node: this.id, ...e } as ForwarderEvent);
  }

  #send(faceId: string, p: Packet): void {
    this.#faces.get(faceId)?.face.send(p);
  }

  #nack(faceId: string, nonce: string, code: IdemWireErrorCode, name?: string, message?: string): void {
    this.#send(faceId, {
      type: "nack",
      nonce,
      code,
      ...(name !== undefined && { name }),
      ...(message !== undefined && { message }),
    });
  }

  async #onInterest(faceId: string, p: Extract<Packet, { type: "interest" }>): Promise<void> {
    const I = p.interest;
    this.#emit({ kind: "interest_in", name: I.name, face: faceId });

    let parsed: ParsedName;
    try {
      parsed = parseName(I.name);
    } catch {
      this.#emit({ kind: "drop", face: faceId, name: I.name, reason: "bad_name" });
      return;
    }

    // Tool not cacheable per the signed manifest → this Interest should have been a plain call.
    const policy = this.#trust.policy(parsed.producer, parsed.tool);
    if (!policy?.cacheable || policy.schemaDigest !== parsed.schemaDigest) {
      this.#emit({ kind: "bypass", face: faceId, name: I.name, reason: "not_cacheable" });
      this.#nack(faceId, I.nonce, "NOT_CACHEABLE", I.name);
      return;
    }

    const consumerFace = this.#faces.get(faceId)?.consumer ?? false;
    const [digest, authContext] = await Promise.all([
      sha256b64u(jcs(I.args)).catch(() => undefined),
      // authContext exists only on the first hop [P-8.4]; anything arriving from upstream
      // forwarders is ignored.
      consumerFace
        ? I.authContext !== undefined
          ? Promise.resolve(I.authContext)
          : p.auth !== undefined && this.#authSecret !== undefined
            ? deriveAuthContext(this.#authSecret, p.auth)
            : Promise.resolve(undefined)
        : Promise.resolve(undefined),
    ]);

    // ---- From here on everything is synchronous: the PIT/CS checks are atomic. ----
    if (digest !== parsed.argsDigest) {
      // [P-4.3]
      this.#emit({ kind: "drop", face: faceId, name: I.name, reason: "digest_mismatch" });
      this.#nack(faceId, I.nonce, "DIGEST_MISMATCH", I.name);
      return;
    }
    if (!Number.isInteger(I.hopLimit) || I.hopLimit <= 0) {
      // [P-4.4]
      this.#emit({ kind: "drop", face: faceId, name: I.name, reason: "hop_limit" });
      this.#nack(faceId, I.nonce, "HOP_LIMIT", I.name);
      return;
    }

    const scope = policy.scope;
    // `private` entries are partitioned by authContext; without one they are never aggregated
    // nor cached (each Interest gets its own entry, keyed by nonce) [P-8.3].
    const key =
      scope === "public"
        ? I.name
        : authContext !== undefined
          ? `${I.name}${SEP}ac:${authContext}`
          : `${I.name}${SEP}n:${I.nonce}`;

    // Loop detection [P-4.4].
    const seenKey = this.#nonces.get(I.nonce) ?? (this.#bypass.has(I.nonce) ? "" : undefined);
    if (seenKey !== undefined) {
      const entry = this.#pit.get(seenKey);
      const sameFace = entry?.inRecords.some((r) => r.nonce === I.nonce && r.face === faceId) ?? false;
      this.#emit({ kind: "drop", face: faceId, name: I.name, reason: sameFace ? "duplicate" : "loop" });
      if (!sameFace) this.#nack(faceId, I.nonce, "LOOP", I.name);
      return;
    }

    // Content Store.
    const t = this.#clock.now();
    const cacheableHere = scope === "public" || authContext !== undefined;
    if (cacheableHere) {
      const hit = this.#cs.get(key, t);
      if (hit && (!I.mustBeFresh || isFresh(hit, t, policy.ttlMs))) {
        const ageMs = entryAge(hit, t);
        this.#emit({ kind: "cs_hit", face: faceId, name: I.name, ageMs });
        this.#send(faceId, { type: "data", nonce: I.nonce, data: { ...hit.data, ageMs } });
        return;
      }
    }

    // PIT aggregation.
    const existing = this.#pit.get(key);
    if (existing) {
      if (existing.inRecords.length >= this.#limits.maxFacesPerEntry) {
        this.#passthrough(faceId, p, "pit_full");
        return;
      }
      existing.inRecords.push({ face: faceId, nonce: I.nonce });
      this.#nonces.set(I.nonce, key);
      const expiresAt = t + I.lifetimeMs;
      if (expiresAt > existing.expiresAt) this.#armExpiry(existing, expiresAt);
      this.#emit({ kind: "pit_aggregate", face: faceId, name: I.name, waiting: existing.inRecords.length });
      return;
    }
    if (this.#pit.size >= this.#limits.maxEntries) {
      this.#passthrough(faceId, p, "pit_full");
      return;
    }

    const nextHop = this.#fib.lookup(I.name);
    if (nextHop === undefined || !this.#faces.has(nextHop) || nextHop === faceId) {
      this.#emit({ kind: "drop", face: faceId, name: I.name, reason: "no_route" });
      this.#nack(faceId, I.nonce, "UPSTREAM_ERROR", I.name, "no route");
      return;
    }
    const entry: PitEntry = {
      key,
      name: I.name,
      scope,
      ...(authContext !== undefined && scope === "private" && { authContext }),
      inRecords: [{ face: faceId, nonce: I.nonce }],
      outFace: nextHop,
      outNonce: I.nonce,
      expiresAt: 0,
      timer: undefined,
    };
    this.#pit.set(key, entry);
    this.#nonces.set(I.nonce, key);
    this.#armExpiry(entry, t + I.lifetimeMs);
    const { authContext: _stripped, ...upstream } = I;
    this.#send(nextHop, {
      type: "interest",
      interest: { ...upstream, hopLimit: I.hopLimit - 1 },
      ...(p.auth !== undefined && { auth: p.auth }),
    });
    this.#emit({ kind: "upstream_out", face: faceId, name: I.name, nextHop });
  }

  /** Forward without PIT state (PIT bounds exceeded [P-7.3]). */
  #passthrough(faceId: string, p: Extract<Packet, { type: "interest" }>, reason: string): void {
    const I = p.interest;
    const nextHop = this.#fib.lookup(I.name);
    if (
      nextHop === undefined ||
      !this.#faces.has(nextHop) ||
      this.#bypass.size >= 4 * this.#limits.maxEntries
    ) {
      this.#emit({
        kind: "drop",
        face: faceId,
        name: I.name,
        reason: nextHop === undefined ? "no_route" : "overload",
      });
      this.#nack(faceId, I.nonce, "UPSTREAM_ERROR", I.name, "overloaded");
      return;
    }
    this.#emit({ kind: "bypass", face: faceId, name: I.name, reason });
    this.#trackBypass(I.nonce, { down: faceId, up: nextHop, kind: "interest", name: I.name }, I.lifetimeMs);
    const { authContext: _stripped, ...upstream } = I;
    this.#send(nextHop, {
      type: "interest",
      interest: { ...upstream, hopLimit: I.hopLimit - 1 },
      ...(p.auth !== undefined && { auth: p.auth }),
    });
  }

  #trackBypass(id: string, e: Omit<BypassEntry, "timer">, lifetimeMs: number): void {
    const entry: BypassEntry = { ...e, timer: undefined };
    entry.timer = this.#clock.setTimeout(() => {
      if (this.#bypass.get(id) !== entry) return;
      this.#bypass.delete(id);
      this.#emit({ kind: "drop", ...(e.name !== undefined && { name: e.name }), reason: "bypass_timeout" });
      this.#nack(e.down, id, "TIMEOUT", e.name);
    }, lifetimeMs);
    this.#bypass.set(id, entry);
  }

  #takeBypass(id: string, fromFace: string): BypassEntry | undefined {
    const e = this.#bypass.get(id);
    if (!e || e.up !== fromFace) return undefined;
    this.#bypass.delete(id);
    this.#clock.clearTimeout(e.timer);
    return e;
  }

  #armExpiry(entry: PitEntry, expiresAt: number): void {
    this.#clock.clearTimeout(entry.timer);
    entry.expiresAt = expiresAt;
    entry.timer = this.#clock.setTimeout(() => {
      if (this.#pit.get(entry.key) !== entry) return;
      this.#removeEntry(entry);
      this.#emit({ kind: "pit_expire", name: entry.name });
      for (const r of entry.inRecords) this.#nack(r.face, r.nonce, "TIMEOUT", entry.name);
    }, expiresAt - this.#clock.now());
  }

  #removeEntry(entry: PitEntry): void {
    this.#clock.clearTimeout(entry.timer);
    this.#pit.delete(entry.key);
    this.#nonces.delete(entry.outNonce);
    for (const r of entry.inRecords) this.#nonces.delete(r.nonce);
  }

  /** The PIT entry an upstream packet with `nonce` answers, if it came from the right face. */
  #matchUpstream(nonce: string, faceId: string): PitEntry | undefined {
    const key = this.#nonces.get(nonce);
    const entry = key === undefined ? undefined : this.#pit.get(key);
    return entry && entry.outFace === faceId && entry.outNonce === nonce ? entry : undefined;
  }

  async #onData(faceId: string, p: Extract<Packet, { type: "data" }>): Promise<void> {
    const D = p.data;
    this.#emit({ kind: "data_in", name: D.name, bytes: dataBytes(D) });

    const bypass = this.#takeBypass(p.nonce, faceId);
    if (bypass) {
      this.#send(bypass.down, p);
      return;
    }
    const entry = this.#matchUpstream(p.nonce, faceId);
    if (!entry || entry.name !== D.name) {
      // Data only comes back on the face its Interest went out on, for the same name.
      this.#emit({ kind: "drop", name: D.name, reason: "unsolicited" });
      return;
    }

    if (this.#verify) {
      // [P-7.1] verify before caching (and before delivering).
      const t0 = now();
      const res = await verifyData(D, this.#trust, { now: this.#clock.now() });
      const us = Math.round((now() - t0) * 1000);
      this.#emit({ kind: res.ok ? "verify_ok" : "verify_fail", name: D.name, us });
      if (!res.ok) {
        if (this.#pit.get(entry.key) === entry) this.#fail(entry, "BAD_SIGNATURE", res.reason);
        return;
      }
    }
    if (this.#pit.get(entry.key) !== entry) {
      this.#emit({ kind: "drop", name: D.name, reason: "late" });
      return;
    }
    // Signed scope more restrictive than the manifest: never risk delivering it to a shared entry [P-8.5].
    if (D.meta.scope === "private" && entry.scope === "public") {
      this.#emit({ kind: "drop", name: D.name, reason: "scope_mismatch" });
      this.#fail(entry, "BAD_SIGNATURE", "Data scope is private but the manifest says public");
      return;
    }

    // Cache: never errors [P-5.3, P-7.2]; private only at the edge, partitioned [P-8.3].
    const t = this.#clock.now();
    const storable =
      D.content.isError !== true &&
      D.meta.freshnessMs > 0 &&
      (entry.scope === "public" || entry.authContext !== undefined);
    if (storable) {
      const { inserted, evicted } = this.#cs.put(entry.key, D, t);
      for (const e of evicted) this.#emit({ kind: "cs_evict", name: e.data.name, bytes: e.bytes });
      if (inserted) this.#emit({ kind: "cs_insert", name: D.name, bytes: dataBytes(D) });
    }

    this.#removeEntry(entry);
    for (const r of entry.inRecords) this.#send(r.face, { type: "data", nonce: r.nonce, data: D });
    this.#emit({ kind: "pit_satisfy", name: D.name, faces: entry.inRecords.length });
  }

  #fail(entry: PitEntry, code: IdemWireErrorCode, message: string): void {
    this.#removeEntry(entry);
    for (const r of entry.inRecords) this.#nack(r.face, r.nonce, code, entry.name, message);
  }

  #onNack(faceId: string, p: Extract<Packet, { type: "nack" }>): Promise<void> {
    const bypass = this.#takeBypass(p.nonce, faceId);
    if (bypass) {
      this.#send(bypass.down, p);
      return Promise.resolve();
    }
    const entry = this.#matchUpstream(p.nonce, faceId);
    if (!entry) {
      this.#emit({ kind: "drop", ...(p.name !== undefined && { name: p.name }), reason: "unsolicited_nack" });
      return Promise.resolve();
    }
    this.#emit({ kind: "drop", name: entry.name, reason: `nack:${p.code}` });
    this.#fail(entry, p.code, p.message ?? "");
    return Promise.resolve();
  }

  #onCall(faceId: string, p: Extract<Packet, { type: "call" }>): Promise<void> {
    this.#emit({ kind: "bypass", reason: `call:${p.tool}` });
    if (this.#bypass.has(p.id)) {
      this.#emit({ kind: "drop", reason: "duplicate_call" });
      return Promise.resolve();
    }
    const nextHop = this.#fib.lookupProducer(p.producer);
    if (
      nextHop === undefined ||
      !this.#faces.has(nextHop) ||
      this.#bypass.size >= 4 * this.#limits.maxEntries
    ) {
      this.#emit({ kind: "drop", reason: nextHop === undefined ? "no_route" : "overload" });
      this.#nack(faceId, p.id, "UPSTREAM_ERROR", undefined, "no route");
      return Promise.resolve();
    }
    this.#trackBypass(
      p.id,
      { down: faceId, up: nextHop, kind: "call" },
      p.lifetimeMs ?? DEFAULT_CALL_LIFETIME_MS,
    );
    this.#send(nextHop, p);
    return Promise.resolve();
  }

  #onResult(faceId: string, p: Extract<Packet, { type: "result" }>): Promise<void> {
    const bypass = this.#takeBypass(p.id, faceId);
    if (bypass) this.#send(bypass.down, p);
    else this.#emit({ kind: "drop", reason: "unsolicited_result" });
    return Promise.resolve();
  }
}
