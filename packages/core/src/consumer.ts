import { type CanonicalArgs, canonicalizeArgs } from "./canonical";
import { randomNonce } from "./encoding";
import { IdemError } from "./errors";
import { makeName, toolSchemaDigest } from "./name";
import type { ToolInfo } from "./producer";
import type { Interest, Manifest, ToolIdentity, ToolPolicy } from "./types";

/** Interest defaults (protocol §4). */
export const INTEREST_DEFAULTS = {
  mustBeFresh: true,
  lifetimeMs: 10_000,
  hopLimit: 8,
} as const;

/**
 * Decide whether a call to `tool` may use IDEM [P-6.1]: the signed manifest marks it cacheable,
 * the tool declares `readOnlyHint: true` (defense in depth, never sufficient alone), and the
 * manifest's schema digest matches the one derived from `tools/list`. Returns the policy and the
 * naming identity, or `undefined` (→ plain MCP).
 */
export async function cacheablePolicy(
  manifest: Manifest | undefined,
  tool: ToolInfo,
): Promise<{ policy: ToolPolicy; identity: ToolIdentity } | undefined> {
  const policy = manifest?.tools.find((t) => t.tool === tool.name);
  if (!policy?.cacheable) return undefined;
  if (tool.annotations?.readOnlyHint !== true) return undefined;
  const identity: ToolIdentity = {
    name: tool.name,
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema !== undefined && { outputSchema: tool.outputSchema }),
    policyVersion: policy.policyVersion,
  };
  let digest: string;
  try {
    digest = await toolSchemaDigest(identity);
  } catch {
    return undefined;
  }
  return digest === policy.schemaDigest ? { policy, identity } : undefined;
}

/** Input to {@link buildInterest}. */
export interface BuildInterestInput {
  producer: string;
  identity: ToolIdentity;
  policy: ToolPolicy;
  args: unknown;
  nonce?: string;
  mustBeFresh?: boolean;
  lifetimeMs?: number;
  hopLimit?: number;
}

/**
 * Build an Interest locally from the manifest policy and the arguments [P-4.1]. Throws
 * `NOT_CACHEABLE` for non-cacheable policies [P-4.2] and `INVALID_ARGS` / `UNSUPPORTED_SCHEMA`
 * when the call must fall back to plain MCP [P-3.1].
 */
export async function buildInterest(
  input: BuildInterestInput,
): Promise<{ interest: Interest; args: CanonicalArgs }> {
  if (!input.policy.cacheable)
    throw new IdemError("NOT_CACHEABLE", `tool "${input.identity.name}" is not cacheable`);
  const args = await canonicalizeArgs(input.args, input.identity, input.policy);
  const name = await makeName({ producer: input.producer, tool: input.identity, args });
  return {
    args,
    interest: {
      name,
      args: args.value,
      mustBeFresh: input.mustBeFresh ?? INTEREST_DEFAULTS.mustBeFresh,
      lifetimeMs: input.lifetimeMs ?? INTEREST_DEFAULTS.lifetimeMs,
      nonce: input.nonce ?? randomNonce(),
      hopLimit: input.hopLimit ?? INTEREST_DEFAULTS.hopLimit,
    },
  };
}
