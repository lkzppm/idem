/**
 * `@idem/ndn`: the native NDN binding of IDEM (protocol §9.2, ADR-004, ADR-026). IDEM names,
 * Interests and signed Data become NDN TLV packets through NDNts; the producer and consumer wrap
 * `@idem/core`'s `Producer`, `buildInterest` and `verifyData` (ADR-014), so naming, signing and
 * verification are the overlay's own. PIT, CS and aggregation belong to the NDN forwarder (NFD).
 * Web APIs only: runs in Node and browsers.
 *
 * @packageDocumentation
 */

export {
  CONTENT_TYPE,
  type DecodedData,
  dataFromWire,
  decodeData,
  decodeInterest,
  encodeData,
  encodeInterest,
  encodeNack,
  idemNonce,
  interestFromWire,
  MAX_PACKET_SIZE,
  type NativeEnvelope,
  ndnNonce,
  toWire,
} from "./codec";
export { type NdnCallOutcome, NdnConsumer, type NdnConsumerOptions } from "./consumer";
export { TLV_TYPES, type TlvNode, tlvTree, toHex } from "./inspect";
export { type NdnSigner, ndnSigner, ndnVerifier, producerSigner } from "./keys";
export { fromNdnName, hasParamsDigest, ndnUri, toNdnName } from "./name";
export { type NdnProducer, type NdnProducerOptions, RESERVED, serveNdn } from "./producer";
export {
  type NdnVerifyOptions,
  type NdnVerifyResult,
  type OuterVerifyResult,
  verifyNdnData,
} from "./verify";
