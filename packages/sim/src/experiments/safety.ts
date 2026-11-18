import {
  buildInterest,
  cacheablePolicy,
  type Data,
  deriveAuthContext,
  type Face,
  Fib,
  Forwarder,
  type ForwarderEvent,
  type IdemKeyPair,
  type Interest,
  keyLocator,
  keyPairFromSeed,
  type Manifest,
  MemoryContentStore,
  type Packet,
  Producer,
  type ProducerTool,
  parseName,
  signData,
  signManifest,
  TrustStore,
  VirtualClock,
  verifyData,
} from "@idem/core";
import { Rng } from "../rng";
import type { SafetyConfig } from "./spec";

/**
 * E5 (05-evaluation §4): adversarial runs against the real `@idem/core` engine — `Forwarder`,
 * `Producer`, `TrustStore`, `verifyData` — on a virtual clock. Every trial builds a fresh world
 * from its seed (keys, documents, timing, the attacker's choices), runs one attack, and is judged
 * on ground truth: what the victim ended up accepting and what the Content Stores hold. A trial
 * counts as rejected only if no victim accepted attacker-chosen or expired content and no cache
 * kept any. Variants the protocol documents as limits stay in the suite and are counted the same
 * way, so a limit is a number and not a footnote.
 */

const PRODUCER = "docs.idem.dev";
const TTL_MS = 60_000;
const AGENT_LINK_MS = 5;
const CORE_LINK_MS = 10;
const PRODUCER_LINK_MS = 40;
const EDGE_SECRET = "e5-edge-secret";
const ORIGIN = "https://docs.idem.dev";

/** Attack classes of spec 05 E5, plus the timing side channel of open question Q3. */
export type AttackClass = "tamper" | "forge" | "replay" | "private" | "poison" | "timing";

/**
 * What the specification says of a variant: `rejected` is a claim the engine must keep; `limit`
 * is an attack v1 documents and does not stop (the suite measures it); `leaks` is a side channel
 * v1 accepts as a risk.
 */
export type Expectation = "rejected" | "limit" | "leaks";

/** Result of one trial. */
export interface TrialOutcome {
  /** The attack failed: nothing forged, expired or foreign was accepted or cached. */
  rejected: boolean;
  /** How the attack was stopped, or what was accepted. */
  mechanism: string;
}

/** One attack variant. */
export interface SafetyVariant {
  /** `<attack>/<what>@<where>`. */
  id: string;
  attack: AttackClass;
  /** Where the attacker sits. */
  where: string;
  expected: Expectation;
  /** What the attacker does, in one sentence. */
  summary: string;
  /** Anything the attacker needs beyond the position in `where`. */
  assumes?: string;
  run(seed: number): Promise<TrialOutcome>;
}

/** One line of `metrics.csv` for E5. */
export interface SafetyRow {
  attack: AttackClass;
  variant: string;
  where: string;
  expected: Expectation;
  trials: number;
  rejected: number;
  accepted: number;
  /** `mechanism=count` pairs, most frequent first, separated by ` | ` (see {@link MECHANISM_SEPARATOR}). */
  mechanisms: string;
  assumes: string;
  summary: string;
}
export const SAFETY_COLUMNS = [
  "attack",
  "variant",
  "where",
  "expected",
  "trials",
  "rejected",
  "accepted",
  "mechanisms",
  "assumes",
  "summary",
] as const satisfies readonly (keyof SafetyRow)[];

/** Separates the `mechanism=count` pairs of a `metrics.csv` line; no mechanism text contains it. */
export const MECHANISM_SEPARATOR = " | ";

/** One line of `trials.csv` for E5. */
export interface SafetyTrialRow {
  variant: string;
  trial: number;
  seed: number;
  rejected: boolean;
  mechanism: string;
}
export const SAFETY_TRIAL_COLUMNS = [
  "variant",
  "trial",
  "seed",
  "rejected",
  "mechanism",
] as const satisfies readonly (keyof SafetyTrialRow)[];

// ---------------------------------------------------------------- world

type Hook = (p: Packet) => Packet | undefined;

/** A link whose two directions an on-path attacker can rewrite, drop or add to. */
class Wire {
  readonly a: Face;
  readonly b: Face;
  /** Applied to packets travelling a → b / b → a at delivery; return `undefined` to drop. */
  toB: Hook | undefined;
  toA: Hook | undefined;
  /** Every packet delivered, after the hooks (what a tap on the wire records). */
  readonly seenToA: Packet[] = [];
  readonly #clock: VirtualClock;
  readonly #latency: number;
  #deliverA: ((p: Packet) => void | Promise<void>) | undefined;
  #deliverB: ((p: Packet) => void | Promise<void>) | undefined;

  constructor(clock: VirtualClock, ids: { a: string; b: string }, latencyMs: number) {
    this.#clock = clock;
    this.#latency = latencyMs;
    this.a = {
      id: ids.a,
      send: (p) => this.#schedule("b", p),
      onReceive: (cb) => {
        this.#deliverA = cb;
      },
      close: () => {},
    };
    this.b = {
      id: ids.b,
      send: (p) => this.#schedule("a", p),
      onReceive: (cb) => {
        this.#deliverB = cb;
      },
      close: () => {},
    };
  }

  #schedule(to: "a" | "b", p: Packet): void {
    this.#clock.setTimeout(() => {
      const hook = to === "a" ? this.toA : this.toB;
      const out = hook ? hook(p) : p;
      if (!out) return;
      if (to === "a") {
        this.seenToA.push(out);
        return this.#deliverA?.(out);
      }
      return this.#deliverB?.(out);
    }, this.#latency);
  }

  /** Put a packet on the wire toward `a` (as an attacker attached to it would). */
  injectToA(p: Packet): void {
    this.#clock.setTimeout(() => {
      this.seenToA.push(p);
      return this.#deliverA?.(p);
    }, 0);
  }
}

