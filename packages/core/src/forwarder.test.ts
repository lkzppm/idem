import { describe, expect, it } from "vitest";
import { VirtualClock } from "./clock";
import { keyPairFromSeed, signData } from "./crypto";
import { entryAge, isFresh, MemoryContentStore } from "./cs";
import { linkFaces, type Packet } from "./face";
import { Fib } from "./fib";
import { Forwarder, type ForwarderOptions } from "./forwarder";
import { dataOf, PRODUCER, setup, textOf } from "./testkit.test-helpers";
import { TrustStore } from "./trust";
import type { Data } from "./types";

const URL_A = "https://example.com/page?b=2&a=1";
const URL_A_EQUIV = "https://EXAMPLE.com:443/page?a=1&b=2#section";

describe("forwarder: aggregation and caching (protocol §7)", () => {
  it("aggregates 3 concurrent equivalent calls into 1 upstream Interest, then serves a 4th from the CS", async () => {
    const s = await setup();
    const [a1, a2, a3, a4] = ["a1", "a2", "a3", "a4"].map((id) => s.agent(id));
    a1?.send({ type: "interest", interest: await s.interest("fetch_page", { url: URL_A }) });
    a2?.send({ type: "interest", interest: await s.interest("fetch_page", { url: URL_A_EQUIV }) });
    a3?.send({ type: "interest", interest: await s.interest("fetch_page", { url: URL_A }) });
    await s.clock.runAll();
    expect(s.upstreamInterests()).toBe(1);
    for (const a of [a1, a2, a3])
      expect(textOf(a?.received[0])).toBe("page https://example.com/page?a=1&b=2");
    expect(s.events.filter((e) => e.kind === "pit_aggregate")).toHaveLength(2);
    expect(s.events.find((e) => e.kind === "pit_satisfy")).toMatchObject({ faces: 3 });

    a4?.send({ type: "interest", interest: await s.interest("fetch_page", { url: URL_A }) });
    await s.clock.runAll();
    expect(s.upstreamInterests()).toBe(1);
    expect(s.events.filter((e) => e.kind === "cs_hit")).toHaveLength(1);
    // Each downstream gets the answer under its own nonce.
    const nonces = [a1, a2, a3, a4].map((a) => (a?.received[0] as { nonce: string } | undefined)?.nonce);
    expect(new Set(nonces).size).toBe(4);
  });

  it("MUST drop an Interest whose args do not match the name: DIGEST_MISMATCH [P-4.3]", async () => {
    const s = await setup();
    const a = s.agent("a");
    const I = await s.interest("fetch_page", { url: URL_A });
    a.send({ type: "interest", interest: { ...I, args: { url: "https://evil.example/" } } });
    await s.clock.runAll();
    expect(a.received[0]).toMatchObject({ type: "nack", code: "DIGEST_MISMATCH" });
    expect(s.upstreamInterests()).toBe(0);
    expect(s.events.at(-1)).toMatchObject({ kind: "drop", reason: "digest_mismatch" });
  });

  it("MUST decrement hopLimit and drop at 0 [P-4.4]", async () => {
    const s = await setup();
    const a = s.agent("a");
    const I = await s.interest("fetch_page", { url: URL_A });
    a.send({ type: "interest", interest: { ...I, hopLimit: 0 } });
    await s.clock.runAll();
    expect(a.received[0]).toMatchObject({ type: "nack", code: "HOP_LIMIT" });
    const ok = await s.interest("fetch_page", { url: URL_A });
    a.send({ type: "interest", interest: { ...ok, hopLimit: 3 } });
    await s.clock.runAll();
    const up = s.upstreamPackets.find((p) => p.type === "interest");
    expect(up?.type === "interest" && up.interest.hopLimit).toBe(2);
  });

  it("MUST drop an Interest whose (name, nonce) is already pending from another face: LOOP [P-4.4]", async () => {
    const s = await setup();
    const I = await s.interest("fetch_page", { url: URL_A }, { nonce: "same-nonce-1" });
    s.agent("a").send({ type: "interest", interest: I });
    s.agent("b").send({ type: "interest", interest: I });
    await s.clock.runAll();
    expect(s.agent("b").received[0]).toMatchObject({ type: "nack", code: "LOOP" });
    expect(textOf(s.agent("a").received[0])).toContain("page");
  });

  it("MUST verify the signature before inserting into the CS [P-7.1]", async () => {
    const s = await setup();
    // Man-in-the-middle on the producer link: rewrite Data content.
    const clock = s.clock;
    const fib = new Fib();
    const evilEvents: string[] = [];
    const edge = new Forwarder({
      id: "edge2",
      clock,
      fib,
      trust: s.trust,
      onEvent: (e) => evilEvents.push(e.kind),
    });
    const [up, fake] = linkFaces(clock, { a: "up", b: "fake-producer" });
    edge.addFace(up);
    fib.addProducer(PRODUCER, up.id);
    const [agentFace, edgeSide] = linkFaces(clock, { a: "agent", b: "edge2:agent" });
    edge.addFace(edgeSide, { consumer: true });
    const got: Packet[] = [];
    agentFace.onReceive((p) => {
      got.push(p);
    });
    fake.onReceive(async (p) => {
      if (p.type !== "interest") return;
      const real = await s.producer.handleInterest(p.interest);
      fake.send({
        type: "data",
        nonce: p.interest.nonce,
        data: { ...real, content: { content: [{ type: "text", text: "evil" }] } },
      });
    });
    agentFace.send({ type: "interest", interest: await s.interest("fetch_page", { url: URL_A }) });
    await clock.runAll();
    expect(got[0]).toMatchObject({ type: "nack", code: "BAD_SIGNATURE" });
    expect(evilEvents).toContain("verify_fail");
    expect(evilEvents).not.toContain("cs_insert");
    expect(edge.cs.stats().entries).toBe(0);
  });

  it("MUST NOT cache errors (no negative caching) [P-7.2] [P-5.3]", async () => {
    const s = await setup();
    const a = s.agent("a");
    a.send({ type: "interest", interest: await s.interest("flaky", {}) });
    await s.clock.runAll();
    expect(dataOf(a.received[0]).content.isError).toBe(true);
    expect(dataOf(a.received[0]).meta.freshnessMs).toBe(0);
    a.send({ type: "interest", interest: await s.interest("flaky", {}) });
    await s.clock.runAll();
    expect(s.upstreamInterests()).toBe(2);
    expect(s.events.some((e) => e.kind === "cs_insert")).toBe(false);
  });

  it("MUST NOT cache a TIMEOUT: expiry nacks every waiter [P-7.2]", async () => {
    const s = await setup({ serviceTimeMs: 5_000 });
    const a = s.agent("a");
    const b = s.agent("b");
    a.send({
      type: "interest",
      interest: await s.interest("fetch_page", { url: URL_A }, { lifetimeMs: 1_000 }),
    });
    b.send({
      type: "interest",
      interest: await s.interest("fetch_page", { url: URL_A }, { lifetimeMs: 1_000 }),
    });
    await s.clock.runAll();
    expect(a.received[0]).toMatchObject({ type: "nack", code: "TIMEOUT" });
    expect(b.received[0]).toMatchObject({ type: "nack", code: "TIMEOUT" });
    expect(s.events.filter((e) => e.kind === "pit_expire")).toHaveLength(1);
    expect(s.events.some((e) => e.kind === "drop" && e.reason === "late")).toBe(false);
    expect(s.edge.cs.stats().entries).toBe(0);
  });

  it("MUST bound PIT entries and faces per entry; overflow is passthrough [P-7.3]", async () => {
    const s = await setup({ pit: { maxEntries: 1, maxFacesPerEntry: 2 } });
    const names = ["https://e.com/1", "https://e.com/2"];
    s.agent("a").send({ type: "interest", interest: await s.interest("fetch_page", { url: names[0] }) });
    s.agent("b").send({ type: "interest", interest: await s.interest("fetch_page", { url: names[1] }) });
    for (const id of ["c", "d"]) {
      s.agent(id).send({ type: "interest", interest: await s.interest("fetch_page", { url: names[0] }) });
    }
    await s.clock.runAll();
    for (const id of ["a", "b", "c", "d"]) expect(s.agent(id).received[0]?.type).toBe("data");
    // a creates the entry, c aggregates (2 faces), d overflows; b overflows maxEntries.
    expect(s.events.filter((e) => e.kind === "bypass" && e.reason === "pit_full")).toHaveLength(2);
    expect(s.upstreamInterests()).toBe(3);
  });

  it("MUST respect the CS byte budget, LRU by default [P-7.4]", async () => {
    const { dataBytes } = await import("./cs");
    const key = await keyPairFromSeed(new Uint8Array(32).fill(1));
    const mk = (i: number) =>
      signData(
        {
          name: `/idem/v1/p.dev/t/${"a".repeat(22)}/${String(i).padStart(43, "x")}`,
          content: { content: [{ type: "text", text: "y".repeat(100) }] },
          producedAt: 0,
          freshnessMs: 1,
          scope: "public",
          policyVersion: 1,
        },
        key,
      );
    const items: Data[] = [];
    for (let i = 0; i < 5; i++) items.push(await mk(i));
    const budget = Math.floor(dataBytes(items[0] as Data) * 2.5); // room for exactly two items
    const cs = new MemoryContentStore({ maxBytes: budget });
    cs.put("0", items[0] as Data, 0);
    cs.put("1", items[1] as Data, 0);
    cs.get("0", 0); // 0 is now most recently used
    const { evicted } = cs.put("2", items[2] as Data, 0);
    expect(cs.stats().bytes).toBeLessThanOrEqual(budget);
    expect(evicted.map((e) => e.key)).toEqual(["1"]);
    const fifo = new MemoryContentStore({ maxBytes: budget, policy: "fifo" });
    fifo.put("0", items[0] as Data, 0);
    fifo.put("1", items[1] as Data, 0);
    fifo.get("0", 0);
    expect(fifo.put("2", items[2] as Data, 0).evicted.map((e) => e.key)).toEqual(["0"]);
    const tiny = new MemoryContentStore({ maxBytes: 10 });
    expect(tiny.put("x", items[3] as Data, 0)).toEqual({ inserted: false, evicted: [] });
  });

  it("passes non-cacheable tools through without PIT/CS (bypass)", async () => {
    const s = await setup();
    const a = s.agent("a");
    a.send({ type: "call", id: "call-1", producer: PRODUCER, tool: "send_email", args: { to: "x@y.z" } });
    a.send({ type: "call", id: "call-2", producer: PRODUCER, tool: "send_email", args: { to: "x@y.z" } });
    await s.clock.runAll();
    expect(a.received.map((p) => p.type)).toEqual(["result", "result"]);
    expect(s.events.filter((e) => e.kind === "bypass")).toHaveLength(2);
    expect(s.edge.cs.stats().entries).toBe(0);
  });

  it("answers an Interest for a non-cacheable tool with NOT_CACHEABLE [P-4.2]", async () => {
    const s = await setup();
    const I = await s.interest("fetch_page", { url: URL_A });
    const forged = { ...I, name: I.name.replace("/fetch_page/", "/send_email/") };
    s.agent("a").send({ type: "interest", interest: forged });
    await s.clock.runAll();
    expect(s.agent("a").received[0]).toMatchObject({ type: "nack", code: "NOT_CACHEABLE" });
  });

  it("producer MUST recompute the name itself [P-5.1]", async () => {
    const s = await setup();
    const I = await s.interest("fetch_page", { url: URL_A });
    await expect(
      s.producer.handleInterest({ ...I, args: { url: "https://other.example/" } }),
    ).rejects.toMatchObject({
      code: "DIGEST_MISMATCH",
    });
  });

  it("producer MUST NOT use IDEM for multi-round-trip results [P-5.4]", async () => {
    const s = await setup();
    const { Producer } = await import("./producer");
    const p = new Producer({
      producer: PRODUCER,
      key: s.key,
      tools: [
        {
          name: "ask",
          inputSchema: { type: "object" },
          annotations: { readOnlyHint: true },
          policy: { cacheable: true, ttlMs: 1000, scope: "public" },
          handler: () => ({ content: [], resultType: "input_required" }),
        },
      ],
    });
    const { buildInterest } = await import("./consumer");
    const m = await p.manifest();
    const { interest } = await buildInterest({
      producer: PRODUCER,
      identity: p.identity("ask"),
      policy: m.tools[0] as never,
      args: {},
    });
    await expect(p.handleInterest(interest)).rejects.toMatchObject({ code: "NOT_CACHEABLE" });
  });

  it("ignores Data arriving from a face the Interest was not sent to", async () => {
    const s = await setup();
    const I = await s.interest("fetch_page", { url: URL_A });
    const a = s.agent("a");
    const attacker = s.agent("attacker");
    a.send({ type: "interest", interest: I });
    const forgedData = await s.producer.handleInterest(I);
    attacker.send({ type: "data", nonce: I.nonce, data: forgedData });
    await s.clock.runAll();
    expect(s.events.some((e) => e.kind === "drop" && e.reason === "unsolicited")).toBe(true);
    expect(a.received).toHaveLength(1);
  });
});

