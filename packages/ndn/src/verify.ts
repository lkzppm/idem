import {
  type Data,
  parseKeyLocator,
  parseName,
  type TrustStore,
  type VerifyResult,
  verifyData,
} from "@idem/core";
import { KeyLocator, type Name, type Data as NdnData, SigType } from "@ndn/packet";
import { decodeData } from "./codec";
import { ndnVerifier } from "./keys";
import { fromNdnName, ndnUri } from "./name";

/** Outcome of checking the NDN-level signature of a native Data. */
export type OuterVerifyResult =
  | { ok: true; keyLocator: string }
  | { ok: false; keyLocator?: string; code: "BAD_SIGNATURE" | "UNTRUSTED_KEY"; reason: string };

/** Outcome of {@link verifyNdnData}. */
export interface NdnVerifyResult {
  /** True only when the outer and inner checks pass and the Data is `public`. */
  ok: boolean;
  /** Why `ok` is false, if it is. */
  code?: "BAD_SIGNATURE" | "UNTRUSTED_KEY" | "NOT_CACHEABLE";
  /** The NDN Ed25519 signature over the packet's signed portion, checked with NDNts. */
  outer: OuterVerifyResult;
  /** The IDEM signature and content digest inside the envelope, checked by `@idem/core` [P-5.5]. */
  inner: VerifyResult;
  /** The decoded IDEM Data (present whenever the packet decoded). */
  data?: Data;
}

/** Options of {@link verifyNdnData}. */
export interface NdnVerifyOptions {
  now?: number;
  /**
   * Accept an outer signature by this key instead of the producer's: a translator that re-encodes
   * overlay Data as NDN packets (as the sandbox does) signs with its own key and says so in the
   * KeyLocator, like the proxy-producer mode of protocol §9.1. The inner IDEM signature must still
   * be the producer's.
   */
  outerKey?: { keyLocator: Name; publicKey: CryptoKey };
}

function badOuter(
  code: "BAD_SIGNATURE" | "UNTRUSTED_KEY",
  reason: string,
  keyLocator?: string,
): OuterVerifyResult {
  return { ok: false, code, reason, ...(keyLocator !== undefined && { keyLocator }) };
}

async function checkOuter(
  pkt: NdnData,
  data: Data,
  trust: TrustStore,
  opts: NdnVerifyOptions,
): Promise<OuterVerifyResult> {
  if (pkt.sigInfo?.type !== SigType.Ed25519)
    return badOuter("BAD_SIGNATURE", "NDN SignatureType is not Ed25519");
  let kl: Name;
  try {
    kl = KeyLocator.mustGetName(pkt.sigInfo.keyLocator);
  } catch {
    return badOuter("UNTRUSTED_KEY", "NDN KeyLocator has no name");
  }
  const shown = ndnUri(kl);
  let publicKey: CryptoKey | undefined;
  if (opts.outerKey) {
    if (!kl.equals(opts.outerKey.keyLocator))
      return badOuter("UNTRUSTED_KEY", "unexpected KeyLocator", shown);
    publicKey = opts.outerKey.publicKey;
  } else {
    // The producer's own key, the same one that made the IDEM signature [P-5.2].
    let locator: string;
    let loc: { producer: string; keyId: string };
    try {
      locator = fromNdnName(kl);
      loc = parseKeyLocator(locator);
    } catch {
      return badOuter("UNTRUSTED_KEY", "KeyLocator is not an IDEM key locator", shown);
    }
    const { producer } = parseName(data.name);
    if (loc.producer !== producer) {
      return badOuter("UNTRUSTED_KEY", "KeyLocator belongs to another producer [P-5.2]", locator);
    }
    if (locator !== data.signature.keyLocator) {
      return badOuter("UNTRUSTED_KEY", "NDN and IDEM signatures name different keys", locator);
    }
    publicKey = await trust.key(producer, loc.keyId, opts.now ?? Date.now());
    if (!publicKey)
      return badOuter("UNTRUSTED_KEY", `key ${loc.keyId} is not trusted for ${producer}`, locator);
  }
  try {
    await (await ndnVerifier(publicKey)).verify(pkt);
  } catch {
    return badOuter("BAD_SIGNATURE", "NDN Ed25519 signature does not verify", shown);
  }
  return { ok: true, keyLocator: opts.outerKey ? shown : data.signature.keyLocator };
}

/**
 * Verify a native Data end to end: decode the envelope, check the NDN Ed25519 signature with NDNts
 * (by the producer's trusted key, or `opts.outerKey`), check the IDEM signature and content digest
 * with `@idem/core` (`verifyData`, the same check the overlay runs [P-5.5]), and refuse `private`
 * Data, which the native binding never carries [P-8.3]. Never throws.
 */
export async function verifyNdnData(
  pkt: NdnData,
  trust: TrustStore,
  opts: NdnVerifyOptions = {},
): Promise<NdnVerifyResult> {
  let decoded: ReturnType<typeof decodeData>;
  try {
    decoded = decodeData(pkt);
  } catch (e) {
    const reason = e instanceof Error ? e.message : "not an IDEM Data";
    return {
      ok: false,
      code: "BAD_SIGNATURE",
      outer: badOuter("BAD_SIGNATURE", reason),
      inner: { ok: false, code: "BAD_SIGNATURE", reason },
    };
  }
  if (decoded.kind === "nack") {
    const reason = `application Nack ${decoded.code}`;
    return {
      ok: false,
      code: "BAD_SIGNATURE",
      outer: badOuter("BAD_SIGNATURE", reason),
      inner: { ok: false, code: "BAD_SIGNATURE", reason },
    };
  }
  const data = decoded.data;
  const [outer, inner] = await Promise.all([
    checkOuter(pkt, data, trust, opts),
    verifyData(data, trust, opts.now !== undefined ? { now: opts.now } : {}),
  ]);
  if (!outer.ok) return { ok: false, code: outer.code, outer, inner, data };
  if (!inner.ok)
    return {
      ok: false,
      code: inner.code === "UNTRUSTED_KEY" ? "UNTRUSTED_KEY" : "BAD_SIGNATURE",
      outer,
      inner,
      data,
    };
  if (data.meta.scope !== "public") return { ok: false, code: "NOT_CACHEABLE", outer, inner, data };
  return { ok: true, outer, inner, data };
}
