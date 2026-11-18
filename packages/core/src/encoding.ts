import { IdemError } from "./errors";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

const B64U_RE = /^[A-Za-z0-9_-]*$/;

/** base64url without padding (RFC 4648 §5). */
export function b64uEncode(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    out +=
      ALPHABET.charAt(n >>> 18) +
      ALPHABET.charAt((n >>> 12) & 63) +
      ALPHABET.charAt((n >>> 6) & 63) +
      ALPHABET.charAt(n & 63);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] as number) << 16;
    out += ALPHABET.charAt(n >>> 18) + ALPHABET.charAt((n >>> 12) & 63);
  } else if (rest === 2) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
    out += ALPHABET.charAt(n >>> 18) + ALPHABET.charAt((n >>> 12) & 63) + ALPHABET.charAt((n >>> 6) & 63);
  }
  return out;
}

/** Decode base64url without padding. Throws `BAD_ENCODING` on invalid input. */
export function b64uDecode(s: string): Uint8Array<ArrayBuffer> {
  if (!B64U_RE.test(s) || s.length % 4 === 1) {
    throw new IdemError("BAD_ENCODING", "invalid base64url string");
  }
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    buf = (buf << 6) | (LOOKUP[s.charCodeAt(i)] as number);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >>> bits) & 0xff;
    }
  }
  return out;
}

/** True when `s` is a base64url string (no padding) of exactly `len` characters. */
export function isB64u(s: unknown, len?: number): s is string {
  return typeof s === "string" && B64U_RE.test(s) && (len === undefined || s.length === len);
}

const encoder = new TextEncoder();

/** UTF-8 encode a string. */
export function utf8(s: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(s) as Uint8Array<ArrayBuffer>;
}

/** Number of bytes `s` occupies in UTF-8, computed without allocating. */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else n += 3;
    } else n += 3;
  }
  return n;
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new IdemError("CRYPTO_UNSUPPORTED", "WebCrypto (crypto.subtle) is not available");
  return s;
}

/** SHA-256 via WebCrypto. */
export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await subtle().digest("SHA-256", bytes));
}

/** `b64u(SHA-256(utf8(s)))`: 43 characters. */
export async function sha256b64u(s: string): Promise<string> {
  return b64uEncode(await sha256(utf8(s)));
}

/** Internal accessor shared by the crypto module. */
export function getSubtle(): SubtleCrypto {
  return subtle();
}

/** 64 random bits, base64url (11 characters). Used for Interest nonces (protocol §4). */
export function randomNonce(): string {
  const b = new Uint8Array(8);
  globalThis.crypto.getRandomValues(b);
  return b64uEncode(b);
}
