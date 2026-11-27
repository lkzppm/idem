/**
 * Error codes carried on the wire (protocol §10).
 */
export type IdemWireErrorCode =
  | "DIGEST_MISMATCH"
  | "BAD_SIGNATURE"
  /** Data outside its signed lifetime (either side) at a forwarder, for a fresh Interest [P-8.6]. */
  | "EXPIRED"
  | "UNTRUSTED_KEY"
  | "NOT_CACHEABLE"
  | "TIMEOUT"
  | "HOP_LIMIT"
  | "LOOP"
  | "UPSTREAM_ERROR";

/**
 * Local error codes: raised by the library, never sent as a Nack (protocol §10, "local errors").
 */
export type IdemLocalErrorCode =
  | "BAD_NAME"
  | "BAD_JSON"
  | "BAD_ENCODING"
  | "INVALID_ARGS"
  | "UNSUPPORTED_SCHEMA"
  | "BAD_POLICY"
  | "BAD_MANIFEST"
  | "CRYPTO_UNSUPPORTED"
  /**
   * The consumer's verified plain-call retry is still outside its signed lifetime: this node's clock
   * and the producer's disagree, or a party on the retry's path replays too [P-8.7].
   */
  | "CLOCK_SKEW";

/** Every error code IDEM can raise. */
export type IdemErrorCode = IdemWireErrorCode | IdemLocalErrorCode;

/**
 * Typed error used everywhere in `@idem/*`. Branch on {@link IdemError.code}, never on the message.
 */
export class IdemError extends Error {
  /** Machine-readable error code. */
  readonly code: IdemErrorCode;

  constructor(code: IdemErrorCode, message: string, options?: { cause?: unknown }) {
    super(`${code}: ${message}`, options);
    this.name = "IdemError";
    this.code = code;
  }
}

/** Narrow an unknown error to an {@link IdemError}, optionally with a specific code. */
export function isIdemError(e: unknown, code?: IdemErrorCode): e is IdemError {
  return e instanceof IdemError && (code === undefined || e.code === code);
}
