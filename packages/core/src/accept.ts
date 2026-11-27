import { verifyData } from "./crypto";
import { DEFAULT_CLOCK_TOLERANCE_MS, lifetimeReason, lifetimeState, staleByAge } from "./lifetime";
import { parseName } from "./name";
import type { TrustStore } from "./trust";
import type { Data, VerifyResult } from "./types";

/** A {@link VerifyResult} that passed. */
export type VerifiedData = Extract<VerifyResult, { ok: true }>;

/** Inputs of {@link acceptData}. */
export interface AcceptOptions {
  /** Keys and manifest policies of the producers this consumer trusts [P-6.2]. */
  trust: TrustStore;
  /** This consumer's clock [P-8.7]. */
  now: number;
  /**
   * The name the consumer asked for. The Data MUST carry exactly this name [P-5.5]. Omit it only for
   * a plain-call result that answers no Interest.
   */
  name?: string;
  /**
   * The consumer asked for fresh Data (`mustBeFresh: true`, and always for the [P-5.5] retry):
   * refuse Data outside its signed lifetime [P-8.6] or stale by its `ageMs` [P-8.1].
   */
  mustBeFresh: boolean;
  /** Manifest `ttlMs` of the tool. Default: the policy `trust` holds for the Data's name, else none. */
  ttlMs?: number;
  /** This consumer's `clockToleranceMs` [P-8.6]. Default {@link DEFAULT_CLOCK_TOLERANCE_MS}. */
  toleranceMs?: number;
}

/**
 * The consumer's decision on a Data ({@link acceptData}). `ok: true` means the content may be handed
 * to the agent. Otherwise `code` says why, and the verdicts stay distinct: `BAD_SIGNATURE` (wrong
 * name, content digest or signature), `UNTRUSTED_KEY` (no trusted key for the key locator),
 * `BAD_MANIFEST`, or `EXPIRED` (the signature verifies, `verify.ok` is `true`, but the Data is
 * outside its signed lifetime or stale by its age, and the consumer asked for fresh Data).
 */
export type AcceptVerdict =
  | { ok: true; verify: VerifiedData }
  | {
      ok: false;
      code: "BAD_SIGNATURE" | "UNTRUSTED_KEY" | "BAD_MANIFEST";
      reason: string;
      verify: VerifyResult;
    }
  | { ok: false; code: "EXPIRED"; reason: string; verify: VerifiedData };

/**
 * Decide whether a consumer may hand a Data to its agent: the one decision every shipped consumer
 * makes (`IdemClient`, `IdemConsumer`, `NdnConsumer`, the simulator's agents and the E5 harness).
 * In order: the Data carries the name that was asked for [P-5.5]; it verifies (trusted key for its
 * producer, content digest, Ed25519 signature, `verifyData`) [P-5.5]; and, when the consumer asked
 * for fresh Data, it is within its signed lifetime on this consumer's clock [P-8.6, P-8.7] and not
 * stale by its hop-relative age [P-8.1, P-8.2]. A refusal for `EXPIRED` is followed by the [P-5.5]
 * plain-call retry where the binding has one.
 */
export async function acceptData(data: Data, opts: AcceptOptions): Promise<AcceptVerdict> {
  if (opts.name !== undefined && data?.name !== opts.name) {
    const reason = "Data name differs from the Interest";
    return { ok: false, code: "BAD_SIGNATURE", reason, verify: { ok: false, code: "BAD_SIGNATURE", reason } };
  }
  const verify = await verifyData(data, opts.trust, { now: opts.now });
  if (!verify.ok) return { ok: false, code: verify.code, reason: verify.reason, verify };
  if (!opts.mustBeFresh) return { ok: true, verify };
  const ttl = opts.ttlMs ?? ttlOf(data, opts.trust);
  const tolerance = opts.toleranceMs ?? DEFAULT_CLOCK_TOLERANCE_MS;
  if (lifetimeState(data.meta, ttl, opts.now, tolerance) !== "within") {
    return {
      ok: false,
      code: "EXPIRED",
      reason: lifetimeReason(data.meta, ttl, opts.now, tolerance),
      verify,
    };
  }
  if (staleByAge(data, ttl)) {
    const reason = `Data stale by its age (ageMs ${data.ageMs}, freshness ${Math.min(data.meta.freshnessMs, ttl)} ms)`;
    return { ok: false, code: "EXPIRED", reason, verify };
  }
  return { ok: true, verify };
}

function ttlOf(data: Data, trust: TrustStore): number {
  try {
    const { producer, tool } = parseName(data.name);
    return trust.policy(producer, tool)?.ttlMs ?? Infinity;
  } catch {
    return Infinity; // verifyData parsed the name already; keep the signed freshness as the bound
  }
}
