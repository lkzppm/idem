/**
 * `@idem/core`: the IDEM v1 protocol. Names, canonicalization, JCS, signed Data and manifests,
 * the forwarder engine (PIT, CS, FIB) and its events. Web APIs only: runs unchanged in browsers,
 * Node 24, Vercel Functions and the simulator.
 *
 * @packageDocumentation
 */

export { type CanonicalArgs, canonicalizeArgs } from "./canonical";
export { type Clock, RealClock, VirtualClock } from "./clock";
export { type BuildInterestInput, buildInterest, cacheablePolicy, INTEREST_DEFAULTS } from "./consumer";
export {
  assertManifestShape,
  contentDigest,
  dataSignedBytes,
  deriveAuthContext,
  exportPrivateKeyJwk,
  generateKeyPair,
  type IdemKeyPair,
  importKeyPair,
  importPublicKey,
  keyIdFromJwk,
  keyPairFromSeed,
  manifestSignedBytes,
  signData,
  signManifest,
  stripEphemeral,
  type UnsignedData,
  verifyData,
  verifyManifest,
  verifyManifestSignature,
} from "./crypto";
export {
  type ContentStore,
  type CsEntry,
  type CsStats,
  dataBytes,
  entryAge,
  isFresh,
  MemoryContentStore,
  type ReplacementPolicy,
} from "./cs";
export {
  b64uDecode,
  b64uEncode,
  isB64u,
  randomNonce,
  sha256,
  sha256b64u,
  utf8,
  utf8Length,
} from "./encoding";
export {
  IdemError,
  type IdemErrorCode,
  type IdemLocalErrorCode,
  type IdemWireErrorCode,
  isIdemError,
} from "./errors";
export { type Face, linkFaces, type Packet } from "./face";
export { Fib } from "./fib";
export {
  type FaceOptions,
  Forwarder,
  type ForwarderEvent,
  type ForwarderEventKind,
  type ForwarderOptions,
  type PitLimits,
} from "./forwarder";
export { type JsonObject, type JsonValue, jcs, toJson } from "./jcs";
export {
  ARGS_DIGEST_LENGTH,
  argsDigestOf,
  assertProducer,
  encodeComponent,
  formatName,
  type IdemName,
  keyLocator,
  makeName,
  NAME_PREFIX,
  type ParsedName,
  parseKeyLocator,
  parseName,
  producerPrefix,
  SCHEMA_DIGEST_LENGTH,
  toolSchemaDigest,
} from "./name";
export {
  applyNormalizer,
  applyNormalizers,
  isNormalizer,
  NORMALIZERS,
  type Normalizer,
  parsePointer,
} from "./normalize";
export {
  attachData,
  dataFromToolResult,
  META_KEYS,
  Producer,
  type ProducerContext,
  type ProducerOptions,
  type ProducerTool,
  type ProducerToolPolicy,
  type ToolInfo,
  wireCode,
} from "./producer";
export {
  applyDefaults,
  assertSupportedSchema,
  type JsonSchema,
  SUPPORTED_SCHEMA_KEYWORDS,
  validate,
} from "./schema";
export { TrustStore } from "./trust";
export type {
  CallToolResult,
  Data,
  DataMeta,
  DataSignature,
  Interest,
  Manifest,
  ManifestKey,
  Scope,
  ToolIdentity,
  ToolPolicy,
  UnsignedManifest,
  VerifyResult,
} from "./types";
