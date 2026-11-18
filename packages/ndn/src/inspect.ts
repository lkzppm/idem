import { IdemError } from "@idem/core";

/** NDN packet format v0.3 TLV-TYPE names, for the types this binding emits. */
export const TLV_TYPES: Readonly<Record<number, string>> = {
  1: "ImplicitSha256DigestComponent",
  2: "ParametersSha256DigestComponent",
  5: "Interest",
  6: "Data",
  7: "Name",
  8: "GenericNameComponent",
  10: "Nonce",
  12: "InterestLifetime",
  18: "MustBeFresh",
  20: "MetaInfo",
  21: "Content",
  22: "SignatureInfo",
  23: "SignatureValue",
  24: "ContentType",
  25: "FreshnessPeriod",
  26: "FinalBlockId",
  27: "SignatureType",
  28: "KeyLocator",
  29: "KeyDigest",
  30: "ForwardingHint",
  33: "CanBePrefix",
  34: "HopLimit",
  36: "ApplicationParameters",
  44: "InterestSignatureInfo",
  46: "InterestSignatureValue",
};

const CONTAINERS = new Set([5, 6, 7, 20, 22, 28, 30, 44]);
const NUMBERS = new Set([12, 24, 25, 27, 34]);
const TEXTS = new Set([8, 21, 36]);
const CONTENT_TYPES: Record<number, string> = { 0: "BLOB", 1: "LINK", 2: "KEY", 3: "NACK" };
const SIG_TYPES: Record<number, string> = {
  0: "DigestSha256",
  1: "SignatureSha256WithRsa",
  3: "SignatureSha256WithEcdsa",
  4: "SignatureHmacWithSha256",
  5: "SignatureEd25519",
  200: "Null",
};

/** One TLV element of a decoded packet, for display. */
export interface TlvNode {
  /** TLV-TYPE number. */
  type: number;
  /** NDN name of the TLV-TYPE, when known. */
  typeName?: string;
  /** Offset of the element (its TLV-TYPE byte) in the wire. */
  offset: number;
  /** Bytes taken by TLV-TYPE and TLV-LENGTH. */
  headerLength: number;
  /** TLV-LENGTH: bytes of TLV-VALUE. */
  length: number;
  /** Short readable rendering of a leaf's TLV-VALUE: text, number or hex. */
  preview?: string;
  /** Nested elements, for container types (Interest, Data, Name, MetaInfo, SignatureInfo, ...). */
  children?: TlvNode[];
}

/** Lowercase hex of `bytes`. */
export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

function readVarNum(wire: Uint8Array, at: number): [value: number, size: number] {
  const first = wire[at];
  if (first === undefined) throw new IdemError("BAD_ENCODING", "truncated TLV");
  if (first < 253) return [first, 1];
  const n = first === 253 ? 2 : first === 254 ? 4 : 8;
  if (at + 1 + n > wire.length) throw new IdemError("BAD_ENCODING", "truncated TLV");
  let v = 0;
  for (let i = 1; i <= n; i++) v = v * 256 + (wire[at + i] as number);
  if (!Number.isSafeInteger(v)) throw new IdemError("BAD_ENCODING", "TLV number too large");
  return [v, 1 + n];
}

const strict = new TextDecoder("utf-8", { fatal: true });

function printable(s: string): boolean {
  return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s);
}

function preview(type: number, value: Uint8Array, max: number): string {
  if (NUMBERS.has(type)) {
    let n = 0;
    for (const b of value) n = n * 256 + b;
    if (type === 24) return `${n} (${CONTENT_TYPES[n] ?? "?"})`;
    if (type === 27) return `${n} (${SIG_TYPES[n] ?? "?"})`;
    if (type === 12 || type === 25) return `${n} ms`;
    return String(n);
  }
  if (TEXTS.has(type)) {
    try {
      const s = strict.decode(value);
      if (printable(s)) return s.length > max ? `${s.slice(0, max)}…` : s;
    } catch {
      // binary: fall through to hex
    }
  }
  const hex = toHex(value.subarray(0, max));
  return value.length > max ? `${hex}…` : hex;
}

function parse(wire: Uint8Array, start: number, end: number, max: number): TlvNode[] {
  const out: TlvNode[] = [];
  let at = start;
  while (at < end) {
    const [type, tSize] = readVarNum(wire, at);
    const [length, lSize] = readVarNum(wire, at + tSize);
    const headerLength = tSize + lSize;
    const vStart = at + headerLength;
    const vEnd = vStart + length;
    if (vEnd > end) throw new IdemError("BAD_ENCODING", `TLV ${type} overruns its parent`);
    const node: TlvNode = { type, offset: at, headerLength, length };
    const typeName = TLV_TYPES[type];
    if (typeName) node.typeName = typeName;
    if (CONTAINERS.has(type)) node.children = parse(wire, vStart, vEnd, max);
    else node.preview = preview(type, wire.subarray(vStart, vEnd), max);
    out.push(node);
    at = vEnd;
  }
  return out;
}

/**
 * Decode the TLV structure of an NDN packet for display: every element with its type, length,
 * position and, for leaves, a short preview (`previewChars` characters of text or bytes of hex,
 * default 48). Throws `BAD_ENCODING` on malformed TLV.
 */
export function tlvTree(wire: Uint8Array, opts: { previewChars?: number } = {}): TlvNode[] {
  return parse(wire, 0, wire.length, opts.previewChars ?? 48);
}
