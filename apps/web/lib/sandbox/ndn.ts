/**
 * The native NDN view of one overlay exchange (ADR-026): given the IDEM Interest and the signed
 * Data the sandbox handled over HTTP, build the NDN Interest and Data the native binding would put
 * on the wire, with `@idem/ndn` (NDNts). Everything here is computed in the page from the real
 * packets: the wire bytes, their TLV tree and both signature checks. Nothing is simulated.
 *
 * One difference from a native producer is stated, never hidden: the page does not hold the
 * producer's private key, so the NDN-level signature of the Data is made here by a throwaway
 * *translator* key whose KeyLocator says so (`/localhost/idem-sandbox/KEY/<id>`), as in the
 * proxy-producer mode of protocol §9.1. The IDEM signature inside the Content is the producer's
 * own and is verified against the producer's trusted key, exactly as the overlay does.
 */
import {
  type Data,
  generateKeyPair,
  type IdemKeyPair,
  INTEREST_DEFAULTS,
  type Interest,
  isIdemError,
  parseName,
  randomNonce,
  type TrustStore,
  utf8Length,
} from "@idem/core";
import {
  dataFromWire,
  encodeData,
  encodeInterest,
  interestFromWire,
  type NdnVerifyResult,
  ndnSigner,
  ndnUri,
  type TlvNode,
  tlvTree,
  toHex,
  toWire,
  verifyNdnData,
} from "@idem/ndn";
import { Name } from "@ndn/packet";

/** One NDN packet, ready to show. */
export interface NdnPacketView {
  kind: "interest" | "data";
  /** Readable NDN URI of the packet's name: the IDEM name + `/params-sha256=<hex>`. */
  name: string;
  /** TLV wire encoding. */
  wire: Uint8Array;
  /** Lowercase hex of `wire`. */
  hex: string;
  /** Decoded TLV structure of `wire`. */
  tree: TlvNode[];
  /** Size of the same packet in the HTTP overlay (UTF-8 JSON body), for comparison. */
  overlayBytes: number;
}

/** Why an exchange has no native form. */
export type NdnUnavailableReason =
  /** `scope: "private"`: never expressed natively, NFD has no authorization context [P-8.3]. */
  | "private"
  /** No IDEM name: a plain call (non-cacheable tool or arguments outside the schema). */
  | "plain"
  /** The Data exceeds the NDN packet size limit; the native binding does not segment. */
  | "too-large"
  /** Anything else (malformed packet, crypto unavailable): `message` says what. */
  | "error";

/** The native form of one overlay exchange. */
export interface NdnExchangeView {
  /** The IDEM name, when the call had one. */
  idemName?: string;
  interest?: NdnPacketView;
  data?: NdnPacketView;
  /**
   * Both signature checks, run on the decoded Data wire bytes: `outer` is the NDN Ed25519
   * signature (translator key), `inner` the producer's IDEM signature and content digest.
   * Absent without a trust store.
   */
  verify?: Omit<NdnVerifyResult, "data">;
  /** KeyLocator of the translator key that made the NDN-level Data signature. */
  translatorKeyLocator?: string;
  unavailable?: { reason: NdnUnavailableReason; message: string };
}

/** A key that re-signs translated Data at the NDN level, and the KeyLocator it writes. */
export interface NdnTranslator {
  key: IdemKeyPair;
  keyLocator: Name;
}

/** Input of {@link ndnExchange}: what Live mode already holds for a call. */
export interface NdnExchangeInput {
  /**
   * The overlay Interest, or at least its name and canonical arguments (a Live-mode row's `name`
   * and `canonical`); missing fields take the protocol §4 defaults. Absent for plain calls.
   */
  interest?: Pick<Interest, "name" | "args"> & Partial<Interest>;
  /** The overlay Data that answered it, if it has arrived. */
  data?: Data;
  /** The trust store that accepted the producer's manifest (Live mode: `client.trust`). */
  trust?: TrustStore;
  /** Translator key. Default: one throwaway key per page ({@link pageTranslator}). */
  translator?: NdnTranslator;
}

let shared: Promise<NdnTranslator> | undefined;

