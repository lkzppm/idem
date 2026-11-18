import { b64uDecode, b64uEncode, getSubtle, isB64u, sha256b64u, utf8 } from "./encoding";
import { IdemError } from "./errors";
import { jcs } from "./jcs";
import { keyLocator, parseKeyLocator, parseName } from "./name";
import { isNormalizer } from "./normalize";
import type { TrustStore } from "./trust";
import type {
  CallToolResult,
  Data,
  DataMeta,
  Manifest,
  Scope,
  UnsignedManifest,
  VerifyResult,
} from "./types";

const ED25519 = { name: "Ed25519" } as const;

/** An Ed25519 key pair with its IDEM key id. */
export interface IdemKeyPair {
  /** Truncated RFC 7638 thumbprint of the public key (16 base64url characters). */
  keyId: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
}

function cryptoError(e: unknown): IdemError {
  return new IdemError(
    "CRYPTO_UNSUPPORTED",
    "this runtime does not support Ed25519 in WebCrypto (see ADR-005 for the documented fallback)",
    { cause: e },
  );
}

/** Truncated RFC 7638 JWK thumbprint: `b64u(SHA-256(JCS({crv, kty, x})))[0:16]`. */
export async function keyIdFromJwk(jwk: JsonWebKey): Promise<string> {
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !isB64u(jwk.x, 43)) {
    throw new IdemError("BAD_MANIFEST", "not an Ed25519 public JWK");
  }
  return (await sha256b64u(jcs({ crv: jwk.crv, kty: jwk.kty, x: jwk.x }))).slice(0, 16);
}

function publicJwk(jwk: JsonWebKey): JsonWebKey {
  return { kty: "OKP", crv: "Ed25519", x: jwk.x as string };
}

async function pairFromPrivate(privateKey: CryptoKey): Promise<IdemKeyPair> {
  const jwk = await getSubtle().exportKey("jwk", privateKey);
  if (!jwk.x) throw new IdemError("CRYPTO_UNSUPPORTED", "runtime did not export the Ed25519 public key");
  const publicKeyJwk = publicJwk(jwk);
  const publicKey = await importPublicKey(publicKeyJwk);
  return { keyId: await keyIdFromJwk(publicKeyJwk), privateKey, publicKey, publicKeyJwk };
}

/** Generate a fresh Ed25519 key pair (WebCrypto). */
export async function generateKeyPair(): Promise<IdemKeyPair> {
  let pair: CryptoKeyPair;
  try {
    pair = (await getSubtle().generateKey(ED25519, true, ["sign", "verify"])) as CryptoKeyPair;
  } catch (e) {
    throw cryptoError(e);
  }
  return pairFromPrivate(pair.privateKey);
}

// DER prefix of a PKCS#8 Ed25519 private key; the 32-byte seed follows (RFC 8410 §7).
const PKCS8_ED25519_PREFIX = [
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
];

/**
 * Derive a key pair from a 32-byte seed. Deterministic: **for tests and the simulator only**,
 * never for production keys.
 */
export async function keyPairFromSeed(seed: Uint8Array): Promise<IdemKeyPair> {
  if (seed.length !== 32) throw new IdemError("BAD_ENCODING", "Ed25519 seed must be 32 bytes");
  const der = new Uint8Array(48);
  der.set(PKCS8_ED25519_PREFIX, 0);
  der.set(seed, 16);
  let privateKey: CryptoKey;
  try {
    privateKey = await getSubtle().importKey("pkcs8", der, ED25519, true, ["sign"]);
  } catch (e) {
    throw cryptoError(e);
  }
  return pairFromPrivate(privateKey);
}

/** Export the private key as a JWK (e.g. to store in `IDEM_PRODUCER_KEY`). */
export async function exportPrivateKeyJwk(key: IdemKeyPair): Promise<JsonWebKey> {
  const jwk = await getSubtle().exportKey("jwk", key.privateKey);
  return { kty: "OKP", crv: "Ed25519", x: jwk.x as string, d: jwk.d as string };
}

/** Import a key pair from a private JWK produced by {@link exportPrivateKeyJwk}. */
export async function importKeyPair(jwk: JsonWebKey): Promise<IdemKeyPair> {
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.d) {
    throw new IdemError("BAD_ENCODING", "expected an Ed25519 private JWK");
  }
  let privateKey: CryptoKey;
  try {
    privateKey = await getSubtle().importKey(
      "jwk",
      { kty: "OKP", crv: "Ed25519", x: jwk.x, d: jwk.d },
      ED25519,
      true,
      ["sign"],
    );
  } catch (e) {
    throw cryptoError(e);
  }
  return pairFromPrivate(privateKey);
}

