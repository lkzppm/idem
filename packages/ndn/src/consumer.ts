import {
  acceptData,
  buildInterest,
  type CallToolResult,
  type Clock,
  cacheablePolicy,
  clockTolerance,
  type Data,
  type IdemWireErrorCode,
  type Interest,
  isIdemError,
  type Manifest,
  producerPrefix,
  RealClock,
  randomNonce,
  type ToolIdentity,
  type ToolInfo,
  type ToolPolicy,
  TrustStore,
} from "@idem/core";
import { consume } from "@ndn/endpoint";
import type { Forwarder } from "@ndn/fw";
import { type Data as NdnData, Interest as NdnInterest } from "@ndn/packet";
import { decodeData, encodeInterest } from "./codec";
import { ndnVerifier } from "./keys";
import { ndnUri, toNdnName } from "./name";
import { RESERVED } from "./producer";
import { type NdnVerifyResult, verifyNdnData } from "./verify";

/** Options of {@link NdnConsumer}. */
export interface NdnConsumerOptions {
  /** Producer name, e.g. `demo.idem.dev`. */
  producer: string;
  /** NDNts logical forwarder. Default: NDNts' default forwarder. */
  fw?: Forwarder;
  /** Trust store (TOFU or pinned keys, [P-6.2]). Default: a new one. */
  trust?: TrustStore;
  /** InterestLifetime of the manifest and tool-list Interests, in ms. Default `4000`. */
  lifetimeMs?: number;
  /**
   * InterestLifetime of tool-call Interests, in ms: also how long one attempt waits for its Data.
   * Default: `@idem/core`'s `INTEREST_DEFAULTS.lifetimeMs`.
   */
  interestLifetimeMs?: number;
  /**
   * How many times a tool-call Interest that got no Data within its lifetime is sent again, each
   * time with a fresh Nonce (NFD drops a name + Nonce pair it has already seen, Dead Nonce List).
   * Default `0`: one Interest per call. Loss on the native binding is recovered only this way.
   */
  retransmissions?: number;
  /** Time source of the signed-lifetime check [P-8.7] and of key expiry. Default `RealClock`. */
  clock?: Clock;
  /** Clock tolerance of the signed-lifetime check [P-8.6]. Default `DEFAULT_CLOCK_TOLERANCE_MS`. */
  clockToleranceMs?: number;
}

/** Outcome of {@link NdnConsumer.call}. */
export interface NdnCallOutcome {
  tool: string;
  /** The IDEM name of the call. */
  name: string;
  /** The NDN name on the wire (IDEM name + ParametersSha256DigestComponent), as a readable URI. */
  ndnName: string;
  /** The verified IDEM Data. Absent on error: no unverified content is ever returned [P-5.5]. */
  data?: Data;
  verify?: NdnVerifyResult;
  /** The verified result, or an `isError` result describing `error`. */
  result: CallToolResult;
  error?: { code: IdemWireErrorCode; message: string };
  /** Interests sent for this call: `0` when it could not travel natively, `1 + retransmissions` at most. */
  attempts: number;
  /** Time spent in {@link verifyNdnData} (both signatures), in ms, when an answer was verified. */
  verifyMs?: number;
}

function errorResult(code: string, message: string): CallToolResult {
  return { content: [{ type: "text", text: `${code}: ${message}` }], isError: true };
}

function textOf(pkt: NdnData): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(pkt.content);
}

/**
 * IDEM consumer over native NDN (protocol §9.2, ADR-026). It fetches the manifest and tool list as
 * named Data, names calls locally with `@idem/core`'s `cacheablePolicy` and `buildInterest`
 * [P-4.1], sends them as NDN Interests, and verifies both signatures of every answer before
 * returning content [P-5.5].
 *
 * Only cacheable, `public` tools travel natively: there is no plain-call path on NDN, and `private`
 * results must never enter NFD's PIT or CS [P-8.3]. Such calls return `NOT_CACHEABLE` and belong to
 * the overlay. A Data that fails verification fails the call closed [P-9.3]: `UNTRUSTED_KEY` when a
 * signing key is not the producer's trusted key, `BAD_SIGNATURE` otherwise, and `NOT_CACHEABLE` for
 * a validly signed `private` Data [P-9.4] (the plain-call retry of [P-5.5] needs the overlay,
 * ADR-026). A verified Data outside its signed lifetime fails the call closed with `EXPIRED` [P-8.7]:
 * NFD's CS keeps a Data for its FreshnessPeriod from receipt and never looks at `producedAt`.
 */
