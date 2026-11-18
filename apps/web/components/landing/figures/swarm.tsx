"use client";

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMessages } from "@/lib/i18n/client";
import { landing } from "@/lib/i18n/messages/landing";
import { nameFetchPage } from "@/lib/idem-demo";
import { backIn, backOut, fade, flag, type Pt, put, seg, travel, useFrames, useWide, wobble } from "./motion";
import { Agent, Check, Forwarder, Halftone, Packet, Producer, parts, Svg } from "./parts";

/*
 * The problem in one scene (spec 04 §1): four agents ask the same read-only call. Over plain MCP
 * every call travels to the server and the tool runs once per call. With IDEM the edge folds the
 * identical Interests into one PIT entry, forwards one, fans the signed Data out to every waiting
 * agent, keeps it in its Content Store and answers a late ask from there (spec 01 §7). Timings are
 * the drawing's pace, not measurements, and the figure shows no number: the producer's work is a
 * row of marks, one per run of the tool.
 */

export type SwarmMode = "plain" | "idem";

/** Seconds a packet takes between an agent and the edge, and between the edge and the producer. */
const NEAR = 0.8;
const FAR = 1.0;
/** Seconds the producer takes to run the tool. */
const RUN = 0.6;
/** Seconds a stored Data stays fresh in the edge's Content Store, in the drawing. */
const FRESH = 4.4;
/** The autoplay script: when each agent asks (seconds into a round), and the round's length. */
const SCRIPT: readonly (readonly [number, number])[] = [
  [0.25, 0],
  [0.5, 1],
  [0.75, 2],
  [5.7, 3],
];
const ROUND = 10.4;
/** After a visitor's click, the script waits this long (seconds) before it plays again. */
const IDLE = 7;
const POOL = 12;
const MARKS = 8;
const LETTERS = ["A", "B", "C", "D"] as const;
/** The still frames under reduced motion: the fan-out (IDEM) and the server running every call (plain). */
const POSTER: Record<SwarmMode, number> = { idem: 4.3, plain: 2.95 };

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Geo {
  w: number;
  h: number;
  agents: Pt[];
  letters: Pt[];
  edge: Pt;
  producer: Pt;
  pit: Box;
  cs: Box;
  edgeLabel: [number, number, "start" | "middle" | "end"];
  prodLabel: [number, number, "start" | "middle" | "end"];
  /** Where the run marks go: centred under the producer, or in a row starting at x. */
  marks: { x: number; y: number; center: boolean };
  question: Pt;
}

function geometry(wide: boolean): Geo {
  if (wide) {
    const ys = [56, 116, 176, 236];
    return {
      w: 640,
      h: 292,
      agents: ys.map((y) => [74, y] as Pt),
      letters: ys.map((y) => [46, y] as Pt),
      edge: [322, 146],
      producer: [566, 146],
      pit: { x: 252, y: 54, w: 140, h: 34 },
      cs: { x: 252, y: 204, w: 140, h: 34 },
      edgeLabel: [322, 188, "middle"],
      prodLabel: [566, 190, "middle"],
      marks: { x: 566, y: 210, center: true },
      question: [24, 22],
    };
  }
  const xs = [52, 136, 220, 304];
  return {
    w: 356,
    h: 420,
    agents: xs.map((x) => [x, 78] as Pt),
    letters: xs.map((x) => [x, 54] as Pt),
    edge: [178, 214],
    producer: [178, 368],
    pit: { x: 12, y: 258, w: 140, h: 34 },
    cs: { x: 204, y: 258, w: 140, h: 34 },
    edgeLabel: [202, 218, "start"],
    prodLabel: [152, 372, "end"],
    marks: { x: 210, y: 368, center: false },
    question: [12, 22],
  };
}

interface Hop {
  kind: "i" | "d";
  pts: Pt[];
  t0: number;
  dur: number;
  done: (at: number) => void;
}

