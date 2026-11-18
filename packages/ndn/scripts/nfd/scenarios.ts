// The NFD check scenarios (spec/tasks/ndn.md, protocol §9.2). Each returns PASS/FAIL with the checks
// it made and the raw counters behind them; nothing is asserted here, so the CLI can record failures.
import {
  type Data,
  type IdemKeyPair,
  type Interest,
  jcs,
  keyLocator,
  sha256,
  signData,
  stripEphemeral,
  utf8,
} from "@idem/core";
import { Data as NdnData, type Interest as NdnInterest } from "@ndn/packet";
import {
  CONTENT_TYPE,
  dataFromWire,
  decodeData,
  encodeData,
  encodeInterest,
  MAX_PACKET_SIZE,
  toWire,
} from "../../src/codec";
import { ndnSigner, producerSigner } from "../../src/keys";
import { toNdnName } from "../../src/name";
import { verifyNdnData } from "../../src/verify";
import {
  type CsInfo,
  csInfo,
  eraseCs,
  type FaceCounters,
  faceDelta,
  faces,
  idemInterest,
  keyFromSeed,
  type LiveConsumer,
  type LiveProducer,
  type NfdCheckConfig,
  newFaces,
  offlineProducer,
  routeEdgesToRegional,
  sleep,
  startConsumer,
  startProducer,
  startRogue,
} from "./harness";

/** One check of a scenario. */
export interface Check {
  name: string;
  expected: unknown;
  actual: unknown;
  pass: boolean;
}

/** Outcome of one scenario. */
export interface ScenarioResult {
  id: string;
  title: string;
  /** Protocol rules the scenario exercises. */
  rules: string[];
  pass: boolean;
  checks: Check[];
  evidence: Record<string, unknown>;
  durationMs: number;
  error?: string;
}

/** Shared state: the main producer on edge1 and the keys. */
export interface World {
  cfg: NfdCheckConfig;
  key: IdemKeyPair;
  attacker: IdemKeyPair;
  producer: LiveProducer;
}

