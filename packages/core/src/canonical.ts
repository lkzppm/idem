import { IdemError } from "./errors";
import { type JsonValue, jcs, toJson } from "./jcs";
import { applyNormalizers } from "./normalize";
import { applyDefaults, assertSupportedSchema, validate } from "./schema";
import type { ToolIdentity, ToolPolicy } from "./types";

/** Arguments after the canonicalization pipeline, with their JCS serialization. */
export interface CanonicalArgs {
  /** The canonical arguments as a JSON value. */
  readonly value: JsonValue;
  /** `JCS(value)`: the exact bytes the args digest is computed over. */
  readonly jcs: string;
}

/**
 * Canonicalize tool arguments (protocol §3). The same pipeline runs at consumer, forwarder and
 * producer:
 *
 * 1. validate against `inputSchema` (failure → `INVALID_ARGS`; the caller falls back to plain MCP [P-3.1]);
 * 2. apply schema defaults [P-3.2];
 * 3. apply **only** the normalizers declared in the manifest policy [P-3.3];
 * 4. serialize with JCS [P-3.4].
 *
 * Throws `UNSUPPORTED_SCHEMA` if the schema uses keywords outside the v1 subset [P-3.6], and
 * `BAD_POLICY` if a normalizer does not fit its field.
 */
export async function canonicalizeArgs(
  args: unknown,
  tool: Pick<ToolIdentity, "inputSchema">,
  policy: Pick<ToolPolicy, "normalizers">,
): Promise<CanonicalArgs> {
  assertSupportedSchema(tool.inputSchema);
  let value: JsonValue;
  try {
    value = toJson(args ?? {});
  } catch (e) {
    throw new IdemError("INVALID_ARGS", "arguments are not JSON", { cause: e });
  }
  const errors = validate(tool.inputSchema, value);
  if (errors.length > 0) throw new IdemError("INVALID_ARGS", errors.join("; "));
  value = applyDefaults(tool.inputSchema, value);
  const afterDefaults = validate(tool.inputSchema, value);
  if (afterDefaults.length > 0) {
    throw new IdemError("INVALID_ARGS", `schema defaults are invalid: ${afterDefaults.join("; ")}`);
  }
  value = applyNormalizers(value, policy.normalizers ?? {});
  // Re-validate so canonical args are always valid; this makes canon(canon(a)) == canon(a) [P-3.5].
  const afterNormalize = validate(tool.inputSchema, value);
  if (afterNormalize.length > 0) {
    throw new IdemError("INVALID_ARGS", `normalized arguments are invalid: ${afterNormalize.join("; ")}`);
  }
  return { value, jcs: jcs(value) };
}
