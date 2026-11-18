"use client";

import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type ChartPoint,
  type ChartSeries,
  type LineChartProps,
  M,
  MarkerShape,
  r2,
  SeriesKey,
  scale,
  spreadLabels,
} from "./chart";

/**
 * The results page's line chart. The drawing is the same flat SVG as before (marks cut out of the
 * page by an outline, dashed secondary series, halftone gap, direct labels at the line ends), plus:
 *
 * - **A readout.** Hover or touch moves a crosshair and shows a small card with the exact values,
 *   with their interval, at the nearest x (`readout: "x"`) or for the nearest point (`"nearest"`).
 *   The chart is one tab stop: arrow keys move the readout, Home and End jump, Escape clears, and a
 *   visually hidden live region says the same thing.
 * - **A legend that is also the controls.** Hovering or focusing an entry highlights that series
 *   (the others fade); pressing it hides or shows the series, never leaving the chart empty.
 *
 * Everything shown is a prop computed on the server from `lib/results/data.json`; nothing here
 * invents a value.
 */

type Cursor = { kind: "x"; x: number } | { kind: "pt"; id: string; i: number };

interface Row {
  s: ChartSeries;
  p: ChartPoint;
}

export function LineChart({
  title,
  desc,
  series,
  xDomain,
  yDomain,
  yScale = "linear",
  xTicks,
  yTicks,
  xLabel,
  yLabel,
  fill,
  rule,
  width = 640,
  height = 360,
  labelRoom = 96,
  readout = "x",
  labels,
}: LineChartProps) {
  const [off, setOff] = useState<ReadonlySet<string>>(new Set());
  const [lit, setLit] = useState<string | null>(null);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [byKeys, setByKeys] = useState(false);
  const svg = useRef<SVGSVGElement>(null);

  const shown = useMemo(() => series.filter((s) => !off.has(s.id)), [series, off]);
  const drawn = shown.filter((s) => !s.reference);

  const x0 = M.left;
  const x1 = width - labelRoom;
  const y0 = height - M.bottom;
  const y1 = M.top;
  const sx = useMemo(() => scale(xDomain, [x0, x1]), [xDomain, x0, x1]);
  const sy = useMemo(() => scale(yDomain, [y0, y1], yScale === "log"), [yDomain, y0, y1, yScale]);
  const path = (pts: ChartPoint[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${r2(sx(p.x))} ${r2(sy(p.y))}`).join("");
  const byId = new Map(series.map((s) => [s.id, s]));

  // ---- the halftone area between two series (only while both are on)
  let area: string | undefined;
  if (fill && !off.has(fill.from) && !off.has(fill.to)) {
    const a = byId.get(fill.from)?.points ?? [];
    const b = byId.get(fill.to)?.points ?? [];
    if (a.length > 1 && b.length > 1) {
      area = `${path(a)}${[...b]
        .reverse()
        .map((p) => `L${r2(sx(p.x))} ${r2(sy(p.y))}`)
        .join("")}Z`;
    }
  }

  // ---- direct labels at the right end of each series on screen
  const ends = shown
    .filter((s) => s.points.length > 0)
    .map((s) => ({
      s,
      y: sy((s.points[s.points.length - 1] as ChartPoint).y),
      x: sx((s.points[s.points.length - 1] as ChartPoint).x),
    }));
  const groups: { ids: string[]; label: string; y: number; x: number }[] = [];
  for (const e of [...ends.filter((v) => !v.s.reference), ...ends.filter((v) => v.s.reference)]) {
    const text = e.s.short ?? e.s.label;
    const same = groups.find((g) => Math.abs(g.y - e.y) < 1.5 && Math.abs(g.x - e.x) < 1.5);
    if (same) {
      same.ids.push(e.s.id);
      if (!e.s.reference) same.label = `${same.label} · ${text}`;
    } else groups.push({ ids: [e.s.id], label: text, y: e.y, x: e.x });
  }
  const labelYs = spreadLabels(
    groups.map((g) => g.y),
    15,
    y1 + 4,
    y0 - 2,
  );
  const patternId = `r-halftone-${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  const span = xDomain[1] - xDomain[0] || 1;

  // ---- the readout
  /** The x positions the readout can stop at (readout "x"): where any visible series has a point. */
  const stops = useMemo(
    () => [...new Set(shown.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b),
    [shown],
  );
  // A hidden series can strand the cursor: resolve it against what is on screen.
  const live: Cursor | null = (() => {
    if (!cursor) return null;
    if (cursor.kind === "x") return stops.includes(cursor.x) ? cursor : null;
    const s = shown.find((v) => v.id === cursor.id);
    return s?.points[cursor.i] ? cursor : null;
  })();

  const rows: Row[] = [];
  let heading = "";
  if (live?.kind === "x") {
    for (const s of shown) {
      const p = s.points.find((q) => q.x === live.x);
      if (p) rows.push({ s, p });
    }
    const tick = xTicks.find((t) => Math.abs(t.at - live.x) < 1e-9);
    heading = `${xLabel}: ${tick?.label ?? r2(live.x)}`;
  } else if (live?.kind === "pt") {
    const s = shown.find((v) => v.id === live.id);
    const p = s?.points[live.i];
    if (s && p) {
      rows.push({ s, p });
      heading = p.head ?? "";
    }
  }
  const spoken = rows.length ? `${heading}. ${rows.map((r) => `${r.s.label}: ${r.p.text}`).join("; ")}` : "";
  const litId = lit ?? (live?.kind === "pt" ? live.id : null);

  // ---- pointer
  const place = useCallback(
    (e: PointerEvent<SVGSVGElement>): Cursor | null => {
      const el = svg.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0) return null;
      const px = ((e.clientX - r.left) * width) / r.width;
      const py = ((e.clientY - r.top) * height) / r.height;
      if (px < x0 - 14 || px > x1 + 14 || py < y1 - 14 || py > y0 + 14) return null;
      if (readout === "x") {
        let best: number | undefined;
        for (const x of stops)
          if (best === undefined || Math.abs(sx(x) - px) < Math.abs(sx(best) - px)) best = x;
        return best === undefined ? null : { kind: "x", x: best };
      }
      let best: { id: string; i: number; d: number } | undefined;
      for (const s of drawn) {
        s.points.forEach((p, i) => {
          const d = (sx(p.x) - px) ** 2 + (sy(p.y) - py) ** 2;
          if (!best || d < best.d) best = { id: s.id, i, d };
        });
      }
      return best ? { kind: "pt", id: best.id, i: best.i } : null;
    },
    [readout, stops, drawn, sx, sy, width, height, x0, x1, y0, y1],
  );
  const onPointer = (e: PointerEvent<SVGSVGElement>) => {
    setByKeys(false);
    setCursor(place(e));
  };

  // ---- keyboard
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    if (k === "Escape") {
      setCursor(null);
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(k)) return;
    e.preventDefault();
    setByKeys(true);
    const dir = k === "ArrowRight" ? 1 : k === "ArrowLeft" ? -1 : 0;
    if (readout === "x") {
      if (stops.length === 0) return;
      const at = live?.kind === "x" ? stops.indexOf(live.x) : -1;
      const next =
        k === "Home"
          ? 0
          : k === "End"
            ? stops.length - 1
            : at < 0
              ? dir < 0
                ? stops.length - 1
                : 0
              : Math.min(stops.length - 1, Math.max(0, at + dir));
      setCursor({ kind: "x", x: stops[next] as number });
      return;
    }
    if (drawn.length === 0) return;
    const cur = live?.kind === "pt" ? live : { id: (drawn[0] as ChartSeries).id, i: -1 };
    const s = drawn.find((v) => v.id === cur.id) ?? (drawn[0] as ChartSeries);
    const last = s.points.length - 1;
    if (k === "ArrowUp" || k === "ArrowDown") {
      const at = drawn.indexOf(s);
      const n = drawn[(at + (k === "ArrowUp" ? -1 : 1) + drawn.length) % drawn.length] as ChartSeries;
      const x = s.points[Math.max(0, cur.i)]?.x ?? 0;
      let j = 0;
      n.points.forEach((p, i) => {
        if (Math.abs(p.x - x) < Math.abs((n.points[j] as ChartPoint).x - x)) j = i;
      });
      setCursor({ kind: "pt", id: n.id, i: j });
      return;
    }
    const i =
      k === "Home"
        ? 0
        : k === "End"
          ? last
          : cur.i < 0
            ? Math.round(last / 2)
            : Math.min(last, Math.max(0, cur.i + dir));
    setCursor({ kind: "pt", id: s.id, i });
  };

  // ---- legend
  const toggle = (id: string) => {
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        // Never an empty chart: the last drawn series stays.
        const target = byId.get(id);
        const left = series.filter((s) => !s.reference && !next.has(s.id) && s.id !== id);
        if (!target?.reference && left.length === 0) return prev;
        next.add(id);
      }
      return next;
    });
  };

  // The card sits to the right of the crosshair, or to its left past the middle of the plot.
  const cx = live ? (live.kind === "x" ? sx(live.x) : sx(rows[0]?.p.x ?? 0)) : 0;
  const flip = cx > (x0 + x1) / 2;
  const card: CSSProperties = {
    left: `${(cx / width) * 100}%`,
    top: `${((y1 - 6) / height) * 100}%`,
    transform: flip ? "translateX(calc(-100% - 14px))" : "translateX(14px)",
  };

  return (
    <div className="r-chart-block" data-hl={litId ?? undefined}>
      <div
        className="r-chart-wrap"
        role="group"
        aria-label={`${title}. ${labels.hint}`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setByKeys(false);
          setCursor(null);
        }}
      >
        <div className="r-chart-stage" style={{ "--r-w": `${width / 16}rem` } as CSSProperties}>
          <svg
            ref={svg}
            className="r-chart"
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={title}
            onPointerDown={onPointer}
            onPointerMove={onPointer}
            onPointerLeave={() => {
              if (!byKeys) setCursor(null);
            }}
          >
            <title>{title}</title>
            <desc>{desc}</desc>
            {fill && (
              <defs>
                <pattern
                  id={patternId}
                  width="7"
                  height="7"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <circle cx="3.5" cy="3.5" r="1.45" className={`r-dot t-${fill.tone}`} />
                </pattern>
              </defs>
            )}

            {/* Grid and axes: hairlines, solid, a step off the page. */}
            <g className="r-grid">
              {yTicks.map((t) => (
                <path key={t.at} d={`M${x0} ${r2(sy(t.at))}H${x1}`} />
              ))}
            </g>
            <path className="r-axis" d={`M${x0} ${y1}V${y0}H${x1}`} />
            {rule !== undefined && <path className="r-rule" d={`M${x0} ${r2(sy(rule))}H${x1}`} />}
            <g className="r-ticks">
              {yTicks.map((t) => (
                <text key={t.at} x={x0 - 9} y={r2(sy(t.at) + 3.5)} textAnchor="end">
                  {t.label}
                </text>
              ))}
              {xTicks.map((t) => (
                <g key={t.at}>
                  <path d={`M${r2(sx(t.at))} ${y0}v5`} />
                  <text x={r2(sx(t.at))} y={y0 + 18} textAnchor="middle">
                    {t.label}
                  </text>
                </g>
              ))}
            </g>
            <text className="r-axis-label" x={(x0 + x1) / 2} y={height - 6} textAnchor="middle">
              {xLabel}
            </text>
            <text className="r-axis-label" x={x0 - 44} y={12} textAnchor="start">
              {yLabel}
            </text>

            {area && <path className="r-area" d={area} fill={`url(#${patternId})`} />}

            {/* The crosshair sits under the marks. */}
            {live && rows.length > 0 && (
              <g className="r-cross" aria-hidden="true">
                <path d={`M${r2(cx)} ${y1}V${y0}`} />
                {live.kind === "pt" && rows[0] && <path d={`M${x0} ${r2(sy(rows[0].p.y))}H${x1}`} />}
              </g>
            )}

            {shown.map((s) => (
              <g key={s.id} className={`r-series t-${s.tone}${litId && litId !== s.id ? " is-dim" : ""}`}>
                {!s.reference &&
                  s.points
                    .filter(
                      (p) => p.lo !== undefined && p.hi !== undefined && Math.abs(sy(p.lo) - sy(p.hi)) > 3,
                    )
                    .map((p) => {
                      const px = r2(sx(p.x));
                      const a = r2(sy(p.hi as number));
                      const b = r2(sy(p.lo as number));
                      return (
                        <path
                          key={p.x}
                          className="r-whisker"
                          d={`M${px - 4} ${a}h8M${px} ${a}V${b}M${px - 4} ${b}h8`}
                        />
                      );
                    })}
                <path
                  className={`r-line${s.reference ? " r-ref" : s.dash ? " r-dash" : " r-draw"}`}
                  d={path(s.points)}
                  {...(!s.reference && !s.dash && { pathLength: 1 })}
                />
                {!s.reference &&
                  (s.marker ?? "circle") !== "none" &&
                  s.points.map((p) => (
                    <g
                      key={p.x}
                      className="r-mark"
                      style={{ "--r-at": r2((p.x - xDomain[0]) / span) } as CSSProperties}
                    >
                      <MarkerShape kind={s.marker ?? "circle"} x={sx(p.x)} y={sy(p.y)} />
                    </g>
                  ))}
              </g>
            ))}

            {/* Rings on the points the readout is reading. */}
            {live && (
              <g className="r-rings" aria-hidden="true">
                {rows.map(({ s, p }) => (
                  <circle key={s.id} cx={r2(sx(p.x))} cy={r2(sy(p.y))} r={s.marker === "none" ? 6 : 10} />
                ))}
              </g>
            )}

            <g className="r-end-labels">
              {groups.map((g, i) => {
                const ly = labelYs[i] as number;
                const moved = Math.abs(ly - g.y) > 4;
                return (
                  <g key={g.ids.join("+")}>
                    {moved && (
                      <path className="r-leader" d={`M${r2(g.x + 9)} ${r2(g.y)}L${r2(g.x + 16)} ${r2(ly)}`} />
                    )}
                    <text x={r2(g.x + (moved ? 19 : 12))} y={r2(ly + 3.5)}>
                      {g.label}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>

          {live && rows.length > 0 && (
            <div className="r-card" style={card} aria-hidden="true">
              <p className="r-card-head">{heading}</p>
              <ul>
                {rows.map(({ s, p }) => (
                  <li key={s.id}>
                    <SeriesKey
                      tone={s.tone}
                      {...(s.dash !== undefined && { dash: s.dash })}
                      {...(s.marker !== undefined && { marker: s.marker })}
                      {...(s.reference !== undefined && { reference: s.reference })}
                    />
                    <span className="r-card-name">{s.short ?? s.label}</span>
                    <span className="r-card-val">{p.text}</span>
                  </li>
                ))}
              </ul>
              {labels.note && <p className="r-card-note">{labels.note}</p>}
            </div>
          )}
        </div>
        <p className="r-sr" aria-live={byKeys ? "polite" : "off"}>
          {spoken}
        </p>
      </div>

      <ul className="r-legend" aria-label={labels.legend}>
        {series.map((s) => {
          const on = !off.has(s.id);
          return (
            <li key={s.id}>
              <button
                type="button"
                aria-pressed={on}
                aria-label={`${on ? labels.hide : labels.show} ${s.label}`}
                onClick={() => toggle(s.id)}
                onPointerEnter={() => setLit(s.id)}
                onPointerLeave={() => setLit(null)}
                onFocus={() => setLit(s.id)}
                onBlur={() => setLit(null)}
              >
                <SeriesKey
                  tone={s.tone}
                  {...(s.dash !== undefined && { dash: s.dash })}
                  {...(s.marker !== undefined && { marker: s.marker })}
                  {...(s.reference !== undefined && { reference: s.reference })}
                />
                {s.label}
              </button>
            </li>
          );
        })}
        {off.size > 0 && (
          <li>
            <button type="button" className="r-legend-all" onClick={() => setOff(new Set())}>
              {labels.showAll}
            </button>
          </li>
        )}
      </ul>
      <p className="r-chart-hint">{labels.hint}</p>
    </div>
  );
}
