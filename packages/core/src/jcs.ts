import { IdemError } from "./errors";

/** A JSON value as defined by RFC 8259 (I-JSON subset: finite numbers, well-formed strings). */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** A JSON object. */
export type JsonObject = { [key: string]: JsonValue };

// With the `u` flag, a surrogate pair is one code point, so this only matches lone surrogates.
const LONE_SURROGATE = /[\uD800-\uDFFF]/u;

function serializeString(s: string): string {
  if (LONE_SURROGATE.test(s)) {
    throw new IdemError("BAD_JSON", "string contains a lone surrogate (not I-JSON, RFC 8785 §3.2.2.2)");
  }
  // ECMAScript JSON.stringify string escaping is exactly the one RFC 8785 §3.2.2.2 mandates.
  return JSON.stringify(s);
}

function serializeNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new IdemError("BAD_JSON", `number ${n} is not representable in JSON`);
  }
  // RFC 8785 §3.2.2.3: ECMAScript Number serialization. String(-0) is already "0".
  return String(n);
}

function isPlainObject(v: object): boolean {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function serialize(v: unknown, path: Set<object>): string {
  switch (typeof v) {
    case "string":
      return serializeString(v);
    case "number":
      return serializeNumber(v);
    case "boolean":
      return v ? "true" : "false";
    case "object": {
      if (v === null) return "null";
      if (path.has(v)) throw new IdemError("BAD_JSON", "cyclic structure");
      path.add(v);
      let out: string;
      if (Array.isArray(v)) {
        const parts: string[] = [];
        for (const item of v) {
          if (item === undefined) throw new IdemError("BAD_JSON", "undefined inside an array");
          parts.push(serialize(item, path));
        }
        out = `[${parts.join(",")}]`;
      } else {
        if (!isPlainObject(v)) {
          throw new IdemError("BAD_JSON", "only plain objects, arrays and primitives are JSON");
        }
        // RFC 8785 §3.2.3: sort property names by UTF-16 code units. Array#sort's default
        // comparison is exactly that.
        const keys = Object.keys(v)
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .sort();
        const parts: string[] = [];
        for (const k of keys) {
          parts.push(`${serializeString(k)}:${serialize((v as Record<string, unknown>)[k], path)}`);
        }
        out = `{${parts.join(",")}}`;
      }
      path.delete(v);
      return out;
    }
    default:
      throw new IdemError("BAD_JSON", `${typeof v} is not a JSON value`);
  }
}

/**
 * JSON Canonicalization Scheme (RFC 8785).
 *
 * Properties whose value is `undefined` are omitted (as `JSON.stringify` does); every other
 * non-JSON value (functions, symbols, bigints, `NaN`, `Infinity`, lone surrogates, class
 * instances, cycles) throws `BAD_JSON`.
 */
export function jcs(value: unknown): string {
  return serialize(value, new Set());
}

/**
 * Deep-copy `value` into a plain {@link JsonValue}, throwing `BAD_JSON` if it is not JSON.
 * `undefined` properties are dropped and `-0` becomes `0`.
 */
export function toJson(value: unknown): JsonValue {
  return JSON.parse(jcs(value)) as JsonValue;
}
