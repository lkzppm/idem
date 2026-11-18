import { IdemError } from "./errors";
import { type JsonValue, jcs } from "./jcs";

/**
 * A JSON Schema (2020-12) restricted to the subset IDEM v1 understands (protocol §3, Appendix A).
 * Boolean schemas are allowed.
 */
export type JsonSchema = boolean | { [keyword: string]: unknown };

/** Keywords that only annotate and never affect validation. */
const ANNOTATIONS = new Set([
  "$schema",
  "$id",
  "$comment",
  "title",
  "description",
  "default",
  "examples",
  "deprecated",
  "readOnly",
  "writeOnly",
  "format",
]);

/** Validation keywords IDEM v1 implements. Anything else makes the tool non-cacheable. */
const VALIDATION = new Set([
  "type",
  "enum",
  "const",
  "properties",
  "required",
  "additionalProperties",
  "minProperties",
  "maxProperties",
  "items",
  "prefixItems",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "anyOf",
  "allOf",
  "oneOf",
  "not",
]);

/** The keywords of the IDEM v1 JSON Schema subset (protocol Appendix A). */
export const SUPPORTED_SCHEMA_KEYWORDS: readonly string[] = [...ANNOTATIONS, ...VALIDATION].sort();

type SchemaObject = { [keyword: string]: unknown };

function asSchema(s: unknown, where: string): JsonSchema {
  if (typeof s === "boolean") return s;
  if (s !== null && typeof s === "object" && !Array.isArray(s)) return s as SchemaObject;
  throw new IdemError("UNSUPPORTED_SCHEMA", `${where}: not a schema`);
}

/**
 * Throw `UNSUPPORTED_SCHEMA` if `schema` uses any keyword outside the IDEM v1 subset
 * ([P-3.6]). Producers MUST NOT mark such tools cacheable.
 */
export function assertSupportedSchema(schema: unknown, where = "#"): void {
  const s = asSchema(schema, where);
  if (typeof s === "boolean") return;
  for (const [k, v] of Object.entries(s)) {
    if (ANNOTATIONS.has(k)) continue;
    if (!VALIDATION.has(k)) {
      throw new IdemError("UNSUPPORTED_SCHEMA", `${where}: keyword "${k}" is outside the IDEM v1 subset`);
    }
    switch (k) {
      case "properties":
        for (const [p, sub] of Object.entries(v as object))
          assertSupportedSchema(sub, `${where}/properties/${p}`);
        break;
      case "additionalProperties":
      case "items":
      case "not":
        assertSupportedSchema(v, `${where}/${k}`);
        break;
      case "prefixItems":
      case "anyOf":
      case "allOf":
      case "oneOf":
        if (!Array.isArray(v)) throw new IdemError("UNSUPPORTED_SCHEMA", `${where}/${k}: must be an array`);
        v.forEach((sub, i) => {
          assertSupportedSchema(sub, `${where}/${k}/${i}`);
        });
        break;
      case "pattern":
        try {
          new RegExp(v as string, "u");
        } catch (e) {
          throw new IdemError("UNSUPPORTED_SCHEMA", `${where}/pattern: invalid regular expression`, {
            cause: e,
          });
        }
        break;
      default:
        break;
    }
  }
}

function typeOf(v: JsonValue): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function matchesType(v: JsonValue, t: string): boolean {
  const actual = typeOf(v);
  return actual === t || (t === "number" && actual === "integer");
}

const patternCache = new Map<string, RegExp>();
function regex(p: string): RegExp {
  let r = patternCache.get(p);
  if (!r) {
    r = new RegExp(p, "u");
    patternCache.set(p, r);
  }
  return r;
}

