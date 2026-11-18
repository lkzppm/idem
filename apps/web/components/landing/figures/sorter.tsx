"use client";

import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { useMessages } from "@/lib/i18n/client";
import { landing } from "@/lib/i18n/messages/landing";
import { backOut, fade, flag, type Pt, put, seg, travel, useFrames, useWide, wobble } from "./motion";
import { Agent, Check, Cross, Packet, Producer, parts, Svg } from "./parts";

/*
 * The forwarder pipeline of spec 01 §7, as a sorter: one Interest at a time enters on the left and
 * visibly takes its branch (pass through, drop, reply from the CS, add its face to a pending PIT
 * entry, or forward); for a forwarded one, the Data comes back along the lower row (verify, store,
 * satisfy every waiting face, clear the entry). Five scenarios play in turn; picking one replays it
 * and stops the turn-taking. Reduced motion shows each scenario's finished path.
 */

type Id =
  | "in"
  | "cacheable"
  | "valid"
  | "cs"
  | "pit"
  | "fwd"
  | "pass"
  | "drop"
  | "reply"
  | "add"
  | "dataIn"
  | "verify"
  | "store"
  | "satisfy"
  | "clear";

const INTEREST_ROW: Id[] = ["in", "cacheable", "valid", "cs", "pit", "fwd"];
const OUTCOMES: Id[] = ["pass", "drop", "reply", "add"];
const DATA_ROW: Id[] = ["dataIn", "verify", "store", "satisfy", "clear"];
const ALL: Id[] = [...INTEREST_ROW, ...OUTCOMES, ...DATA_ROW];
/** Which answer at each test keeps the Interest on the spine, and where the other one leads. */
const EXITS: { from: Id; to: Id; say: "yes" | "no" }[] = [
  { from: "cacheable", to: "pass", say: "no" },
  { from: "valid", to: "drop", say: "no" },
  { from: "cs", to: "reply", say: "yes" },
  { from: "pit", to: "add", say: "yes" },
];
const SPINE_SAY: Partial<Record<Id, "yes" | "no">> = { valid: "yes", cs: "yes", pit: "no", fwd: "no" };

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Geo {
  w: number;
  h: number;
  box: Record<Id, Rect>;
  producer: Pt;
  prodLabel: [number, number, "start" | "end" | "middle"];
  faces: Pt[];
  /** The failed-verification branch: a dashed stem, then its words (two lines when `stack`). */
  fail: { from: Pt; to: Pt; text: Pt; anchor: "start" | "middle" | "end"; stack: boolean };
  labelI: Pt;
  labelD: [number, number, "start" | "end"];
  /** A dashed rule between the two rows, from `x0` to `x1`. */
  divider: { y: number; x0: number; x1: number };
  entry: Pt;
  replyBack: Pt[];
}

/*
 * Two layouts. Wide: the Interest row runs left to right with its exits hanging below it, and the
 * Data row comes back right to left under a divider; the producer sits on the divider at the end of
 * the row. Narrow: the Interest row runs down the left column with its exits to the right, and the
 * Data row runs down the right column. Every gap a yes/no word sits in is at least 20 units wider
 * (or taller) than the word, and the reply path from the CS has a lane of its own.
 */
