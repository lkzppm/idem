"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useMessages } from "@/lib/i18n/client";
import { landing } from "@/lib/i18n/messages/landing";
import { nameFetchPage } from "@/lib/idem-demo";
import {
  attr,
  backIn,
  backOut,
  easeIn,
  easeInOut,
  easeOut,
  fade,
  flag,
  lerp,
  type Pt,
  put,
  seg,
  travel,
  useFrames,
  useWide,
  wobble,
} from "./motion";
import { Agent, Check, Core, Forwarder, Packet, Producer, parts, Seal, Svg } from "./parts";

/*
 * The four steps of an IDEM call (spec 01 §2–§7), one short animation each. Each plays once when
 * its tab opens and holds its last frame, which is drawn to explain the step on its own (that frame
 * is also what reduced motion shows). Everything shown is a format or a rule of the spec; the
 * digests are computed in the browser by `@idem/core`.
 */

type Get = (k: string) => Element | null;

/** Frame loop plumbing shared by the four figures: lookup by `data-k`, wide or narrow drawing. */
function useStep(end: number, paint: (t: number, $: Get, wide: boolean) => void, deps: unknown[] = []) {
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const wide = useWide(box, 470);
  const lookup = useRef<{ root: Element | null; get: Get }>({ root: null, get: () => null });
  useFrames(
    svg,
    (t) => {
      if (lookup.current.root !== svg.current)
        lookup.current = { root: svg.current, get: parts(svg.current) };
      paint(t, lookup.current.get, wide);
    },
    { poster: end, end, deps: [wide, ...deps] },
  );
  return { box, svg, wide };
}

/** A takeaway under a figure, shown when the figure reaches it (`is-on`, set by the frame function). */
function Takeaway({ k, children }: { k: string; children: ReactNode }) {
  return (
    <p data-take={k} className="takeaway">
      <span aria-hidden="true" className="takeaway-tick" />
      {children}
    </p>
  );
}

const pop = (t: number, at: number, d = 0.4) => 0.25 + 0.75 * backOut(seg(t, at, d), 2.4);
const appear = (el: Element | null, t: number, at: number, x: number, y: number) => {
  fade(el, seg(t, at, 0.15));
  put(el, x, y, pop(t, at));
};

// ---------------------------------------------------------------------------------------------
// 01 Canonicalize: two spellings become the same bytes.

/** The raw call of agent A, in pieces; `fix` is what the normalizer does to each piece. */
const CHIPS: { s: string; fix?: "lower" | "drop" | "swapR" | "swapL"; rule?: number }[] = [
  { s: '{"url":"https://' },
  { s: "EXAMPLE", fix: "lower", rule: 0 },
  { s: ".com" },
  { s: ":443", fix: "drop", rule: 1 },
  { s: "/p?" },
  { s: "b=2", fix: "swapR", rule: 3 },
  { s: "&" },
  { s: "a=1", fix: "swapL", rule: 3 },
  { s: "#x", fix: "drop", rule: 2 },
  { s: '"}' },
];
const RAW_A = CHIPS.map((c) => c.s).join("");
const RAW_B = '{"url":"https://example.com/p?a=1&b=2"}';
/** When each edit happens (seconds), by rule: lowercase, port, fragment, sort. */
const EDIT_AT = [0.45, 1.05, 1.6, 2.2];
const MERGE_AT = 3.0;
const LAND_AT = MERGE_AT + 0.42;

function canonGeo(wide: boolean) {
  const g = wide
    ? { w: 520, h: 196, x: 32, ay: 56, by: 140, boxW: 330, rx: 360, ry: 30, fs: 11.5 }
    : { w: 340, h: 238, x: 18, ay: 50, by: 122, boxW: 320, rx: 10, ry: 160, fs: 10.4 };
  const boxX = g.x - 12;
  return { ...g, boxX, cx: boxX + g.boxW / 2, cw: g.fs * 0.6 };
}

