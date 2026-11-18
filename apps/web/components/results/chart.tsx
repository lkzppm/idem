/**
 * Charts of the results page: plain SVG drawn on the server from the committed data, in the
 * project's flat cartoon style (solid ink marks cut out of the page by an outline in the page's
 * colour, dashed lines for the secondary series, a halftone fill, no glow and no gradients).
 *
 * Colour carries one meaning each: `interest` (blue) for requests and the baselines that only
 * send requests, `data` (yellow) for answers served from the network, greys for the rest.
 * Identity never rests on colour alone: every series also has its own dash and marker shape, a
 * direct label at its end, a legend entry, and a table under the chart with the same numbers.
 *
 * This file holds what the server draws and the types; the interactive line chart (hover and
 * keyboard readout, legend toggles) is `interactive-chart.tsx`.
 */

export type Tone = "interest" | "data" | "ink" | "muted";
export type Marker = "circle" | "square" | "diamond" | "none";

export interface ChartPoint {
  x: number;
  y: number;
  /** Ends of the 95% interval (or of the spread), in data units. */
  lo?: number;
  hi?: number;
  /** The value as the readout prints it, already formatted: `29.2% ± 1.6`. */
  text: string;
  /** In `nearest` charts, the readout heading of the point (`p95`). */
  head?: string;
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

/** The chart's own words, already in the visitor's language (the component is a client one and takes no functions). */
export interface ChartLabels {
  /** One line on how to read exact values: hover, touch or arrow keys. */
  hint: string;
  /** Accessible name of the legend. */
  legend: string;
  /** Prefix of a legend button's name while the series is on: "Hide". */
  hide: string;
  /** … and while it is off: "Show". */
  show: string;
  /** Button that turns every series back on. */
  showAll: string;
  /** What the readout's numbers are: "Mean ± 95% CI over 30 seeds". */
  note?: string;
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
  /**
   * `x`: the readout follows the nearest x and lists every series there (series that share their x
   * values). `nearest`: it follows the nearest point of any series (curves with their own x values).
   */
  readout?: "x" | "nearest";
  labels: ChartLabels;
}

export const r2 = (n: number) => Math.round(n * 100) / 100;

export const M = { top: 30, bottom: 46, left: 58 };

/** A linear or logarithmic scale from a data domain to a pixel range. */
export function scale(domain: [number, number], range: [number, number], log = false): (v: number) => number {
  const [d0, d1] = log ? [Math.log10(domain[0]), Math.log10(domain[1])] : domain;
  const span = d1 - d0 || 1;
  return (v) => {
    const t = ((log ? Math.log10(Math.max(v, 1e-9)) : v) - d0) / span;
    return range[0] + t * (range[1] - range[0]);
  };
}

export function MarkerShape({ kind, x, y, size = 5 }: { kind: Marker; x: number; y: number; size?: number }) {
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