function geometry(wide: boolean): Geo {
  if (wide) {
    const W = 108;
    const col = (c: number) => 16 + c * (W + 40);
    const cx = (c: number) => col(c) + W / 2;
    const r = (c: number, y: number, h: number): Rect => ({ x: col(c), y, w: W, h });
    const TOP = 40; // Interest row: 40..90; its exits drop 40 to the outcomes: 130..174.
    const OUT = 130;
    const LANE = 198; // the reply's way back, under the outcomes
    const RULE = 226; // the divider, with the producer on it
    const DATA = 270; // Data row: 270..320
    const box = {
      in: r(0, TOP, 50),
      cacheable: r(1, TOP, 50),
      valid: r(2, TOP, 50),
      cs: r(3, TOP, 50),
      pit: r(4, TOP, 50),
      fwd: r(5, TOP, 50),
      pass: r(1, OUT, 44),
      drop: r(2, OUT, 44),
      reply: r(3, OUT, 44),
      add: r(4, OUT, 44),
      dataIn: r(5, DATA, 50),
      verify: r(4, DATA, 50),
      store: r(3, DATA, 50),
      satisfy: r(2, DATA, 50),
      clear: r(1, DATA, 50),
    } satisfies Record<Id, Rect>;
    return {
      w: col(5) + W + 16,
      h: 372,
      box,
      producer: [cx(5), RULE],
      prodLabel: [cx(5) - 24, RULE + 4, "end"],
      faces: [-1, 0, 1].map((k) => [cx(2) + k * 30, DATA + 88] as Pt),
      fail: {
        from: [cx(4), DATA + 50],
        to: [cx(4), DATA + 66],
        text: [cx(4), DATA + 80],
        anchor: "middle",
        stack: true,
      },
      labelI: [16, 26],
      labelD: [16, RULE + 30, "start"],
      divider: { y: RULE, x0: 16, x1: col(4) + W },
      entry: [-6, TOP + 25],
      replyBack: [
        [cx(3), OUT + 44],
        [cx(3), LANE],
        [cx(0), LANE],
        [cx(0), TOP + 50],
      ],
    };
  }
  const L = 12;
  const W = 146;
  const R = L + W + 40;
  const LANE = R + W + 14; // the reply's way back, outside the right column
  const row = (k: number) => 46 + k * 62; // Interest rows: 42 tall, 20 apart
  const drow = (k: number) => 458 + k * 52; // Data rows: no words between them, so closer
  const r = (x: number, y: number): Rect => ({ x, y, w: W, h: 42 });
  const box = {
    in: r(L, row(0)),
    cacheable: r(L, row(1)),
    valid: r(L, row(2)),
    cs: r(L, row(3)),
    pit: r(L, row(4)),
    fwd: r(L, row(5)),
    pass: r(R, row(1)),
    drop: r(R, row(2)),
    reply: r(R, row(3)),
    add: r(R, row(4)),
    dataIn: r(R, drow(0)),
    verify: r(R, drow(1)),
    store: r(R, drow(2)),
    satisfy: r(R, drow(3)),
    clear: r(R, drow(4)),
  } satisfies Record<Id, Rect>;
  const w = LANE + 14;
  return {
    w,
    h: drow(4) + 54,
    box,
    producer: [R + W / 2, row(5) + 21],
    prodLabel: [R + W / 2 + 24, row(5) + 25, "start"],
    faces: [0, 1, 2].map((k) => [L + 40 + k * 32, drow(3) + 21] as Pt),
    fail: {
      from: [R, drow(1) + 21],
      to: [R - 22, drow(1) + 21],
      text: [R - 28, drow(1) + 25],
      anchor: "end",
      stack: false,
    },
    labelI: [L + W / 2 + 14, 30],
    labelD: [L, drow(0) - 12, "start"],
    divider: { y: drow(0) - 36, x0: L, x1: w - L },
    entry: [L + W / 2, 6],
    replyBack: [
      [R + W, row(3) + 21],
      [LANE, row(3) + 21],
      [LANE, row(0) + 21],
      [L + W, row(0) + 21],
    ],
  };
}

const mid = (b: Rect): Pt => [b.x + b.w / 2, b.y + b.h / 2];

/** A connector between two boxes (or a box and a point), from side to side along the main axis. */
function link(a: Rect | Pt, b: Rect | Pt): Pt[] {
  const ra: Rect = "x" in a ? a : { x: a[0] - 17, y: a[1] - 17, w: 34, h: 34 };
  const rb: Rect = "x" in b ? b : { x: b[0] - 17, y: b[1] - 17, w: 34, h: 34 };
  const [ax, ay] = mid(ra);
  const [bx, by] = mid(rb);
  if (Math.abs(bx - ax) >= Math.abs(by - ay)) {
    const s = bx > ax ? 1 : -1;
    return [
      [ax + (s * ra.w) / 2, ay],
      [bx - (s * rb.w) / 2, by],
    ];
  }
  const s = by > ay ? 1 : -1;
  return [
    [ax, ay + (s * ra.h) / 2],
    [bx, by - (s * rb.h) / 2],
  ];
}