/** Import an Ed25519 public JWK for verification. */
export async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  try {
    return await getSubtle().importKey("jwk", publicJwk(jwk), ED25519, true, ["verify"]);
  } catch (e) {
    throw cryptoError(e);
  }
}

async function sign(key: CryptoKey, message: string): Promise<string> {
  return b64uEncode(new Uint8Array(await getSubtle().sign(ED25519, key, utf8(message))));
}

async function verify(key: CryptoKey, signature: string, message: string): Promise<boolean> {
  if (!isB64u(signature, 86)) return false;
  return getSubtle().verify(ED25519, key, b64uDecode(signature), utf8(message));
}

/**
 * Remove ephemeral fields from a tool result before naming and signing it: the top-level
 * `_meta` (traces, IDEM's own `dev.idem/*` keys). Content blocks are kept as-is.
 */
export function stripEphemeral(result: CallToolResult): CallToolResult {
  const { _meta: _ignored, ...rest } = result;
  return rest as CallToolResult;
}

/** `b64u(SHA-256(JCS(content)))` over the content without ephemeral fields. */
export async function contentDigest(content: CallToolResult): Promise<string> {
  return sha256b64u(jcs(stripEphemeral(content)));
}

/** The exact string a Data signature covers [P-5.2]. */
export function dataSignedBytes(name: string, meta: DataMeta): string {
  return jcs({
    name,
    contentDigest: meta.contentDigest,
    producedAt: meta.producedAt,
    freshnessMs: meta.freshnessMs,
    scope: meta.scope,
    policyVersion: meta.policyVersion,
  });
}

/** Input to {@link signData}. */
export interface UnsignedData {
  name: string;
  content: CallToolResult;
  producedAt: number;
  freshnessMs: number;
  scope: Scope;
  policyVersion: number;
}

/**
 * Sign a result as Data (protocol §5). Throws `BAD_POLICY` if an error result carries a
 * non-zero freshness [P-5.3].
 */
export async function signData(input: UnsignedData, key: IdemKeyPair): Promise<Data> {
  const { producer } = parseName(input.name);
  if (!Number.isInteger(input.freshnessMs) || input.freshnessMs < 0) {
    throw new IdemError("BAD_POLICY", "freshnessMs must be a non-negative integer");
  }
  if (input.content.isError === true && input.freshnessMs !== 0) {
    throw new IdemError("BAD_POLICY", "isError results must have freshnessMs = 0 [P-5.3]");
  }
  const content = stripEphemeral(input.content);
  const meta: DataMeta = {
    contentDigest: await contentDigest(content),
    producedAt: input.producedAt,
    freshnessMs: input.freshnessMs,
    scope: input.scope,
    policyVersion: input.policyVersion,
  };
  const value = await sign(key.privateKey, dataSignedBytes(input.name, meta));
  return {
    name: input.name,
    content,
    meta,
    signature: { alg: "Ed25519", keyLocator: keyLocator(producer, key.keyId), value },
  };
}

function fail(code: "BAD_SIGNATURE" | "UNTRUSTED_KEY" | "BAD_MANIFEST", reason: string): VerifyResult {
  return { ok: false, code, reason };
}

/**
 * Verify a Data object end to end [P-5.5]: the key locator belongs to the producer in the name,
 * the key is trusted and not expired, the content digest matches, and the Ed25519 signature
 * covers `JCS({ name, ...meta })`.
 */
export async function verifyData(
  data: Data,
  trust: TrustStore,
  opts: { now?: number } = {},
): Promise<VerifyResult> {
  try {
    if (data?.signature?.alg !== "Ed25519") return fail("BAD_SIGNATURE", "unsupported signature algorithm");
    const { producer } = parseName(data.name);
    const loc = parseKeyLocator(data.signature.keyLocator);
    if (loc.producer !== producer) return fail("UNTRUSTED_KEY", "key locator belongs to another producer");
    const now = opts.now ?? Date.now();
    const key = await trust.key(producer, loc.keyId, now);
    if (!key) return fail("UNTRUSTED_KEY", `key ${loc.keyId} is not trusted for ${producer}`);
    if ((await contentDigest(data.content)) !== data.meta.contentDigest) {
      return fail("BAD_SIGNATURE", "content digest mismatch");
    }
    const ok = await verify(key, data.signature.value, dataSignedBytes(data.name, data.meta));
    return ok ? { ok: true, producer, keyId: loc.keyId } : fail("BAD_SIGNATURE", "invalid signature");
  } catch (e) {
    return fail("BAD_SIGNATURE", e instanceof Error ? e.message : "malformed Data");
  }
}

