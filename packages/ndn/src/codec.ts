import {
  b64uDecode,
  b64uEncode,
  type CallToolResult,
  type Data,
  type DataMeta,
  type DataSignature,
  IdemError,
  type IdemWireErrorCode,
  type Interest,
  isB64u,
  jcs,
  parseName,
  sha256b64u,
  stripEphemeral,
  utf8,
} from "@idem/core";
import { type Name, Data as NdnData, Interest as NdnInterest, type Signer } from "@ndn/packet";
import { Decoder, Encoder } from "@ndn/tlv";
import { fromNdnName, hasParamsDigest, toNdnName } from "./name";

/**
 * Largest NDN packet this binding emits or accepts, in bytes. It is the `MAX_NDN_PACKET_SIZE` of
 * ndn-cxx and NFD; larger results would need segmentation, which v1 of the native binding does not
 * implement (ADR-026): the producer answers `UPSTREAM_ERROR` instead.
 */
export const MAX_PACKET_SIZE = 8800;

/** NDN ContentType values used by the binding (NDN packet format v0.3, §MetaInfo). */
export const CONTENT_TYPE = {
  /** A signed IDEM envelope. */
  blob: 0,
  /** An application-level Nack: the content is a JCS `{ code, message }`. */
  nack: 3,
} as const;

/**
 * Content of a native Data packet: the IDEM Data minus its name (the NDN name carries it) and minus
 * the unsigned per-hop `ageMs` (NFD keeps its own freshness). Serialized with JCS (ADR-004). It
 * keeps the IDEM signature, so `@idem/core`'s `verifyData` checks a native Data exactly as it
 * checks an overlay one (ADR-026).
 */
export interface NativeEnvelope {
  content: CallToolResult;
  meta: DataMeta;
  signature: DataSignature;
}

/** A decoded native Data: an IDEM Data, or an application-level Nack. */
export type DecodedData =
  | { kind: "data"; data: Data }
  | { kind: "nack"; name: string; code: IdemWireErrorCode; message: string };

const WIRE_CODES = new Set<string>([
  "DIGEST_MISMATCH",
  "BAD_SIGNATURE",
  "UNTRUSTED_KEY",
  "NOT_CACHEABLE",
  "TIMEOUT",
  "HOP_LIMIT",
  "LOOP",
  "UPSTREAM_ERROR",
]);

const strict = new TextDecoder("utf-8", { fatal: true });

function text(bytes: Uint8Array, what: string): string {
  try {
    return strict.decode(bytes);
  } catch (e) {
    throw new IdemError("BAD_ENCODING", `${what} is not UTF-8`, { cause: e });
  }
}

function parseJson(s: string, what: string): unknown {
  try {
    return JSON.parse(s) as unknown;
  } catch (e) {
    throw new IdemError("BAD_JSON", `${what} is not JSON`, { cause: e });
  }
}

/**
 * NDN Nonce (32 bits) for an IDEM nonce: its first four bytes when it is base64url of at least
 * four bytes, otherwise a random one. NDN's Nonce is shorter than IDEM's 64 bits; on the native
 * binding loop detection is NFD's, so the nonce only has to be random (protocol §9.2).
 */
export function ndnNonce(idemNonce: string): number {
  if (isB64u(idemNonce) && idemNonce.length >= 6) {
    const b = b64uDecode(idemNonce);
    if (b.length >= 4)
      return (
        (((b[0] as number) << 24) | ((b[1] as number) << 16) | ((b[2] as number) << 8) | (b[3] as number)) >>>
        0
      );
  }
  return NdnInterest.generateNonce();
}

/** The IDEM nonce of an NDN Interest: base64url of its four Nonce bytes. */
export function idemNonce(nonce: number | undefined): string {
  const n = nonce ?? NdnInterest.generateNonce();
  return b64uEncode(new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]));
}

