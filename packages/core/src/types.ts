import type { JsonObject, JsonValue } from "./jcs";
import type { Normalizer } from "./normalize";
import type { JsonSchema } from "./schema";

/** Who may receive a cached result (protocol §8). */
export type Scope = "public" | "private";

/**
 * A minimal structural view of an MCP `CallToolResult`. `@idem/core` does not depend on the MCP
 * SDK; any object with this shape works.
 */
export interface CallToolResult {
  content: JsonValue[];
  structuredContent?: JsonObject;
  isError?: boolean;
  /** MCP 2026-07-28 multi-round-trip marker. `"input_required"` results never use IDEM [P-5.4]. */
  resultType?: string;
  _meta?: JsonObject;
  [key: string]: JsonValue | undefined;
}

/**
 * Identity of a tool for naming purposes (protocol §2.1). The tool `description` is deliberately
 * absent [P-2.2].
 */
export interface ToolIdentity {
  name: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  policyVersion: number;
}

/** Per-tool cache policy published in the signed manifest (protocol §6). */
export interface ToolPolicy {
  tool: string;
  schemaDigest: string;
  cacheable: boolean;
  ttlMs: number;
  scope: Scope;
  /** JSON Pointer → normalizers applied in order. */
  normalizers: Record<string, Normalizer[]>;
  policyVersion: number;
}

/** Request for a name (protocol §4). */
export interface Interest {
  name: string;
  /** Canonical arguments (already validated, defaulted and normalized). */
  args: JsonValue;
  mustBeFresh: boolean;
  lifetimeMs: number;
  /** 64 random bits, base64url. */
  nonce: string;
  hopLimit: number;
  /**
   * Never set by a sender, and ignored on receipt by every forwarder: the edge derives its own value
   * from the credential and its secret [P-8.4]. Kept so the wire format of §4 is unchanged.
   */
  authContext?: string;
}

/** Signed metadata of a Data object (protocol §5). */
export interface DataMeta {
  contentDigest: string;
  producedAt: number;
  freshnessMs: number;
  scope: Scope;
  policyVersion: number;
}

/** Signature block shared by Data and manifests. */
export interface DataSignature {
  alg: "Ed25519";
  /** `/idem/v1/<producer>/_key/<keyId>` */
  keyLocator: string;
  value: string;
}

/** Named response signed by the producer (protocol §5). */
export interface Data {
  name: string;
  content: CallToolResult;
  meta: DataMeta;
  signature: DataSignature;
  /** Not signed. Accumulated cache residence time, like the HTTP `Age` header [P-8.1]. */
  ageMs?: number;
}

/** A producer key as listed in the manifest. */
export interface ManifestKey {
  keyId: string;
  publicKeyJwk: JsonWebKey;
  notAfter?: number;
}

/** Producer's signed document: keys and per-tool cache policy (protocol §6). */
export interface Manifest {
  producer: string;
  version: number;
  keys: ManifestKey[];
  tools: ToolPolicy[];
  signature: { alg: "Ed25519"; keyId: string; value: string };
}

/** A manifest before signing. */
export type UnsignedManifest = Omit<Manifest, "signature">;

/** Outcome of verifying a Data object or a manifest. */
export type VerifyResult =
  | { ok: true; producer: string; keyId: string }
  | { ok: false; code: "BAD_SIGNATURE" | "UNTRUSTED_KEY" | "BAD_MANIFEST"; reason: string };