/** Step 1: equivalent spellings of a call collapse, rule by rule, into one canonical JSON. */
export function CanonicalizeFigure() {
  const t = useMessages(landing).how.canon;
  const { box, svg, wide } = useStep(LAND_AT + 0.9, (now, $, w) => {
    const g = canonGeo(w);
    const cw = g.cw;
    // Character offsets of every chip as the edits happen: drops close their gap, swaps trade places.
    let col = 0;
    CHIPS.forEach((c, i) => {
      const el = $(`c${i}`);
      const start = col;
      col += c.s.length;
      // Shift left by the dropped pieces before this one, as each drop happens.
      let shift = 0;
      for (let j = 0; j < i; j++) {
        const cj = CHIPS[j];
        if (cj?.fix === "drop")
          shift += cj.s.length * backOut(seg(now, (EDIT_AT[cj.rule ?? 0] ?? 0) + 0.15, 0.45), 1.4);
      }
      let x = g.x + (start - shift) * cw;
      let y = g.ay;
      let o = 1;
      let s = 1;
      let sy = 1;
      let rot = 0;
      const at = EDIT_AT[c.rule ?? 0] ?? 0;
      if (c.fix === "lower") {
        // Flip: squash flat, swap the letters, spring back open.
        const u = seg(now, at, 0.36);
        sy = u < 0.4 ? 1 - u / 0.4 : backOut((u - 0.4) / 0.6, 2.6);
        const up = $(`c${i}u`);
        const lo = $(`c${i}l`);
        fade(up, u < 0.4 ? 1 : 0);
        fade(lo, u < 0.4 ? 0 : 1);
      } else if (c.fix === "drop") {
        const u = seg(now, at, 0.5);
        y += easeIn(u) * 22;
        rot = u * 24;
        o = 1 - easeIn(u);
      } else if (c.fix === "swapR" || c.fix === "swapL") {
        const u = seg(now, at, 0.55);
        const e = backOut(u, 1.2);
        const d = (c.fix === "swapR" ? 1 : -1) * 4 * cw;
        x += d * e;
        y += (c.fix === "swapR" ? -1 : 1) * 11 * Math.sin(Math.PI * Math.min(1, u * 1.05));
      }
      fade(el, o);
      put(el, x, y, s, rot, sy);
    });
    // Rules tick off as they apply.
    EDIT_AT.forEach((at, r) => {
      const tk = $(`rule${r}`);
      flag(tk, "is-on", now >= at + 0.2);
      appear($(`rule${r}k`), now, at + 0.2, 0, 0);
    });
    // Row A drops onto row B and the two become one; the raw spelling stays behind, faint.
    const m = seg(now, MERGE_AT, 0.42);
    const dy = (g.by - g.ay) * easeIn(m);
    put($("rowA"), 0, dy);
    fade($("rowA"), now < LAND_AT ? 1 : 1 - seg(now, LAND_AT, 0.12));
    fade($("ghost"), 0.42 * seg(now, MERGE_AT, 0.4));
    const land = wobble(now - LAND_AT) * 0.14;
    put($("rowB"), g.cx, g.by - 5, 1 + land * 0.4, 0, 1 - land);
    flag($("rowB"), "is-canon", now >= LAND_AT);
    fade($("labB"), 1 - seg(now, LAND_AT, 0.2));
    fade($("labC"), seg(now, LAND_AT, 0.25));
    flag(box.current?.querySelector('[data-take="same"]'), "is-on", now >= LAND_AT + 0.25);
  });

  const g = canonGeo(wide);
  const { fs, boxX } = g;
  const rules = t.rules.map((label, r) =>
    wide
      ? { label, x: g.rx + 14, y: g.ry + 50 + r * 19 }
      : { label, x: g.rx + 6 + (r % 2) * 160, y: g.ry + 34 + Math.floor(r / 2) * 20 },
  );
  return (
    <div ref={box}>
      <Svg svgRef={svg} title={t.title} w={g.w} h={g.h} className="canon">
        <text x={boxX} y={g.ay - 30} className="lbl lbl-strong">
          {t.a}
        </text>
        <g data-k="ghost" opacity={0}>
          <rect x={boxX} y={g.ay - 21} width={g.boxW} height={32} rx={7} className="tbl tbl-dash" />
          <text x={g.x} y={g.ay} className="mono raw" style={{ fontSize: fs }}>
            {RAW_A}
          </text>
        </g>
        <text data-k="labB" x={boxX} y={g.by - 30} className="lbl lbl-strong">
          {t.b}
        </text>
        <text data-k="labC" x={boxX} y={g.by - 30} className="lbl lbl-i" opacity={0}>
          {t.canonical}
        </text>
        <g data-k="rowB" className="canon-row">
          <rect x={-g.boxW / 2} y={-16} width={g.boxW} height={32} rx={7} className="canon-box" />
          <text x={g.x - g.cx} y={5} className="mono canon-t" style={{ fontSize: fs }}>
            {RAW_B}
          </text>
        </g>
        <g data-k="rowA">
          <rect x={boxX} y={g.ay - 21} width={g.boxW} height={32} rx={7} className="canon-box-a" />
          {CHIPS.map((c, i) =>
            c.fix === "lower" ? (
              <g key={c.s} data-k={`c${i}`} className="chip">
                <text data-k={`c${i}u`} y={0} className="mono chip-hot" style={{ fontSize: fs }}>
                  {c.s}
                </text>
                <text data-k={`c${i}l`} y={0} className="mono chip-t" style={{ fontSize: fs }} opacity={0}>
                  {c.s.toLowerCase()}
                </text>
              </g>
            ) : (
              <g key={c.s} data-k={`c${i}`} className="chip">
                <text className={`mono ${c.fix ? "chip-hot" : "chip-t"}`} style={{ fontSize: fs }}>
                  {c.s}
                </text>
              </g>
            ),
          )}
        </g>
        <g>
          {wide && <rect x={g.rx} y={g.ry} width={156} height={136} rx={8} className="tbl" />}
          <text x={g.rx + (wide ? 14 : 2)} y={g.ry + 20} className="mono tiny lbl-fg">
            url:sortQuery
          </text>
          <text
            x={g.rx + (wide ? 14 : 96)}
            y={g.ry + (wide ? 34 : 20)}
            className="lbl"
            style={{ fontSize: 10.5 }}
          >
            {t.normalizer}
          </text>
          {rules.map((r, i) => (
            <g key={r.label} data-k={`rule${i}`} className="rule">
              <circle cx={r.x + 4} cy={r.y - 4} r={4} className="rule-dot" />
              <g
                data-k={`rule${i}k`}
                opacity={0}
                visibility="hidden"
                transform={`translate(${r.x + 4} ${r.y - 4})`}
              >
                <circle r={5.2} className="rule-on" />
                <path d="M-2.4 -0.2l1.6 1.7l3.1 -3.4" className="mk rule-k" strokeWidth={1.5} />
              </g>
              <text x={r.x + 14} y={r.y} className="lbl" style={{ fontSize: 10.5 }}>
                {r.label}
              </text>
            </g>
          ))}
        </g>
      </Svg>
      <Takeaway k="same">{t.same}</Takeaway>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 02 Name: the two digests and the fixed parts click into place.

/** The fields of a tool's identity that its schema digest covers (spec 01 §2.1). */
const IDENTITY = ["name", "inputSchema", "policyVersion"];

/** A phrase as two lines, broken at the space nearest its middle. */
function split2(s: string): string[] {
  const mid = s.length / 2;
  let best = -1;
  for (let i = 0; i < s.length; i++)
    if (s[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? [s] : [s.slice(0, best), s.slice(best + 1)];
}

/** Step 2: the canonical bytes are hashed and the real digests fly into the name's slots. */
export function NameFigure() {
  const t = useMessages(landing).how.name;
  const [d, setD] = useState({ schema: "ViVqoyNP…", args: "m0oAz5X3…" });
  useEffect(() => {
    let stale = false;
    void nameFetchPage({ url: "https://example.com/p?a=1&b=2" }).then((n) => {
      if (!stale && n.ok)
        setD({ schema: `${n.schemaDigest.slice(0, 8)}…`, args: `${n.argsDigest.slice(0, 8)}…` });
    });
    return () => {
      stale = true;
    };
  }, []);
  const segs = useMemo(
    () => [
      { s: "/idem/v1/", tone: "" },
      { s: "demo.idem.dev/", tone: "" },
      { s: "fetch_page/", tone: "" },
      { s: `${d.schema}/`, tone: "faint" },
      { s: d.args, tone: "i" },
    ],
    [d],
  );

  const layout = (w: boolean) => {
    const cw = 6.6;
    const pad = 12;
    const width = (s: string) => s.length * cw + pad;
    // Slots of the name: one row when wide, two rows when narrow.
    const rows = w
      ? [[0, 1, 2, 3, 4]]
      : [
          [0, 1, 2],
          [3, 4],
        ];
    const slots: { x: number; y: number; w: number }[] = [];
    rows.forEach((r, ri) => {
      const total = r.reduce((s, i) => s + width(segs[i]?.s ?? "") + 4, -4);
      let x = ((w ? 520 : 340) - total) / 2;
      for (const i of r) {
        const sw = width(segs[i]?.s ?? "");
        slots[i] = { x, y: w ? 164 : 188 + ri * 54, w: sw };
        x += sw + 4;
      }
    });
    return w
      ? {
          w: 520,
          h: 218,
          id: { x: 20, y: 14, w: 220 },
          args: { x: 280, y: 14, w: 220 },
          ch: 40,
          hy: 82,
          dy: 122,
          slots,
        }
      : {
          w: 340,
          h: 286,
          id: { x: 8, y: 10, w: 156 },
          args: { x: 176, y: 10, w: 156 },
          ch: 52,
          hy: 94,
          dy: 134,
          slots,
        };
  };

  const { box, svg, wide } = useStep(
    3.4,
    (now, $, w) => {
      const L = layout(w);
      const hx = [L.id.x + L.id.w / 2, L.args.x + L.args.w / 2];
      // Bytes go into the hash boxes, which chew, and the digests pop out.
      hx.forEach((x, k) => {
        travel(
          $(`bytes${k}`),
          [
            [x, L.id.y + L.ch],
            [x, L.hy],
          ],
          now,
          0.15 + k * 0.08,
          0.42,
        );
        const chew = (wobble(now - 0.6 - k * 0.08) + wobble(now - 0.85 - k * 0.08)) * 0.2;
        put($(`hash${k}`), x, L.hy, 1 + chew * 0.7, 0, 1 - chew);
      });
      // The fixed parts pop in, left to right; the digests fly into their slots and land.
      segs.forEach((_, i) => {
        const slot = L.slots[i];
        const el = $(`seg${i}`);
        if (!slot) return;
        const cx = slot.x + slot.w / 2;
        if (i < 3) {
          appear(el, now, 1.3 + i * 0.13, cx, slot.y);
        } else {
          const k = i - 3;
          const from: Pt = [hx[k] ?? 0, L.dy];
          const t0 = 1.75 + k * 0.22;
          const u = seg(now, t0, 0.5);
          const e = easeInOut(u);
          const x = lerp(from[0], cx, e);
          const y = lerp(from[1], slot.y, e) - Math.sin(Math.PI * u) * 26;
          const land = wobble(now - t0 - 0.5) * 0.3;
          fade(el, seg(now, 1.0 + k * 0.08, 0.15));
          put(el, x, y, (now < 1.0 ? 0.4 : pop(now, 1.0 + k * 0.08)) * (1 + land * 0.5), 0, 1 - land);
        }
        appear($(`lab${i}`), now, i < 3 ? 1.4 + i * 0.13 : 2.3 + (i - 3) * 0.22, cx, slot.y + 30);
      });
      flag($("bar"), "is-on", now >= 2.75);
      flag(box.current?.querySelector('[data-take="note"]'), "is-on", now >= 2.9);
    },
    [segs],
  );
  const L = layout(wide);
  const hx = [L.id.x + L.id.w / 2, L.args.x + L.args.w / 2];
  return (
    <div ref={box}>
      <Svg svgRef={svg} title={t.title} w={L.w} h={L.h} className="namefig">
        <rect x={L.id.x} y={L.id.y} width={L.id.w} height={L.ch} rx={8} className="tbl" />
        <text x={L.id.x + 10} y={L.id.y + 16} className="lbl lbl-strong" style={{ fontSize: 12 }}>
          {t.identity}
        </text>
        {wide ? (
          <text x={L.id.x + 10} y={L.id.y + 31} className="mono" style={{ fontSize: 9.5 }}>
            {IDENTITY.join(" · ")}
          </text>
        ) : (
          <text x={L.id.x + 10} y={L.id.y + 31} className="mono" style={{ fontSize: 9 }}>
            <tspan>{IDENTITY.slice(0, 2).join(" · ")}</tspan>
            <tspan x={L.id.x + 10} dy={12}>
              {IDENTITY[2]}
            </tspan>
          </text>
        )}
        <rect x={L.args.x} y={L.args.y} width={L.args.w} height={L.ch} rx={8} className="tbl tbl-i" />
        <text x={L.args.x + 10} y={L.args.y + 16} className="lbl lbl-i" style={{ fontSize: 12 }}>
          {t.args}
        </text>
        <text x={L.args.x + 10} y={L.args.y + 31} className="mono" style={{ fontSize: wide ? 9.5 : 8.6 }}>
          {'{"url":"…/p?a=1&b=2"}'}
        </text>
        {hx.map((x, k) => (
          <g key={x}>
            <path d={`M${x} ${L.id.y + L.ch}V${L.dy - 8}`} className="ln ln-faint" />
            <Packet tone={k === 0 ? "o" : "i"} k={`bytes${k}`} r={4} />
            <g data-k={`hash${k}`} transform={`translate(${x} ${L.hy})`}>
              <rect x={-34} y={-12} width={68} height={24} rx={6} className="hashbox" />
              <text y={4} textAnchor="middle" className="mono hash-t" style={{ fontSize: 10 }}>
                SHA-256
              </text>
            </g>
          </g>
        ))}
        <g data-k="bar" className="name-bar">
          {L.slots.map((s, i) => (
            <rect
              key={`slot${s.x}`}
              x={s.x}
              y={s.y - 13}
              width={s.w}
              height={26}
              rx={5}
              className={`slot ${i === 4 ? "slot-i" : ""}`}
            />
          ))}
        </g>
        {segs.map((sg, i) => (
          <g key={sg.s} data-k={`seg${i}`} opacity={0} visibility="hidden">
            <text
              y={4}
              textAnchor="middle"
              className={`mono seg-t seg-${sg.tone || "fg"}`}
              style={{ fontSize: 11 }}
            >
              {sg.s}
            </text>
          </g>
        ))}
        {t.parts.map((p, i) => (
          <g key={p} data-k={`lab${i}`} opacity={0} visibility="hidden">
            <text textAnchor="middle" className="lbl" style={{ fontSize: 11 }}>
              {p}
            </text>
          </g>
        ))}
      </Svg>
      <Takeaway k="note">{t.note}</Takeaway>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 03 Sign: the producer runs the tool once, the Data assembles, the seal lands.

export function SignFigure() {
  const t = useMessages(landing).how.sign;
  const layout = (w: boolean) =>
    w
      ? {
          w: 520,
          h: 228,
          prod: [62, 96] as Pt,
          card: { x: 140, y: 10, w: 320 },
          kx: 92,
          vx: 92,
          labels: "below" as const,
        }
      : {
          w: 340,
          h: 300,
          prod: [30, 30] as Pt,
          card: { x: 8, y: 66, w: 324 },
          kx: 82,
          vx: 82,
          labels: "right" as const,
        };
  const rowsOf = (y0: number) => {
    let y = y0 + 30;
    return (
      [
        ["name", 30],
        ["content", 30],
        ["meta", 44],
        ["signature", 32],
        ["ageMs", 30],
      ] as const
    ).map(([k, h]) => {
      const r = { k, y, h };
      y += h;
      return r;
    });
  };
  const { box, svg, wide } = useStep(4.1, (now, $, w) => {
    const L = layout(w);
    const rows = rowsOf(L.card.y);
    const row = (k: string) => rows.find((r) => r.k === k) ?? { y: 0, h: 0 };
    // The producer runs the tool: a shiver, then the result goes into the content row.
    const work = now > 0.1 && now < 0.65 ? Math.sin((now - 0.1) * 34) * 0.06 : 0;
    const land = wobble(now - 0.7) * 0.2;
    put($("prod"), L.prod[0], L.prod[1], 1 + work + land * 0.4, 0, 1 - work - land);
    const c = row("content");
    travel($("result"), [L.prod, [L.card.x + L.kx - 14, c.y + c.h / 2]], now, 0.6, 0.5);
    for (const [k, at] of [
      ["v-name", 0.25],
      ["v-content", 1.05],
      ["v-digest", 1.5],
      ["v-meta", 1.75],
      ["v-sig", 3.0],
      ["v-age", 3.35],
    ] as const) {
      fade($(k), seg(now, at, 0.25));
    }
    // The content's digest flies down into meta.
    const m = row("meta");
    travel(
      $("digest"),
      [
        [L.card.x + L.vx + 20, c.y + c.h - 4],
        [L.card.x + L.vx + 20, m.y + 10],
      ],
      now,
      1.2,
      0.35,
    );
    // The bracket over the signed bytes grows; name and meta light up.
    const br = backOut(seg(now, 2.0, 0.45), 1.6);
    const ny = rowsOf(L.card.y)[0]?.y ?? 0;
    put($("bracket"), 0, ny * (1 - br), 1, 0, Math.max(0.001, br));
    fade($("bracket"), seg(now, 2.0, 0.1));
    fade($("hl"), 0.9 * seg(now, 2.05, 0.3));
    // The seal comes down on the signature row and lands with a squash.
    const s = row("signature");
    const sx = L.card.x + L.card.w - 26;
    const sy = s.y + s.h / 2;
    const u = seg(now, 2.55, 0.42);
    const hit = wobble(now - 2.97) * 0.35;
    fade($("seal"), seg(now, 2.55, 0.1));
    put(
      $("seal"),
      sx,
      sy - (1 - easeIn(u)) * 44,
      (1.7 - 0.7 * easeIn(u)) * (1 + hit * 0.5),
      (1 - u) * -30,
      (1.7 - 0.7 * easeIn(u)) * (1 - hit),
    );
    const ring = seg(now, 2.97, 0.5);
    fade($("ring"), ring > 0 && ring < 1 ? 1 - ring : 0);
    put($("ring"), sx, sy, 0.8 + backOut(ring, 1.2) * 1.2);
  });
  const L = layout(wide);
  const rows = rowsOf(L.card.y);
  const row = (k: string) => rows.find((r) => r.k === k) ?? { y: 0, h: 0 };
  const values: Record<string, ReactNode> = {
    name: (
      <text
        data-k="v-name"
        x={L.card.x + L.vx}
        y={row("name").y + 19}
        className="mono tiny lbl-fg"
        opacity={0}
      >
        /idem/v1/demo.idem.dev/…
      </text>
    ),
    content: (
      <text
        data-k="v-content"
        x={L.card.x + L.vx}
        y={row("content").y + 19}
        className="lbl"
        style={{ fontSize: 11.5 }}
        opacity={0}
      >
        {t.content}
      </text>
    ),
    meta: (
      <g>
        <text
          data-k="v-digest"
          x={L.card.x + L.vx}
          y={row("meta").y + 18}
          className="lbl"
          style={{ fontSize: 11.5 }}
          opacity={0}
        >
          <tspan className="mono tiny lbl-fg">contentDigest</tspan>
          {wide ? ` · ${t.digest}` : ""}
        </text>
        <text
          data-k="v-meta"
          x={L.card.x + L.vx}
          y={row("meta").y + 34}
          className="mono"
          style={{ fontSize: 9.5 }}
          opacity={0}
        >
          {t.meta}
        </text>
      </g>
    ),
    signature: (
      <text
        data-k="v-sig"
        x={L.card.x + L.vx}
        y={row("signature").y + 20}
        className="mono tiny lbl-fg"
        opacity={0}
      >
        {t.signature}
      </text>
    ),
    ageMs: (
      <text
        data-k="v-age"
        x={L.card.x + L.vx}
        y={row("ageMs").y + 19}
        className="lbl"
        style={{ fontSize: 11 }}
        opacity={0}
      >
        {t.age}
      </text>
    ),
  };
  const nm = row("name");
  const mt = row("meta");
  const bx = wide ? L.card.x + L.card.w + 8 : L.card.x + L.card.w - 10;
  const total = rows.reduce((s, r) => s + r.h, 30);
  return (
    <div ref={box}>
      <Svg svgRef={svg} title={t.title} w={L.w} h={L.h} className="signfig">
        <Producer k="prod" h={15} />
        <text
          x={L.labels === "below" ? L.prod[0] : L.prod[0] + 26}
          y={L.labels === "below" ? L.prod[1] + 36 : L.prod[1] - 3}
          textAnchor={L.labels === "below" ? "middle" : "start"}
          className="lbl lbl-strong"
        >
          {t.producer}
        </text>
        {(wide ? split2(t.runs) : [t.runs]).map((line, i) => (
          <text
            key={line}
            x={L.labels === "below" ? L.prod[0] : L.prod[0] + 26}
            y={(L.labels === "below" ? L.prod[1] + 52 : L.prod[1] + 13) + i * 15}
            textAnchor={L.labels === "below" ? "middle" : "start"}
            className="lbl"
            style={{ fontSize: 11.5 }}
          >
            {line}
          </text>
        ))}
        <rect x={L.card.x} y={L.card.y} width={L.card.w} height={total} rx={9} className="tbl" />
        <g data-k="hl" opacity={0}>
          <rect
            x={L.card.x + 2}
            y={nm.y + 2}
            width={L.card.w - 4}
            height={nm.h - 4}
            rx={4}
            className="hl-d"
          />
          <rect
            x={L.card.x + 2}
            y={mt.y + 2}
            width={L.card.w - 4}
            height={mt.h - 4}
            rx={4}
            className="hl-d"
          />
        </g>
        <rect x={L.card.x + 12} y={L.card.y + 11} width={8} height={8} rx={1.5} className="f-db" />
        <text x={L.card.x + 26} y={L.card.y + 19} className="lbl lbl-d">
          Data
        </text>
        {rows.map((r) => (
          <g key={r.k}>
            <path
              d={`M${L.card.x} ${r.y}H${L.card.x + L.card.w}`}
              className={`ln ln-faint ${r.k === "ageMs" ? "ln-dash" : ""}`}
            />
            <text x={L.card.x + 12} y={r.y + 19} className={`mono tiny ${r.k === "ageMs" ? "" : "lbl-fg"}`}>
              {r.k}
            </text>
            {values[r.k]}
          </g>
        ))}
        <g data-k="bracket" opacity={0}>
          <path
            d={`M${bx - 5} ${nm.y + 3}H${bx}V${mt.y + mt.h - 3}H${bx - 5}`}
            className="mk mk-d"
            strokeWidth={2}
          />
        </g>
        <text x={bx + 7} y={(nm.y + mt.y + mt.h) / 2 + 4} className="lbl lbl-d" style={{ fontSize: 11 }}>
          {wide ? t.signed : ""}
        </text>
        <Packet tone="d" k="result" r={4} />
        <Packet tone="d" k="digest" r={3.2} />
        <circle data-k="ring" r={14} className="burst burst-d" opacity={0} />
        <g data-k="seal" opacity={0}>
          <Seal r={11} />
        </g>
      </Svg>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 04 Serve: a regional cache answers; the agent verifies with the producer's key.

export function ServeFigure() {
  const t = useMessages(landing).how.serve;
  const layout = (w: boolean) =>
    w
      ? { w: 520, h: 206, y: 58, xs: [52, 190, 330, 468], panel: { x: 20, y: 140, w: 330 }, keyY: 166 }
      : { w: 340, h: 214, y: 54, xs: [36, 128, 220, 306], panel: { x: 8, y: 146, w: 324 }, keyY: 0 };
  const { box, svg, wide } = useStep(3.9, (now, $, w) => {
    const L = layout(w);
    const [a, e, r, p] = L.xs.map((x) => [x, L.y] as Pt) as [Pt, Pt, Pt, Pt];
    travel($("i1"), [a, e], now, 0.15, 0.5);
    travel($("i2"), [e, r], now, 0.85, 0.5);
    travel($("d1"), [r, e], now, 1.65, 0.5);
    travel($("d2"), [e, a], now, 2.2, 0.5);
    const ew = wobble(now - 0.65) * 0.24 + wobble(now - 2.15) * 0.2;
    put($("edge"), e[0], e[1], 1 + ew * 0.6, 0, 1 - ew);
    const rw = wobble(now - 1.35) * 0.26;
    put($("regional"), r[0], r[1], 1 + rw * 0.6, 0, 1 - rw);
    flag($("regional"), "is-cs", now >= 1.35);
    put($("prod"), p[0], p[1]);
    const aw = wobble(now - 2.7) * 0.3;
    const agent = $("agent");
    put(agent, a[0], a[1], 1 + aw * 0.6, 0, 1 - aw);
    flag(agent, "is-wait", now > 0.15 && now < 2.7);
    flag(agent, "is-done", now >= 2.7);
    appear($("miss"), now, 0.7, e[0], L.y - 26);
    appear($("hit"), now, 1.35, r[0], L.y - 30);
    // The hit's ring stays inside the gap between the "in its CS" and "regional" labels.
    const ring = seg(now, 1.35, 0.55);
    fade($("ring"), ring > 0 && ring < 1 ? 1 - ring : 0);
    put($("ring"), r[0], r[1], 0.8 + backOut(ring, 1.2) * 0.45);
    // The producer's key reaches the agent's check only when there is an answer to check: the
    // dashed line draws itself from the producer down to the panel as the panel arrives.
    if (w) {
      const x0 = p[0];
      const y0 = L.y + 62;
      const x1 = L.panel.x + L.panel.w;
      const down = L.keyY - y0;
      const len = easeOut(seg(now, 2.35, 0.5)) * (down + (x0 - x1));
      const d =
        len <= 0
          ? ""
          : len <= down
            ? `M${x0} ${y0}V${y0 + len}`
            : `M${x0} ${y0}V${L.keyY}H${x0 - (len - down)}`;
      attr($("key"), "d", d);
    }
    fade($("panel"), seg(now, 2.75, 0.2));
    put($("panel"), 0, (1 - backOut(seg(now, 2.75, 0.4))) * 8);
    appear($("ok"), now, 3.1, L.panel.x + L.panel.w - 18, L.panel.y + 26);
  });
  const L = layout(wide);
  const [a, e, r, p] = L.xs;
  const labels: [number | undefined, string][] = [
    [a, t.agent],
    [e, t.edge],
    [r, t.regional],
    [p, t.producer],
  ];
  return (
    <div ref={box}>
      <Svg svgRef={svg} title={t.title} w={L.w} h={L.h} className="servefig">
        <path d={`M${a} ${L.y}H${r}`} className="ln" />
        <path d={`M${r} ${L.y}H${p}`} className="ln ln-dash ln-faint" />
        {wide && <path data-k="key" d="" className="ln ln-dash" />}
        {labels.map(([x, l]) => (
          <text key={l} x={x} y={L.y + 36} textAnchor="middle" className="lbl">
            {l}
          </text>
        ))}
        <text x={p} y={L.y + 52} textAnchor="middle" className="lbl" style={{ fontSize: 11 }}>
          {t.notAsked}
        </text>
        <Packet tone="i" k="i1" />
        <Packet tone="i" k="i2" />
        <Packet tone="d" k="d1" />
        <Packet tone="d" k="d2" />
        <circle data-k="ring" r={18} className="burst burst-d" opacity={0} />
        <Agent k="agent" r={8} />
        <Forwarder k="edge" h={12} />
        <Core k="regional" r={13} />
        <g opacity={0.45}>
          <Producer k="prod" h={13} />
        </g>
        <g data-k="miss" opacity={0} visibility="hidden">
          <text textAnchor="middle" className="lbl" style={{ fontSize: 11 }}>
            {t.miss}
          </text>
        </g>
        <g data-k="hit" opacity={0} visibility="hidden">
          <text textAnchor="middle" className="lbl lbl-d" style={{ fontSize: 11 }}>
            {t.hit}
          </text>
        </g>
        <g data-k="panel" opacity={0}>
          <rect x={L.panel.x} y={L.panel.y} width={L.panel.w} height={52} rx={8} className="tbl" />
          <g transform={`translate(${L.panel.x + 22} ${L.panel.y + 26})`}>
            <Seal r={10} />
          </g>
          <text x={L.panel.x + 42} y={L.panel.y + 22} className="lbl lbl-fg" style={{ fontSize: 11.5 }}>
            {t.verify}
          </text>
          <text x={L.panel.x + 42} y={L.panel.y + 38} className="lbl" style={{ fontSize: 11 }}>
            {t.manifest}
          </text>
        </g>
        <g data-k="ok" opacity={0} visibility="hidden">
          <Check s={0.8} />
        </g>
      </Svg>
    </div>
  );
}