type Verdict =
  | { kind: "accepted"; data: Data; text: string; at: number }
  | { kind: "refused"; why: string; at: number }
  | { kind: "nack"; code: string; at: number }
  | { kind: "none" };

/** A consumer following the reference procedure: ask by name, check the name, verify [P-5.5]. */
class Consumer {
  readonly id: string;
  readonly token: string | undefined;
  readonly wire: Wire;
  readonly trust = new TrustStore();
  readonly #world: World;
  readonly #arrivals: { p: Packet; at: number }[] = [];

  constructor(world: World, id: string, token: string | undefined, wire: Wire) {
    this.#world = world;
    this.id = id;
    this.token = token;
    this.wire = wire;
    wire.a.onReceive((p) => {
      this.#arrivals.push({ p, at: world.clock.now() });
    });
  }

  /** Build the Interest for a call, exactly as a consumer does [P-4.1]. */
  interest(tool: string, args: unknown): Promise<Interest> {
    return this.#world.interest(tool, args);
  }

  send(interest: Interest, raw?: Partial<Interest>): void {
    this.wire.a.send({
      type: "interest",
      interest: { ...interest, ...raw },
      ...(this.token !== undefined && { auth: this.token }),
    });
  }

  /** Push an arbitrary packet toward the edge (a misbehaving consumer). */
  push(p: Packet): void {
    this.wire.a.send(p);
  }

  /** What this consumer concludes about the answer to `interest`. */
  async verdict(interest: Interest): Promise<Verdict> {
    const hit = this.#arrivals.find(
      ({ p }) => (p.type === "data" || p.type === "nack") && p.nonce === interest.nonce,
    );
    if (!hit) return { kind: "none" };
    const { p, at } = hit;
    if (p.type === "nack") return { kind: "nack", code: p.code, at };
    if (p.type !== "data") return { kind: "none" };
    if (p.data.name !== interest.name) return { kind: "refused", why: "name mismatch", at };
    const v = await verifyData(p.data, this.trust, { now: at });
    if (!v.ok) return { kind: "refused", why: v.code, at };
    return { kind: "accepted", data: p.data, text: textOf(p.data), at };
  }
}

function textOf(d: Data): string {
  const block = d.content.content[0] as { text?: unknown } | undefined;
  return typeof block?.text === "string" ? block.text : "";
}

function url(doc: number): string {
  return `${ORIGIN}/doc/${doc}?lang=en&v=1`;
}

/** agents → edge(s) → [regional →] producer, built from the real core classes. */
class World {
  readonly clock = new VirtualClock();
  readonly rng: Rng;
  readonly marker: string;
  key!: IdemKeyPair;
  producer!: Producer;
  manifest!: Manifest;
  readonly edges: Forwarder[] = [];
  readonly stores: MemoryContentStore[] = [];
  readonly trusts: TrustStore[] = [];
  readonly events: ForwarderEvent[] = [];
  /** The link that reaches the producer (edge ↔ producer, or regional ↔ producer in a tree). */
  upstream!: Wire;
  /** Interests that reached the producer. */
  upstreamInterests = 0;
  readonly #names = new Map<string, number>();
  #faces = 0;

  private constructor(seed: number) {
    this.rng = new Rng(seed);
    this.marker = this.rng.uint32().toString(36);
  }

