import type { CSSProperties, ReactNode } from "react";

/**
 * Charts of the results page: plain SVG drawn on the server from the committed data, in the
 * project's flat cartoon style (solid ink marks cut out of the page by an outline in the page's
 * colour, dashed lines for the secondary series, a halftone fill, no glow and no gradients).
 *
 * Colour carries one meaning each: `interest` (blue) for requests and the baselines that only
 * send requests, `data` (yellow) for answers served from the network, greys for the rest.
 * Identity never rests on colour alone: every series also has its own dash and marker shape, a
 * direct label at its end, a legend entry, and a table under the chart with the same numbers.
 */

export type Tone = "interest" | "data" | "ink" | "muted";
export type Marker = "circle" | "square" | "diamond" | "none";

export interface ChartPoint {
  x: number;
  y: number;
  /** Ends of the 95% interval (or of the spread), in data units. */
  lo?: number;
  hi?: number;
  /** What the point says, in words: shown on hover and read by assistive technology. */
  tip?: string;
}

export interface ChartSeries {
  id: string;
  label: string;
  /** The label drawn at the end of the line, when the full one is too long there. */
  short?: string;
  tone: Tone;
  dash?: boolean;
  marker?: Marker;
  /** A thin dotted reference line (a bound), without markers or whiskers. */
  reference?: boolean;
  points: ChartPoint[];
}

export interface Tick {
  at: number;
  label: string;
}

export interface LineChartProps {
  /** Accessible name and description (`<title>`, `<desc>`). */
  title: string;
  desc: string;
  series: ChartSeries[];
  xDomain: [number, number];
  yDomain: [number, number];
  yScale?: "linear" | "log";
  xTicks: Tick[];
  yTicks: Tick[];
  xLabel: string;
  yLabel: string;
  /** Halftone fill between two series (by id): the gap the eye should weigh. */
  fill?: { from: string; to: string; tone: Tone; label?: string };
  /** A horizontal rule at this y (a baseline that is not the bottom of the plot). */
  rule?: number;
  /** Aspect of the drawing; the SVG scales to its container. */
  width?: number;
  height?: number;
  /** Room on the right for the direct labels. */
  labelRoom?: number;
}

const M = { top: 30, bottom: 46, left: 58 };