/** Make a translator key with KeyLocator `/localhost/idem-sandbox/KEY/<keyId>` (`/localhost`: never leaves the page). */
export async function makeTranslator(): Promise<NdnTranslator> {
  const key = await generateKeyPair();
  return { key, keyLocator: new Name(`/localhost/idem-sandbox/KEY/${key.keyId}`) };
}

/** The page's translator key, created once on first use. */
export function pageTranslator(): Promise<NdnTranslator> {
  shared ??= makeTranslator();
  shared.catch(() => {
    shared = undefined;
  });
  return shared;
}

function packet(kind: "interest" | "data", name: string, wire: Uint8Array, overlay: unknown): NdnPacketView {
  return {
    kind,
    name,
    wire,
    hex: toHex(wire),
    tree: tlvTree(wire),
    overlayBytes: utf8Length(JSON.stringify(overlay)),
  };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isPrivate(input: NdnExchangeInput, name: string): boolean {
  if (input.data?.meta.scope === "private") return true;
  try {
    const { producer, tool } = parseName(name);
    return input.trust?.policy(producer, tool)?.scope === "private";
  } catch {
    return false;
  }
}

/**
 * Build the native NDN form of an overlay exchange. Never throws: problems come back as
 * `unavailable`. A `private` exchange is never encoded at all, not even its Interest: on NDN the
 * PIT and CS are keyed by name alone, so the binding refuses it (golden rule 4, [P-8.3]).
 */
export async function ndnExchange(input: NdnExchangeInput): Promise<NdnExchangeView> {
  const name = input.interest?.name;
  if (!input.interest || !name) {
    return { unavailable: { reason: "plain", message: "plain call: no IDEM name, no native packet" } };
  }
  if (isPrivate(input, name)) {
    return {
      idemName: name,
      unavailable: { reason: "private", message: "private results never travel on the native binding" },
    };
  }
  const interest: Interest = {
    mustBeFresh: INTEREST_DEFAULTS.mustBeFresh,
    lifetimeMs: INTEREST_DEFAULTS.lifetimeMs,
    hopLimit: INTEREST_DEFAULTS.hopLimit,
    nonce: randomNonce(),
    ...input.interest,
    name,
  };
  const { authContext: _never, ...overlayInterest } = interest; // [P-8.4]: never on the wire
  const view: NdnExchangeView = { idemName: name };
  try {
    const ni = await encodeInterest(interest);
    const iWire = toWire(ni);
    view.interest = packet("interest", ndnUri(interestFromWire(iWire).name), iWire, overlayInterest);
    if (!input.data) return view;
    const translator = input.translator ?? (await pageTranslator());
    const signer = ndnSigner(translator.key.privateKey, translator.keyLocator);
    let dWire: Uint8Array;
    try {
      dWire = toWire(await encodeData(input.data, ni.name, signer));
    } catch (e) {
      if (isIdemError(e, "BAD_ENCODING")) {
        view.unavailable = { reason: "too-large", message: message(e) };
        return view;
      }
      throw e;
    }
    const decoded = dataFromWire(dWire);
    view.data = packet("data", ndnUri(decoded.name), dWire, input.data);
    view.translatorKeyLocator = ndnUri(translator.keyLocator);
    if (input.trust) {
      const { data: _decoded, ...verify } = await verifyNdnData(decoded, input.trust, {
        outerKey: { keyLocator: translator.keyLocator, publicKey: translator.key.publicKey },
      });
      view.verify = verify;
    }
    return view;
  } catch (e) {
    view.unavailable = { reason: "error", message: message(e) };
    return view;
  }
}

/** One line of a hex dump: the offset of its first byte and its bytes as two-digit hex. */
export interface HexLine {
  offset: number;
  bytes: string[];
}

/** Split hex into lines of `perLine` bytes, for a dump next to the TLV tree. */
export function hexLines(hex: string, perLine = 16): HexLine[] {
  const out: HexLine[] = [];
  const n = hex.length / 2;
  for (let off = 0; off < n; off += perLine) {
    const bytes: string[] = [];
    for (let i = off; i < Math.min(n, off + perLine); i++) bytes.push(hex.slice(i * 2, i * 2 + 2));
    out.push({ offset: off, bytes });
  }
  return out;
}

/** Byte range `[start, end)` a TLV element covers in its packet's wire. */
export function tlvRange(node: TlvNode): [start: number, end: number] {
  return [node.offset, node.offset + node.headerLength + node.length];
}