type Ev =
  | { k: "move"; pk: string; pts: Pt[]; t0: number; dur: number }
  | { k: "land"; at: Id | "producer"; tone: "i" | "d"; t: number; end?: boolean }
  | { k: "pop"; el: string; t: number };

const MOVE = 0.42;
const THINK = 0.3;
/** Seconds a finished scenario stays on screen before the next one plays. */
const HOLD = 2.4;

/** The timeline of one scenario: where the packets go and when each box reacts. */
function script(s: number, g: Geo): { evs: Ev[]; total: number } {
  const evs: Ev[] = [];
  let t = 0.15;
  const b = g.box;
  const move = (pk: string, pts: Pt[], dur = MOVE) => {
    evs.push({ k: "move", pk, pts, t0: t, dur });
    t += dur;
  };
  const land = (at: Id | "producer", tone: "i" | "d", end = false) =>
    evs.push({ k: "land", at, tone, t, end });
  const pop = (el: string, delay = 0) => evs.push({ k: "pop", el, t: t + delay });

  // In from a face, then down the spine until the scenario's exit.
  move("tok-i", [g.entry, entryPoint(g)]);
  land("in", "i");
  const path: Id[] = ["in", "cacheable", "valid", "cs", "pit", "fwd"];
  const stop = [1, 2, 3, 4, 5][s] ?? 5;
  for (let i = 1; i <= stop; i++) {
    const from = path[i - 1] as Id;
    const to = path[i] as Id;
    t += i === 1 ? 0.12 : THINK;
    if (SPINE_SAY[to]) pop(`say-${to}`);
    move("tok-i", link(b[from], b[to]));
    land(to, "i", s === 4 && to === "fwd");
  }
  const exit = EXITS[s];
  if (exit) {
    t += THINK;
    pop(`say-${exit.to}`);
    move(s === 0 ? "tok-o" : "tok-i", link(b[exit.from], b[exit.to]));
    land(exit.to, s === 2 ? "d" : "i", true);
    if (s === 1) pop("drop-x");
    if (s === 3) pop("add-face");
    if (s === 2) {
      t += 0.2;
      move("back-d", g.replyBack, 0.9);
      land("in", "d");
    }
    return { evs, total: t + 0.4 };
  }
  // Forwarded: up to the next hop, then the Data's way back.
  t += 0.15;
  move("tok-i", link(b.fwd, g.producer));
  land("producer", "i");
  t += 0.45;
  move("tok-d", link(g.producer, b.dataIn));
  land("dataIn", "d");
  for (const [from, to] of [
    ["dataIn", "verify"],
    ["verify", "store"],
    ["store", "satisfy"],
  ] as [Id, Id][]) {
    t += 0.18;
    move("tok-d", link(b[from], b[to]), 0.36);
    land(to, "d");
    if (to === "verify") pop("verify-ok", 0.08);
    if (to === "store") pop("store-card", 0.05);
  }
  t += 0.2;
  const fanAt = t;
  g.faces.forEach((f, k) => {
    evs.push({
      k: "move",
      pk: `fan${k}`,
      pts: link(b.satisfy, [f[0], f[1]]),
      t0: fanAt + k * 0.06,
      dur: 0.55,
    });
    evs.push({ k: "pop", el: `face${k}`, t: fanAt + k * 0.06 + 0.55 });
  });
  t += 0.35;
  move("tok-d", link(b.satisfy, b.clear), 0.36);
  land("clear", "d", true);
  return { evs, total: t + 0.4 };
}

/** Where the entering Interest meets the first box. */
function entryPoint(g: Geo): Pt {
  const b = g.box.in;
  return g.entry[1] < b.y ? [b.x + b.w / 2, b.y] : [b.x, b.y + b.h / 2];
}

