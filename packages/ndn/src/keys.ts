import { type IdemKeyPair, keyLocator } from "@idem/core";
import { LLSign, LLVerify, type Name, Signer, SigType, Verifier } from "@ndn/packet";
import { toNdnName } from "./name";

/**
 * An NDNts {@link Signer} bound to the NDN name its KeyLocator carries. Signing is Ed25519 (ADR-005)
 * over NDN's signed portion of the packet, done by WebCrypto itself with the `CryptoKey` it is given.
 *
 * Not through `@ndn/keychain`: its browser build routes Ed25519 through a ponyfill that, in WebKit
 * (Safari), replaces WebCrypto with a JavaScript implementation that cannot use a native
 * `CryptoKey` ("Uint8Array expected"), so a producer in Safari could never sign.
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
  return {
    keyLocator: locator,
    async sign(pkt) {
      Signer.putSigInfo(pkt, SigType.Ed25519, locator);
      await pkt[LLSign.OP](
        async (input) =>
          new Uint8Array(await globalThis.crypto.subtle.sign("Ed25519", privateKey, input as BufferSource)),
      );
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
 * An NDNts verifier for an Ed25519 public key (a WebCrypto `CryptoKey`, as `@idem/core`'s
 * `TrustStore` hands out), checked by WebCrypto itself (see {@link ndnSigner} for why not the
 * keychain). It checks the SigType and the NDN signature only; which key may sign which name is
 * decided by the caller ({@link verifyNdnData}).
 */
export async function ndnVerifier(publicKey: CryptoKey): Promise<Verifier> {
  return {
    async verify(pkt) {
      Verifier.checkSigType(pkt, SigType.Ed25519);
      await pkt[LLVerify.OP](async (input, sig) => {
        const ok = await globalThis.crypto.subtle.verify(
          "Ed25519",
          publicKey,
          sig as BufferSource,
          input as BufferSource,
        );
        Verifier.throwOnBadSig(ok);
      });
    },
  };
}
