"use client";

import { type ReactNode, useRef } from "react";
import { useMessages } from "@/lib/i18n/client";
import { landing } from "@/lib/i18n/messages/landing";
import {
  backIn,
  backOut,
  easeIn,
  fade,
  flag,
  type Pt,
  put,
  putPacket,
  seg,
  travel,
  useFrames,
  wobble,
} from "./motion";
import { Agent, Check, Cross, Forwarder, Packet, Producer, parts, Seal, Svg } from "./parts";

/*
 * One looping scene per guarantee (spec 01 §6–§8), each a few seconds long and playing only while
 * on screen: the signed manifest decides what is stored; a private result stays in its owner's
 * partition; a tampered answer fails the consumer's check and the call is retried at the producer;
 * a call with a side effect passes through untouched. Reduced motion shows one still frame that
 * carries the point of each.
 */

const W = 440;
const H = 172;
type Get = (k: string) => Element | null;
type Scene = { loop: number; poster: number; paint: (t: number, $: Get) => void };

/** Shared geometry: a consumer on the left, a forwarder in the middle, the producer on the right. */
const A: Pt = [44, 96];
const F: Pt = [214, 96];
const P: Pt = [396, 96];

const popIn = (t: number, at: number, d = 0.4) => 0.25 + 0.75 * backOut(seg(t, at, d), 2.4);
const show = (el: Element | null, t: number, from: number, to: number, x: number, y: number) => {
  if (t < from || t > to + 0.3) return fade(el, 0);
  const out = seg(t, to, 0.3);
  fade(el, 1 - out);
  put(el, x, y, popIn(t, from) * (1 - backIn(out) * 0.6));
};
const bounce = (el: Element | null, p: Pt, t: number, ...at: number[]) => {
  const w = at.reduce((s, a) => s + wobble(t - a), 0) * 0.24;
  put(el, p[0], p[1], 1 + w * 0.6, 0, 1 - w);
};

/** 1. Signed authorization: the manifest's word, not the annotation, decides what the CS keeps. */
const authorization: Scene = {
  loop: 6.4,
  poster: 4.6,
  paint(t, $) {
    // A signed Data comes down from the producer; its tool is cacheable in the manifest.
    travel($("d1"), [P, F], t, 0.2, 0.9);
    travel($("d2"), [F, A], t, 1.25, 0.8);
    show($("ok"), t, 1.15, 2.8, F[0] + 46, 135);
    // A copy drops into the CS.
    const cardIn = seg(t, 1.15, 0.45);
    const cardOut = seg(t, 5.9, 0.3);
    fade($("card"), t < 1.15 ? 0 : 1 - cardOut);
    put($("card"), F[0] + 2, 148 - (1 - backOut(cardIn)) * 22, 1 - backIn(cardOut) * 0.5);
    // A plain result from a tool that only claims readOnlyHint passes by; the CS shakes its head.
    travel($("o1"), [P, F, A], t, 2.9, 1.7);
    // Its tag rides along: the only claim it has is the MCP annotation.
    const u = seg(t, 2.9, 1.7);
    const tx = P[0] + (A[0] - P[0]) * (0.5 - 0.5 * Math.cos(Math.PI * u));
    if (t < 2.75 || t > 4.9) fade($("tag"), 0);
    else {
      fade($("tag"), 1 - seg(t, 4.6, 0.3));
      put($("tag"), tx, A[1] - 16, popIn(t, 2.75));
    }
    show($("no"), t, 3.75, 5.0, F[0] + 46, 135);
    const shake = t > 3.75 && t < 4.35 ? Math.sin((t - 3.75) * 40) * 3 * (1 - seg(t, 3.75, 0.6)) : 0;
    put($("cs"), shake, 0);
    const agent = $("agent");
    flag(agent, "is-done", t > 2.05 && t < 2.9);
    bounce(agent, A, t, 2.05, 4.6);
    bounce($("fwd"), F, t, 1.1, 3.75);
  },
};