/** The forwarder pipeline, with its scenario picker. */
export function Sorter() {
  const t = useMessages(landing).forwarder;
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const wide = useWide(box, 720);
  const geo = useMemo(() => geometry(wide), [wide]);
  const [scene, setScene] = useState(0);
  const [auto, setAuto] = useState(true);
  const [run, setRun] = useState(0);
  const plan = useMemo(() => script(scene, geo), [scene, geo]);
  /** Set once the current scenario has asked for the next one, so a few frames can't skip ahead. */
  const advanced = useRef(false);
  const lookup = useRef<{ root: Element | null; get: (k: string) => Element | null }>({
    root: null,
    get: () => null,
  });

  const draw = (now: number) => {
    if (lookup.current.root !== svg.current) lookup.current = { root: svg.current, get: parts(svg.current) };
    const $ = lookup.current.get;
    const { evs } = plan;

    // Packets: for each one, the move that is under way (if any).
    const active = new Map<string, Ev & { k: "move" }>();
    for (const e of evs) if (e.k === "move" && now >= e.t0 && now <= e.t0 + e.dur) active.set(e.pk, e);
    for (const pk of ["tok-i", "tok-o", "tok-d", "back-d", "fan0", "fan1", "fan2"]) {
      const m = active.get(pk);
      if (m) travel($(pk), m.pts, now, m.t0, m.dur);
      else fade($(pk), 0);
    }

    // Boxes: lit in the tone of what passed through them, filled where the trip ended, wobbling on landing.
    const lit = new Map<string, { tone: "i" | "d"; end: boolean; t: number }>();
    for (const e of evs) {
      if (e.k !== "land" || now < e.t) continue;
      const prev = lit.get(e.at);
      lit.set(e.at, { tone: e.tone, end: (prev?.end ?? false) || !!e.end, t: e.t });
    }
    for (const id of ALL) {
      const el = $(`b-${id}`);
      const l = lit.get(id);
      flag(el, "is-i", l?.tone === "i");
      flag(el, "is-d", l?.tone === "d");
      flag(el, "is-end", !!l?.end);
      const r = geo.box[id];
      const w = l ? wobble(now - l.t) * 0.12 : 0;
      put(el, r.x + r.w / 2, r.y + r.h / 2, 1 + w * 0.5, 0, 1 - w);
    }
    const pl = lit.get("producer");
    const pw = pl ? wobble(now - pl.t) * 0.25 : 0;
    put($("prod"), geo.producer[0], geo.producer[1], 1 + pw * 0.6, 0, 1 - pw);

    // Pops: decision words, the cross, the tick, the stored card, the added face, the fed faces.
    const popped = new Map<string, number>();
    for (const e of evs) if (e.k === "pop") popped.set(e.el, e.t);
    const pops = ["drop-x", "verify-ok", "store-card", "add-face", ...geo.faces.map((_, k) => `face${k}`)];
    for (const id of [...pops, ...ALL.map((i) => `say-${i}`)]) {
      const el = $(id);
      if (!el) continue;
      const at = popped.get(id);
      const on = at !== undefined && now >= at;
      if (id.startsWith("say-")) {
        flag(el, "is-on", on);
        continue;
      }
      if (id.startsWith("face")) {
        flag(el, "is-done", on);
        continue;
      }
      fade(el, on ? 1 : 0);
      if (on) {
        const [x, y] = (el as SVGGElement).dataset.at?.split(",").map(Number) ?? [0, 0];
        put(el, x ?? 0, y ?? 0, 0.3 + 0.7 * backOut(seg(now, at, 0.4), 2.4));
      }
    }
    fade($("reply-path"), scene === 2 ? 1 : 0);

    const bar = bars.current[scene];
    if (bar) bar.style.transform = `scaleX(${auto && !reduced ? Math.min(1, now / (plan.total + HOLD)) : 0})`;
    if (auto && !reduced && !advanced.current && now > plan.total + HOLD) {
      advanced.current = true;
      setScene((x) => (x + 1) % t.scenarios.length);
    }
  };

  // A new scenario (or a replay) may ask for the next one again when it is done.
  useEffect(() => {
    advanced.current = false;
  }, [plan, run]);
  const { reduced } = useFrames(svg, (now) => draw(reduced ? plan.total : now), {
    poster: 999,
    // A picked scenario plays once and holds; the turn-taking keeps the loop running to advance.
    end: auto ? undefined : plan.total,
    deps: [plan, run],
  });

  const say = (id: Id): "yes" | "no" | undefined =>
    SPINE_SAY[id] ?? EXITS.find((e) => e.to === id)?.say ?? undefined;
  /** A yes/no word in the clear: above a level connector, beside an upright one, never on it. */
  const labelAt = (from: Id | undefined, id: Id): [number, number, "start" | "middle"] | undefined => {
    if (!from) return undefined;
    const [p, q] = link(geo.box[from], geo.box[id]) as [Pt, Pt];
    if (Math.abs(q[0] - p[0]) > Math.abs(q[1] - p[1])) return [(p[0] + q[0]) / 2, p[1] - 7, "middle"];
    return [p[0] + 8, (p[1] + q[1]) / 2 + 4, "start"];
  };
  const fromOf = (id: Id): Id | undefined =>
    SPINE_SAY[id] ? INTEREST_ROW[INTEREST_ROW.indexOf(id) - 1] : EXITS.find((e) => e.to === id)?.from;

  const links: { k: string; pts: Pt[]; cls?: string }[] = [
    ...INTEREST_ROW.slice(1).map((id, i) => ({
      k: `s${id}`,
      pts: link(geo.box[INTEREST_ROW[i] as Id], geo.box[id]),
    })),
    ...EXITS.map((e) => ({ k: `x${e.to}`, pts: link(geo.box[e.from], geo.box[e.to]) })),
    { k: "up1", pts: link(geo.box.fwd, geo.producer) },
    { k: "up2", pts: link(geo.producer, geo.box.dataIn) },
    ...DATA_ROW.slice(1).map((id, i) => ({
      k: `d${id}`,
      pts: link(geo.box[DATA_ROW[i] as Id], geo.box[id]),
    })),
    ...geo.faces.map((f, k) => ({ k: `f${k}`, pts: link(geo.box.satisfy, f), cls: "ln-faint" })),
    { k: "fail", pts: [geo.fail.from, geo.fail.to], cls: "ln-dash" },
  ];
  const corner = (id: Id, dx = 0, dy = 0): string => {
    const r = geo.box[id];
    return `${r.x + r.w - 4 + dx},${r.y + 4 + dy}`;
  };

  return (
    <div className="fig-card overflow-hidden">
      <div
        role="group"
        aria-label={t.pick}
        className="flex flex-wrap gap-2 border-b border-line px-4 py-3 sm:px-5"
      >
        {t.scenarios.map((s, i) => (
          <button
            key={s.label}
            type="button"
            aria-pressed={scene === i}
            onClick={() => {
              setAuto(false);
              setScene(i);
              setRun((r) => r + 1);
            }}
            className="pick"
          >
            <span className="pick-label">{s.label}</span>
            <span className="pick-call">{s.call}</span>
            <span
              aria-hidden="true"
              className="pick-bar"
              ref={(el) => {
                bars.current[i] = el;
              }}
              style={{ transform: "scaleX(0)" } as CSSProperties}
            />
          </button>
        ))}
      </div>
      <div ref={box} className="px-2 py-5 sm:px-5">
        <Svg
          svgRef={svg}
          title={t.title2}
          w={geo.w}
          h={geo.h}
          className={`sorter mx-auto ${wide ? "max-w-[940px]" : "max-w-[480px]"}`}
        >
          <text x={geo.labelI[0]} y={geo.labelI[1]} className="lbl lbl-i">
            {t.interestRow}
          </text>
          <text x={geo.labelD[0]} y={geo.labelD[1]} textAnchor={geo.labelD[2]} className="lbl lbl-d">
            {t.dataRow}
          </text>
          <path d={`M${geo.divider.x0} ${geo.divider.y}H${geo.divider.x1}`} className="ln ln-dash ln-faint" />
          {links.map((l) => (
            <path
              key={l.k}
              d={`M${l.pts.map((p) => p.join(" ")).join("L")}`}
              className={`ln ${l.cls ?? ""}`}
            />
          ))}
          <path
            data-k="reply-path"
            d={`M${geo.replyBack.map((p) => p.join(" ")).join("L")}`}
            className="ln ln-d ln-dash"
            opacity={0}
          />
          <text
            x={geo.fail.text[0]}
            y={geo.fail.text[1]}
            textAnchor={geo.fail.anchor}
            className="lbl sorter-fail"
          >
            {geo.fail.stack ? (
              <>
                <tspan>{t.failsHead}</tspan>
                <tspan x={geo.fail.text[0]} dy={15}>
                  {t.failsBody}
                </tspan>
              </>
            ) : (
              t.failsShort
            )}
          </text>

          <Packet tone="i" k="tok-i" />
          <Packet tone="o" k="tok-o" />
          <Packet tone="d" k="tok-d" />
          <Packet tone="d" k="back-d" />
          {geo.faces.map((_, k) => (
            <Packet key={`fan${k}`} tone="d" k={`fan${k}`} r={3.8} />
          ))}

          {ALL.map((id) => {
            const r = geo.box[id];
            const b = t.boxes[id] ?? { title: id, sub: "" };
            const outcome = OUTCOMES.includes(id) || id === "clear";
            return (
              <g key={id} data-k={`b-${id}`} className={`sbox ${outcome ? "sbox-out" : ""} sbox-${id}`}>
                <rect
                  x={-r.w / 2}
                  y={-r.h / 2}
                  width={r.w}
                  height={r.h}
                  rx={8}
                  className={`sbox-r ${id === "drop" ? "tbl-dash" : ""}`}
                />
                <text x={-r.w / 2 + 11} y={-r.h / 2 + 19} className="lbl lbl-strong sbox-t">
                  {b.title}
                </text>
                <text x={-r.w / 2 + 11} y={-r.h / 2 + 35} className="lbl sbox-s">
                  {b.sub}
                </text>
              </g>
            );
          })}
          {ALL.map((id) => {
            const s = say(id);
            const at = labelAt(fromOf(id), id);
            if (!s || !at) return null;
            return (
              <text
                key={`say-${id}`}
                data-k={`say-${id}`}
                x={at[0]}
                y={at[1]}
                textAnchor={at[2]}
                className="say"
              >
                {s === "yes" ? t.yes : t.no}
              </text>
            );
          })}

          <Producer k="prod" h={13} />
          <text x={geo.prodLabel[0]} y={geo.prodLabel[1]} textAnchor={geo.prodLabel[2]} className="lbl">
            {t.upstream}
          </text>
          {geo.faces.map((f, k) => (
            <g key={`face${k}`} data-k={`face${k}`} transform={`translate(${f[0]} ${f[1]})`}>
              <Agent r={6.5} />
            </g>
          ))}

          <g data-k="drop-x" data-at={corner("drop")} opacity={0} visibility="hidden">
            <Cross s={0.8} />
          </g>
          <g data-k="verify-ok" data-at={corner("verify")} opacity={0} visibility="hidden">
            <Check s={0.8} />
          </g>
          <g data-k="store-card" data-at={corner("store", -12, 6)} opacity={0} visibility="hidden">
            <rect x={-12} y={-7} width={24} height={14} rx={3} className="card-d" />
          </g>
          <g data-k="add-face" data-at={corner("add", -2, 2)} opacity={0} visibility="hidden">
            <circle r={8} className="o-fill" />
            <circle r={5.5} className="face" />
          </g>
        </Svg>
      </div>
      <p className="border-t border-line px-4 py-3 text-[13px] leading-relaxed text-muted sm:px-5">
        {t.caption}
      </p>
    </div>
  );
}
