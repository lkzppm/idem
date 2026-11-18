import { importPublicKey, keyIdFromJwk, verifyManifestSignature } from "./crypto";
import { assertProducer } from "./name";
import type { Manifest, ToolPolicy, VerifyResult } from "./types";

interface KnownKey {
  jwk: JsonWebKey;
  notAfter?: number;
  key?: Promise<CryptoKey>;
}

interface ProducerTrust {
  /** Keys pinned by configuration. Never removed by a manifest. */
  pinned: Map<string, KnownKey>;
  /** Keys listed by the currently accepted manifest. */
  listed: Map<string, KnownKey>;
  /** Keys trusted right now (pinned, or listed by the accepted manifest): may sign the next manifest. */
  seen: Set<string>;
  manifest?: Manifest;
  policies: Map<string, ToolPolicy>;
}

/**
 * Trust state of one node: accepted manifests and the producer keys they authorize.
 *
 * Trust model v1 [P-6.2]: trust on first use, with optional pinning. A manifest is accepted only
 * if it is signed by a key it lists **and** that key is currently trusted for the producer
 * (pinned, or listed by the accepted manifest), except on first contact. A manifest with a lower
 * `version` than the accepted one is rejected (no rollback) [P-6.3].
 */
export class TrustStore {
  readonly #producers = new Map<string, ProducerTrust>();

  #entry(producer: string): ProducerTrust {
    let e = this.#producers.get(producer);
    if (!e) {
      e = { pinned: new Map(), listed: new Map(), seen: new Set(), policies: new Map() };
      this.#producers.set(producer, e);
    }
    return e;
  }

  /** Pin a producer key by configuration. Pinned keys disable trust on first use for that producer. */
  async pin(producer: string, publicKeyJwk: JsonWebKey): Promise<string> {
    assertProducer(producer);
    const keyId = await keyIdFromJwk(publicKeyJwk);
    const e = this.#entry(producer);
    e.pinned.set(keyId, { jwk: publicKeyJwk });
    e.seen.add(keyId);
    return keyId;
  }

  /**
   * Decide whether `m` would be accepted, without changing state. Returns the verification
   * result; `BAD_MANIFEST` covers rollback and malformed manifests.
   */
  async check(m: Manifest, opts: { now?: number } = {}): Promise<VerifyResult> {
    const sig = await verifyManifestSignature(m);
    if (!sig.ok) return sig;
    const now = opts.now ?? Date.now();
    const signer = m.keys.find((k) => k.keyId === m.signature.keyId);
    if (signer?.notAfter !== undefined && now > signer.notAfter) {
      return { ok: false, code: "UNTRUSTED_KEY", reason: "manifest signing key expired" };
    }
    const e = this.#producers.get(m.producer);
    const firstContact = !e || e.seen.size === 0;
    if (!firstContact && !e.seen.has(m.signature.keyId)) {
      return { ok: false, code: "UNTRUSTED_KEY", reason: "manifest signed by a key that was never trusted" };
    }
    if (e?.manifest && m.version < e.manifest.version) {
      return {
        ok: false,
        code: "BAD_MANIFEST",
        reason: `rollback from version ${e.manifest.version} to ${m.version}`,
      };
    }
    return sig;
  }

  /** Verify and, if trusted, accept a manifest (replacing the producer's previous one). */
  async addManifest(m: Manifest, opts: { now?: number } = {}): Promise<VerifyResult> {
    const result = await this.check(m, opts);
    if (!result.ok) return result;
    const e = this.#entry(m.producer);
    e.manifest = m;
    e.listed = new Map(
      m.keys.map((k) => [
        k.keyId,
        { jwk: k.publicKeyJwk, ...(k.notAfter !== undefined && { notAfter: k.notAfter }) },
      ]),
    );
    // Keys dropped by a rotation stop being able to sign the next manifest.
    e.seen = new Set([...e.pinned.keys(), ...m.keys.map((k) => k.keyId)]);
    e.policies = new Map(m.tools.map((t) => [t.tool, t]));
    return result;
  }

  /** The accepted manifest of a producer, if any. */
  manifest(producer: string): Manifest | undefined {
    return this.#producers.get(producer)?.manifest;
  }

  /** The cache policy a producer's accepted manifest declares for `tool`. */
  policy(producer: string, tool: string): ToolPolicy | undefined {
    return this.#producers.get(producer)?.policies.get(tool);
  }

  /**
   * A verification key currently trusted for `producer`: pinned, or listed by the accepted
   * manifest and not past its `notAfter`.
   */
  async key(producer: string, keyId: string, now: number = Date.now()): Promise<CryptoKey | undefined> {
    const e = this.#producers.get(producer);
    const k = e?.pinned.get(keyId) ?? e?.listed.get(keyId);
    if (!k) return undefined;
    if (k.notAfter !== undefined && now > k.notAfter) return undefined;
    k.key ??= importPublicKey(k.jwk);
    return k.key;
  }

  /** Producers with an accepted manifest. */
  producers(): string[] {
    return [...this.#producers.entries()].filter(([, e]) => e.manifest).map(([p]) => p);
  }
}