/** 2. Private never leaks: Alice's result stays in Alice's partition; Bob's ask goes upstream. */
const ALICE: Pt = [44, 52];
const BOB: Pt = [44, 140];
const privacy: Scene = {
  loop: 9,
  poster: 6.6,
  paint(t, $) {
    // Alice asks, the producer answers, the Data lands in her partition and reaches her.
    travel($("ai"), [ALICE, F], t, 0.2, 0.75);
    travel($("ai2"), [F, P], t, 1.0, 0.85);
    travel($("ad"), [P, F], t, 2.15, 0.85);
    travel($("ad2"), [F, ALICE], t, 3.1, 0.75);
    const aIn = seg(t, 3.0, 0.45);
    const out = seg(t, 8.5, 0.3);
    fade($("acard"), t < 3.0 ? 0 : 1 - out);
    put($("acard"), 296, 46 - (1 - backOut(aIn)) * 16, 1 - backIn(out) * 0.5);
    // Bob asks for the same name. Alice's partition stays shut; his Interest goes to the producer.
    travel($("bi"), [BOB, F], t, 4.2, 0.75);
    const jig = t > 5.0 && t < 5.7 ? Math.sin((t - 5.0) * 38) * 7 * (1 - seg(t, 5.0, 0.7)) : 0;
    put($("lock"), 332, 46, 1, jig);
    show($("bx"), t, 5.0, 6.1, 346, 28);
    travel($("bi2"), [F, P], t, 5.25, 0.85);
    travel($("bd"), [P, F], t, 6.4, 0.85);
    travel($("bd2"), [F, BOB], t, 7.35, 0.75);
    const bIn = seg(t, 7.25, 0.45);
    fade($("bcard"), t < 7.25 ? 0 : 1 - out);
    put($("bcard"), 296, 146 - (1 - backOut(bIn)) * 16, 1 - backIn(out) * 0.5);
    const alice = $("alice");
    const bob = $("bob");
    flag(alice, "is-wait", t > 0.2 && t < 3.85);
    flag(alice, "is-done", t >= 3.85 && t < 8.5);
    flag(bob, "is-wait", t > 4.2 && t < 8.1);
    flag(bob, "is-done", t >= 8.1);
    bounce(alice, ALICE, t, 3.85);
    bounce(bob, BOB, t, 8.1);
    bounce($("fwd"), F, t, 0.95, 2.95, 4.95, 7.2);
    bounce($("prod"), P, t, 1.85, 6.1);
  },
};

/** 3. End-to-end verification: a good signature passes; a tampered answer is thrown away and retried. */
const ARC: Pt[] = [A, [92, 34], [220, 22], [348, 34], P];
const verification: Scene = {
  loop: 8.4,
  poster: 3.75,
  paint(t, $) {
    // A signed Data from a cache: the agent checks it, it holds.
    travel($("d1"), [F, A], t, 0.2, 0.85);
    show($("ok1"), t, 1.1, 2.3, A[0] + 20, A[1] - 20);
    // The cache hands over a tampered one: the check fails, it is thrown away.
    const tStart = 2.6;
    const tArrive = tStart + 0.85;
    const bad = $("d2");
    const badge = $("scribble");
    if (t >= tStart && t < tArrive) {
      travel(bad, [F, A], t, tStart, 0.85);
      const u = seg(t, tStart, 0.85);
      const x = F[0] + (A[0] - F[0]) * (0.5 - 0.5 * Math.cos(Math.PI * u));
      fade(badge, 1);
      put(badge, x, A[1] - 12);
    } else if (t >= tArrive && t < tArrive + 1.1) {
      // It shakes, then falls away, turning.
      const k = t - tArrive;
      const shake = k < 0.45 ? Math.sin(k * 44) * 4 * (1 - k / 0.45) : 0;
      const fall = easeIn(seg(k, 0.45, 0.65));
      putPacket(bad, A[0] + 22 + shake, A[1] + fall * 60, 0.6 + fall * 2.4, 0, 1 - fall);
      fade(badge, 1 - fall);
      put(badge, A[0] + 22 + shake, A[1] - 12 + fall * 60);
    } else {
      fade(bad, 0);
      fade(badge, 0);
    }
    show($("tampered"), t, 2.45, 4.4, F[0], F[1] + 46);
    show($("no"), t, tArrive, 4.6, A[0] + 20, A[1] - 20);
    // The agent asks the producer directly, over the dashed arc, and gets a good answer.
    const arcOn = t > 4.5 && t < 8.1;
    fade($("arc"), arcOn ? 1 : 0);
    show($("retry"), t, 4.5, 7.9, 220, 14);
    travel($("ri"), ARC, t, 4.6, 1.1);
    travel($("rd"), [...ARC].reverse(), t, 6.0, 1.1);
    show($("ok2"), t, 7.15, 8.0, A[0] + 20, A[1] - 20);
    const agent = $("agent");
    flag(agent, "is-wait", t > 4.6 && t < 7.1);
    flag(agent, "is-done", (t > 1.05 && t < 2.5) || (t >= 7.1 && t < 8.1));
    bounce(agent, A, t, 1.05, tArrive, 7.1);
    bounce($("prod"), P, t, 5.7);
  },
};