/** JSON with sorted object keys, so equality ignores key order (`undefined` → `null`). */
function stable(v: unknown): string {
  if (v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

class Recorder {
  readonly checks: Check[] = [];
  readonly evidence: Record<string, unknown> = {};
  eq(name: string, actual: unknown, expected: unknown): void {
    this.checks.push({ name, expected, actual, pass: stable(actual) === stable(expected) });
  }
  ok(name: string, cond: boolean, actual: unknown = cond): void {
    this.checks.push({ name, expected: true, actual, pass: cond });
  }
  ev(k: string, v: unknown): void {
    this.evidence[k] = v;
  }
}

type Body = (w: World, r: Recorder, cleanup: (fn: () => void) => void) => Promise<void>;

interface Scenario {
  id: string;
  title: string;
  rules: string[];
  body: Body;
}

/** NDN name of the Interest `I` encodes to (IDEM name + ParametersSha256DigestComponent). */
async function ndnNameOf(I: Interest): Promise<NdnInterest["name"]> {
  return (await encodeInterest(I)).name;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** NDN TLV-LENGTH (VAR-NUMBER) of `n`. */
function varNum(n: number): number[] {
  if (n < 253) return [n];
  if (n <= 0xffff) return [253, n >> 8, n & 0xff];
  return [254, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

/**
 * ParametersSha256DigestComponent of an unsigned Interest whose ApplicationParameters are `params`,
 * computed by hand (NDN packet format v0.3: SHA-256 over the ApplicationParameters TLV), so the
 * check does not reuse NDNts' own code.
 */
async function paramsDigestHex(params: Uint8Array): Promise<string> {
  const tlv = new Uint8Array([0x24, ...varNum(params.length), ...params]);
  return hex(await sha256(tlv));
}

const sum = (fs: FaceCounters[], k: keyof Omit<FaceCounters, "id" | "remote">) =>
  fs.reduce((a, f) => a + f[k], 0);

const csDelta = (a: CsInfo, b: CsInfo) => ({ hits: b.hits - a.hits, misses: b.misses - a.misses });

function edge1(w: World): string {
  return w.cfg.forwarders.edge1.container;
}

async function consumers(w: World, n: number, transport: "tcp" | "udp" | "ws" = "tcp") {
  const out: LiveConsumer[] = [];
  for (let i = 0; i < n; i++) {
    const c = await startConsumer(w.cfg, "edge1", w.cfg.producer, transport);
    await c.consumer.init();
    out.push(c);
  }
  return out;
}

/** Genuine native Data for `interest`, made offline with the producer's key (handler counted apart). */
async function genuine(w: World, tool: string, args: unknown, auth?: string) {
  const off = await offlineProducer(w.cfg, w.cfg.producer, w.key);
  const I = await idemInterest(off.producer, tool, args);
  const data = await off.producer.handleInterest(I, auth !== undefined ? { auth } : {});
  return { I, data, off };
}

/** A native Data packet for `data` without encodeData's scope check (a producer that ignores [P-9.4]). */
async function rawNative(data: Data, name: NdnInterest["name"], sign: (p: NdnData) => Promise<void>) {
  const pkt = new NdnData(
    name,
    NdnData.ContentType(CONTENT_TYPE.blob),
    NdnData.FreshnessPeriod(data.meta.freshnessMs),
    utf8(jcs({ content: stripEphemeral(data.content), meta: data.meta, signature: data.signature })),
  );
  await sign(pkt);
  return pkt;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "S1",
    title: "Round trip: manifest bootstrap, one call, both signatures, name = IDEM name + PSDC",
    rules: ["P-9.1", "P-9.3", "P-6.2"],
    async body(w, r, cleanup) {
      const c = await startConsumer(w.cfg, "edge1", w.cfg.producer);
      cleanup(() => c.close());
      const boot = await c.consumer.init();
      r.eq(
        "manifest fetched over NFD = the producer's manifest",
        boot.manifest,
        await w.producer.producer.manifest(),
      );
      r.eq(
        "tool list fetched over NFD",
        boot.tools.map((t) => t.name),
        w.producer.producer.toolList().map((t) => t.name),
      );
      const args = { url: "https://corpus.idem.dev/doc/1" };
      const I = await idemInterest(w.producer.producer, "fetch_page", args);
      const expectedNdn = `${I.name}/params-sha256=${await paramsDigestHex(utf8(jcs(I.args)))}`;
      const before = {
        f: await faces(edge1(w)),
        cs: await csInfo(edge1(w)),
        runs: w.producer.counters.fetch_page ?? 0,
      };
      const out = await c.consumer.call("fetch_page", args);
      const after = {
        f: await faces(edge1(w)),
        cs: await csInfo(edge1(w)),
        runs: w.producer.counters.fetch_page ?? 0,
      };
      r.eq("no error", out.error, undefined);
      r.eq("NDN (outer) signature verifies", out.verify?.outer.ok, true);
      r.eq("IDEM (inner) signature and contentDigest verify", out.verify?.inner.ok, true);
      r.eq("content", out.result.content, [{ type: "text", text: `page ${args.url}` }]);
      r.eq("IDEM name = core's overlay name", out.name, I.name);
      r.eq("Data name = Interest name", out.data?.name, I.name);
      r.eq("NDN name = IDEM name + hand-computed ParametersSha256DigestComponent", out.ndnName, expectedNdn);
      r.eq(
        "outer KeyLocator = IDEM key locator",
        out.verify?.outer.ok ? out.verify.outer.keyLocator : undefined,
        keyLocator(w.cfg.producer, w.key.keyId),
      );
      r.eq("tool ran once", after.runs - before.runs, 1);
      r.eq(
        "NFD sent 1 Interest to the producer face",
        faceDelta(before.f, after.f, w.producer.nfdFaceId).outI,
        1,
      );
      // The same Interest again, by hand, to read the packet NFD returns (served from its CS).
      const pkt = await c.raw(I);
      r.eq("FreshnessPeriod = manifest TTL", pkt.freshnessPeriod, w.cfg.ttlMs);
      r.eq("ContentType BLOB", pkt.contentType, CONTENT_TYPE.blob);
      r.ok("packet within MAX_PACKET_SIZE", toWire(pkt).length <= MAX_PACKET_SIZE, toWire(pkt).length);
      r.ev("ndnName", out.ndnName);
      r.ev("dataBytes", toWire(pkt).length);
      r.ev("producerFace", faceDelta(before.f, after.f, w.producer.nfdFaceId));
      r.ev("cs", csDelta(before.cs, after.cs));
    },
  },
  {
    id: "S2",
    title: "PIT aggregation: N concurrent identical calls on N faces, the tool runs once",
    rules: ["P-9.1", "P-9.3"],
    async body(w, r, cleanup) {
      const f0 = await faces(edge1(w));
      const cs = await consumers(w, w.cfg.consumers);
      cleanup(() => {
        for (const c of cs) c.close();
      });
      const args = { url: "https://corpus.idem.dev/doc/2" };
      const before = {
        f: await faces(edge1(w)),
        cs: await csInfo(edge1(w)),
        runs: w.producer.counters.fetch_page ?? 0,
      };
      const outs = await Promise.all(cs.map((c) => c.consumer.call("fetch_page", args)));
      const after = {
        f: await faces(edge1(w)),
        cs: await csInfo(edge1(w)),
        runs: w.producer.counters.fetch_page ?? 0,
      };
      const mine = newFaces(f0, after.f).filter((f) => f.id !== w.producer.nfdFaceId);
      const own = mine.map((f) => faceDelta(before.f, after.f, f.id));
      r.eq("consumer faces at NFD", mine.length, w.cfg.consumers);
      r.eq(
        "every consumer got verified Data",
        outs.filter((o) => o.verify?.ok === true).length,
        w.cfg.consumers,
      );
      r.eq("one NDN name", new Set(outs.map((o) => o.ndnName)).size, 1);
      r.eq(
        "NFD received N Interests from the consumer faces",
        own.reduce((a, d) => a + d.inI, 0),
        w.cfg.consumers,
      );
      r.eq(
        "NFD returned N Data to the consumer faces",
        own.reduce((a, d) => a + d.outD, 0),
        w.cfg.consumers,
      );
      r.eq(
        "NFD forwarded 1 Interest to the producer",
        faceDelta(before.f, after.f, w.producer.nfdFaceId).outI,
        1,
      );
      r.eq("tool ran once", after.runs - before.runs, 1);
      r.ev("consumerFaces", own);
      r.ev("producerFace", faceDelta(before.f, after.f, w.producer.nfdFaceId));
      r.ev("cs", csDelta(before.cs, after.cs));
      r.ev("signatures", new Set(outs.map((o) => o.data?.signature.value)).size);
    },
  },
  {
    id: "S3",
    title: "Content Store and freshness: repeat from CS; MustBeFresh goes upstream after the TTL",
    rules: ["P-9.1", "P-5.3"],
    async body(w, r, cleanup) {
      const [c] = await consumers(w, 1);
      if (!c) throw new Error("no consumer");
      cleanup(() => c.close());
      const E = edge1(w);
      // NFD's CS misses also count NFD's own management traffic; hits and upstream Interests do not.
      const step = async (label: string, fn: () => Promise<unknown>, tool = "quick") => {
        const runs = () => w.producer.counters[tool] ?? 0;
        const b = { f: await faces(E), cs: await csInfo(E), runs: runs(), t: Date.now() };
        const out = await fn();
        const a = { f: await faces(E), cs: await csInfo(E), runs: runs() };
        const d = {
          label,
          tool,
          atMs: b.t,
          runs: a.runs - b.runs,
          upstream: faceDelta(b.f, a.f, w.producer.nfdFaceId).outI,
          ...csDelta(b.cs, a.cs),
        };
        return { out, d };
      };
      const args = { q: "freshness" };
      const s1 = await step("first call", () => c.consumer.call("quick", args));
      const s2 = await step("repeat at once", () => c.consumer.call("quick", args));
      const o1 = s1.out as Awaited<ReturnType<typeof c.consumer.call>>;
      const o2 = s2.out as Awaited<ReturnType<typeof c.consumer.call>>;
      r.eq("first call: verified", o1.verify?.ok, true);
      r.eq("first call: tool ran, 1 Interest upstream", [s1.d.runs, s1.d.upstream], [1, 1]);
      r.eq("repeat: verified", o2.verify?.ok, true);
      r.eq("repeat: CS hit, no tool run, nothing upstream", [s2.d.hits, s2.d.runs, s2.d.upstream], [1, 0, 0]);
      r.eq("repeat: the very same signed Data", o2.data?.signature.value, o1.data?.signature.value);
      await sleep(w.cfg.shortTtlMs + 500);
      const s3 = await step("MustBeFresh after the TTL", () => c.consumer.call("quick", args));
      const o3 = s3.out as Awaited<ReturnType<typeof c.consumer.call>>;
      r.eq("after TTL: verified", o3.verify?.ok, true);
      r.eq(
        "after TTL: stale CS entry not used, tool ran again",
        [s3.d.hits, s3.d.runs, s3.d.upstream],
        [0, 1, 1],
      );
      r.ok("after TTL: newer producedAt", (o3.data?.meta.producedAt ?? 0) > (o1.data?.meta.producedAt ?? 0));
      await sleep(w.cfg.shortTtlMs + 500);
      // NDN semantics the binding relies on: without MustBeFresh, NFD serves stale Data. NdnConsumer
      // always sets MustBeFresh (core INTEREST_DEFAULTS); a hand-made Interest shows why it must.
      const I = await idemInterest(w.producer.producer, "quick", args, { mustBeFresh: false });
      const s4 = await step("no MustBeFresh after the TTL", () => c.raw(I));
      const stale = decodeData(s4.out as NdnData);
      const age = stale.kind === "data" ? Date.now() - stale.data.meta.producedAt : -1;
      r.eq(
        "without MustBeFresh: stale Data from CS, no tool run",
        [s4.d.hits, s4.d.runs, s4.d.upstream],
        [1, 0, 0],
      );
      r.ok("without MustBeFresh: the Data is older than its TTL", age > w.cfg.shortTtlMs, age);
      // Error results carry freshness 0 [P-5.3]: never answered from CS to a MustBeFresh Interest.
      const missing = { url: "https://corpus.idem.dev/missing" };
      const e1 = await step("isError result", () => c.consumer.call("fetch_page", missing), "fetch_page");
      const e2 = await step("isError repeat", () => c.consumer.call("fetch_page", missing), "fetch_page");
      r.eq("isError: FreshnessPeriod 0", (e1.out as typeof o1).data?.meta.freshnessMs, 0);
      r.eq(
        "isError repeat: not served from CS, tool ran again",
        [e2.d.hits, e2.d.runs, e2.d.upstream],
        [0, 1, 1],
      );
      r.ev("steps", [s1.d, s2.d, s3.d, s4.d, e1.d, e2.d]);
      r.ev("ttlMs", w.cfg.shortTtlMs);
    },
  },
  {
    id: "S4",
    title: "Equivalent spellings: one name, shared PIT entry and CS entry",
    rules: ["P-2.1", "P-9.1"],
    async body(w, r, cleanup) {
      const spellings = [
        "https://corpus.idem.dev/doc/4?a=1&b=2",
        "https://CORPUS.idem.dev:443/doc/4?b=2&a=1",
        "https://corpus.idem.dev/doc/4?b=2&a=1#intro",
        "HTTPS://corpus.IDEM.dev/doc/4?a=1&b=2",
      ];
      const cs = await consumers(w, spellings.length + 1);
      cleanup(() => {
        for (const c of cs) c.close();
      });
      const E = edge1(w);
      const b = { f: await faces(E), cs: await csInfo(E), runs: w.producer.counters.fetch_page ?? 0 };
      const outs = await Promise.all(spellings.map((url, i) => cs[i]?.consumer.call("fetch_page", { url })));
      const m = { f: await faces(E), cs: await csInfo(E), runs: w.producer.counters.fetch_page ?? 0 };
      const late = await cs[spellings.length]?.consumer.call("fetch_page", {
        url: "https://corpus.idem.dev:443/doc/4?b=2&a=1",
      });
      const a = { cs: await csInfo(E), runs: w.producer.counters.fetch_page ?? 0 };
      r.eq("all verified", outs.filter((o) => o?.verify?.ok).length, spellings.length);
      r.eq("one NDN name for every spelling", new Set(outs.map((o) => o?.ndnName)).size, 1);
      r.eq("concurrent spellings: tool ran once", m.runs - b.runs, 1);
      r.eq("concurrent spellings: 1 Interest upstream", faceDelta(b.f, m.f, w.producer.nfdFaceId).outI, 1);
      r.eq("later spelling: same name", late?.ndnName, outs[0]?.ndnName);
      r.eq("later spelling: CS hit, tool not run", [csDelta(m.cs, a.cs).hits, a.runs - m.runs], [1, 0]);
      r.ev("ndnName", outs[0]?.ndnName);
      r.ev("spellings", spellings);
    },
  },
  {
    id: "S5",
    title: "private never on NDN: not sent, Nacked without running, rejected if it ever arrives",
    rules: ["P-9.4", "P-8.3"],
    async body(w, r, cleanup) {
      const E = edge1(w);
      const f0 = await faces(E);
      const [alice, bob, carol] = await consumers(w, 3);
      if (!alice || !bob || !carol) throw new Error("no consumers");
      cleanup(() => {
        for (const c of [alice, bob, carol]) c.close();
      });
      const f1 = await faces(E);
      const aliceFace = newFaces(f0, f1).sort((x, y) => x.id - y.id)[0]?.id ?? -1;
      // (a) The consumer refuses to express the Interest.
      const a = await alice.consumer.call("my_notes", {});
      const f2 = await faces(E);
      r.eq("consumer: NOT_CACHEABLE without sending", a.error?.code, "NOT_CACHEABLE");
      r.eq("consumer: no Interest reached NFD from its face", faceDelta(f1, f2, aliceFace).inI, 0);
      r.eq("consumer: no content", a.data, undefined);
      // (b) A hand-made Interest reaches the producer: Nack, handler never runs.
      const I = await idemInterest(w.producer.producer, "my_notes", {});
      const nack = decodeData(await bob.raw(I));
      const f3 = await faces(E);
      r.eq("producer: NOT_CACHEABLE Nack", nack.kind === "nack" ? nack.code : nack.kind, "NOT_CACHEABLE");
      r.eq("producer: Interest did reach it", faceDelta(f2, f3, w.producer.nfdFaceId).outI, 1);
      r.eq("producer: private tool never ran", w.producer.counters.my_notes ?? 0, 0);
      // (c) A producer that ignores [P-9.4] (here: a rogue face with the producer's key) answers
      // alice's notes natively. NFD caches them by name; the consumer check is what stops the leak.
      const g = await genuine(w, "my_notes", {}, "alice");
      r.eq("crafted Data is signed private", g.data.meta.scope, "private");
      const signer = producerSigner(w.cfg.producer, w.key);
      const rogue = await startRogue(w.cfg, "edge1", toNdnName(I.name), async (i) =>
        rawNative(g.data, i.name, (p) => signer.sign(p)),
      );
      cleanup(() => rogue.close());
      const leaked = await bob.raw(I);
      const v = await verifyNdnData(leaked, bob.consumer.trust);
      r.eq("bob: both signatures are valid", [v.outer.ok, v.inner.ok], [true, true]);
      r.eq("bob: rejected as private (NOT_CACHEABLE)", [v.ok, v.code], [false, "NOT_CACHEABLE"]);
      rogue.close();
      const cs0 = await csInfo(E);
      const again = await carol.raw(I);
      const cs1 = await csInfo(E);
      const v2 = await verifyNdnData(again, carol.consumer.trust);
      r.eq("carol: NFD served alice's private Data from its CS", csDelta(cs0, cs1).hits, 1);
      r.eq("carol: rejected as private (NOT_CACHEABLE)", [v2.ok, v2.code], [false, "NOT_CACHEABLE"]);
      r.eq("private tool still never ran on the real producer", w.producer.counters.my_notes ?? 0, 0);
      r.ev("rogueHits", rogue.hits());
      r.ev("leakedContent", v2.data?.content.content);
    },
  },
  {
    id: "S6",
    title: "Tampering on the path: altered Data is rejected; NFD caches it until it goes stale",
    rules: ["P-9.3", "P-5.5"],
    async body(w, r, cleanup) {
      const E = edge1(w);
      const runs = () => w.producer.counters.fetch_page ?? 0;
      const variants: { id: string; expect: string; make: (good: NdnData) => Promise<NdnData> }[] = [
        {
          id: "flipped-byte",
          expect: "BAD_SIGNATURE",
          async make(good) {
            const wire = toWire(good);
            const at = Buffer.from(wire).indexOf("page https");
            const bad = Uint8Array.from(wire);
            bad[at] = "P".charCodeAt(0);
            return dataFromWire(bad);
          },
        },
        {
          id: "re-signed-outer-wrong-key",
          expect: "BAD_SIGNATURE",
          async make(good) {
            const d = decodeData(good);
            if (d.kind !== "data") throw new Error("nack");
            const forged = {
              ...d.data,
              content: { content: [{ type: "text" as const, text: "page evil" }] },
            };
            return rawNative(forged, good.name, (p) =>
              ndnSigner(w.attacker.privateKey, toNdnName(keyLocator(w.cfg.producer, w.key.keyId))).sign(p),
            );
          },
        },
        {
          id: "re-signed-both-attacker-key",
          expect: "UNTRUSTED_KEY",
          async make(good) {
            const d = decodeData(good);
            if (d.kind !== "data") throw new Error("nack");
            const forged = await signData(
              {
                name: d.data.name,
                content: { content: [{ type: "text", text: "page evil" }] },
                producedAt: d.data.meta.producedAt,
                freshnessMs: d.data.meta.freshnessMs,
                scope: "public",
                policyVersion: d.data.meta.policyVersion,
              },
              { ...w.attacker, keyId: w.attacker.keyId },
            );
            return rawNative(forged, good.name, (p) =>
              ndnSigner(w.attacker.privateKey, toNdnName(keyLocator(w.cfg.producer, w.attacker.keyId))).sign(
                p,
              ),
            );
          },
        },
      ];
      const rows: unknown[] = [];
      for (const [i, v] of variants.entries()) {
        await eraseCs(w.cfg);
        const args = { url: `https://corpus.idem.dev/doc/6-${i}` };
        const g = await genuine(w, "fetch_page", args);
        const goodPkt = await encodeData(g.data, await ndnNameOf(g.I), producerSigner(w.cfg.producer, w.key));
        const bad = await v.make(goodPkt);
        const rogue = await startRogue(w.cfg, "edge1", toNdnName(g.I.name), async () => bad);
        cleanup(() => rogue.close());
        const [victim, second] = await consumers(w, 2);
        if (!victim || !second) throw new Error("no consumers");
        cleanup(() => {
          victim.close();
          second.close();
        });
        const r0 = runs();
        const out = await victim.consumer.call("fetch_page", args);
        r.eq(
          `${v.id}: call fails closed with ${v.expect}`,
          [out.error?.code, out.verify?.code],
          [v.expect, v.expect],
        );
        r.eq(`${v.id}: no content returned`, out.data, undefined);
        rogue.close();
        // Availability: NFD does not verify signatures, so the altered Data now sits in its CS.
        const cs0 = await csInfo(E);
        const out2 = await second.consumer.call("fetch_page", args);
        const cs1 = await csInfo(E);
        r.eq(
          `${v.id}: second consumer is served the same altered Data from CS and rejects it`,
          [csDelta(cs0, cs1).hits, out2.error?.code],
          [1, v.expect],
        );
        r.eq(`${v.id}: real producer never asked`, runs() - r0, 0);
        // Recovery once the entry is gone (here erased; in the wild after FreshnessPeriod or eviction).
        await eraseCs(w.cfg);
        const out3 = await second.consumer.call("fetch_page", args);
        r.eq(
          `${v.id}: after the CS entry is gone, the real producer answers`,
          [out3.verify?.ok, runs() - r0],
          [true, 1],
        );
        rows.push({
          variant: v.id,
          first: out.verify?.code,
          reason: out.error?.message,
          second: out2.error?.code,
          rogueHits: rogue.hits(),
        });
      }
      r.ev("variants", rows);
    },
  },
  {
    id: "S7",
    title: "Size limit: the largest Data under 8800 bytes crosses NFD (TCP and UDP); larger → UPSTREAM_ERROR",
    rules: ["§9.2 size"],
    async body(w, r, cleanup) {
      // Largest `n` whose Data fits, found offline with the same key (sizes do not depend on time).
      const off = await offlineProducer(w.cfg, w.cfg.producer, w.key);
      const size = async (n: number) => {
        const I = await idemInterest(off.producer, "blob", { n });
        const d = await off.producer.handleInterest(I);
        try {
          return toWire(await encodeData(d, await ndnNameOf(I), producerSigner(w.cfg.producer, w.key)))
            .length;
        } catch {
          return Number.POSITIVE_INFINITY;
        }
      };
      let lo = 0;
      let hi = 9000;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if ((await size(mid)) <= MAX_PACKET_SIZE) lo = mid;
        else hi = mid - 1;
      }
      const nMax = lo;
      r.ev("nMax", nMax);
      r.ev("bytesAtNMax", await size(nMax));
      const [tcp] = await consumers(w, 1, "tcp");
      const [udp] = await consumers(w, 1, "udp");
      if (!tcp || !udp) throw new Error("no consumers");
      cleanup(() => {
        tcp.close();
        udp.close();
      });
      await eraseCs(w.cfg);
      const a = await tcp.consumer.call("blob", { n: nMax });
      r.eq("TCP: largest Data verified", a.verify?.ok, true);
      await eraseCs(w.cfg);
      const b = await udp.consumer.call("blob", { n: nMax });
      r.eq(
        "UDP: largest Data verified (NDNLP fragmentation by NFD, reassembly by NDNts)",
        b.verify?.ok,
        true,
      );
      const c = await tcp.consumer.call("blob", { n: nMax + 1 });
      r.eq("one byte more: UPSTREAM_ERROR Nack", c.error?.code, "UPSTREAM_ERROR");
      const d = await udp.consumer.call("blob", { n: 20_000 });
      r.eq("20 000 bytes: UPSTREAM_ERROR Nack", d.error?.code, "UPSTREAM_ERROR");
      r.ev("overLimitMessage", c.error?.message);
    },
  },
  {
    id: "S8",
    title: "Two-forwarder chain: edge1, edge2 → regional; regional CS serves the second edge",
    rules: ["P-9.1", "P-9.3"],
    async body(w, r, cleanup) {
      const routes = await routeEdgesToRegional(w.cfg);
      r.ev("edgeToRegionalFaces", routes);
      const p = await startProducer(w.cfg, "regional", w.cfg.chainProducer, w.key);
      cleanup(() => p.close());
      const A = await startConsumer(w.cfg, "edge1", w.cfg.chainProducer);
      const B = await startConsumer(w.cfg, "edge2", w.cfg.chainProducer);
      cleanup(() => {
        A.close();
        B.close();
      });
      await A.consumer.init();
      await B.consumer.init();
      const F = w.cfg.forwarders;
      const snap = async () => ({
        e1: await csInfo(F.edge1.container),
        e2: await csInfo(F.edge2.container),
        rg: await csInfo(F.regional.container),
        rf: await faces(F.regional.container),
        runs: p.counters.fetch_page ?? 0,
      });
      const args = { url: "https://corpus.idem.dev/doc/8" };
      const s0 = await snap();
      const a = await A.consumer.call("fetch_page", args);
      const s1 = await snap();
      const b = await B.consumer.call("fetch_page", args);
      const s2 = await snap();
      r.eq("edge1 consumer: verified", a.verify?.ok, true);
      r.eq("edge2 consumer: verified", b.verify?.ok, true);
      r.eq("same name through both edges", b.ndnName, a.ndnName);
      r.eq(
        "first call: tool ran once, 1 Interest to the producer",
        [s1.runs - s0.runs, faceDelta(s0.rf, s1.rf, p.nfdFaceId).outI],
        [1, 1],
      );
      r.eq(
        "second call: no hit at edge2, one hit at regional",
        [csDelta(s1.e2, s2.e2).hits, csDelta(s1.rg, s2.rg).hits],
        [0, 1],
      );
      r.eq(
        "second call: tool not run, nothing to the producer",
        [s2.runs - s1.runs, faceDelta(s1.rf, s2.rf, p.nfdFaceId).outI],
        [0, 0],
      );
      r.ev("cs", {
        first: { edge1: csDelta(s0.e1, s1.e1), regional: csDelta(s0.rg, s1.rg) },
        second: { edge2: csDelta(s1.e2, s2.e2), regional: csDelta(s1.rg, s2.rg) },
      });
    },
  },
  {
    id: "S9",
    title: "Browser transport: WebSocket face to NFD; TCP, UDP and WebSocket consumers aggregate together",
    rules: ["P-9.1", "P-9.3"],
    async body(w, r, cleanup) {
      const [ws] = await consumers(w, 1, "ws");
      const [tcp] = await consumers(w, 1, "tcp");
      const [udp] = await consumers(w, 1, "udp");
      if (!ws || !tcp || !udp) throw new Error("no consumers");
      cleanup(() => {
        for (const c of [ws, tcp, udp]) c.close();
      });
      r.ok(
        "WebSocket consumer bootstrapped the manifest over NFD (TOFU)",
        ws.consumer.trust.manifest(w.cfg.producer) !== undefined,
      );
      const E = edge1(w);
      const args = { url: "https://corpus.idem.dev/doc/9" };
      const b = { f: await faces(E), runs: w.producer.counters.fetch_page ?? 0 };
      const outs = await Promise.all([ws, tcp, udp].map((c) => c.consumer.call("fetch_page", args)));
      const a = { f: await faces(E), runs: w.producer.counters.fetch_page ?? 0 };
      r.eq(
        "ws, tcp, udp: all verified",
        outs.map((o) => o.verify?.ok),
        [true, true, true],
      );
      r.eq("tool ran once for the three transports", a.runs - b.runs, 1);
      r.eq("1 Interest upstream", faceDelta(b.f, a.f, w.producer.nfdFaceId).outI, 1);
      const wsFaces = [...a.f.values()].filter((f) => f.remote.startsWith("wsclient://"));
      r.ok(
        "NFD lists a WebSocket face",
        wsFaces.length >= 1,
        wsFaces.map((f) => f.remote),
      );
      r.ev("producerFace", faceDelta(b.f, a.f, w.producer.nfdFaceId));
      r.ev(
        "transports",
        [ws, tcp, udp].map((c) => c.node.transport),
      );
      r.ev(
        "wsFaces",
        wsFaces.map((f) => f.remote),
      );
    },
  },
];

/** Run one scenario, recording a thrown error as a failure. Clears NFD's `/idem` CS entries first. */
export async function runScenario(w: World, s: Scenario): Promise<ScenarioResult> {
  const r = new Recorder();
  const cleanups: (() => void)[] = [];
  const t0 = Date.now();
  let error: string | undefined;
  try {
    await eraseCs(w.cfg);
    await s.body(w, r, (fn) => cleanups.push(fn));
  } catch (e) {
    error = e instanceof Error ? (e.stack ?? e.message) : String(e);
  } finally {
    for (const fn of cleanups.reverse()) {
      try {
        fn();
      } catch {
        // already closed
      }
    }
  }
  const pass = error === undefined && r.checks.length > 0 && r.checks.every((c) => c.pass);
  return {
    id: s.id,
    title: s.title,
    rules: s.rules,
    pass,
    checks: r.checks,
    evidence: r.evidence,
    durationMs: Date.now() - t0,
    ...(error !== undefined && { error }),
  };
}

/** Start the main producer on edge1 and return the shared world. */
export async function setupWorld(cfg: NfdCheckConfig): Promise<World> {
  const key = await keyFromSeed(cfg.seed);
  const attacker = await keyFromSeed(cfg.seed + 1);
  const producer = await startProducer(cfg, "edge1", cfg.producer, key);
  return { cfg, key, attacker, producer };
}
