import { IdemError } from "./errors";
import type { Data, DataMeta } from "./types";

/**
 * Default `clockToleranceMs` of every node [P-8.6]: how far, on this node's clock, a Data may be past
 * its freshness, or dated in the future, and still be accepted. It covers clock skew between the node
 * and the producer plus transit time, and it is the most stale an on-path party can make a Data look
 * fresh. 60 s, the grace period NDN recommends for signed-Interest timestamps and MCPS's default skew.
 */
export const DEFAULT_CLOCK_TOLERANCE_MS = 60_000;

/**
 * Apparent age of a Data at a node whose clock reads `now`: `now − producedAt` [P-8.6]. Taken from
 * RFC 9111 §4.2.3 `apparent_age`, with the signed `producedAt` in place of `Date`, but **not clamped
 * at 0**: a Data dated in the node's future has a negative apparent age.
 */
export function apparentAge(meta: Pick<DataMeta, "producedAt">, now: number): number {
  return now - meta.producedAt;
}

/**
 * The apparent age at which a Data expires [P-8.6]: `min(freshnessMs, ttlMs) + toleranceMs`. Pass
 * `ttlMs = Infinity` when no manifest TTL is known; the signed `freshnessMs` then bounds it alone.
 */
export function lifetimeOf(
  meta: Pick<DataMeta, "freshnessMs">,
  ttlMs: number,
  toleranceMs: number = DEFAULT_CLOCK_TOLERANCE_MS,
): number {
  return Math.min(meta.freshnessMs, ttlMs) + toleranceMs;
}

/**
 * Where a Data stands against its signed lifetime at a node whose clock reads `now` [P-8.6]:
 * `"expired"` when `apparentAge ≥ min(freshnessMs, ttlMs) + toleranceMs`, `"future"` when it is dated
 * more than `toleranceMs` in the node's future, `"within"` otherwise. This is the one definition used
 * by forwarders and consumers (the E5 judge works on ground truth instead). It fails closed: a value that is not a number (a
 * malformed timestamp or option) gives `"expired"`. Signature validity is a separate verdict
 * (`verifyData`).
 */
export function lifetimeState(
  meta: Pick<DataMeta, "producedAt" | "freshnessMs">,
  ttlMs: number,
  now: number,
  toleranceMs: number = DEFAULT_CLOCK_TOLERANCE_MS,
): "within" | "expired" | "future" {
  const age = apparentAge(meta, now);
  if (!(age < lifetimeOf(meta, ttlMs, toleranceMs))) return "expired";
  if (!(-age <= toleranceMs)) return "future";
  return "within";
}

/** `true` when a Data is outside its signed lifetime, on either side ({@link lifetimeState}). */
export function isOutsideLifetime(
  meta: Pick<DataMeta, "producedAt" | "freshnessMs">,
  ttlMs: number,
  now: number,
  toleranceMs: number = DEFAULT_CLOCK_TOLERANCE_MS,
): boolean {
  return lifetimeState(meta, ttlMs, now, toleranceMs) !== "within";
}

/**
 * A one-line explanation of a lifetime failure, for `EXPIRED` and `CLOCK_SKEW` messages: which side
 * of the window was missed, the signed `producedAt` and the local time (epoch or virtual ms).
 */
export function lifetimeReason(
  meta: Pick<DataMeta, "producedAt" | "freshnessMs">,
  ttlMs: number,
  now: number,
  toleranceMs: number = DEFAULT_CLOCK_TOLERANCE_MS,
): string {
  const side =
    lifetimeState(meta, ttlMs, now, toleranceMs) === "future"
      ? "dated in the future beyond the clock tolerance"
      : "past its signed lifetime";
  return `Data ${side} (producedAt ${meta.producedAt}, local time ${now}, tolerance ${toleranceMs} ms)`;
}

/**
 * Validate a node's `clockToleranceMs` option (default {@link DEFAULT_CLOCK_TOLERANCE_MS}). Throws
 * `BAD_POLICY` for a negative value or one that is not a number.
 */
export function clockTolerance(ms: number | undefined): number {
  const v = ms ?? DEFAULT_CLOCK_TOLERANCE_MS;
  if (typeof v !== "number" || !(v >= 0)) {
    throw new IdemError("BAD_POLICY", "clockToleranceMs must be a non-negative number of milliseconds");
  }
  return v;
}

/**
 * Whether a Data is stale by its hop-relative age on arrival [P-8.1, P-8.2]: it carries an `ageMs`
 * (a cache served it) of at least its effective freshness `min(freshnessMs, ttlMs)`. A Data without
 * `ageMs` comes first-hand from its producer and is not stale on arrival, whatever its freshness. An
 * `ageMs` that is not a number counts as stale (fails closed). `ageMs` is unsigned, so this binds
 * honest caches only; the signed bound is {@link lifetimeState}. A downstream that asked for fresh
 * Data receives a Data only if this is `false` and it is within its signed lifetime.
 */
export function staleByAge(data: Pick<Data, "ageMs" | "meta">, ttlMs: number): boolean {
  if (data.ageMs === undefined) return false;
  return !(data.ageMs < Math.min(data.meta.freshnessMs, ttlMs));
}