describe("freshness and scope (protocol §8)", () => {
  it("MUST track freshness with ageMs, like the HTTP Age header [P-8.1]", async () => {
    const s = await setup();
    const a = s.agent("a");
    a.send({ type: "interest", interest: await s.interest("weather", { city: " Rio " }) });
    await s.clock.runAll();
    const t0 = s.clock.now();
    await s.clock.runUntil(t0 + 400);
    a.send({ type: "interest", interest: await s.interest("weather", { city: "RIO" }) });
    await s.clock.runAll();
    const hit = dataOf(a.received[1]);
    expect(hit.ageMs).toBeGreaterThanOrEqual(400);
    expect(hit.ageMs).toBeLessThan(1_000);
    // After the 1 s freshness the entry is stale: a new upstream fetch happens.
    await s.clock.runUntil(s.clock.now() + 1_000);
    a.send({ type: "interest", interest: await s.interest("weather", { city: "rio" }) });
    await s.clock.runAll();
    expect(s.upstreamInterests()).toBe(2);
    expect(dataOf(a.received[2]).ageMs ?? 0).toBe(0);
  });

  it("MUST cap freshness at the manifest ttlMs [P-8.2]", async () => {
    const key = await keyPairFromSeed(new Uint8Array(32).fill(1));
    const d = await signData(
      {
        name: `/idem/v1/p.dev/t/${"a".repeat(22)}/${"b".repeat(43)}`,
        content: { content: [] },
        producedAt: 0,
        freshnessMs: 10_000,
        scope: "public",
        policyVersion: 1,
      },
      key,
    );
    const entry = { data: { ...d, ageMs: 100 }, receivedAt: 0 };
    expect(entryAge(entry, 50)).toBe(150);
    expect(isFresh(entry, 50)).toBe(true);
    expect(isFresh(entry, 50, 120)).toBe(false);
  });

  it("MUST NEVER serve a private result to another authorization context [P-8.3]", async () => {
    const s = await setup();
    const alice = s.agent("alice");
    const bob = s.agent("bob");
    // Concurrent: must not aggregate across users.
    alice.send({ type: "interest", interest: await s.interest("my_notes", {}), auth: "token-alice" });
    bob.send({ type: "interest", interest: await s.interest("my_notes", {}), auth: "token-bob" });
    await s.clock.runAll();
    expect(textOf(alice.received[0])).toBe("notes of token-alice");
    expect(textOf(bob.received[0])).toBe("notes of token-bob");
    expect(s.upstreamInterests()).toBe(2);
    // Later: each user hits only their own partition.
    bob.send({ type: "interest", interest: await s.interest("my_notes", {}), auth: "token-bob" });
    alice.send({ type: "interest", interest: await s.interest("my_notes", {}), auth: "token-alice" });
    await s.clock.runAll();
    expect(textOf(bob.received[1])).toBe("notes of token-bob");
    expect(textOf(alice.received[1])).toBe("notes of token-alice");
    expect(s.events.filter((e) => e.kind === "cs_hit")).toHaveLength(2);
    // Anonymous requests never touch the private CS nor aggregate.
    const anon = s.agent("anon");
    anon.send({ type: "interest", interest: await s.interest("my_notes", {}) });
    anon.send({ type: "interest", interest: await s.interest("my_notes", {}) });
    await s.clock.runAll();
    expect(anon.received.map(textOf)).toEqual(["notes of anonymous", "notes of anonymous"]);
    expect(s.upstreamInterests()).toBe(4);
  });

  it("MUST NOT store private Data beyond the edge [P-8.3]", async () => {
    // agents → edge → regional → producer: the regional never sees an authContext.
    const s = await setup();
    const clock = s.clock;
    const regionalEvents: string[] = [];
    const fib = new Fib();
    const regional = new Forwarder({
      id: "regional",
      clock,
      fib,
      trust: s.trust,
      onEvent: (e) => regionalEvents.push(e.kind),
    });
    const [rUp, rUpPeer] = linkFaces(clock, { a: "regional→producer", b: "p2" });
    regional.addFace(rUp);
    fib.addProducer(PRODUCER, rUp.id);
    s.producer.serve(rUpPeer, { clock });
    // The regional's downstream is "the edge" (not a consumer face).
    const [edgeSide, regionalSide] = linkFaces(clock, { a: "edge-out", b: "regional-in" });
    regional.addFace(regionalSide);
    const got: Packet[] = [];
    edgeSide.onReceive((p) => {
      got.push(p);
    });
    for (const auth of ["token-alice", "token-bob"]) {
      const I = await s.interest("my_notes", {});
      edgeSide.send({ type: "interest", interest: { ...I, authContext: "forged-ac" }, auth });
    }
    await clock.runAll();
    expect(got.map(textOf).sort()).toEqual(["notes of token-alice", "notes of token-bob"]);
    expect(regional.cs.stats().entries).toBe(0);
    expect(regionalEvents).not.toContain("pit_aggregate");
  });

  it("MUST strip authContext before forwarding upstream [P-8.4]", async () => {
    const s = await setup();
    s.agent("a").send({ type: "interest", interest: await s.interest("my_notes", {}), auth: "token-a" });
    await s.clock.runAll();
    const up = s.upstreamPackets.find((p) => p.type === "interest");
    expect(up?.type === "interest" && up.interest.authContext).toBeUndefined();
  });

  it("MUST reject Data whose signed scope is stricter than the manifest [P-8.5]", async () => {
    const clock = new VirtualClock();
    const s = await setup();
    const fib = new Fib();
    const events: string[] = [];
    const edge = new Forwarder({
      id: "e",
      clock,
      fib,
      trust: s.trust,
      onEvent: (e) => events.push(("reason" in e ? e.reason : undefined) ?? e.kind),
    });
    const [up, prod] = linkFaces(clock, { a: "up", b: "prod" });
    edge.addFace(up);
    fib.addProducer(PRODUCER, up.id);
    prod.onReceive(async (p) => {
      if (p.type !== "interest") return;
      const d = await signData(
        {
          name: p.interest.name,
          content: { content: [] },
          producedAt: 0,
          freshnessMs: 10,
          scope: "private",
          policyVersion: 1,
        },
        s.key,
      );
      prod.send({ type: "data", nonce: p.interest.nonce, data: d });
    });
    const [ag, edgeSide] = linkFaces(clock, { a: "ag", b: "e:ag" });
    edge.addFace(edgeSide, { consumer: true });
    const got: Packet[] = [];
    ag.onReceive((p) => {
      got.push(p);
    });
    ag.send({ type: "interest", interest: await s.interest("fetch_page", { url: URL_A }) });
    await clock.runAll();
    expect(got[0]).toMatchObject({ type: "nack", code: "BAD_SIGNATURE" });
    expect(events).toContain("scope_mismatch");
  });

  it("an untrusted manifest makes every tool non-cacheable", async () => {
    const clock = new VirtualClock();
    const edge = new Forwarder({ id: "e", clock, fib: new Fib(), trust: new TrustStore() });
    const s = await setup();
    const [ag, side] = linkFaces(clock, { a: "ag", b: "side" });
    edge.addFace(side, { consumer: true });
    const got: Packet[] = [];
    ag.onReceive((p) => {
      got.push(p);
    });
    ag.send({ type: "interest", interest: await s.interest("fetch_page", { url: URL_A }) });
    await clock.runAll();
    expect(got[0]).toMatchObject({ type: "nack", code: "NOT_CACHEABLE" });
  });
});