function isObject(v: JsonValue): v is { [k: string]: JsonValue } {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function check(schema: JsonSchema, v: JsonValue, path: string, errors: string[]): void {
  if (schema === true) return;
  if (schema === false) {
    errors.push(`${path}: not allowed`);
    return;
  }
  const s = schema;
  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
    if (!types.some((t) => matchesType(v, t))) {
      errors.push(`${path}: expected ${types.join(" | ")}, got ${typeOf(v)}`);
      return;
    }
  }
  if (s.const !== undefined && jcs(s.const) !== jcs(v)) errors.push(`${path}: must equal const`);
  if (Array.isArray(s.enum) && !s.enum.some((e) => jcs(e) === jcs(v))) errors.push(`${path}: not in enum`);

  if (typeof v === "string") {
    const len = [...v].length; // code points, per JSON Schema
    if (typeof s.minLength === "number" && len < s.minLength)
      errors.push(`${path}: shorter than ${s.minLength}`);
    if (typeof s.maxLength === "number" && len > s.maxLength)
      errors.push(`${path}: longer than ${s.maxLength}`);
    if (typeof s.pattern === "string" && !regex(s.pattern).test(v))
      errors.push(`${path}: does not match pattern`);
  }
  if (typeof v === "number") {
    if (typeof s.minimum === "number" && v < s.minimum) errors.push(`${path}: < minimum`);
    if (typeof s.maximum === "number" && v > s.maximum) errors.push(`${path}: > maximum`);
    if (typeof s.exclusiveMinimum === "number" && v <= s.exclusiveMinimum)
      errors.push(`${path}: <= exclusiveMinimum`);
    if (typeof s.exclusiveMaximum === "number" && v >= s.exclusiveMaximum)
      errors.push(`${path}: >= exclusiveMaximum`);
    if (typeof s.multipleOf === "number" && s.multipleOf > 0) {
      const q = v / s.multipleOf;
      if (Math.abs(q - Math.round(q)) > 1e-9) errors.push(`${path}: not a multiple of ${s.multipleOf}`);
    }
  }
  if (Array.isArray(v)) {
    if (typeof s.minItems === "number" && v.length < s.minItems)
      errors.push(`${path}: fewer than ${s.minItems} items`);
    if (typeof s.maxItems === "number" && v.length > s.maxItems)
      errors.push(`${path}: more than ${s.maxItems} items`);
    if (s.uniqueItems === true && new Set(v.map((x) => jcs(x))).size !== v.length) {
      errors.push(`${path}: items are not unique`);
    }
    const prefix = Array.isArray(s.prefixItems) ? (s.prefixItems as JsonSchema[]) : [];
    v.forEach((item, i) => {
      const sub = i < prefix.length ? prefix[i] : (s.items as JsonSchema | undefined);
      if (sub !== undefined) check(sub, item, `${path}/${i}`, errors);
    });
  }
  if (isObject(v)) {
    const keys = Object.keys(v);
    if (typeof s.minProperties === "number" && keys.length < s.minProperties)
      errors.push(`${path}: too few properties`);
    if (typeof s.maxProperties === "number" && keys.length > s.maxProperties)
      errors.push(`${path}: too many properties`);
    if (Array.isArray(s.required)) {
      for (const r of s.required as string[]) if (!(r in v)) errors.push(`${path}: missing required "${r}"`);
    }
    const props = (s.properties ?? {}) as Record<string, JsonSchema>;
    for (const k of keys) {
      const value = v[k] as JsonValue;
      if (Object.hasOwn(props, k)) check(props[k] as JsonSchema, value, `${path}/${k}`, errors);
      else if (s.additionalProperties !== undefined) {
        check(s.additionalProperties as JsonSchema, value, `${path}/${k}`, errors);
      }
    }
  }
  if (Array.isArray(s.allOf)) for (const sub of s.allOf as JsonSchema[]) check(sub, v, path, errors);
  if (Array.isArray(s.anyOf)) {
    if (!(s.anyOf as JsonSchema[]).some((sub) => validate(sub, v).length === 0))
      errors.push(`${path}: anyOf failed`);
  }
  if (Array.isArray(s.oneOf)) {
    const n = (s.oneOf as JsonSchema[]).filter((sub) => validate(sub, v).length === 0).length;
    if (n !== 1) errors.push(`${path}: oneOf matched ${n} schemas`);
  }
  if (s.not !== undefined && validate(s.not as JsonSchema, v).length === 0)
    errors.push(`${path}: matches "not"`);
}

/**
 * Validate `value` against `schema` (IDEM v1 subset). Returns the list of errors; empty means
 * valid. `format` is an annotation and is not asserted.
 */
export function validate(schema: JsonSchema, value: JsonValue): string[] {
  const errors: string[] = [];
  check(schema, value, "#", errors);
  return errors;
}

/**
 * Return a copy of `value` with schema `default`s applied to absent object properties
 * ([P-3.2]). Defaults are taken from `properties`, `items` and `prefixItems` only; combinators
 * (`anyOf`, `oneOf`, ...) are ambiguous and are not descended into.
 */
export function applyDefaults(schema: JsonSchema, value: JsonValue): JsonValue {
  if (typeof schema === "boolean") return value;
  if (isObject(value) && schema.properties && typeof schema.properties === "object") {
    const out: { [k: string]: JsonValue } = { ...value };
    for (const [k, sub] of Object.entries(schema.properties as Record<string, JsonSchema>)) {
      if (Object.hasOwn(out, k)) out[k] = applyDefaults(sub, out[k] as JsonValue);
      else if (typeof sub === "object" && sub.default !== undefined) {
        out[k] = JSON.parse(jcs(sub.default)) as JsonValue;
      }
    }
    return out;
  }
  if (Array.isArray(value)) {
    const prefix = Array.isArray(schema.prefixItems) ? (schema.prefixItems as JsonSchema[]) : [];
    return value.map((item, i) => {
      const sub = i < prefix.length ? prefix[i] : (schema.items as JsonSchema | undefined);
      return sub === undefined ? item : applyDefaults(sub, item);
    });
  }
  return value;
}