/** Throw `BAD_MANIFEST` unless `m` has the shape of protocol §6. */
export function assertManifestShape(m: UnsignedManifest): void {
  const bad = (why: string): never => {
    throw new IdemError("BAD_MANIFEST", why);
  };
  if (typeof m !== "object" || m === null) bad("not an object");
  if (typeof m.producer !== "string") bad("producer");
  if (!Number.isInteger(m.version) || m.version < 0) bad("version");
  if (!Array.isArray(m.keys) || m.keys.length === 0) bad("keys");
  if (!Array.isArray(m.tools)) bad("tools");
  for (const t of m.tools) {
    if (typeof t.tool !== "string" || !isB64u(t.schemaDigest, 22)) bad(`tool ${String(t.tool)}`);
    if (typeof t.cacheable !== "boolean") bad(`${t.tool}.cacheable`);
    if (!Number.isInteger(t.ttlMs) || t.ttlMs < 0) bad(`${t.tool}.ttlMs`);
    if (t.scope !== "public" && t.scope !== "private") bad(`${t.tool}.scope`);
    if (!Number.isInteger(t.policyVersion)) bad(`${t.tool}.policyVersion`);
    for (const [p, ns] of Object.entries(t.normalizers ?? {})) {
      if (!Array.isArray(ns) || !ns.every(isNormalizer)) bad(`${t.tool}.normalizers[${p}]`);
    }
  }
}

/** Sign a manifest with `key`, which must be listed in `m.keys` (protocol §6). */
export async function signManifest(m: UnsignedManifest, key: IdemKeyPair): Promise<Manifest> {
  assertManifestShape(m);
  if (!m.keys.some((k) => k.keyId === key.keyId)) {
    throw new IdemError("BAD_MANIFEST", "signing key is not listed in the manifest");
  }
  const value = await sign(key.privateKey, manifestSignedBytes(m));
  return { ...m, signature: { alg: "Ed25519", keyId: key.keyId, value } };
}

/** The exact string a manifest signature covers: JCS of the manifest without `signature`. */
export function manifestSignedBytes(m: UnsignedManifest | Manifest): string {
  const { signature: _ignored, ...rest } = m as Manifest;
  return jcs(rest);
}

/**
 * Check a manifest's self-consistency and signature (without consulting trust): every listed
 * key id is the thumbprint of its JWK, and the signature verifies with the listed signing key.
 * Trust decisions ([P-6.2]) are made by {@link TrustStore.addManifest}.
 */
export async function verifyManifestSignature(m: Manifest): Promise<VerifyResult> {
  try {
    assertManifestShape(m);
    for (const k of m.keys) {
      if ((await keyIdFromJwk(k.publicKeyJwk)) !== k.keyId) {
        return fail("BAD_MANIFEST", `key id ${k.keyId} does not match its JWK thumbprint`);
      }
    }
    if (m.signature?.alg !== "Ed25519") return fail("BAD_SIGNATURE", "unsupported signature algorithm");
    const signer = m.keys.find((k) => k.keyId === m.signature.keyId);
    if (!signer) return fail("UNTRUSTED_KEY", "manifest signed by a key it does not list");
    const ok = await verify(
      await importPublicKey(signer.publicKeyJwk),
      m.signature.value,
      manifestSignedBytes(m),
    );
    return ok
      ? { ok: true, producer: m.producer, keyId: signer.keyId }
      : fail("BAD_SIGNATURE", "invalid signature");
  } catch (e) {
    return fail("BAD_MANIFEST", e instanceof Error ? e.message : "malformed manifest");
  }
}

/**
 * Verify a manifest against a trust store without adding it ([P-6.2]): see
 * {@link TrustStore.check}.
 */
export async function verifyManifest(
  m: Manifest,
  trust: TrustStore,
  opts: { now?: number } = {},
): Promise<VerifyResult> {
  return trust.check(m, opts);
}

/**
 * Derive a non-reversible authorization context from a credential [P-8.4]:
 * `b64u(HMAC-SHA256(edgeSecret, credential))[0:22]`.
 */
export async function deriveAuthContext(edgeSecret: string, credential: string): Promise<string> {
  const key = await getSubtle().importKey("raw", utf8(edgeSecret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = new Uint8Array(await getSubtle().sign("HMAC", key, utf8(credential)));
  return b64uEncode(mac).slice(0, 22);
}
