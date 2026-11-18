import {
  buildInterest,
  type CallToolResult,
  cacheablePolicy,
  type Data,
  type IdemWireErrorCode,
  type Interest,
  isIdemError,
  type Manifest,
  producerPrefix,
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
 * the overlay. A Data that fails verification fails the call closed with `BAD_SIGNATURE` (the
 * plain-call retry of [P-5.5] needs the overlay, ADR-026).
 */
export class NdnConsumer {
  readonly trust: TrustStore;
  readonly producer: string;
  readonly #o: NdnConsumerOptions;
  #ready?: Promise<{ manifest: Manifest; tools: ToolInfo[] }>;
  readonly #policies = new Map<string, { policy: ToolPolicy; identity: ToolIdentity } | undefined>();

  constructor(opts: NdnConsumerOptions) {
    this.#o = opts;
    this.producer = opts.producer;
    this.trust = opts.trust ?? new TrustStore();
  }

  #fetch(interest: NdnInterest): Promise<NdnData> {
    return consume(interest, {
      ...(this.#o.fw && { fw: this.#o.fw }),
      describe: `idem-consumer(${this.producer})`,
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
      const v = await this.trust.addManifest(manifest);
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
      return (await buildInterest({ producer: this.producer, identity: c.identity, policy: c.policy, args }))
        .interest;
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
      };
    }
    const pkt = await encodeInterest(interest);
    const base = { tool, name: interest.name, ndnName: ndnUri(pkt.name) };
    let answer: NdnData;
    try {
      answer = await this.#fetch(pkt);
    } catch (e) {
      const message = e instanceof Error ? e.message : "no Data";
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
    const verify = await verifyNdnData(answer, this.trust);
    if (!verify.ok || verify.data?.name !== interest.name) {
      const reason = !verify.outer.ok
        ? verify.outer.reason
        : !verify.inner.ok
          ? verify.inner.reason
          : "refused";
      return {
        ...base,
        verify,
        result: errorResult("BAD_SIGNATURE", reason),
        error: { code: "BAD_SIGNATURE", message: reason },
      };
    }
    return { ...base, verify, data: verify.data, result: verify.data.content };
  }
}