/** 4. Transparent to MCP: a call with a side effect goes straight through as plain MCP. */
const transparent: Scene = {
  loop: 6.2,
  poster: 1.3,
  paint(t, $) {
    travel($("o1"), [A, F, P], t, 0.3, 1.8);
    travel($("o2"), [P, F, A], t, 2.6, 1.8);
    show($("label"), t, 0.3, 4.4, 128, 70);
    show($("untouched"), t, 1.05, 4.6, F[0], 162);
    const agent = $("agent");
    flag(agent, "is-wait", t > 0.3 && t < 4.4);
    bounce(agent, A, t, 4.4);
    bounce($("prod"), P, t, 2.1);
  },
};

const SCENES: Scene[] = [authorization, privacy, verification, transparent];

/** The still and moving pieces of each scene. */
function Drawing({ which }: { which: number }) {
  const t = useMessages(landing).guarantees;
  const node = (label: string, p: Pt, el: ReactNode, below = 30) => (
    <>
      {el}
      <text x={p[0]} y={p[1] + below} textAnchor="middle" className="lbl">
        {label}
      </text>
    </>
  );
  if (which === 0) {
    const v = t.v1;
    return (
      <>
        <path d={`M${A[0]} ${A[1]}H${P[0]}`} className="ln" />
        <g data-k="cs">
          <rect x={F[0] - 32} y={128} width={64} height={34} rx={7} className="tbl" />
          <text x={F[0] - 24} y={150} className="lbl lbl-strong">
            {v.cs}
          </text>
        </g>
        <g data-k="card" opacity={0} visibility="hidden">
          <rect x={-2} y={-8} width={26} height={14} rx={3} className="card-d" />
        </g>
        <g>
          <rect x={284} y={8} width={150} height={50} rx={8} className="tbl" />
          <g transform="translate(298 23)">
            <Seal r={7} />
          </g>
          <text x={311} y={27} className="lbl" style={{ fontSize: 11.5 }}>
            {v.manifest}
          </text>
          <text x={294} y={47} className="mono tiny lbl-fg">
            fetch_page
          </text>
          <text x={366} y={47} className="lbl" style={{ fontSize: 11 }}>
            {v.cacheable}
          </text>
        </g>
        <path d={`M${F[0] + 10} ${F[1] - 12}L284 40`} className="ln ln-dash ln-faint" />
        <g data-k="tag" opacity={0} visibility="hidden">
          <text textAnchor="middle" className="lbl" style={{ fontSize: 11 }}>
            {v.hint}
          </text>
        </g>
        <g data-k="ok" opacity={0} visibility="hidden">
          <Check s={0.62} />
        </g>
        <g data-k="no" opacity={0} visibility="hidden">
          <Cross s={0.62} />
        </g>
        <Packet tone="d" k="d1" />
        <Packet tone="d" k="d2" />
        <Packet tone="o" k="o1" />
        <Forwarder k="fwd" h={13} />
        <Agent k="agent" r={8} />
        <Producer k="prod" h={14} />
      </>
    );
  }
  if (which === 1) {
    const v = t.v2;
    const locker = (y: number, name: string, k: string) => (
      <g>
        <rect x={244} y={y} width={100} height={30} rx={7} className="tbl" />
        <text x={254} y={y + 19.5} className="lbl lbl-strong" style={{ fontSize: 11.5 }}>
          {name}
        </text>
        <g data-k={k} opacity={0} visibility="hidden">
          <rect x={0} y={-7} width={22} height={14} rx={3} className="card-d" />
        </g>
      </g>
    );
    return (
      <>
        <path
          d={`M${ALICE[0]} ${ALICE[1]}L${F[0]} ${F[1]}M${BOB[0]} ${BOB[1]}L${F[0]} ${F[1]}`}
          className="ln"
        />
        <path d={`M${F[0]} ${F[1]}H${P[0]}`} className="ln" />
        {locker(31, v.alice, "acard")}
        {locker(131, v.bob, "bcard")}
        <g data-k="lock">
          <Lock />
        </g>
        <g transform="translate(332 146)">
          <Lock />
        </g>
        <g data-k="bx" opacity={0} visibility="hidden">
          <Cross s={0.55} />
        </g>
        <path d="M244 46H232L222 84M244 146H232L222 108" className="ln ln-dash ln-faint" />
        {["ai", "ai2", "bi", "bi2"].map((k) => (
          <Packet key={k} tone="i" k={k} />
        ))}
        {["ad", "ad2", "bd", "bd2"].map((k) => (
          <Packet key={k} tone="d" k={k} />
        ))}
        {node(v.edge, F, <Forwarder k="fwd" h={13} />, 32)}
        <Agent k="alice" r={8} />
        <text x={ALICE[0]} y={ALICE[1] - 16} textAnchor="middle" className="lbl lbl-strong">
          {v.alice}
        </text>
        <Agent k="bob" r={8} />
        <text x={BOB[0]} y={BOB[1] + 26} textAnchor="middle" className="lbl lbl-strong">
          {v.bob}
        </text>
        <Producer k="prod" h={14} />
        <text x={W - 4} y={P[1] + 34} textAnchor="end" className="lbl">
          {v.upstream}
        </text>
      </>
    );
  }
  if (which === 2) {
    const v = t.v3;
    return (
      <>
        <path d={`M${A[0]} ${A[1]}H${P[0]}`} className="ln" />
        <path
          data-k="arc"
          d={`M${ARC.map((p) => p.join(" ")).join("L")}`}
          className="ln ln-dash ln-i"
          opacity={0}
          strokeLinejoin="round"
        />
        <g data-k="retry" opacity={0} visibility="hidden">
          <text y={-2} textAnchor="middle" className="lbl lbl-i" style={{ fontSize: 11.5 }}>
            {v.retry}
          </text>
        </g>
        <g data-k="tampered" opacity={0} visibility="hidden">
          <text textAnchor="middle" className="lbl lbl-strong" style={{ fontSize: 11.5 }}>
            {v.tampered}
          </text>
        </g>
        <Packet tone="d" k="d1" />
        <Packet tone="d" k="d2" />
        <g data-k="scribble" opacity={0} visibility="hidden">
          <path d="M-7 1l3-4 3 4 3-4 3 4" className="mk mk-fg" strokeWidth={1.8} />
        </g>
        <Packet tone="i" k="ri" />
        <Packet tone="d" k="rd" />
        {node(v.cache, F, <Forwarder k="fwd" h={13} />)}
        <Agent k="agent" r={8} />
        <text x={A[0]} y={A[1] + 30} textAnchor="middle" className="lbl">
          {v.agent}
        </text>
        <Producer k="prod" h={14} />
        <text x={P[0]} y={P[1] + 32} textAnchor="middle" className="lbl">
          {v.producer}
        </text>
        <g data-k="ok1" opacity={0} visibility="hidden">
          <Check s={0.7} />
        </g>
        <g data-k="ok2" opacity={0} visibility="hidden">
          <Check s={0.7} />
        </g>
        <g data-k="no" opacity={0} visibility="hidden">
          <Cross s={0.7} />
        </g>
      </>
    );
  }
  const v = t.v4;
  return (
    <>
      <path d={`M${A[0]} ${A[1]}H${P[0]}`} className="ln" />
      <g>
        <rect x={F[0] - 54} y={124} width={50} height={24} rx={6} className="tbl" />
        <text x={F[0] - 29} y={140} textAnchor="middle" className="lbl lbl-strong" style={{ fontSize: 11 }}>
          PIT
        </text>
        <rect x={F[0] + 4} y={124} width={50} height={24} rx={6} className="tbl" />
        <text x={F[0] + 29} y={140} textAnchor="middle" className="lbl lbl-strong" style={{ fontSize: 11 }}>
          CS
        </text>
        <path d={`M${F[0]} ${F[1] + 16}V124`} className="ln ln-faint" />
      </g>
      <g data-k="untouched" opacity={0} visibility="hidden">
        <text textAnchor="middle" className="lbl" style={{ fontSize: 11.5 }}>
          {v.untouched}
        </text>
      </g>
      <g data-k="label" opacity={0} visibility="hidden">
        <text textAnchor="middle" className="mono tiny lbl-fg">
          {v.call}
        </text>
        <text y={-14} textAnchor="middle" className="lbl" style={{ fontSize: 11.5 }}>
          {v.plain}
        </text>
      </g>
      <Packet tone="o" k="o1" />
      <Packet tone="o" k="o2" />
      <Forwarder k="fwd" h={13} />
      <Agent k="agent" r={8} />
      <Producer k="prod" h={14} />
    </>
  );
}

