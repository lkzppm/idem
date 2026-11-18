import {
  buildInterest,
  canonicalizeArgs,
  generateKeyPair,
  type Interest,
  isIdemError,
  makeName,
  Producer,
  type ProducerTool,
  type ToolIdentity,
  type ToolPolicy,
  toolSchemaDigest,
} from "@idem/core";

/** Producer name used by the demo deployment and the simulator. */
export const DEMO_PRODUCER = "demo.idem.dev";

/**
 * The `fetch_page` tool as the landing page models it: the schema and normalizer the spec
 * declares for the demo producer (04-showcase §3). Everything below runs `@idem/core` in the
 * browser; nothing is precomputed.
 */
export const FETCH_PAGE: ToolIdentity = {
  name: "fetch_page",
  inputSchema: {
    type: "object",
    properties: { url: { type: "string", minLength: 1 } },
    required: ["url"],
    additionalProperties: false,
  },
  policyVersion: 1,
};

export const FETCH_PAGE_NORMALIZERS: ToolPolicy["normalizers"] = { "/url": ["url:sortQuery"] };

let policy: Promise<ToolPolicy> | undefined;

/** The manifest policy for {@link FETCH_PAGE}, with its real schema digest. */
export function fetchPagePolicy(): Promise<ToolPolicy> {
  policy ??= toolSchemaDigest(FETCH_PAGE).then((schemaDigest) => ({
    tool: FETCH_PAGE.name,
    schemaDigest,
    cacheable: true,
    ttlMs: 60_000,
    scope: "public",
    normalizers: FETCH_PAGE_NORMALIZERS,
    policyVersion: 1,
  }));
  return policy;
}

/** Result of naming one call. */
export type Named =
  | { ok: true; jcs: string; name: string; schemaDigest: string; argsDigest: string }
  | {
      ok: false;
      /** The error's message (English, from `@idem/core`). */
      error: string;
      /** The `IdemError` code when there is one: a protocol term, shown as is in every language. */
      code?: string;
    };

/** Canonicalize `args` and compute the IDEM name, exactly as a consumer would. */
export async function nameFetchPage(args: unknown): Promise<Named> {
  try {
    const p = await fetchPagePolicy();
    const c = await canonicalizeArgs(args, FETCH_PAGE, p);
    const name = await makeName({ producer: DEMO_PRODUCER, tool: FETCH_PAGE, args: c });
    const parts = name.split("/");
    return { ok: true, jcs: c.jcs, name, schemaDigest: parts[5] ?? "", argsDigest: parts[6] ?? "" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return isIdemError(e) ? { ok: false, error: msg, code: e.code } : { ok: false, error: msg };
  }
}

/**
 * Produce a real Interest and a real signed Data for a `fetch_page` call, in the browser, with an
 * ephemeral Ed25519 key. Used by the packet-anatomy section. `text` is the page's content, in the
 * visitor's language; it is signed like any other content.
 */
export async function samplePackets(
  url: string,
  text: string,
): Promise<{ interest: Interest; data: unknown }> {
  const key = await generateKeyPair();
  const tool: ProducerTool = {
    ...FETCH_PAGE,
    description: "Return a page of the static corpus.",
    annotations: { readOnlyHint: true },
    policy: { cacheable: true, ttlMs: 60_000, scope: "public", normalizers: FETCH_PAGE_NORMALIZERS },
    handler: () => ({ content: [{ type: "text", text }] }),
  };
  const producer = new Producer({ producer: DEMO_PRODUCER, key, tools: [tool] });
  const { interest } = await buildInterest({
    producer: DEMO_PRODUCER,
    identity: FETCH_PAGE,
    policy: await fetchPagePolicy(),
    args: { url },
  });
  const data = await producer.handleInterest(interest);
  return { interest, data };
}