describe("authContext is the edge's own (protocol §8)", () => {
  it("MUST derive authContext itself and ignore one carried by a received Interest [P-8.4]", async () => {
    const { deriveAuthContext } = await import("./crypto");
    const s = await setup();
    const alice = s.agent("alice");
    alice.send({ type: "interest", interest: await s.interest("my_notes", {}), auth: "token-alice" });
    await s.clock.runAll();
    const victim = await deriveAuthContext("edge-secret", "token-alice");
    // Mallory knows Alice's value and puts it in her own Interest, with and without a credential.
    const mallory = s.agent("mallory");
    mallory.send({
      type: "interest",
      interest: { ...(await s.interest("my_notes", {})), authContext: victim },
      auth: "token-mallory",
    });
    mallory.send({
      type: "interest",
      interest: { ...(await s.interest("my_notes", {})), authContext: victim },
    });
    await s.clock.runAll();
    expect(mallory.received.map(textOf).sort()).toEqual(["notes of anonymous", "notes of token-mallory"]);
    expect(s.events.filter((e) => e.kind === "cs_hit")).toHaveLength(0);
    // A garbage value does not move Alice out of her own partition either.
    alice.send({
      type: "interest",
      interest: { ...(await s.interest("my_notes", {})), authContext: "garbage" },
      auth: "token-alice",
    });
    await s.clock.runAll();
    expect(textOf(alice.received[1])).toBe("notes of token-alice");
    expect(s.events.filter((e) => e.kind === "cs_hit")).toHaveLength(1);
  });
});

