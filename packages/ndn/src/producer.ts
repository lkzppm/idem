import {
  IdemError,
  type IdemKeyPair,
  isIdemError,
  jcs,
  type Producer,
  parseName,
  producerPrefix,
  utf8,
  wireCode,
} from "@idem/core";
import { type Producer as EndpointProducer, produce } from "@ndn/endpoint";
import type { Forwarder } from "@ndn/fw";
import { type Name, Data as NdnData, type Interest as NdnInterest } from "@ndn/packet";
import { decodeInterest, encodeData, encodeNack } from "./codec";
import { type NdnSigner, producerSigner } from "./keys";
import { toNdnName } from "./name";

/** Reserved name parts the native producer answers besides tool calls [P-2.4]. */
export const RESERVED = {
  /** `/idem/v1/<producer>/_manifest/<version>`: the signed manifest (protocol §6). */
  manifest: "_manifest",
  /** `/idem/v1/<producer>/_tools/<version>`: the tool list, as `tools/list` reports it (ADR-026). */
  tools: "_tools",
} as const;

/** Options of {@link serveNdn}. */
export interface NdnProducerOptions {
  /** The transport-agnostic producer of `@idem/core` (ADR-014): it names, runs and signs. */
  producer: Producer;
  /** The key `producer` signs with; it also signs the NDN packets. Must be listed in the manifest. */
  key: IdemKeyPair;
  /** NDNts logical forwarder. Default: NDNts' default forwarder. */
  fw?: Forwarder;
  /** Interests processed in parallel. Default `16`. */
  concurrency?: number;
}

/** A running native producer. */
export interface NdnProducer {
  /** Registered prefix: `/idem/v1/<producer>`. */
  readonly prefix: Name;
  /** The NDN signer (producer key, KeyLocator `/idem/v1/<producer>/_key/<keyId>`). */
  readonly signer: NdnSigner;
  /** The underlying NDNts producer. */
  readonly endpoint: EndpointProducer;
  /** Unregister the prefix. */
  close(): void;
}

function componentText(name: Name, i: number): string | undefined {
  const c = name.get(i);
  return c ? new TextDecoder().decode(c.value) : undefined;
}

/**
 * Serve a `@idem/core` {@link Producer} on an NDN forwarder (protocol §9.2, ADR-026). For each
 * Interest under `/idem/v1/<producer>`:
 *
 * - `_manifest` / `_tools` (CanBePrefix): the signed manifest and the tool list, at the manifest
 *   version;
 * - a tool-call name: decoded and checked ([P-4.3]), refused with a `NOT_CACHEABLE` Nack when the
 *   manifest declares the tool `private` (the handler never runs, [P-8.3]), otherwise answered by
 *   `producer.handleInterest`, which recomputes the name [P-5.1] and signs [P-5.2]; the result is
 *   encoded as a native Data and NDN-signed with the same key;
 * - anything that fails becomes an application Nack carrying the wire code (protocol §10).
 *
 * PIT, CS and aggregation are the forwarder's (NFD in Mini-NDN); this function adds none.
 */
export async function serveNdn(opts: NdnProducerOptions): Promise<NdnProducer> {
  const { producer, key } = opts;
  const manifest = await producer.manifest();
  if (!manifest.keys.some((k) => k.keyId === key.keyId)) {
    throw new IdemError("BAD_POLICY", "the NDN signing key is not listed in the producer's manifest");
  }
  const signer = producerSigner(producer.producer, key);
  const prefix = toNdnName(producerPrefix(producer.producer));
  const base = prefix.length;

  const reserved = async (
    interest: NdnInterest,
    part: string,
    body: unknown,
  ): Promise<NdnData | undefined> => {
    const name = toNdnName(`${producerPrefix(producer.producer)}/${part}/${manifest.version}`);
    const pkt = new NdnData(name, NdnData.FreshnessPeriod(0), utf8(jcs(body as Parameters<typeof jcs>[0])));
    await signer.sign(pkt);
    return (await pkt.canSatisfy(interest)) ? pkt : undefined;
  };

  const nack = (interest: NdnInterest, e: unknown) =>
    encodeNack(interest.name, wireCode(e), e instanceof Error ? e.message : "failed", signer);

  const handler = async (interest: NdnInterest): Promise<NdnData | undefined> => {
    const part = componentText(interest.name, base);
    if (part === RESERVED.manifest) return reserved(interest, part, manifest);
    if (part === RESERVED.tools) return reserved(interest, part, producer.toolList());
    try {
      const idem = await decodeInterest(interest);
      const { tool } = parseName(idem.name);
      const policy = manifest.tools.find((t) => t.tool === tool);
      if (policy?.scope !== "public") {
        // Golden rule 4: NFD aggregates and caches by name alone, with no authContext.
        throw new IdemError("NOT_CACHEABLE", `tool "${tool}" is private or unknown: not served natively`);
      }
      const data = await producer.handleInterest(idem);
      try {
        return await encodeData(data, interest.name, signer);
      } catch (e) {
        if (isIdemError(e, "BAD_ENCODING")) throw new IdemError("UPSTREAM_ERROR", e.message);
        throw e;
      }
    } catch (e) {
      return nack(interest, e);
    }
  };

  const endpoint = produce(prefix, handler, {
    ...(opts.fw && { fw: opts.fw }),
    concurrency: opts.concurrency ?? 16,
    describe: `idem-producer(${producer.producer})`,
  });
  return { prefix, signer, endpoint, close: () => endpoint.close() };
}
