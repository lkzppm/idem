import { IdemError } from "./errors";
import { type JsonValue, jcs } from "./jcs";

/**
 * Argument normalizers a producer may declare per field in its manifest (protocol §3).
 *
 * - `trim`: strip surrounding whitespace (ECMAScript `String.prototype.trim`).
 * - `lowercase`: Unicode default lowercase mapping, locale-independent (`toLowerCase`). See ADR-011.
 * - `nfc`: Unicode NFC normalization.
 * - `url`: WHATWG URL parse and serialize; lowercase scheme and host, drop the default port
 *   and the fragment.
 * - `url:sortQuery`: `url`, then sort query parameters by name (stable) and re-serialize them as
 *   `application/x-www-form-urlencoded`.
 * - `set`: the array is a set; remove duplicates and sort by the JCS serialization of each item.
 */
export type Normalizer = "trim" | "lowercase" | "nfc" | "url" | "url:sortQuery" | "set";

/** Every normalizer defined by IDEM v1. */
export const NORMALIZERS: readonly Normalizer[] = ["trim", "lowercase", "nfc", "url", "url:sortQuery", "set"];

/** Type guard for {@link Normalizer}. */
export function isNormalizer(n: unknown): n is Normalizer {
  return typeof n === "string" && (NORMALIZERS as readonly string[]).includes(n);
}

function needString(n: Normalizer, v: JsonValue, pointer: string): string {
  if (typeof v !== "string") {
    throw new IdemError("BAD_POLICY", `normalizer "${n}" at "${pointer}" needs a string, got ${typeof v}`);
  }
  return v;
}

function normalizeUrl(raw: string, pointer: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch (e) {
    throw new IdemError("INVALID_ARGS", `"${pointer}" is not a valid absolute URL`, { cause: e });
  }
  // WHATWG already lowercases scheme and host and drops default ports for special schemes.
  // Opaque hosts (non-special schemes) keep their case, so lowercase them explicitly.
  const host = u.hostname.toLowerCase();
  if (host !== u.hostname) u.hostname = host;
  u.hash = "";
  return u;
}

/** Apply one normalizer to one value. `pointer` is only used in error messages. */
export function applyNormalizer(n: Normalizer, v: JsonValue, pointer = ""): JsonValue {
  switch (n) {
    case "trim":
      return needString(n, v, pointer).trim();
    case "lowercase":
      return needString(n, v, pointer).toLowerCase();
    case "nfc":
      return needString(n, v, pointer).normalize("NFC");
    case "url":
      return normalizeUrl(needString(n, v, pointer), pointer).href;
    case "url:sortQuery": {
      const u = normalizeUrl(needString(n, v, pointer), pointer);
      const params = new URLSearchParams(u.search);
      params.sort();
      u.search = params.toString();
      return u.href;
    }
    case "set": {
      if (!Array.isArray(v)) {
        throw new IdemError("BAD_POLICY", `normalizer "set" at "${pointer}" needs an array`);
      }
      const byKey = new Map<string, JsonValue>();
      for (const item of v) byKey.set(jcs(item), item);
      return [...byKey.keys()].sort().map((k) => byKey.get(k) as JsonValue);
    }
    default:
      throw new IdemError("BAD_POLICY", `unknown normalizer "${String(n)}"`);
  }
}

/** Split an RFC 6901 JSON Pointer into unescaped reference tokens. */
export function parsePointer(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) throw new IdemError("BAD_POLICY", `invalid JSON Pointer "${pointer}"`);
  return pointer
    .slice(1)
    .split("/")
    .map((t) => t.replaceAll("~1", "/").replaceAll("~0", "~"));
}

/**
 * Apply the normalizers declared for each JSON Pointer, in place on a copy of `value`.
 *
 * Pointers are applied deepest-first (more reference tokens first), ties broken by UTF-16
 * code-unit order of the pointer string, so element normalizers run before a `set` on their
 * parent array. Pointers that do not resolve (absent optional fields) are skipped.
 */
export function applyNormalizers(
  value: JsonValue,
  normalizers: Record<string, readonly Normalizer[]>,
): JsonValue {
  const entries = Object.entries(normalizers).map(([p, ns]) => ({ p, tokens: parsePointer(p), ns }));
  entries.sort((a, b) => b.tokens.length - a.tokens.length || (a.p < b.p ? -1 : a.p > b.p ? 1 : 0));
  let root = structuredClone(value);
  for (const { p, tokens, ns } of entries) {
    for (const n of ns) {
      if (!isNormalizer(n)) throw new IdemError("BAD_POLICY", `unknown normalizer "${String(n)}" at "${p}"`);
    }
    if (tokens.length === 0) {
      for (const n of ns) root = applyNormalizer(n, root, p);
      continue;
    }
    let parent: JsonValue = root;
    let ok = true;
    for (const t of tokens.slice(0, -1)) {
      const next: JsonValue | undefined = step(parent, t);
      if (next === undefined) {
        ok = false;
        break;
      }
      parent = next;
    }
    const last = tokens[tokens.length - 1] as string;
    if (!ok || step(parent, last) === undefined) continue;
    let v = step(parent, last) as JsonValue;
    for (const n of ns) v = applyNormalizer(n, v, p);
    if (Array.isArray(parent)) parent[Number(last)] = v;
    else (parent as { [k: string]: JsonValue })[last] = v;
  }
  return root;
}

function step(v: JsonValue, token: string): JsonValue | undefined {
  if (Array.isArray(v)) {
    if (!/^(0|[1-9][0-9]*)$/.test(token)) return undefined;
    return v[Number(token)];
  }
  if (v !== null && typeof v === "object") return Object.hasOwn(v, token) ? v[token] : undefined;
  return undefined;
}
