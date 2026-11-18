import { isB64u, sha256b64u } from "./encoding";
import { IdemError } from "./errors";
import { jcs } from "./jcs";
import type { ToolIdentity } from "./types";

/** Every IDEM v1 name starts with this prefix. A wire-format change requires `/idem/v2` (§12). */
export const NAME_PREFIX = "/idem/v1/";

/** Length of the truncated schema digest component (protocol §2.1). */
export const SCHEMA_DIGEST_LENGTH = 22;
/** Length of the args digest component: a full SHA-256 in base64url. */
export const ARGS_DIGEST_LENGTH = 43;

/** An IDEM name: `/idem/v1/<producer>/<tool>/<schema-digest>/<args-digest>`. */
export type IdemName = string;

/** Components of a tool-call name. */
export interface ParsedName {
  producer: string;
  /** Decoded MCP tool name. */
  tool: string;
  schemaDigest: string;
  argsDigest: string;
}

const PRODUCER_RE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?$/;

/** Throws `BAD_NAME` unless `producer` is a lowercase host name, optionally with a port. */
export function assertProducer(producer: string): void {
  if (!PRODUCER_RE.test(producer)) {
    throw new IdemError("BAD_NAME", `invalid producer "${producer}" (lowercase host[:port] expected)`);
  }
}

/** Percent-encode a tool name so the result contains only RFC 3986 unreserved characters or `%XX`. */
export function encodeComponent(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * `b64u(SHA-256(JCS(tool-identity)))[0:22]` (protocol §2.1). Only `name`, `inputSchema`,
 * `outputSchema` and `policyVersion` are hashed, never the description [P-2.2].
 */
export async function toolSchemaDigest(tool: ToolIdentity): Promise<string> {
  const identity = {
    name: tool.name,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    policyVersion: tool.policyVersion,
  };
  return (await sha256b64u(jcs(identity))).slice(0, SCHEMA_DIGEST_LENGTH);
}

/** `b64u(SHA-256(JCS(canonical-args)))`: 43 characters. Pass the canonical JCS string. */
export async function argsDigestOf(canonicalJcs: string): Promise<string> {
  return sha256b64u(canonicalJcs);
}

/** Assemble a name from already-computed components. Validates every component. */
export function formatName(p: ParsedName): IdemName {
  assertProducer(p.producer);
  if (p.tool.length === 0 || p.tool.startsWith("_")) {
    throw new IdemError("BAD_NAME", `tool name "${p.tool}" is empty or reserved [P-2.4]`);
  }
  if (!isB64u(p.schemaDigest, SCHEMA_DIGEST_LENGTH)) throw new IdemError("BAD_NAME", "bad schema digest");
  if (!isB64u(p.argsDigest, ARGS_DIGEST_LENGTH)) throw new IdemError("BAD_NAME", "bad args digest");
  return `${NAME_PREFIX}${p.producer}/${encodeComponent(p.tool)}/${p.schemaDigest}/${p.argsDigest}`;
}

/**
 * Compute the name of a call. The name depends only on the producer, the tool identity and the
 * canonical arguments [P-2.1], and contains the arguments only as a digest [P-2.3].
 */
export async function makeName(input: {
  producer: string;
  tool: ToolIdentity;
  args: { jcs: string };
}): Promise<IdemName> {
  const [schemaDigest, argsDigest] = await Promise.all([
    toolSchemaDigest(input.tool),
    argsDigestOf(input.args.jcs),
  ]);
  return formatName({ producer: input.producer, tool: input.tool.name, schemaDigest, argsDigest });
}

/** Parse a tool-call name. Throws `BAD_NAME` for malformed and reserved (`_…`) names. */
export function parseName(name: string): ParsedName {
  if (typeof name !== "string" || !name.startsWith(NAME_PREFIX)) {
    throw new IdemError("BAD_NAME", `name must start with ${NAME_PREFIX}`);
  }
  const parts = name.slice(NAME_PREFIX.length).split("/");
  if (parts.length !== 4) throw new IdemError("BAD_NAME", "expected 4 components after /idem/v1/");
  const [producer, toolEnc, schemaDigest, argsDigest] = parts as [string, string, string, string];
  let tool: string;
  try {
    tool = decodeURIComponent(toolEnc);
  } catch (e) {
    throw new IdemError("BAD_NAME", "tool component is not valid percent-encoding", { cause: e });
  }
  const parsed = { producer, tool, schemaDigest, argsDigest };
  // Round-trip guarantees a single spelling per name.
  if (formatName(parsed) !== name) throw new IdemError("BAD_NAME", "name is not in canonical form");
  return parsed;
}

/** `/idem/v1/<producer>/_key/<keyId>` (protocol §5, reserved namespace [P-2.4]). */
export function keyLocator(producer: string, keyId: string): string {
  assertProducer(producer);
  return `${NAME_PREFIX}${producer}/_key/${keyId}`;
}

/** Parse a key locator. Throws `BAD_NAME` if malformed. */
export function parseKeyLocator(locator: string): { producer: string; keyId: string } {
  const m = /^\/idem\/v1\/([^/]+)\/_key\/([A-Za-z0-9_-]+)$/.exec(locator);
  if (!m) throw new IdemError("BAD_NAME", `invalid key locator "${locator}"`);
  const producer = m[1] as string;
  assertProducer(producer);
  return { producer, keyId: m[2] as string };
}

/** Name prefix that routes to a producer: `/idem/v1/<producer>`. */
export function producerPrefix(producer: string): string {
  assertProducer(producer);
  return `${NAME_PREFIX}${producer}`;
}