export class NdnConsumer {
  readonly trust: TrustStore;
  readonly producer: string;
  readonly #o: NdnConsumerOptions;
  readonly #clock: Clock;
  readonly #tolerance: number;
  #ready?: Promise<{ manifest: Manifest; tools: ToolInfo[] }>;
  readonly #policies = new Map<string, { policy: ToolPolicy; identity: ToolIdentity } | undefined>();

  constructor(opts: NdnConsumerOptions) {
    this.#o = opts;
    this.producer = opts.producer;
    this.trust = opts.trust ?? new TrustStore();
    this.#clock = opts.clock ?? new RealClock();
    this.#tolerance = clockTolerance(opts.clockToleranceMs);
  }

  /**
   * One Interest, one wait. `retx` (the handshake only) lets NDNts send it again with a fresh Nonce;
   * calls count their own attempts instead.
   */
  #fetch(interest: NdnInterest, retx = 0): Promise<NdnData> {
    return consume(interest, {
      ...(this.#o.fw && { fw: this.#o.fw }),
      describe: `idem-consumer(${this.producer})`,
      ...(retx > 0 && { retx }),
    });
  }

  async #reserved(part: string): Promise<NdnData> {
    return this.#fetch(
      new NdnInterest(
        toNdnName(`${producerPrefix(this.producer)}/${part}`),
        NdnInterest.CanBePrefix,
        NdnInterest.MustBeFresh,
        NdnInterest.Lifetime(this.#o.lifetimeMs ?? 4000),
      ),
      // The manifest and the tool list retry like calls do, so one lost packet on a lossy path
      // does not fail the whole consumer.
      Math.max(0, Math.floor(this.#o.retransmissions ?? 0)),
    );
  }

  /** NDN-signature check of a reserved Data with a key the accepted manifest lists. */
  async #checkReserved(pkt: NdnData, manifest: Manifest): Promise<void> {
    const key = await this.trust.key(this.producer, manifest.signature.keyId);
    if (!key) throw new Error("manifest signing key is not trusted");
    await (await ndnVerifier(key)).verify(pkt);
  }