/** The scene's state machine: hops in flight, the edge's PIT and CS, the producer's runs. */
class Sim {
  t = 0;
  roundT = 0;
  next = 0;
  userAt = -99;
  hops: Hop[] = [];
  agents = LETTERS.map(() => ({ wait: false, doneAt: -99, landAt: -99, askAt: -99 }));
  pit: null | { faces: { i: number; at: number }[] } = null;
  cs: null | { at: number } = null;
  edgeLand = -99;
  hitAt = -99;
  aggAt = -99;
  verifyAt = -99;
  prodLand = -99;
  runs: number[] = [];
  cleared = 0;
  clearedAt = -99;
  beats = [-99, -99, -99];
  lastAnswer = -99;

  constructor(
    readonly mode: SwarmMode,
    readonly geo: Geo,
  ) {}

  #hop(kind: "i" | "d", a: Pt, b: Pt, t0: number, dur: number, done: (at: number) => void) {
    this.hops.push({ kind, pts: [a, b], t0, dur, done });
  }

  ask(i: number) {
    const a = this.agents[i];
    if (!a || a.wait) return;
    a.wait = true;
    a.askAt = this.t;
    // A late ask: someone already got this answer a moment ago (IDEM would serve it from the CS).
    if (this.mode === "plain" && this.t - this.lastAnswer < FRESH) this.beats[2] = this.t;
    this.#hop("i", this.geo.agents[i] as Pt, this.geo.edge, this.t, NEAR, (at) => this.#atEdge(i, at));
  }

  #atEdge(i: number, at: number) {
    const g = this.geo;
    this.edgeLand = at;
    if (this.mode === "plain") {
      this.beats[0] = at;
      this.#hop("i", g.edge, g.producer, at + 0.05, FAR, (t2) => this.#produce(t2, i));
      return;
    }
    if (this.cs && at - this.cs.at < FRESH) {
      this.hitAt = at;
      this.beats[2] = at;
      this.#hop("d", g.edge, g.agents[i] as Pt, at + 0.12, NEAR, (t2) => this.#answer(i, t2));
    } else if (this.pit) {
      this.pit.faces.push({ i, at });
      this.aggAt = at;
      this.beats[0] = at;
    } else {
      this.pit = { faces: [{ i, at }] };
      this.#hop("i", g.edge, g.producer, at + 0.1, FAR, (t2) => this.#produce(t2, i));
    }
  }

  #produce(at: number, asker: number) {
    const g = this.geo;
    this.prodLand = at;
    this.runs.push(at);
    if (this.mode === "plain") this.beats[1] = at;
    this.#hop("d", g.producer, g.edge, at + RUN, FAR, (t2) => {
      this.edgeLand = t2;
      if (this.mode === "plain") {
        this.#hop("d", g.edge, g.agents[asker] as Pt, t2 + 0.05, NEAR, (t3) => this.#answer(asker, t3));
        return;
      }
      // Verify, store, satisfy every waiting face, clear the entry.
      this.verifyAt = t2;
      this.cs = { at: t2 };
      const faces = this.pit?.faces ?? [];
      this.pit = null;
      this.beats[1] = t2;
      for (const f of faces) {
        this.#hop("d", g.edge, g.agents[f.i] as Pt, t2 + 0.24, NEAR, (t3) => this.#answer(f.i, t3));
      }
    });
  }

  #answer(i: number, at: number) {
    const a = this.agents[i];
    if (!a) return;
    a.wait = false;
    a.doneAt = at;
    a.landAt = at;
    this.lastAnswer = at;
  }

  step(dt: number) {
    this.t += dt;
    // Arrivals, in the order they happen; a handler may schedule more.
    for (;;) {
      let first = -1;
      let end = Number.POSITIVE_INFINITY;
      for (let k = 0; k < this.hops.length; k++) {
        const h = this.hops[k] as Hop;
        const e = h.t0 + h.dur;
        if (e <= this.t && e < end) {
          end = e;
          first = k;
        }
      }
      if (first < 0) break;
      const [h] = this.hops.splice(first, 1);
      h?.done(end);
    }
    if (this.cs && this.t - this.cs.at > FRESH + 0.4) this.cs = null;
    // The script steps aside while a visitor plays, and starts a new round once all has landed.
    if (this.t - this.userAt < IDLE) return;
    this.roundT += dt;
    for (let s = SCRIPT[this.next]; s && this.roundT >= s[0]; s = SCRIPT[this.next]) {
      this.ask(s[1]);
      this.next++;
    }
    if (this.roundT >= ROUND && this.hops.length === 0) this.#newRound();
  }

  #newRound() {
    this.roundT = 0;
    this.next = 0;
    this.cleared = this.runs.length;
    this.clearedAt = this.t;
    this.runs = [];
  }

  /** A visitor's click: the agent asks now and the script steps aside for a while. */
  poke(i: number) {
    if (this.t - this.userAt >= IDLE) {
      this.next = SCRIPT.length;
      this.roundT = ROUND;
      if (this.hops.length === 0) {
        this.#newRound();
        this.next = SCRIPT.length;
      }
    }
    this.userAt = this.t;
    this.ask(i);
  }
}