/**
 * Encode an IDEM Interest as an NDN Interest (protocol §9.2, ADR-026):
 *
 * - Name = the IDEM name as GenericNameComponents, followed by the ParametersSha256DigestComponent
 *   NDN computes over ApplicationParameters;
 * - ApplicationParameters = `JCS(canonical args)`, the exact bytes `args-digest` hashes;
 * - MustBeFresh, InterestLifetime and HopLimit from the Interest; CanBePrefix is never set;
 * - the Interest is never signed (a signature would change the ParametersSha256DigestComponent per
 *   request and defeat aggregation), and `authContext` is never encoded [P-8.4].
 *
 * Throws `BAD_NAME` for a name that is not a tool-call name, and `DIGEST_MISMATCH` when the
 * arguments do not hash to the name's `args-digest` [P-4.3].
 */
export async function encodeInterest(interest: Interest): Promise<NdnInterest> {
  const parsed = parseName(interest.name);
  const argsJcs = jcs(interest.args);
  if ((await sha256b64u(argsJcs)) !== parsed.argsDigest) {
    throw new IdemError("DIGEST_MISMATCH", "arguments do not match the name's args-digest [P-4.3]");
  }
  const args: NdnInterest.CtorArg[] = [
    toNdnName(interest.name),
    utf8(argsJcs),
    NdnInterest.Lifetime(Math.max(0, Math.round(interest.lifetimeMs))),
    NdnInterest.HopLimit(Math.min(255, Math.max(0, Math.round(interest.hopLimit)))),
    NdnInterest.Nonce(ndnNonce(interest.nonce)),
  ];
  if (interest.mustBeFresh) args.push(NdnInterest.MustBeFresh);
  const pkt = new NdnInterest(...args);
  await pkt.updateParamsDigest();
  return pkt;
}

/**
 * Decode an NDN Interest into an IDEM Interest. Checks, in order: the Interest is unsigned and
 * carries ApplicationParameters; its ParametersSha256DigestComponent is correct (NFD checks it
 * too); the name is an IDEM tool-call name; and the ApplicationParameters hash to the name's
 * `args-digest` [P-4.3]. The producer then recomputes the whole name from the arguments [P-5.1].
 *
 * Throws `NOT_CACHEABLE` (signed or parameterless Interest), `DIGEST_MISMATCH`, `BAD_NAME`,
 * `BAD_ENCODING` or `BAD_JSON`.
 */
export async function decodeInterest(pkt: NdnInterest): Promise<Interest> {
  if (pkt.sigInfo) throw new IdemError("NOT_CACHEABLE", "signed Interests are not IDEM Interests");
  if (!pkt.appParameters) throw new IdemError("NOT_CACHEABLE", "IDEM Interests carry ApplicationParameters");
  try {
    await pkt.validateParamsDigest(true);
  } catch (e) {
    throw new IdemError("DIGEST_MISMATCH", "bad ParametersSha256DigestComponent", { cause: e });
  }
  const name = fromNdnName(pkt.name);
  const parsed = parseName(name);
  const argsJcs = text(pkt.appParameters, "ApplicationParameters");
  if ((await sha256b64u(argsJcs)) !== parsed.argsDigest) {
    throw new IdemError("DIGEST_MISMATCH", "ApplicationParameters do not match the args-digest [P-4.3]");
  }
  return {
    name,
    args: parseJson(argsJcs, "ApplicationParameters") as Interest["args"],
    mustBeFresh: pkt.mustBeFresh,
    lifetimeMs: pkt.lifetime,
    nonce: idemNonce(pkt.nonce),
    hopLimit: pkt.hopLimit,
  };
}

/** Throw `BAD_ENCODING` when a packet exceeds {@link MAX_PACKET_SIZE}. */
function assertSize(pkt: NdnData): void {
  const size = Encoder.encode(pkt).length;
  if (size > MAX_PACKET_SIZE) {
    throw new IdemError(
      "BAD_ENCODING",
      `Data of ${size} bytes exceeds ${MAX_PACKET_SIZE}; the native binding does not segment (ADR-026)`,
    );
  }
}

