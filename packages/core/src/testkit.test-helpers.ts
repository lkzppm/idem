// Test-only harness: agents → edge forwarder → producer on a VirtualClock.
import { VirtualClock } from "./clock";
import { buildInterest, cacheablePolicy } from "./consumer";
import { keyPairFromSeed } from "./crypto";
import { type Face, linkFaces, type Packet } from "./face";
import { Fib } from "./fib";
import { Forwarder, type ForwarderEvent, type ForwarderOptions } from "./forwarder";
import { Producer, type ProducerTool } from "./producer";
import { TrustStore } from "./trust";

export const PRODUCER = "demo.idem.dev";

export const TOOLS: ProducerTool[] = [
  {
    name: "fetch_page",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    policy: { cacheable: true, ttlMs: 60_000, scope: "public", normalizers: { "/url": ["url:sortQuery"] } },
    handler: (args) => ({ content: [{ type: "text", text: `page ${(args as { url: string }).url}` }] }),
  },
  {
    name: "my_notes",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    policy: { cacheable: true, ttlMs: 60_000, scope: "private" },
    handler: (_args, ctx) => ({ content: [{ type: "text", text: `notes of ${ctx.auth ?? "anonymous"}` }] }),
  },
  {
    name: "weather",
    inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
    annotations: { readOnlyHint: true },
    policy: {
      cacheable: true,
      ttlMs: 1_000,
      scope: "public",
      normalizers: { "/city": ["trim", "lowercase"] },
    },
    handler: (args, ctx) => ({
      content: [{ type: "text", text: `${(args as { city: string }).city}@${ctx.now}` }],
    }),
  },
  {
    name: "flaky",
    inputSchema: { type: "object" },
    annotations: { readOnlyHint: true },
    policy: { cacheable: true, ttlMs: 60_000, scope: "public" },
    handler: () => ({ content: [{ type: "text", text: "boom" }], isError: true }),
  },
  {
    name: "send_email",
    inputSchema: { type: "object", properties: { to: { type: "string" } }, required: ["to"] },
    annotations: { readOnlyHint: false },
    handler: (args) => ({ content: [{ type: "text", text: `sent to ${(args as { to: string }).to}` }] }),
  },
];

let seq = 0;
function nonce(): string {
  seq++;
  return `n${seq.toString().padStart(10, "0")}`;
}

export interface Agent {
  face: Face;
  received: Packet[];
  send(p: Packet): void;
}

export async function setup(
  opts: Partial<ForwarderOptions> & { serviceTimeMs?: number; latencyMs?: number } = {},
) {
  const clock = new VirtualClock();
  const key = await keyPairFromSeed(new Uint8Array(32).fill(7));
  const producer = new Producer({ producer: PRODUCER, key, tools: TOOLS, clock });
  const manifest = await producer.manifest();
  const trust = new TrustStore();
  await trust.addManifest(manifest, { now: 0 });
  const events: ForwarderEvent[] = [];
  const fib = new Fib();
  const edge = new Forwarder({
    id: "edge",
    clock,
    fib,
    trust,
    authSecret: "edge-secret",
    onEvent: (e) => events.push(e),
    ...opts,
  });
  const [up, prodFace] = linkFaces(clock, {
    a: "edge→producer",
    b: "producer",
    latencyMs: opts.latencyMs ?? 20,
  });
  edge.addFace(up);
  fib.addProducer(PRODUCER, up.id);
  const upstreamPackets: Packet[] = [];
  const realReceive = prodFace.onReceive.bind(prodFace);
  prodFace.onReceive = (cb) =>
    realReceive((p) => {
      upstreamPackets.push(p);
      return cb(p);
    });
  producer.serve(prodFace, { clock, serviceTimeMs: () => opts.serviceTimeMs ?? 100 });

  const agents = new Map<string, Agent>();
  function agent(id: string): Agent {
    const existing = agents.get(id);
    if (existing) return existing;
    const [face, edgeSide] = linkFaces(clock, { a: id, b: `edge:${id}`, latencyMs: 5 });
    edge.addFace(edgeSide, { consumer: true });
    const received: Packet[] = [];
    face.onReceive((p) => {
      received.push(p);
    });
    const a = { face, received, send: (p: Packet) => face.send(p) };
    agents.set(id, a);
    return a;
  }

  async function interest(tool: string, args: unknown, extra: { nonce?: string; lifetimeMs?: number } = {}) {
    const info = producer.toolList().find((t) => t.name === tool);
    if (!info) throw new Error(tool);
    const c = await cacheablePolicy(manifest, info);
    if (!c) throw new Error(`${tool} is not cacheable`);
    const { interest } = await buildInterest({
      producer: PRODUCER,
      identity: c.identity,
      policy: c.policy,
      args,
      nonce: extra.nonce ?? nonce(),
      ...(extra.lifetimeMs !== undefined && { lifetimeMs: extra.lifetimeMs }),
    });
    return interest;
  }

  const upstreamInterests = () => upstreamPackets.filter((p) => p.type === "interest").length;
  return {
    clock,
    key,
    producer,
    manifest,
    trust,
    edge,
    fib,
    events,
    agent,
    interest,
    upstreamPackets,
    upstreamInterests,
    nonce,
  };
}

export function dataOf(p: Packet | undefined) {
  if (p?.type !== "data") throw new Error(`expected data, got ${p?.type}: ${JSON.stringify(p)}`);
  return p.data;
}

export function textOf(p: Packet | undefined): string {
  return (dataOf(p).content.content[0] as { text: string }).text;
}
