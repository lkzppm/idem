import { IdemError, type IdemKeyPair, keyLocator } from "@idem/core";
import { createSigner, createVerifier, Ed25519 } from "@ndn/keychain";
import { type Name, Signer, SigType, type Verifier } from "@ndn/packet";
import { toNdnName } from "./name";

/**
 * An NDNts {@link Signer} bound to the NDN name its KeyLocator carries. Signing uses the NDNts
 * keychain's Ed25519 algorithm (ADR-005) over NDN's signed portion of the packet.
 */
export interface NdnSigner extends Signer {
  /** KeyLocator name written into every packet this signer signs. */
  readonly keyLocator: Name;
}

/**
 * Wrap an Ed25519 private key as an NDNts signer whose KeyLocator is `locator`. The key is the
 * very same WebCrypto key `@idem/core` signs IDEM Data with; nothing is re-imported.
 */
export function ndnSigner(privateKey: CryptoKey, locator: Name): NdnSigner {
  const inner = createSigner(Ed25519, { privateKey, info: {} });
  return {
    keyLocator: locator,
    async sign(pkt) {
      // The plain signer keeps an existing SigInfo; put ours first so the KeyLocator is set.
      Signer.putSigInfo(pkt, SigType.Ed25519, locator);
      await inner.sign(pkt);
    },
  };
}

/**
 * The producer's NDN signer: the producer's IDEM key, with KeyLocator = the IDEM key locator
 * `/idem/v1/<producer>/_key/<keyId>` mapped to NDN [P-5.2] (protocol §9.2).
 */
export function producerSigner(producer: string, key: IdemKeyPair): NdnSigner {
  return ndnSigner(key.privateKey, toNdnName(keyLocator(producer, key.keyId)));
}

/**
 * An NDNts verifier for an Ed25519 public key (WebCrypto `CryptoKey`, extractable, as
 * `@idem/core`'s `TrustStore` hands out). It checks the NDN signature only; which key may sign
 * which name is decided by the caller ({@link verifyNdnData}).
 */
export async function ndnVerifier(publicKey: CryptoKey): Promise<Verifier> {
  let spki: Uint8Array;
  try {
    spki = new Uint8Array(await globalThis.crypto.subtle.exportKey("spki", publicKey));
  } catch (e) {
    throw new IdemError("CRYPTO_UNSUPPORTED", "could not export the Ed25519 public key", { cause: e });
  }
  return createVerifier(Ed25519, { publicKey, spki, info: {} });
}