/**
 * Encode a signed IDEM Data as an NDN Data answering the Interest named `interestName` (protocol
 * §9.2, ADR-026): same name (IDEM name + ParametersSha256DigestComponent), FreshnessPeriod =
 * `freshnessMs`, ContentType BLOB, Content = `JCS({ content, meta, signature })`, signed by
 * `signer` (NDN Ed25519).
 *
 * Throws `NOT_CACHEABLE` for `scope: "private"` Data: NDN's PIT and CS have no authorization
 * context, so private results never travel on the native binding (golden rule 4, [P-8.3]).
 * Throws `DIGEST_MISMATCH` when the Interest name is not the Data's, and `BAD_ENCODING` when the
 * packet exceeds {@link MAX_PACKET_SIZE}.
 */
export async function encodeData(data: Data, interestName: Name, signer: Signer): Promise<NdnData> {
  if (data.meta.scope !== "public") {
    throw new IdemError("NOT_CACHEABLE", "private Data never travels on the native binding [P-8.3]");
  }
  if (!hasParamsDigest(interestName) || fromNdnName(interestName) !== data.name) {
    throw new IdemError("DIGEST_MISMATCH", "the Interest name is not this Data's name");
  }
  const envelope: NativeEnvelope = {
    content: stripEphemeral(data.content),
    meta: data.meta,
    signature: data.signature,
  };
  const pkt = new NdnData(
    interestName,
    NdnData.ContentType(CONTENT_TYPE.blob),
    NdnData.FreshnessPeriod(data.meta.freshnessMs),
    utf8(jcs(envelope)),
  );
  await signer.sign(pkt);
  assertSize(pkt);
  return pkt;
}

/**
 * An application-level Nack for the Interest named `name`: ContentType NACK, FreshnessPeriod 0,
 * Content = `JCS({ code, message })`, signed like any Data. Errors are never cached [P-7.2].
 */
export async function encodeNack(
  name: Name,
  code: IdemWireErrorCode,
  message: string,
  signer: Signer,
): Promise<NdnData> {
  const pkt = new NdnData(
    name,
    NdnData.ContentType(CONTENT_TYPE.nack),
    NdnData.FreshnessPeriod(0),
    utf8(jcs({ code, message })),
  );
  await signer.sign(pkt);
  return pkt;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Decode a native Data into an IDEM Data (name from the NDN name, the rest from the envelope) or an
 * application Nack. Does **not** verify anything: use {@link verifyNdnData}.
 *
 * Throws `BAD_NAME`, `BAD_ENCODING` or `BAD_JSON` for packets that are not IDEM Data.
 */
export function decodeData(pkt: NdnData): DecodedData {
  const name = fromNdnName(pkt.name);
  const body = parseJson(text(pkt.content, "Content"), "Content");
  if (pkt.contentType === CONTENT_TYPE.nack) {
    const code = isObject(body) && typeof body.code === "string" ? body.code : "";
    const message = isObject(body) && typeof body.message === "string" ? body.message : "";
    return {
      kind: "nack",
      name,
      code: (WIRE_CODES.has(code) ? code : "UPSTREAM_ERROR") as IdemWireErrorCode,
      message,
    };
  }
  if (pkt.contentType !== CONTENT_TYPE.blob) {
    throw new IdemError("BAD_ENCODING", `unexpected ContentType ${pkt.contentType}`);
  }
  if (
    !isObject(body) ||
    !isObject(body.content) ||
    !Array.isArray(body.content.content) ||
    !isObject(body.meta) ||
    !isObject(body.signature)
  ) {
    throw new IdemError("BAD_ENCODING", "Content is not an IDEM envelope");
  }
  const env = body as unknown as NativeEnvelope;
  return { kind: "data", data: { name, content: env.content, meta: env.meta, signature: env.signature } };
}

/** TLV wire encoding of an NDN Interest or Data. */
export function toWire(pkt: NdnInterest | NdnData): Uint8Array {
  return Encoder.encode(pkt);
}

/** Decode an NDN Interest from its TLV wire encoding. */
export function interestFromWire(wire: Uint8Array): NdnInterest {
  return Decoder.decode(wire, NdnInterest);
}

/** Decode an NDN Data from its TLV wire encoding. */
export function dataFromWire(wire: Uint8Array): NdnData {
  return Decoder.decode(wire, NdnData);
}