describe("signed lifetime at the forwarder (protocol §8)", () => {
  /** An edge whose upstream answers every Interest with `make(interest, now)`. */
  async function rigged(
    make: (name: string, now: number) => { producedAt: number; ageMs?: number },
    opts: Partial<ForwarderOptions> = {},
  ) {
    const s = await setup();
    const clock = s.clock;
    const fib = new Fib();
    const events: { kind: string; reason?: string }[] = [];
    const edge = new Forwarder({
      id: "e",
      clock,
      fib,
      trust: s.trust,
      onEvent: (e) => events.push(e as never),
      ...opts,
    });
    const [up, prod] = linkFaces(clock, { a: "up", b: "prod" });
    edge.addFace(up);
    fib.addProducer(PRODUCER, up.id);
    let upstream = 0;
    prod.onReceive(async (p) => {
      if (p.type !== "interest") return;
      upstream++;
      const { producedAt, ageMs } = make(p.interest.name, clock.now());
      const d = await signData(
        {
          name: p.interest.name,
          content: { content: [{ type: "text", text: `made at ${producedAt}` }] },
          producedAt,
          freshnessMs: 60_000,
          scope: "public",
          policyVersion: 1,
        },
        s.key,
      );
      prod.send({ type: "data", nonce: p.interest.nonce, data: ageMs === undefined ? d : { ...d, ageMs } });
    });
    const agent = (id: string) => {
      const [ag, side] = linkFaces(clock, { a: id, b: `e:${id}` });
      edge.addFace(side, { consumer: true });
      const got: Packet[] = [];
      ag.onReceive((p) => {
        got.push(p);
      });
      return { send: (p: Packet) => ag.send(p), got };
    };
    return { s, edge, events, agent, upstream: () => upstream };
  }
  const LIFE = 60_000 + 60_000; // freshness (= manifest TTL) + default tolerance

  it("MUST NOT cache expired upstream Data; fresh waiters get EXPIRED, stale-ok waiters the Data [P-8.6]", async () => {
    const r = await rigged((_n, now) => ({ producedAt: now - LIFE }));
    await r.s.clock.runUntil(500_000);
    const a = r.agent("a");
    const b = r.agent("b");
    const I = await r.s.interest("fetch_page", { url: URL_A });
    a.send({ type: "interest", interest: I });
    b.send({
      type: "interest",
      interest: { ...(await r.s.interest("fetch_page", { url: URL_A })), mustBeFresh: false },
    });
    await r.s.clock.runAll();
    expect(r.upstream()).toBe(1); // b aggregated into a's entry
    expect(a.got[0]).toMatchObject({ type: "nack", code: "EXPIRED" });
    expect((a.got[0] as { message?: string }).message).toMatch(/past its signed lifetime/);
    expect(b.got[0]?.type).toBe("data");
    expect(r.edge.cs.stats().entries).toBe(0);
    expect(r.events).toContainEqual(expect.objectContaining({ kind: "drop", reason: "expired" }));
    expect(r.events.some((e) => e.kind === "cs_insert")).toBe(false);
  });

  it("MUST treat Data dated beyond the tolerance in the future as outside its lifetime [P-8.6]", async () => {
    const r = await rigged((_n, now) => ({ producedAt: now + 60_000 + 1_000 }));
    const a = r.agent("a");
    a.send({ type: "interest", interest: await r.s.interest("fetch_page", { url: URL_A }) });
    await r.s.clock.runAll();
    expect(a.got[0]).toMatchObject({ type: "nack", code: "EXPIRED" });
    expect((a.got[0] as { message?: string }).message).toMatch(/future/);
    expect(r.edge.cs.stats().entries).toBe(0);
  });

  it("MUST NOT serve a CS entry past its signed lifetime, whatever its ageMs [P-8.6] [P-8.1]", async () => {
    // Inside its lifetime by 2 s when it arrives, with an understated ageMs of 0.
    const r = await rigged((_n, now) => ({ producedAt: now - LIFE + 2_000, ageMs: 0 }));
    await r.s.clock.runUntil(500_000);
    const a = r.agent("a");
    a.send({ type: "interest", interest: await r.s.interest("fetch_page", { url: URL_A }) });
    await r.s.clock.runAll();
    expect(a.got[0]?.type).toBe("data");
    expect(r.edge.cs.stats().entries).toBe(1);
    // 3 s later: fresh by ageMs (3 s < 60 s), but outside the signed lifetime.
    await r.s.clock.runUntil(r.s.clock.now() + 3_000);
    a.send({ type: "interest", interest: await r.s.interest("fetch_page", { url: URL_A }) });
    await r.s.clock.runAll();
    expect(r.upstream()).toBe(2);
    expect(r.events.filter((e) => e.kind === "cs_hit")).toHaveLength(0);
    // mustBeFresh: false may be answered from any entry, expired included.
    await r.s.clock.runUntil(r.s.clock.now() + 200_000);
    a.send({
      type: "interest",
      interest: { ...(await r.s.interest("fetch_page", { url: URL_A })), mustBeFresh: false },
    });
    await r.s.clock.runAll();
    expect(r.events.filter((e) => e.kind === "cs_hit")).toHaveLength(1);
    expect(r.upstream()).toBe(2);
  });

  it("serves Data past its freshness but inside the tolerance (the bounded-staleness limit) [P-8.6]", async () => {
    const r = await rigged((_n, now) => ({ producedAt: now - 60_000 - 30_000 }));
    await r.s.clock.runUntil(500_000);
    const a = r.agent("a");
    a.send({ type: "interest", interest: await r.s.interest("fetch_page", { url: URL_A }) });
    await r.s.clock.runAll();
    expect(a.got[0]?.type).toBe("data");
    expect(r.edge.cs.stats().entries).toBe(1);
  });

  it("MUST NOT hand a fresh waiter Data stale by ageMs, whatever the other Interests of its entry asked [P-8.1] [P-8.6]", async () => {
    // Upstream, a cache answers the entry's stale-ok Interest from an entry 20 s past its
    // freshness: inside the signed lifetime (tolerance 60 s), stale by its hop-relative age.
    const r = await rigged((_n, now) => ({ producedAt: now - 80_000, ageMs: 80_000 }));
    await r.s.clock.runUntil(500_000);
    const staleOk = r.agent("stale-ok");
    const fresh = r.agent("fresh");
    staleOk.send({
      type: "interest",
      interest: { ...(await r.s.interest("fetch_page", { url: URL_A })), mustBeFresh: false },
    });
    fresh.send({ type: "interest", interest: await r.s.interest("fetch_page", { url: URL_A }) });
    await r.s.clock.runAll();
    expect(r.upstream()).toBe(1); // the fresh Interest aggregated onto the stale-ok one
    expect(staleOk.got[0]?.type).toBe("data");
    expect(fresh.got[0]).toMatchObject({ type: "nack", code: "EXPIRED" });
    expect((fresh.got[0] as { message?: string }).message).toMatch(/stale by its age/);
    expect(r.events).toContainEqual(expect.objectContaining({ kind: "drop", reason: "stale" }));
    // Stored (it is within its signed lifetime), but never a fresh hit.
    fresh.send({ type: "interest", interest: await r.s.interest("fetch_page", { url: URL_A }) });
    await r.s.clock.runAll();
    expect(r.events.filter((e) => e.kind === "cs_hit")).toHaveLength(0);
    expect(r.upstream()).toBe(2);
  });

  it("MUST apply the signed lifetime and the age rule to a pit_full passthrough too [P-7.3] [P-8.6]", async () => {
    const limits = { pit: { maxEntries: 1, maxFacesPerEntry: 1 } };
    // A genuine Data ten minutes old: the first waiter's entry and the passthrough both refuse it.
    const old = await rigged((_n, now) => ({ producedAt: now - 600_000 }), limits);
    await old.s.clock.runUntil(1_000_000);
    const [a1, a2, a3] = ["a1", "a2", "a3"].map((id) => old.agent(id));
    a1?.send({ type: "interest", interest: await old.s.interest("fetch_page", { url: URL_A }) });
    a2?.send({ type: "interest", interest: await old.s.interest("fetch_page", { url: URL_A }) });
    a3?.send({
      type: "interest",
      interest: { ...(await old.s.interest("fetch_page", { url: URL_A })), mustBeFresh: false },
    });
    await old.s.clock.runAll();
    expect(old.events.filter((e) => e.kind === "bypass" && e.reason === "pit_full")).toHaveLength(2);
    expect(a1?.got[0]).toMatchObject({ type: "nack", code: "EXPIRED" });
    expect(a2?.got[0]).toMatchObject({ type: "nack", code: "EXPIRED" });
    expect(a3?.got[0]?.type).toBe("data"); // mustBeFresh: false may receive it
    // Stale by ageMs through the passthrough: the same refusal.
    const stale = await rigged((_n, now) => ({ producedAt: now - 80_000, ageMs: 80_000 }), limits);
    await stale.s.clock.runUntil(500_000);
    const [b1, b2] = ["b1", "b2"].map((id) => stale.agent(id));
    b1?.send({
      type: "interest",
      interest: { ...(await stale.s.interest("fetch_page", { url: URL_A })), mustBeFresh: false },
    });
    b2?.send({ type: "interest", interest: await stale.s.interest("fetch_page", { url: URL_A }) });
    await stale.s.clock.runAll();
    expect(b1?.got[0]?.type).toBe("data");
    expect(b2?.got[0]).toMatchObject({ type: "nack", code: "EXPIRED" });
  });

  it("rejects a negative clock tolerance", async () => {
    const s = await setup();
    expect(
      () => new Forwarder({ id: "x", clock: s.clock, fib: new Fib(), trust: s.trust, clockToleranceMs: -1 }),
    ).toThrow(/clockToleranceMs/);
  });
});