function fastForward(sim: Sim, until: number) {
  while (sim.t < until) sim.step(1 / 60);
}

/**
 * The "plain MCP vs IDEM" scene with its mode switch and the three beats it illustrates, which
 * light up as they happen. A click (or Enter) on an agent makes it ask.
 */
export function Swarm() {
  const t = useMessages(landing).idea;
  const [mode, setMode] = useState<SwarmMode>("idem");
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const beats = useRef<HTMLOListElement>(null);
  const wide = useWide(box, 500);
  const geo = useMemo(() => geometry(wide), [wide]);
  const sim = useRef(new Sim(mode, geo));
  const lookup = useRef<{ root: Element | null; get: (k: string) => Element | null }>({
    root: null,
    get: () => null,
  });
  const [tail, setTail] = useState("…");

  useEffect(() => {
    let stale = false;
    void nameFetchPage({ url: "https://corpus.idem.dev/doc/3" }).then((n) => {
      if (!stale && n.ok) setTail(`…/${n.argsDigest.slice(0, 5)}`);
    });
    return () => {
      stale = true;
    };
  }, []);

  // A new mode or layout starts a fresh scene (declared before the frame loop, so it runs first).
  useEffect(() => {
    sim.current = new Sim(mode, geo);
  }, [mode, geo]);

  const draw = (s: Sim, still: boolean) => {
    if (lookup.current.root !== svg.current) lookup.current = { root: svg.current, get: parts(svg.current) };
    const $ = lookup.current.get;
    const now = s.t;
    const g = s.geo;
    const idem = s.mode === "idem";

    // Packets: two pools (blue, yellow), handed out to the hops in flight.
    let ni = 0;
    let nd = 0;
    for (const h of s.hops) {
      if (now < h.t0) continue;
      const k = h.kind === "i" ? ni++ : nd++;
      if (k < POOL) travel($(`p${h.kind}${k}`), h.pts, now, h.t0, h.dur);
    }
    for (let k = ni; k < POOL; k++) fade($(`pi${k}`), 0);
    for (let k = nd; k < POOL; k++) fade($(`pd${k}`), 0);

    // Agents: blue while waiting, yellow for a moment once answered; a squash when they ask or land.
    s.agents.forEach((a, i) => {
      const el = $(`a${i}`);
      flag(el, "is-wait", a.wait);
      flag(el, "is-done", !a.wait && now - a.doneAt < (still ? 9 : 1.6));
      const p = g.agents[i] as Pt;
      const w = wobble(now - a.landAt) * 0.34 - wobble(now - a.askAt) * 0.2;
      put(el, p[0], p[1], 1 + w * 0.6, 0, 1 - w);
    });

    // The edge: blue while a PIT entry waits, yellow-tinted while its CS holds a fresh Data.
    const fresh = idem && s.cs !== null && now - s.cs.at < FRESH;
    const edge = $("edge");
    flag(edge, "is-pit", idem && s.pit !== null);
    flag(edge, "is-cs", fresh && s.pit === null);
    const ew = wobble(now - s.edgeLand) * 0.24;
    put(edge, g.edge[0], g.edge[1], 1 + ew * 0.7, 0, 1 - ew);
    for (const [k, at] of [
      ["hit", s.hitAt],
      ["agg", s.aggAt],
    ] as const) {
      const u = seg(now, at, 0.6);
      const ring = $(`ring-${k}`);
      if (u <= 0 || u >= 1) fade(ring, 0);
      else {
        fade(ring, 1 - u);
        put(ring, g.edge[0], g.edge[1], 0.8 + 1.1 * backOut(u, 1.2));
      }
    }
    // The verification tick pops over the edge as the Data comes back from the producer.
    const vu = now - s.verifyAt;
    const tick = $("verify");
    if (vu < 0 || vu > 1.5) fade(tick, 0);
    else {
      const out = still ? 0 : seg(vu, 1.15, 0.35);
      fade(tick, 1 - out);
      put(tick, g.edge[0] + 19, g.edge[1] - 19, backOut(seg(vu, 0, 0.35)) * (1 - backIn(out) * 0.6));
    }

    // PIT entry: the name, and one dot per waiting face, popping in as each is added.
    fade($("pit-entry"), idem && s.pit ? 1 : 0);
    for (let i = 0; i < LETTERS.length; i++) {
      const face = s.pit?.faces[i];
      const dot = $(`face${i}`);
      if (!idem || !face || !dot) {
        fade(dot, 0);
        continue;
      }
      fade(dot, 1);
      put(
        dot,
        // Clear of the name's tail, which ends about 72 in.
        g.pit.x + 88 + i * 14,
        g.pit.y + g.pit.h / 2,
        0.2 + 0.8 * backOut(seg(now, face.at, 0.4), 2.6),
      );
      const label = dot.lastElementChild;
      const l = LETTERS[face.i] ?? "";
      if (label && label.textContent !== l) label.textContent = l;
    }

    // CS: the stored Data drops in, its freshness drains, and it pops out when stale.
    const card = $("cs-card");
    if (!idem || !s.cs) fade(card, 0);
    else {
      const age = now - s.cs.at;
      const inP = seg(age, 0, 0.45);
      const outP = seg(age, FRESH, 0.35);
      fade(card, 1 - outP);
      put(card, g.cs.x + 42, g.cs.y + g.cs.h / 2 - (1 - backOut(inP)) * 14, 1 - backIn(outP) * 0.5);
      put($("cs-bar"), 0, 0, Math.max(0.001, 1 - age / FRESH), 0, 1);
    }

    // Producer: a wobble when a request lands, a shiver while it runs the tool, a mark per run.
    const last = s.runs.at(-1) ?? -99;
    const working = now - last >= 0 && now - last < RUN;
    const pw = wobble(now - s.prodLand) * 0.22 + (working ? Math.sin((now - last) * 30) * 0.05 : 0);
    put($("prod"), g.producer[0], g.producer[1], 1 + pw * 0.6, 0, 1 - pw);
    const shown = Math.min(MARKS, Math.max(s.runs.length, s.cleared));
    const x0 = g.marks.center ? g.marks.x - ((shown - 1) * 11) / 2 : g.marks.x;
    for (let i = 0; i < MARKS; i++) {
      const m = $(`mark${i}`);
      const at = s.runs[i];
      if (at !== undefined && i < MARKS) {
        fade(m, 1);
        put(m, x0 + i * 11, g.marks.y, 0.2 + 0.8 * backOut(seg(now, at, 0.4), 2.4));
      } else if (i < s.cleared && now - s.clearedAt < 0.35) {
        const u = seg(now, s.clearedAt, 0.35);
        fade(m, 1 - u);
        put(m, x0 + i * 11, g.marks.y, 1 - backIn(u) * 0.8);
      } else fade(m, 0);
    }

    // The beats beside the scene light up as they happen.
    const items = beats.current?.children;
    if (items) {
      for (let k = 0; k < items.length; k++)
        flag(items[k], "is-on", still || now - (s.beats[k] ?? -99) < 2.6);
    }
  };

  const { reduced } = useFrames(
    svg,
    (time, dt) => {
      if (reduced) {
        const s = new Sim(mode, geo);
        fastForward(s, POSTER[mode]);
        sim.current = s;
        draw(s, true);
        return;
      }
      if (time > 0) sim.current.step(dt);
      draw(sim.current, false);
    },
    { poster: POSTER[mode], deps: [mode, geo] },
  );

  const poke = (i: number) => {
    const s = sim.current;
    s.poke(i);
    if (reduced) {
      // No travel under reduced motion: jump to the moment the answer has arrived.
      fastForward(s, s.t + 3.4);
      draw(s, true);
    }
  };
  const onKey = (i: number) => (ev: KeyboardEvent) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      poke(i);
    }
  };

  const idem = mode === "idem";
  const beatList = idem ? t.beatsIdem : t.beatsPlain;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] lg:gap-10">
      <figure className="fig-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div
            role="radiogroup"
            aria-label={t.modeLabel}
            className="seg"
            data-on={idem ? 1 : 0}
            onKeyDown={(e) => {
              // A radio group: one tab stop, the arrow keys move the choice (two options, so any arrow flips it).
              if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
              e.preventDefault();
              const next = idem ? "plain" : "idem";
              setMode(next);
              e.currentTarget.querySelector<HTMLElement>(`[data-mode="${next}"]`)?.focus();
            }}
          >
            <span aria-hidden="true" className="seg-thumb" />
            {(["plain", "idem"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                tabIndex={mode === m ? 0 : -1}
                data-mode={m}
                onClick={() => setMode(m)}
                className="seg-btn"
              >
                {m === "plain" ? t.plain : t.idem}
              </button>
            ))}
          </div>
          <p className="text-[13px] text-muted">{t.hint}</p>
        </div>
        <div ref={box} className="px-2 py-4 sm:px-4 sm:py-5">
          <Svg
            svgRef={svg}
            title={idem ? t.figIdem : t.figPlain}
            w={geo.w}
            h={geo.h}
            className="swarm"
            interactive
          >
            <defs>
              <Halftone id="swarm-ht" step={7} r={1.15} />
            </defs>
            <circle cx={geo.producer[0]} cy={geo.producer[1]} r={60} fill="url(#swarm-ht)" />
            <text x={geo.question[0]} y={geo.question[1]} className="lbl">
              {t.sameCall} <tspan className="mono">fetch_page(…/doc/3)</tspan>
            </text>

            {/* Links first, so packets run over them and the nodes sit on top. */}
            {geo.agents.map((p, i) => (
              <path key={LETTERS[i]} d={`M${p[0]} ${p[1]}L${geo.edge[0]} ${geo.edge[1]}`} className="ln" />
            ))}
            <path d={`M${geo.edge[0]} ${geo.edge[1]}L${geo.producer[0]} ${geo.producer[1]}`} className="ln" />

            {/* The edge's tables: only an IDEM forwarder has them. */}
            <g className="swarm-tables" data-on={idem ? 1 : 0}>
              <rect x={geo.pit.x} y={geo.pit.y} width={geo.pit.w} height={geo.pit.h} rx={8} className="tbl" />
              <text x={geo.pit.x + 10} y={geo.pit.y + 21.5} className="lbl lbl-strong">
                PIT
              </text>
              <g data-k="pit-entry" opacity={0}>
                <text x={geo.pit.x + 34} y={geo.pit.y + 21} className="mono tiny f-i">
                  {tail}
                </text>
              </g>
              <rect x={geo.cs.x} y={geo.cs.y} width={geo.cs.w} height={geo.cs.h} rx={8} className="tbl" />
              <text x={geo.cs.x + 10} y={geo.cs.y + 21.5} className="lbl lbl-strong">
                CS
              </text>
            </g>
            {LETTERS.map((l, i) => (
              <g key={l} data-k={`face${i}`} opacity={0} visibility="hidden">
                <circle r={6} className="face" />
                <text y={2.9} textAnchor="middle" className="face-l">
                  {l}
                </text>
              </g>
            ))}
            <g data-k="cs-card" opacity={0} visibility="hidden">
              <rect x={-14} y={-10} width={70} height={20} rx={4} className="card-d" />
              <text x={21} y={3.6} textAnchor="middle" className="mono tiny card-d-t">
                {tail}
              </text>
              <g transform="translate(-10 13.5)">
                <g data-k="cs-bar">
                  <rect x={0} y={-1.2} width={62} height={2.4} rx={1.2} className="f-db" />
                </g>
              </g>
            </g>

            {Array.from({ length: POOL }, (_, i) => (
              <g key={`pk${i}`}>
                <Packet tone="i" k={`pi${i}`} />
                <Packet tone="d" k={`pd${i}`} />
              </g>
            ))}
            <circle data-k="ring-agg" r={20} className="burst burst-i" opacity={0} visibility="hidden" />
            <circle data-k="ring-hit" r={20} className="burst burst-d" opacity={0} visibility="hidden" />

            <Forwarder k="edge" h={14} />
            <text x={geo.edgeLabel[0]} y={geo.edgeLabel[1]} textAnchor={geo.edgeLabel[2]} className="lbl">
              {idem ? t.edge : t.proxy}
            </text>
            <Producer k="prod" h={15} />
            <text x={geo.prodLabel[0]} y={geo.prodLabel[1]} textAnchor={geo.prodLabel[2]} className="lbl">
              {t.producer}
            </text>
            {Array.from({ length: MARKS }, (_, i) => (
              <g key={`m${i}`} data-k={`mark${i}`} opacity={0} visibility="hidden">
                <rect x={-3.5} y={-3.5} width={7} height={7} rx={1.5} className="run-mark" />
              </g>
            ))}
            <g data-k="verify" opacity={0} visibility="hidden">
              <Check tone="d" s={0.9} />
            </g>

            {geo.agents.map((p, i) => {
              const l = LETTERS[i] as string;
              const lp = geo.letters[i] as Pt;
              return (
                <g
                  key={l}
                  role="button"
                  tabIndex={0}
                  aria-label={t.agentAsks(l)}
                  className="swarm-agent"
                  onClick={() => poke(i)}
                  onKeyDown={onKey(i)}
                >
                  <circle cx={p[0]} cy={p[1]} r={20} className="hit" />
                  <Agent k={`a${i}`} r={8} />
                  <text x={lp[0]} y={lp[1] + 4.5} textAnchor="middle" className="lbl lbl-strong">
                    {l}
                  </text>
                </g>
              );
            })}
          </Svg>
        </div>
        <figcaption className="flex flex-wrap gap-x-6 gap-y-2 border-t border-line px-4 py-3 text-[13px] text-muted sm:px-5">
          <span className="inline-flex items-center gap-2">
            <PacketGlyph tone="i" />
            {t.legendInterest}
          </span>
          <span className="inline-flex items-center gap-2">
            <PacketGlyph tone="d" />
            {t.legendData}
          </span>
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="run-glyph" />
            {t.legendRun}
          </span>
        </figcaption>
      </figure>

      <ol ref={beats} key={mode} className="beats">
        {beatList.map((b, k) => (
          <li key={b.term} className={`beat beat-${idem ? (k === 0 ? "i" : "d") : "fg"}`}>
            <span aria-hidden="true" className="beat-mark" />
            <p>
              <strong>{b.term}</strong> {b.body}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A still packet for legends: the capsule the figures animate. */
export function PacketGlyph({ tone }: { tone: "i" | "d" }) {
  return (
    <svg
      viewBox="-12 -6 24 12"
      width={22}
      height={11}
      aria-hidden="true"
      className="fig mfig shrink-0"
      // `.fig` stretches a figure to its column; a glyph keeps its own size.
      style={{ width: 22, height: 11 }}
    >
      <circle cx={-8.5} cy={0} r={1.4} className={tone === "i" ? "f-i" : "f-db"} />
      <rect x={-5} y={-4.2} width={14} height={8.4} rx={4.2} className={tone === "i" ? "f-i" : "f-db"} />
    </svg>
  );
}