  static async create(seed: number, opts: { tree?: boolean } = {}): Promise<World> {
    const w = new World(seed);
    w.key = await keyPairFromSeed(w.rng.fork("producer-key").bytes(32));
    const tools: ProducerTool[] = [
      {
        name: "fetch_page",
        inputSchema: {
          type: "object",
          properties: { url: { type: "string", minLength: 1 } },
          required: ["url"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        policy: {
          cacheable: true,
          ttlMs: TTL_MS,
          scope: "public",
          normalizers: { "/url": ["url:sortQuery"] },
        },
        handler: (args, ctx) => {
          const m = /\/doc\/(\d+)$/.exec(new URL((args as { url: string }).url).pathname);
          return { content: [{ type: "text", text: w.pageText(Number(m?.[1] ?? -1), ctx.now) }] };
        },
      },
      {
        name: "my_notes",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true },
        policy: { cacheable: true, ttlMs: TTL_MS, scope: "private" },
        handler: (_args, ctx) => ({ content: [{ type: "text", text: notesOf(ctx.auth) }] }),
      },
    ];
    w.producer = new Producer({ producer: PRODUCER, key: w.key, tools, clock: w.clock });
    w.manifest = await w.producer.manifest();
    const service = w.rng.fork("service");
    const serve = (face: Face) => {
      const inner = face.onReceive.bind(face);
      face.onReceive = (cb) =>
        inner((p) => {
          if (p.type === "interest") w.upstreamInterests++;
          return cb(p);
        });
      w.producer.serve(face, { clock: w.clock, serviceTimeMs: () => 20 + service.next() * 100 });
    };
    const forwarder = async (id: string, edge: boolean) => {
      const trust = new TrustStore();
      await trust.addManifest(w.manifest, { now: 0 });
      const cs = new MemoryContentStore({ maxBytes: 8 * 1024 * 1024 });
      const fib = new Fib();
      const f = new Forwarder({
        id,
        clock: w.clock,
        fib,
        trust,
        cs,
        ...(edge && { authSecret: EDGE_SECRET }),
        onEvent: (e) => w.events.push(e),
      });
      w.stores.push(cs);
      w.trusts.push(trust);
      return { f, fib };
    };
    if (opts.tree) {
      const regional = await forwarder("regional", false);
      w.upstream = new Wire(w.clock, { a: "regional→producer", b: "producer" }, PRODUCER_LINK_MS);
      regional.f.addFace(w.upstream.a);
      regional.fib.addProducer(PRODUCER, w.upstream.a.id);
      for (const id of ["edge-0", "edge-1"]) {
        const e = await forwarder(id, true);
        const wire = new Wire(w.clock, { a: `${id}→regional`, b: `regional:${id}` }, CORE_LINK_MS);
        e.f.addFace(wire.a);
        e.fib.addProducer(PRODUCER, wire.a.id);
        regional.f.addFace(wire.b);
        w.edges.push(e.f);
      }
    } else {
      const e = await forwarder("edge", true);
      w.upstream = new Wire(w.clock, { a: "edge→producer", b: "producer" }, PRODUCER_LINK_MS);
      e.f.addFace(w.upstream.a);
      e.fib.addProducer(PRODUCER, w.upstream.a.id);
      w.edges.push(e.f);
    }
    serve(w.upstream.b);
    return w;
  }

  /** The genuine text of `doc` as produced at producer time `producedAt`. */
  pageText(doc: number, producedAt: number): string {
    return `doc:${doc}@${producedAt}#${this.marker}`;
  }

  async interest(tool: string, args: unknown): Promise<Interest> {
    const info = this.producer.toolList().find((t) => t.name === tool);
    const c = info && (await cacheablePolicy(this.manifest, info));
    if (!c) throw new Error(`${tool} is not cacheable`);
    const { interest } = await buildInterest({
      producer: PRODUCER,
      identity: c.identity,
      policy: c.policy,
      args,
      nonce: this.nonce(),
    });
    const m = /\/doc\/(\d+)\?/.exec(JSON.stringify(args));
    if (tool === "fetch_page" && m) this.#names.set(interest.name, Number(m[1]));
    return interest;
  }

  nonce(): string {
    return Array.from(this.rng.bytes(8), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  /** A consumer attached to edge `edge` (0 by default), trusting the producer's manifest. */
  async consumer(id: string, token?: string, edge = 0): Promise<Consumer> {
    const wire = new Wire(this.clock, { a: id, b: `edge:${id}:${this.#faces++}` }, AGENT_LINK_MS);
    (this.edges[edge] as Forwarder).addFace(wire.b, { consumer: true });
    const c = new Consumer(this, id, token, wire);
    await c.trust.addManifest(this.manifest, { now: 0 });
    return c;
  }

  /** Advance virtual time by `ms`, running everything due. */
  advance(ms: number): Promise<void> {
    return this.clock.runUntil(this.clock.now() + ms);
  }

  /** Run until nothing is scheduled. */
  async settle(): Promise<void> {
    await this.clock.runAll();
  }

  /** Is `d` exactly what the producer made for the document its name stands for? */
  genuine(d: Data): boolean {
    const doc = this.#names.get(d.name);
    return doc !== undefined && textOf(d) === this.pageText(doc, d.meta.producedAt);
  }

  /** Past its freshness on the producer's clock at time `at`. */
  expired(d: Data, at: number): boolean {
    return at - d.meta.producedAt >= Math.min(d.meta.freshnessMs, TTL_MS);
  }

  /** Why a Content Store entry should not be there, for every cache; empty when all are clean. */
  auditCaches(): string[] {
    const problems: string[] = [];
    for (const cs of this.stores) {
      for (const e of cs.entries()) {
        const tool = parseName(e.data.name).tool;
        if (tool === "fetch_page" && e.key !== e.data.name)
          problems.push("cache holds Data under another name");
        else if (tool === "fetch_page" && !this.genuine(e.data)) problems.push("cache holds forged content");
        else if (e.receivedAt - e.data.meta.producedAt >= TTL_MS) problems.push("cache holds expired Data");
      }
    }
    return problems;
  }

  /** Events of a kind (optionally with a reason) seen at any forwarder. */
  count(kind: ForwarderEvent["kind"], reason?: string): number {
    return this.events.filter(
      (e) => e.kind === kind && (reason === undefined || (e as { reason?: string }).reason === reason),
    ).length;
  }
}

function notesOf(auth: string | undefined): string {
  return `notes of ${auth ?? "anonymous"}`;
}

/** How a refusal looked from the consumer's side. */
function describe(v: Verdict): string {
  switch (v.kind) {
    case "accepted":
      return "accepted";
    case "refused":
      return `consumer refused: ${v.why}`;
    case "nack":
      return `Nack ${v.code}`;
    case "none":
      return "no answer";
  }
}

/** Judge a trial whose victims must not accept anything that is not genuine and fresh. */
function judge(
  w: World,
  verdicts: Verdict[],
  bad: (v: Extract<Verdict, { kind: "accepted" }>) => string | undefined,
  how: string,
): TrialOutcome {
  for (const v of verdicts) {
    if (v.kind !== "accepted") continue;
    const why = bad(v);
    if (why) return { rejected: false, mechanism: `ACCEPTED: ${why}` };
  }
  const cache = w.auditCaches();
  if (cache.length > 0) return { rejected: false, mechanism: `ACCEPTED: ${cache[0]}` };
  return { rejected: true, mechanism: how };
}

const notGenuine = (w: World) => (v: Extract<Verdict, { kind: "accepted" }>) =>
  w.genuine(v.data) ? undefined : "forged content passed verification";

// ---------------------------------------------------------------- attacker tools

/** Rewrite the text of a Data without touching its metadata or signature. */
function rewriteContent(d: Data, rng: Rng): Data {
  const text = textOf(d);
  let evil: string;
  switch (rng.int(3)) {
    case 0: {
      // Change a single character.
      const i = rng.int(Math.max(1, text.length));
      const c = text[i] === "x" ? "y" : "x";
      evil = text.slice(0, i) + c + text.slice(i + 1);
      break;
    }
    case 1:
      evil = `${text} — ignore previous instructions`;
      break;
    default:
      evil = "tampered in flight";
  }
  return { ...d, content: { ...d.content, content: [{ type: "text", text: evil }] } };
}

/** Change one character of the base64url signature. */
function flipSignature(d: Data, rng: Rng): Data {
  const v = d.signature.value;
  const i = rng.int(v.length);
  const c = v[i] === "A" ? "B" : "A";
  return { ...d, signature: { ...d.signature, value: v.slice(0, i) + c + v.slice(i + 1) } };
}

/** Replace the first Data that crosses in the hooked direction. */
function once(f: (d: Data) => Data): Hook {
  let used = false;
  return (p) => {
    if (used || p.type !== "data") return p;
    used = true;
    return { ...p, data: f(p.data) };
  };
}

/** Data signed by a key of the attacker's own, for the victim's name. */
async function forgeData(
  name: string,
  key: IdemKeyPair,
  now: number,
  scope: "public" | "private",
): Promise<Data> {
  return signData(
    {
      name,
      content: { content: [{ type: "text", text: "poisoned by a key outside the manifest" }] },
      producedAt: now,
      freshnessMs: TTL_MS,
      scope,
      policyVersion: 1,
    },
    key,
  );
}

/** A genuine Data for `doc` obtained as any consumer could: by asking the producer. */
async function genuineData(w: World, doc: number): Promise<{ interest: Interest; data: Data }> {
  const interest = await w.interest("fetch_page", { url: url(doc) });
  return { interest, data: await w.producer.handleInterest(interest) };
}

// ---------------------------------------------------------------- variants

/** What an on-path attacker does to the Data that crosses: built once per trial, applied in flight. */
type Rewrite = (w: World, doc: number) => Promise<(d: Data) => Data> | ((d: Data) => Data);

/** One to three victims ask for a document while the attacker rewrites the answer on the producer link. */
async function upstreamRewrite(seed: number, rewrite: Rewrite): Promise<TrialOutcome> {
  const w = await World.create(seed);
  const doc = w.rng.int(50);
  const victims = await Promise.all(
    Array.from({ length: 1 + w.rng.int(3) }, (_, i) => w.consumer(`victim-${i}`, `token-${i}`)),
  );
  const interests = await Promise.all(victims.map((v) => v.interest("fetch_page", { url: url(doc) })));
  w.upstream.toA = once(await rewrite(w, doc));
  victims.forEach((v, i) => {
    v.send(interests[i] as Interest);
  });
  await w.settle();
  const verdicts = await Promise.all(victims.map((v, i) => v.verdict(interests[i] as Interest)));
  const stopped = w.count("verify_fail") > 0 ? "forwarder verify_fail" : "forwarder drop: unsolicited";
  return judge(w, verdicts, notGenuine(w), `${stopped} → ${describe(verdicts[0] as Verdict)}`);
}

/** A victim asks through the edge while the attacker rewrites the answer on the victim's own link. */
async function lastHopRewrite(seed: number, rewrite: Rewrite): Promise<TrialOutcome> {
  const w = await World.create(seed);
  const doc = w.rng.int(50);
  const victim = await w.consumer("victim", "token-victim");
  const interest = await victim.interest("fetch_page", { url: url(doc) });
  victim.wire.toA = once(await rewrite(w, doc));
  victim.send(interest);
  await w.settle();
  const v = await victim.verdict(interest);
  return judge(w, [v], notGenuine(w), describe(v));
}

/** A genuine, correctly signed Data of some other document. */
const swapForAnotherDocument: Rewrite = async (w, doc) => {
  const other = (doc + 1 + w.rng.int(49)) % 50;
  const { data } = await genuineData(w, other);
  return () => data;
};

function variant(v: SafetyVariant): SafetyVariant {
  return v;
}

/** Every attack variant of E5, in report order. */
export const SAFETY_VARIANTS: readonly SafetyVariant[] = [
  // ---- tamper: Data modified in flight by someone who cannot sign.
  variant({
    id: "tamper/content@upstream",
    attack: "tamper",
    where: "producer link",
    expected: "rejected",
    summary: "Rewrites the result text of the Data on its way from the producer to the edge.",
    run: (seed) => upstreamRewrite(seed, (w) => (d) => rewriteContent(d, w.rng)),
  }),
  variant({
    id: "tamper/content@last-hop",
    attack: "tamper",
    where: "agent link",
    expected: "rejected",
    summary: "Rewrites the result text between the edge and the agent.",
    run: (seed) => lastHopRewrite(seed, (w) => (d) => rewriteContent(d, w.rng)),
  }),
  variant({
    id: "tamper/freshness@upstream",
    attack: "tamper",
    where: "producer link",
    expected: "rejected",
    summary: "Raises the signed freshnessMs a thousandfold so caches keep the Data longer.",
    run: (seed) =>
      upstreamRewrite(seed, () => (d) => ({
        ...d,
        meta: { ...d.meta, freshnessMs: d.meta.freshnessMs * 1000 },
      })),
  }),
  variant({
    id: "tamper/signature@upstream",
    attack: "tamper",
    where: "producer link",
    expected: "rejected",
    summary: "Changes one character of the signature.",
    run: (seed) => upstreamRewrite(seed, (w) => (d) => flipSignature(d, w.rng)),
  }),
  variant({
    id: "tamper/swap-name@upstream",
    attack: "tamper",
    where: "producer link",
    expected: "rejected",
    summary: "Answers the Interest with a genuine, correctly signed Data of a different document.",
    run: (seed) => upstreamRewrite(seed, swapForAnotherDocument),
  }),
  variant({
    id: "tamper/swap-name@last-hop",
    attack: "tamper",
    where: "agent link",
    expected: "rejected",
    summary: "Hands the agent a genuine, correctly signed Data of a different document.",
    run: (seed) => lastHopRewrite(seed, swapForAnotherDocument),
  }),
  variant({
    id: "tamper/scope@upstream",
    attack: "tamper",
    where: "producer link",
    expected: "rejected",
    summary: "Relabels a private result as public so that the edge would share it.",
    run: async (seed) => {
      const w = await World.create(seed);
      const alice = await w.consumer("alice", "token-alice");
      const bob = await w.consumer("bob", "token-bob");
      w.upstream.toA = once((d) => ({ ...d, meta: { ...d.meta, scope: "public" } }));
      const ia = await alice.interest("my_notes", {});
      alice.send(ia);
      await w.settle();
      const ib = await bob.interest("my_notes", {});
      bob.send(ib);
      await w.settle();
      const va = await alice.verdict(ia);
      const vb = await bob.verdict(ib);
      if (vb.kind === "accepted" && vb.text !== notesOf("token-bob")) {
        return { rejected: false, mechanism: "ACCEPTED: another user's private result" };
      }
      if (va.kind === "accepted") return { rejected: false, mechanism: "ACCEPTED: relabelled Data" };
      return { rejected: true, mechanism: `forwarder verify_fail → ${describe(va)}` };
    },
  }),

  // ---- forge: a name that does not match its arguments.
  variant({
    id: "forge/args-swap@edge",
    attack: "forge",
    where: "consumer",
    expected: "rejected",
    summary: "Sends the name of one document with the arguments of another, to poison the first name.",
    run: async (seed) => {
      const w = await World.create(seed);
      const mallory = await w.consumer("mallory", "token-mallory");
      const a = w.rng.int(50);
      const b = (a + 1 + w.rng.int(49)) % 50;
      const ia = await mallory.interest("fetch_page", { url: url(a) });
      const ib = await mallory.interest("fetch_page", { url: url(b) });
      mallory.send(ia, { args: ib.args });
      await w.settle();
      const v = await mallory.verdict(ia);
      if (w.upstreamInterests > 0)
        return { rejected: false, mechanism: "ACCEPTED: forged Interest forwarded upstream" };
      if (v.kind === "accepted") return { rejected: false, mechanism: "ACCEPTED: Data for a forged name" };
      return judge(w, [], () => undefined, `edge drop → ${describe(v)}`);
    },
  }),
  variant({
    id: "forge/random-digest@edge",
    attack: "forge",
    where: "consumer",
    expected: "rejected",
    summary: "Sends real arguments under a name whose args digest is random.",
    run: async (seed) => {
      const w = await World.create(seed);
      const mallory = await w.consumer("mallory", "token-mallory");
      const i = await mallory.interest("fetch_page", { url: url(w.rng.int(50)) });
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      const digest = Array.from({ length: 43 }, () => alphabet[w.rng.int(64)]).join("");
      const forged = { ...i, name: `${i.name.slice(0, i.name.lastIndexOf("/") + 1)}${digest}` };
      mallory.send(forged);
      await w.settle();
      const v = await mallory.verdict(forged);
      if (w.upstreamInterests > 0)
        return { rejected: false, mechanism: "ACCEPTED: forged Interest forwarded upstream" };
      if (v.kind === "accepted") return { rejected: false, mechanism: "ACCEPTED: Data for a forged name" };
      return judge(w, [], () => undefined, `edge drop → ${describe(v)}`);
    },
  }),
  variant({
    id: "forge/args-swap@producer",
    attack: "forge",
    where: "forwarder (malicious)",
    expected: "rejected",
    summary: "A forwarder that skips its own check passes the mismatched Interest straight to the producer.",
    run: async (seed) => {
      const w = await World.create(seed);
      const a = w.rng.int(50);
      const b = (a + 1 + w.rng.int(49)) % 50;
      const ia = await w.interest("fetch_page", { url: url(a) });
      const ib = await w.interest("fetch_page", { url: url(b) });
      try {
        const d = await w.producer.handleInterest({ ...ia, args: ib.args });
        return {
          rejected: false,
          mechanism: `ACCEPTED: producer signed ${d.name === ia.name ? "the forged name" : "a Data"}`,
        };
      } catch (e) {
        const code = (e as { code?: string }).code ?? "error";
        return { rejected: code === "DIGEST_MISMATCH", mechanism: `producer refuses: ${code}` };
      }
    },
  }),

  // ---- replay: a genuine Data shown again after its freshness ran out.
  variant({
    id: "replay/expired-cache",
    attack: "replay",
    where: "none (honest path)",
    expected: "rejected",
    summary: "A consumer asks again after the cached copy's freshness ran out; the edge must not serve it.",
    run: async (seed) => {
      const w = await World.create(seed);
      const doc = w.rng.int(50);
      const alice = await w.consumer("alice", "token-alice");
      const bob = await w.consumer("bob", "token-bob");
      const ia = await alice.interest("fetch_page", { url: url(doc) });
      alice.send(ia);
      await w.settle();
      const first = await alice.verdict(ia);
      if (first.kind !== "accepted") return { rejected: false, mechanism: "setup failed" };
      // Wait until the copy is exactly expired, or longer.
      const cachedAt = w.events.find((e) => e.kind === "cs_insert")?.t ?? 0;
      const wait = w.rng.chance(0.25) ? TTL_MS : TTL_MS + 1 + w.rng.int(5 * TTL_MS);
      await w.clock.runUntil(cachedAt + wait - AGENT_LINK_MS);
      const before = w.upstreamInterests;
      const ib = await bob.interest("fetch_page", { url: url(doc) });
      bob.send(ib);
      await w.settle();
      const v = await bob.verdict(ib);
      if (v.kind === "accepted" && w.expired(v.data, v.at)) {
        return { rejected: false, mechanism: "ACCEPTED: expired Data served from the cache" };
      }
      if (v.kind !== "accepted") return { rejected: false, mechanism: `no fresh answer: ${describe(v)}` };
      return judge(
        w,
        [v],
        notGenuine(w),
        w.upstreamInterests > before ? "edge refetched from the producer" : "served a copy still fresh",
      );
    },
  }),
  variant({
    id: "replay/expired@upstream",
    attack: "replay",
    where: "producer link",
    expected: "limit",
    summary:
      "Records a genuine Data on the producer link and, after its freshness ran out, substitutes it for the producer's new answer.",
    run: async (seed) => {
      const w = await World.create(seed);
      const doc = w.rng.int(50);
      const alice = await w.consumer("alice", "token-alice");
      const bob = await w.consumer("bob", "token-bob");
      const ia = await alice.interest("fetch_page", { url: url(doc) });
      alice.send(ia);
      await w.settle();
      const recorded = w.upstream.seenToA.find((p) => p.type === "data");
      if (recorded?.type !== "data") return { rejected: false, mechanism: "setup failed" };
      await w.advance(TTL_MS + 1 + w.rng.int(5 * TTL_MS));
      w.upstream.toA = once(() => recorded.data);
      const ib = await bob.interest("fetch_page", { url: url(doc) });
      bob.send(ib);
      await w.settle();
      const v = await bob.verdict(ib);
      if (v.kind === "accepted" && w.expired(v.data, v.at)) {
        return {
          rejected: false,
          mechanism: "ACCEPTED: expired Data verified by the edge, cached as fresh and delivered",
        };
      }
      return judge(w, [v], notGenuine(w), describe(v));
    },
  }),
  variant({
    id: "replay/expired@last-hop",
    attack: "replay",
    where: "agent link",
    expected: "limit",
    summary:
      "Keeps a genuine Data it once fetched and, after its freshness ran out, answers the victim's Interest with it.",
    run: async (seed) => {
      const w = await World.create(seed);
      const doc = w.rng.int(50);
      const bob = await w.consumer("bob", "token-bob");
      const { data: old } = await genuineData(w, doc);
      await w.advance(TTL_MS + 1 + w.rng.int(5 * TTL_MS));
      bob.wire.toA = once(() => old);
      const ib = await bob.interest("fetch_page", { url: url(doc) });
      bob.send(ib);
      await w.settle();
      const v = await bob.verdict(ib);
      if (v.kind === "accepted" && w.expired(v.data, v.at)) {
        return { rejected: false, mechanism: "ACCEPTED: expired Data passed the consumer's verification" };
      }
      return judge(w, [v], notGenuine(w), describe(v));
    },
  }),
  variant({
    id: "replay/unsolicited@consumer-face",
    attack: "replay",
    where: "consumer",
    expected: "rejected",
    summary: "Pushes an old genuine Data into the edge from a consumer face, hoping it gets cached.",
    run: async (seed) => {
      const w = await World.create(seed);
      const doc = w.rng.int(50);
      const mallory = await w.consumer("mallory", "token-mallory");
      const alice = await w.consumer("alice", "token-alice");
      const { data: old } = await genuineData(w, doc);
      await w.advance(TTL_MS + 1 + w.rng.int(5 * TTL_MS));
      // Both ways an attacker would try: out of the blue, and as the "answer" to its own Interest.
      const mine = await mallory.interest("fetch_page", { url: url(doc) });
      if (w.rng.chance(0.5)) mallory.send(mine);
      mallory.push({ type: "data", nonce: mine.nonce, data: old });
      const ia = await alice.interest("fetch_page", { url: url(doc) });
      alice.send(ia);
      await w.settle();
      const v = await alice.verdict(ia);
      if (v.kind === "accepted" && w.expired(v.data, v.at)) {
        return { rejected: false, mechanism: "ACCEPTED: expired Data served from the cache" };
      }
      return judge(
        w,
        [v],
        notGenuine(w),
        w.count("drop", "unsolicited") > 0 ? "edge drop: unsolicited" : describe(v),
      );
    },
  }),

  // ---- private: a `private` result must never reach another authorization context.
  variant({
    id: "private/sequential",
    attack: "private",
    where: "consumer",
    expected: "rejected",
    summary: "Asks for the private name right after another user's result was cached at the edge.",
    run: (seed) => privateProbe(seed, { concurrent: false }),
  }),
  variant({
    id: "private/concurrent",
    attack: "private",
    where: "consumer",
    expected: "rejected",
    summary: "Asks for the private name while another user's Interest for it is pending in the PIT.",
    run: (seed) => privateProbe(seed, { concurrent: true }),
  }),
  variant({
    id: "private/anonymous",
    attack: "private",
    where: "consumer",
    expected: "rejected",
    summary: "Asks for the private name with no credential at all after a user's result was cached.",
    run: (seed) => privateProbe(seed, { concurrent: false, anonymous: true }),
  }),
  variant({
    id: "private/tree",
    attack: "private",
    where: "consumer",
    expected: "rejected",
    summary: "Two users behind different edges ask at once; the regional forwarder sees no authContext.",
    run: (seed) => privateProbe(seed, { concurrent: true, tree: true }),
  }),
  variant({
    id: "private/authcontext-guess",
    attack: "private",
    where: "consumer",
    expected: "rejected",
    summary: "Fills the Interest's authContext field itself with a random value.",
    run: (seed) => privateProbe(seed, { concurrent: false, forge: "guess" }),
  }),
  variant({
    id: "private/authcontext-known",
    attack: "private",
    where: "consumer",
    expected: "rejected",
    assumes: "knows the victim's authContext, a value the edge derives and never sends to anyone",
    summary: "Fills the Interest's authContext field itself with the victim's value.",
    run: (seed) => privateProbe(seed, { concurrent: false, forge: "known" }),
  }),

  // ---- poison: Data signed by a key the producer's manifest does not list.
  variant({
    id: "poison/unknown-key@upstream",
    attack: "poison",
    where: "producer link",
    expected: "rejected",
    summary: "Replaces the answer with Data validly signed by the attacker's own key.",
    run: (seed) => poisonUpstream(seed, "unknown-key"),
  }),
  variant({
    id: "poison/spoofed-key-id@upstream",
    attack: "poison",
    where: "producer link",
    expected: "rejected",
    summary: "Signs with its own key but names the producer's real key in the key locator.",
    run: (seed) => poisonUpstream(seed, "spoofed-key-id"),
  }),
  variant({
    id: "poison/other-producer@upstream",
    attack: "poison",
    where: "producer link",
    expected: "rejected",
    assumes: "is itself a producer every node trusts, for its own names",
    summary: "Signs the victim's name with the key of another, trusted producer.",
    run: (seed) => poisonUpstream(seed, "other-producer"),
  }),
  variant({
    id: "poison/rogue-manifest@upstream",
    attack: "poison",
    where: "producer link",
    expected: "rejected",
    summary: "Offers a newer manifest listing only its own key, then answers with Data signed by it.",
    run: (seed) => poisonUpstream(seed, "rogue-manifest"),
  }),
  variant({
    id: "poison/unknown-key@last-hop",
    attack: "poison",
    where: "agent link",
    expected: "rejected",
    summary: "Hands the agent Data validly signed by the attacker's own key.",
    run: async (seed) => {
      const w = await World.create(seed);
      const key = await keyPairFromSeed(w.rng.fork("attacker-key").bytes(32));
      const victim = await w.consumer("victim", "token-victim");
      const interest = await victim.interest("fetch_page", { url: url(w.rng.int(50)) });
      const evil = await forgeData(interest.name, key, 0, "public");
      victim.wire.toA = once(() => evil);
      victim.send(interest);
      await w.settle();
      const v = await victim.verdict(interest);
      return judge(w, [v], notGenuine(w), describe(v));
    },
  }),
  variant({
    id: "poison/unsolicited@consumer-face",
    attack: "poison",
    where: "consumer",
    expected: "rejected",
    summary: "Pushes its own signed Data into the edge from a consumer face, hoping it gets cached.",
    run: async (seed) => {
      const w = await World.create(seed);
      const key = await keyPairFromSeed(w.rng.fork("attacker-key").bytes(32));
      const doc = w.rng.int(50);
      const mallory = await w.consumer("mallory", "token-mallory");
      const alice = await w.consumer("alice", "token-alice");
      const mine = await mallory.interest("fetch_page", { url: url(doc) });
      const evil = await forgeData(mine.name, key, 0, "public");
      if (w.rng.chance(0.5)) mallory.send(mine);
      mallory.push({ type: "data", nonce: mine.nonce, data: evil });
      const ia = await alice.interest("fetch_page", { url: url(doc) });
      alice.send(ia);
      await w.settle();
      const v = await alice.verdict(ia);
      return judge(
        w,
        [v],
        notGenuine(w),
        w.count("drop", "unsolicited") > 0 ? "edge drop: unsolicited" : describe(v),
      );
    },
  }),

  // ---- timing: a known, undefended side channel (07-decisions Q3), measured here.
  variant({
    id: "timing/cache-probe",
    attack: "timing",
    where: "consumer",
    expected: "leaks",
    assumes: "can time its own requests",
    summary: "Asks for a public name and infers from the answer's latency whether someone asked before.",
    run: async (seed) => {
      const w = await World.create(seed);
      const doc = w.rng.int(50);
      const alice = await w.consumer("alice", "token-alice");
      const mallory = await w.consumer("mallory", "token-mallory");
      const asked = w.rng.chance(0.5);
      if (asked) {
        alice.send(await alice.interest("fetch_page", { url: url(doc) }));
        await w.settle();
      }
      await w.advance(w.rng.int(TTL_MS / 2));
      const t0 = w.clock.now();
      const im = await mallory.interest("fetch_page", { url: url(doc) });
      mallory.send(im);
      await w.settle();
      const v = await mallory.verdict(im);
      if (v.kind !== "accepted") return { rejected: true, mechanism: `no answer: ${describe(v)}` };
      // Anything faster than a round trip to the producer can only have come from the cache.
      const guess = v.at - t0 < 2 * AGENT_LINK_MS + 2 * PRODUCER_LINK_MS;
      return guess === asked
        ? {
            rejected: false,
            mechanism: `LEAK: inferred "${asked ? "asked before" : "never asked"}" from latency`,
          }
        : { rejected: true, mechanism: "wrong inference" };
    },
  }),
];

async function privateProbe(
  seed: number,
  o: { concurrent: boolean; anonymous?: boolean; tree?: boolean; forge?: "guess" | "known" },
): Promise<TrialOutcome> {
  const w = await World.create(seed, { tree: o.tree ?? false });
  const alice = await w.consumer("alice", "token-alice", 0);
  const other = o.anonymous ? undefined : `token-${w.rng.uint32().toString(36)}`;
  const mallory = await w.consumer("mallory", other, o.tree ? 1 : 0);
  const ia = await alice.interest("my_notes", {});
  const im = await mallory.interest("my_notes", {});
  const raw: Partial<Interest> = {};
  if (o.forge === "known") raw.authContext = await deriveAuthContext(EDGE_SECRET, "token-alice");
  if (o.forge === "guess") {
    raw.authContext = Array.from(w.rng.bytes(11), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  if (o.concurrent) {
    if (w.rng.chance(0.5)) {
      alice.send(ia);
      mallory.send(im, raw);
    } else {
      mallory.send(im, raw);
      alice.send(ia);
    }
    await w.settle();
  } else {
    alice.send(ia);
    await w.settle();
    await w.advance(w.rng.int(TTL_MS / 2));
    mallory.send(im, raw);
    await w.settle();
  }
  const va = await alice.verdict(ia);
  const vm = await mallory.verdict(im);
  if (va.kind !== "accepted" || va.text !== notesOf("token-alice")) {
    return {
      rejected: false,
      mechanism: `victim got ${va.kind === "accepted" ? "another user's result" : describe(va)}`,
    };
  }
  if (vm.kind === "accepted" && vm.text !== notesOf(other)) {
    return {
      rejected: false,
      mechanism: "ACCEPTED: another user's private result served from the edge cache",
    };
  }
  // A regional forwarder must hold no private Data at all [P-8.3].
  if (o.tree && (w.stores[0] as MemoryContentStore).stats().entries > 0) {
    return { rejected: false, mechanism: "ACCEPTED: private Data cached beyond the edge" };
  }
  const mine = vm.kind === "accepted" ? "got its own result" : describe(vm);
  const shared = w.count("cs_hit") + w.count("pit_aggregate") > 0;
  return {
    rejected: true,
    mechanism: `${mine}; ${shared ? "edge shared an entry" : "no shared cache or PIT entry"}`,
  };
}

async function poisonUpstream(
  seed: number,
  how: "unknown-key" | "spoofed-key-id" | "other-producer" | "rogue-manifest",
): Promise<TrialOutcome> {
  const w = await World.create(seed);
  const key = await keyPairFromSeed(w.rng.fork("attacker-key").bytes(32));
  const doc = w.rng.int(50);
  const victims = await Promise.all(
    Array.from({ length: 1 + w.rng.int(3) }, (_, i) => w.consumer(`victim-${i}`, `token-${i}`)),
  );
  const interests = await Promise.all(victims.map((v) => v.interest("fetch_page", { url: url(doc) })));
  const name = (interests[0] as Interest).name;
  let evil = await forgeData(name, key, 0, "public");
  let note = "";
  if (how === "spoofed-key-id") {
    evil = { ...evil, signature: { ...evil.signature, keyLocator: keyLocator(PRODUCER, w.key.keyId) } };
  } else if (how === "other-producer") {
    // The attacker runs "evil.example", whose manifest every node has accepted.
    const other = "evil.example";
    const manifest = await signManifest(
      {
        producer: other,
        version: 1,
        keys: [{ keyId: key.keyId, publicKeyJwk: key.publicKeyJwk }],
        tools: [],
      },
      key,
    );
    for (const t of [...w.trusts, ...victims.map((v) => v.trust)]) await t.addManifest(manifest, { now: 0 });
    evil = { ...evil, signature: { ...evil.signature, keyLocator: keyLocator(other, key.keyId) } };
  } else if (how === "rogue-manifest") {
    const rogue = await signManifest(
      {
        producer: PRODUCER,
        version: w.manifest.version + 1,
        keys: [{ keyId: key.keyId, publicKeyJwk: key.publicKeyJwk }],
        tools: w.manifest.tools,
      },
      key,
    );
    const results = await Promise.all(
      [...w.trusts, ...victims.map((v) => v.trust)].map((t) => t.addManifest(rogue, { now: 0 })),
    );
    if (results.some((r) => r.ok)) return { rejected: false, mechanism: "ACCEPTED: rogue manifest trusted" };
    note = "manifest refused: UNTRUSTED_KEY; ";
  }
  w.upstream.toA = once(() => evil);
  victims.forEach((v, i) => {
    v.send(interests[i] as Interest);
  });
  await w.settle();
  const verdicts = await Promise.all(victims.map((v, i) => v.verdict(interests[i] as Interest)));
  return judge(
    w,
    verdicts,
    notGenuine(w),
    `${note}forwarder verify_fail → ${describe(verdicts[0] as Verdict)}`,
  );
}

/** Tally the outcomes of one variant into a `metrics.csv` line. */
export function tally(v: SafetyVariant, outcomes: readonly TrialOutcome[]): SafetyRow {
  const counts = new Map<string, number>();
  for (const o of outcomes) counts.set(o.mechanism, (counts.get(o.mechanism) ?? 0) + 1);
  const rejected = outcomes.filter((o) => o.rejected).length;
  return {
    attack: v.attack,
    variant: v.id,
    where: v.where,
    expected: v.expected,
    trials: outcomes.length,
    rejected,
    accepted: outcomes.length - rejected,
    mechanisms: [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([m, n]) => `${m}=${n}`)
      .join(MECHANISM_SEPARATOR),
    assumes: v.assumes ?? "",
    summary: v.summary,
  };
}

/** Run the safety suite: every selected variant, `trials` times, seeds `seed … seed + trials − 1`. */
export async function runSafety(
  cfg: SafetyConfig,
  opts: { onProgress?: (done: number, total: number) => void } = {},
): Promise<{ rows: SafetyRow[]; trials: SafetyTrialRow[] }> {
  const unknown = (cfg.variants ?? []).filter((id) => !SAFETY_VARIANTS.some((v) => v.id === id));
  if (unknown.length > 0) throw new Error(`config: unknown safety variant(s): ${unknown.join(", ")}`);
  const selected = SAFETY_VARIANTS.filter((v) => !cfg.variants || cfg.variants.includes(v.id));
  const rows: SafetyRow[] = [];
  const trials: SafetyTrialRow[] = [];
  const total = selected.length * cfg.trials;
  let done = 0;
  for (const v of selected) {
    const outcomes: TrialOutcome[] = [];
    for (let k = 0; k < cfg.trials; k++) {
      const seed = cfg.seed + k;
      const o = await v.run(seed);
      outcomes.push(o);
      trials.push({ variant: v.id, trial: k, seed, rejected: o.rejected, mechanism: o.mechanism });
      opts.onProgress?.(++done, total);
    }
    rows.push(tally(v, outcomes));
  }
  return { rows, trials };
}