  /** Fetch and verify the manifest (TOFU or pinned [P-6.2]) and the tool list, over NDN. */
  init(): Promise<{ manifest: Manifest; tools: ToolInfo[] }> {
    this.#ready ??= (async () => {
      const mPkt = await this.#reserved(RESERVED.manifest);
      const manifest = JSON.parse(textOf(mPkt)) as Manifest;
      if (manifest.producer !== this.producer) throw new Error("manifest of another producer");
      const v = await this.trust.addManifest(manifest, { now: this.#clock.now() });
      if (!v.ok) throw new Error(`manifest rejected: ${v.reason}`);
      await this.#checkReserved(mPkt, manifest);
      const tPkt = await this.#reserved(RESERVED.tools);
      await this.#checkReserved(tPkt, manifest);
      const tools = JSON.parse(textOf(tPkt)) as ToolInfo[];
      for (const tool of tools) {
        const c = await cacheablePolicy(manifest, tool);
        // [P-8.3]: private tools never become native Interests.
        this.#policies.set(tool.name, c?.policy.scope === "public" ? c : undefined);
      }
      return { manifest, tools };
    })();
    this.#ready.catch(() => {
      this.#ready = undefined;
    });
    return this.#ready;
  }

  /**
   * The IDEM Interest a call would send, or `undefined` when the call cannot use the native binding
   * (not cacheable [P-4.2], `private` [P-8.3], or arguments outside the schema [P-3.1]).
   */
  async prepare(tool: string, args: unknown): Promise<Interest | undefined> {
    await this.init();
    const c = this.#policies.get(tool);
    if (!c) return undefined;
    try {
      const lifetimeMs = this.#o.interestLifetimeMs;
      return (
        await buildInterest({
          producer: this.producer,
          identity: c.identity,
          policy: c.policy,
          args,
          ...(lifetimeMs !== undefined && { lifetimeMs }),
        })
      ).interest;
    } catch (e) {
      if (isIdemError(e)) return undefined;
      throw e;
    }
  }

  /** Call a tool over NDN. See the class description for what may travel natively. */
  async call(tool: string, args: unknown): Promise<NdnCallOutcome> {
    const interest = await this.prepare(tool, args);
    if (!interest) {
      const message = `"${tool}" cannot travel on the native binding (not cacheable, private, or invalid args)`;
      return {
        tool,
        name: "",
        ndnName: "",
        result: errorResult("NOT_CACHEABLE", message),
        error: { code: "NOT_CACHEABLE", message },
        attempts: 0,
      };
    }
    const tries = 1 + Math.max(0, Math.floor(this.#o.retransmissions ?? 0));
    let answer: NdnData | undefined;
    let ndnName = "";
    let attempts = 0;
    let message = "no Data";
    while (!answer && attempts < tries) {
      // A retransmission is a new Interest for the same name: same name, fresh Nonce.
      const pkt = await encodeInterest(attempts === 0 ? interest : { ...interest, nonce: randomNonce() });
      ndnName ||= ndnUri(pkt.name);
      attempts++;
      try {
        answer = await this.#fetch(pkt);
      } catch (e) {
        message = e instanceof Error ? e.message : "no Data";
      }
    }
    const base = { tool, name: interest.name, ndnName, attempts };
    if (!answer) {
      return { ...base, result: errorResult("TIMEOUT", message), error: { code: "TIMEOUT", message } };
    }
    let decoded: ReturnType<typeof decodeData>;
    try {
      decoded = decodeData(answer);
    } catch (e) {
      const message = e instanceof Error ? e.message : "not an IDEM Data";
      return {
        ...base,
        result: errorResult("BAD_SIGNATURE", message),
        error: { code: "BAD_SIGNATURE", message },
      };
    }
    if (decoded.kind === "nack") {
      return {
        ...base,
        result: errorResult(decoded.code, decoded.message),
        error: { code: decoded.code, message: decoded.message },
      };
    }
    const t0 = performance.now();
    const verify = await verifyNdnData(answer, this.trust, { now: this.#clock.now() });
    const verifyMs = performance.now() - t0;
    if (!verify.ok || verify.data?.name !== interest.name) {
      // [P-9.3]: a key the trust store does not hold is UNTRUSTED_KEY, any other failure
      // BAD_SIGNATURE; a valid but `private` Data is NOT_CACHEABLE [P-9.4].
      const code: IdemWireErrorCode = verify.ok ? "BAD_SIGNATURE" : (verify.code ?? "BAD_SIGNATURE");
      const reason = !verify.outer.ok
        ? verify.outer.reason
        : !verify.inner.ok
          ? verify.inner.reason
          : verify.ok
            ? "Data name differs from the Interest name"
            : "private Data never travels on the native binding [P-9.4]";
      return {
        ...base,
        verify,
        verifyMs,
        result: errorResult(code, reason),
        error: { code, message: reason },
      };
    }
    // The shared consumer decision on the IDEM Data inside the NDN packet: name, signature, signed
    // lifetime and age, on this consumer's clock [P-5.5, P-8.7]. No plain call exists here: a
    // refusal fails closed.
    const accepted = await acceptData(verify.data, {
      trust: this.trust,
      now: this.#clock.now(),
      name: interest.name,
      mustBeFresh: interest.mustBeFresh,
      ttlMs: this.#policies.get(tool)?.policy.ttlMs ?? Infinity,
      toleranceMs: this.#tolerance,
    });
    if (!accepted.ok) {
      const code: IdemWireErrorCode = accepted.code === "BAD_MANIFEST" ? "BAD_SIGNATURE" : accepted.code;
      return {
        ...base,
        verify,
        verifyMs,
        result: errorResult(code, accepted.reason),
        error: { code, message: accepted.reason },
      };
    }
    return { ...base, verify, verifyMs, data: verify.data, result: verify.data.content };
  }
}
