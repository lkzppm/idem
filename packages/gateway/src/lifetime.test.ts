// The signed lifetime over HTTP [P-8.6] [P-8.7], in process: client → edge → producer through
// injected `fetch` functions. Clocks are offset from each other by minutes (never by a race with
// real time): what decides each case is the injected offset, far beyond TTL + tolerance.
import {
  type Clock,
  type Data,
  type Interest,
  keyPairFromSeed,
  Producer,
  type ProducerTool,
  RealClock,
} from "@idem/core";
import { describe, expect, it } from "vitest";
import { IdemClient } from "./client";
import { createGateway } from "./gateway";
import { createProducerHandler } from "./producer-handler";
import { PATHS } from "./wire";

const PRODUCER = "demo.idem.dev";
const EDGE = "http://edge.internal";
const ORIGIN = "http://producer.internal";
const TEN_MIN = 10 * 60_000;

const tools: ProducerTool[] = [
  {
    name: "fetch_page",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    policy: { cacheable: true, ttlMs: 60_000, scope: "public" },
    handler: (args, ctx) => ({
      content: [{ type: "text", text: `page ${(args as { url: string }).url} @${ctx.now}` }],
    }),
  },
];

/** Real timers, a clock that reads `offsetMs` away from real time. */
function offsetClock(offsetMs: number): Clock {
  const real = new RealClock();
  return {
    now: () => Date.now() + offsetMs,
    setTimeout: (fn, ms) => real.setTimeout(fn, ms),
    clearTimeout: (h) => real.clearTimeout(h),
  };
}

async function world(opts: {
  producerOffset?: number;
  clientOffset?: number;
  /** Replace the edge's answer to the Interest with the producer's answer made `replayAge` ms ago. */
  replayAge?: number;
}) {
  const key = await keyPairFromSeed(new Uint8Array(32).fill(77));
  const producer = new Producer({
    producer: PRODUCER,
    key,
    tools,
    clock: offsetClock(opts.producerOffset ?? 0),
  });
  const handler = createProducerHandler(producer);
  const edge = createGateway({
    id: "edge",
    upstreams: [{ producer: PRODUCER, url: ORIGIN, kind: "producer" }],
    fetch: (input, init) => handler(new Request(input, init)),
  });
  const replayAge = opts.replayAge;
  const recorder =
    replayAge === undefined
      ? undefined
      : new Producer({ producer: PRODUCER, key, tools, clock: offsetClock(-replayAge) });
  const link: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const path = new URL(req.url).pathname;
    const sent =
      req.method === "POST" && path === PATHS.interest ? ((await req.clone().json()) as Interest) : undefined;
    const res = await edge.handle(req);
    if (!sent || !recorder) return res;
    // An on-path party answers with a genuine Data it recorded `replayAge` ms ago.
    return new Response(JSON.stringify(await recorder.handleInterest(sent)), {
      status: 200,
      headers: res.headers,
    });
  };
  const client = new IdemClient({
    edge: EDGE,
    producer: PRODUCER,
    fetch: link,
    clock: offsetClock(opts.clientOffset ?? 0),
  });
  return { client, edge };
}

const args = { url: "https://ex.com/a" };
const text = (d: { content: unknown[] }) => (d.content[0] as { text: string }).text;

describe("signed lifetime at an HTTP consumer (protocol §8)", () => {
  it("MUST NOT hand over a replayed expired Data; the plain-call retry delivers a fresh one [P-8.7]", async () => {
    const { client } = await world({ replayAge: TEN_MIN });
    const out = await client.call("fetch_page", args);
    expect(out.retried).toBe(true);
    expect(out.error).toBeUndefined();
    expect(out.verify?.ok).toBe(true);
    expect(Date.now() - (out.data as Data).meta.producedAt).toBeLessThan(60_000);
  });

  it("MUST fail closed with CLOCK_SKEW when the verified retry is still expired (clock ahead) [P-8.7]", async () => {
    const { client } = await world({ clientOffset: TEN_MIN });
    const out = await client.call("fetch_page", args);
    expect(out.retried).toBe(true);
    expect(out.error?.code).toBe("CLOCK_SKEW");
    expect(out.error?.message).toMatch(/past its signed lifetime \(producedAt \d+, local time \d+/);
    expect(out.result.isError).toBe(true);
    expect(text(out.result)).not.toMatch(/^page/);
  });

  it("MUST fail closed with CLOCK_SKEW when the retry is dated beyond the tolerance (clock behind) [P-8.7]", async () => {
    const { client } = await world({ clientOffset: -TEN_MIN });
    const out = await client.call("fetch_page", args);
    expect(out.error?.code).toBe("CLOCK_SKEW");
    expect(out.error?.message).toMatch(/future/);
  });

  it("MUST answer EXPIRED at the edge for upstream Data outside its lifetime, and not cache it [P-8.6]", async () => {
    const { client, edge } = await world({ producerOffset: -TEN_MIN });
    const I = await client.prepare("fetch_page", args);
    const first = await client.sendInterest(I as Interest);
    expect(first.error?.code).toBe("EXPIRED");
    expect(edge.forwarder.cs.stats().entries).toBe(0);
    // The consumer retries as a plain call; the producer's clock is still behind: CLOCK_SKEW.
    const out = await client.call("fetch_page", args);
    expect(out.retried).toBe(true);
    expect(out.error?.code).toBe("CLOCK_SKEW");
  });

  it("skips the lifetime check for an Interest with mustBeFresh: false [P-8.7]", async () => {
    const { client } = await world({ clientOffset: TEN_MIN });
    const I = (await client.prepare("fetch_page", args)) as Interest;
    const r = await client.sendInterest({ ...I, mustBeFresh: false });
    expect(r.verify?.ok).toBe(true);
    expect(r.error).toBeUndefined();
  });
});