/** A padlock, drawn flat. */
function Lock() {
  return (
    <g>
      <path d="M-4.5 -2V-5.5a4.5 4.5 0 0 1 9 0V-2" className="mk mk-fg" strokeWidth={2} />
      <rect x={-7} y={-2.5} width={14} height={11} rx={2.5} className="f-fg" />
    </g>
  );
}

/** One guarantee's looping scene. */
export function Vignette({ which }: { which: number }) {
  const t = useMessages(landing).guarantees;
  const svg = useRef<SVGSVGElement>(null);
  const scene = SCENES[which] ?? authorization;
  const lookup = useRef<{ root: Element | null; get: Get }>({ root: null, get: () => null });
  const titles = [t.v1.title, t.v2.title, t.v3.title, t.v4.title];
  useFrames(
    svg,
    (time) => {
      if (lookup.current.root !== svg.current)
        lookup.current = { root: svg.current, get: parts(svg.current) };
      const $ = lookup.current.get;
      // Nodes start at rest in their places, then the scene moves them.
      put($("agent"), A[0], A[1]);
      put($("fwd"), F[0], F[1]);
      put($("prod"), P[0], P[1]);
      put($("alice"), ALICE[0], ALICE[1]);
      put($("bob"), BOB[0], BOB[1]);
      scene.paint(time % scene.loop, $);
    },
    { poster: scene.poster },
  );
  return (
    <div className="vignette px-3 pt-4 pb-2 sm:px-5">
      <Svg svgRef={svg} title={titles[which] ?? ""} w={W} h={H} className="mx-auto max-w-[480px]">
        <Drawing which={which} />
      </Svg>
    </div>
  );
}