function scale(domain: [number, number], range: [number, number], log = false): (v: number) => number {
  const [d0, d1] = log ? [Math.log10(domain[0]), Math.log10(domain[1])] : domain;
  const span = d1 - d0 || 1;
  return (v) => {
    const t = ((log ? Math.log10(Math.max(v, 1e-9)) : v) - d0) / span;
    return range[0] + t * (range[1] - range[0]);
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function MarkerShape({ kind, x, y, size = 5 }: { kind: Marker; x: number; y: number; size?: number }) {
  if (kind === "none") return null;
  if (kind === "square") {
    return (
      <rect
        x={r2(x - size + 0.5)}
        y={r2(y - size + 0.5)}
        width={size * 2 - 1}
        height={size * 2 - 1}
        rx={1.5}
      />
    );
  }
  if (kind === "diamond") {
    const s = size + 1.5;
    return (
      <path d={`M${r2(x)} ${r2(y - s)}L${r2(x + s)} ${r2(y)}L${r2(x)} ${r2(y + s)}L${r2(x - s)} ${r2(y)}Z`} />
    );
  }
  return <circle cx={r2(x)} cy={r2(y)} r={size} />;
}

/** A short sample of a series' stroke and marker, for legends and table headers. */
export function SeriesKey({
  tone,
  dash,
  marker = "circle",
  reference,
}: Omit<ChartSeries, "id" | "label" | "points">) {
  return (
    <svg className={`r-key t-${tone}`} viewBox="0 0 34 12" width="34" height="12" aria-hidden="true">
      <path d="M1 6H33" className={`r-line${reference ? " r-ref" : dash ? " r-dash" : ""}`} />
      {!reference && (
        <g className="r-mark">
          <MarkerShape kind={marker} x={17} y={6} size={4} />
        </g>
      )}
    </svg>
  );
}

/** The legend of a chart: every series, in drawing order. */
export function Legend({ series, children }: { series: ChartSeries[]; children?: ReactNode }) {
  return (
    <ul className="r-legend">
      {series.map((s) => (
        <li key={s.id}>
          <SeriesKey
            tone={s.tone}
            {...(s.dash !== undefined && { dash: s.dash })}
            {...(s.marker !== undefined && { marker: s.marker })}
            {...(s.reference !== undefined && { reference: s.reference })}
          />
          {s.label}
        </li>
      ))}
      {children}
    </ul>
  );
}

/** Spread end labels that would collide: keep order, at least `gap` apart, inside [min, max]. */
export function spreadLabels(ys: number[], gap: number, min: number, max: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const placed: number[] = [];
  for (const [k, item] of order.entries()) {
    const prev = k === 0 ? Number.NEGATIVE_INFINITY : (placed[k - 1] as number);
    placed.push(Math.max(item.y, prev + gap, min));
  }
  // Push back up from the bottom if the last labels ran past the plot.
  for (let k = placed.length - 1; k >= 0; k--) {
    const next = k === placed.length - 1 ? max : (placed[k + 1] as number) - gap;
    placed[k] = Math.min(placed[k] as number, next);
  }
  const out = new Array<number>(ys.length);
  order.forEach((item, k) => {
    out[item.i] = placed[k] as number;
  });
  return out;
}

/**
 * A line chart with one y axis. Marks enter once the chart scrolls into view (`InView` adds
 * `is-in`): solid lines draw from the left, dashed ones follow, markers pop in their order.
 */
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
}: LineChartProps) {
  const x0 = M.left;
  const x1 = width - labelRoom;
  const y0 = height - M.bottom;
  const y1 = M.top;
  const sx = scale(xDomain, [x0, x1]);
  const sy = scale(yDomain, [y0, y1], yScale === "log");
  const path = (pts: ChartPoint[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${r2(sx(p.x))} ${r2(sy(p.y))}`).join("");
  const byId = new Map(series.map((s) => [s.id, s]));

  // The halftone area between two series, clipped to the x range they share.
  let area: string | undefined;
  if (fill) {
    const a = byId.get(fill.from)?.points ?? [];
    const b = byId.get(fill.to)?.points ?? [];
    if (a.length > 1 && b.length > 1) {
      area = `${path(a)}${[...b]
        .reverse()
        .map((p) => `L${r2(sx(p.x))} ${r2(sy(p.y))}`)
        .join("")}Z`;
    }
  }

  // Direct labels at the right end of each series; series that end together share one label.
  const ends = series
    .filter((s) => s.points.length > 0)
    .map((s) => ({
      s,
      y: sy((s.points[s.points.length - 1] as ChartPoint).y),
      x: sx((s.points[s.points.length - 1] as ChartPoint).x),
    }));
  const groups: { ids: string[]; label: string; y: number; x: number }[] = [];
  // Drawn series first; a reference line that ends on one of them needs no label of its own.
  for (const e of [...ends.filter((x) => !x.s.reference), ...ends.filter((x) => x.s.reference)]) {
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

  return (
    // Narrow screens scroll the drawing sideways instead of shrinking its text below reading size.
    <div className="r-chart-wrap">
      <svg
        className="r-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={title}
        style={{ "--r-w": `${width / 16}rem` } as CSSProperties}
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

        {series.map((s) => (
          <g key={s.id} className={`r-series t-${s.tone}`}>
            {!s.reference &&
              s.points
                .filter((p) => p.lo !== undefined && p.hi !== undefined && Math.abs(sy(p.lo) - sy(p.hi)) > 3)
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
                  {/* A larger, invisible target carries the hover text. */}
                  <circle className="r-hit" cx={r2(sx(p.x))} cy={r2(sy(p.y))} r={13}>
                    {p.tip && <title>{p.tip}</title>}
                  </circle>
                </g>
              ))}
          </g>
        ))}

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
    </div>
  );
}

/** Round tick values covering [min, max]: about `count` steps of 1, 2 or 5 × 10ⁿ. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => span / s <= count + 0.5) ?? 10 * pow;
  const out: number[] = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) {
    out.push(Math.round(v / step) * step + 0);
  }
  return out;
}

/**
 * One whole split into parts on a thin bar, with the parts listed beside it (the list carries the
 * figures, so the bar prints none).
 */
export function SplitBar({
  parts,
  label,
}: {
  parts: { key: string; value: number; tone: Tone; title: string }[];
  label: string;
}) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  let x = 0;
  const gap = 0.6;
  return (
    <svg className="r-split" viewBox="0 0 100 4" preserveAspectRatio="none" role="img" aria-label={label}>
      <title>{label}</title>
      {parts.map((p) => {
        const w = (p.value / total) * 100;
        const rect = (
          <rect
            key={p.key}
            className={`r-seg t-${p.tone}`}
            x={r2(x)}
            y={0}
            width={r2(Math.max(0, w - gap))}
            height={4}
          >
            <title>{p.title}</title>
          </rect>
        );
        x += w;
        return rect;
      })}
    </svg>
  );
}
