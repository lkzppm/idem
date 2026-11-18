import type { ReactNode } from "react";
import type { ResultsMessages } from "@/lib/i18n/messages/results";
import { type EvalModeId, type ResultsData, type Stat, type SweepData, seriesOf } from "@/lib/results/data";
import type { Format } from "@/lib/results/format";
import { InfoTip } from "../sandbox/ui";
import {
  type ChartLabels,
  type ChartSeries,
  type Marker,
  niceTicks,
  SeriesKey,
  type Tick,
  type Tone,
} from "./chart";
import { InView } from "./in-view";
import { LineChart } from "./interactive-chart";

type RunRef = SweepData["run"];
type Micro = NonNullable<ResultsData["e1"]>;

/** How each mode is drawn, everywhere on the page: the colour says what travels, the dash and the marker say which mode. */
export const MODE_STYLE: Record<EvalModeId, { tone: Tone; dash: boolean; marker: Marker }> = {
  B0: { tone: "interest", dash: false, marker: "circle" },
  B1: { tone: "interest", dash: true, marker: "square" },
  B2: { tone: "data", dash: false, marker: "circle" },
  B3: { tone: "data", dash: true, marker: "diamond" },
  B4: { tone: "muted", dash: true, marker: "square" },
};

/** The chart's own words (hint, legend, toggles), with a line saying what the readout's numbers are. */
export function chartLabels(t: ResultsMessages, note?: string): ChartLabels {
  return {
    hint: t.chart.hint,
    legend: t.chart.legend,
    hide: t.chart.hide,
    show: t.chart.show,
    showAll: t.chart.showAll,
    ...(note !== undefined && { note }),
  };
}

/** `B2 IDEM`: the id the tables use, then the name a reader can keep. */
export function modeLabel(t: ResultsMessages, id: EvalModeId): string {
  return `${id} ${t.modes[id]}`;
}

/** Under a figure: what kind of result it is and which run folders it was drawn from. */
export function Provenance({
  t,
  kind,
  runs,
  seeds,
}: {
  t: ResultsMessages;
  kind: "simulation" | "wall-clock" | "emulation";
  runs: RunRef[];
  seeds?: number;
}) {
  const first = runs[0];
  const last = runs[runs.length - 1];
  return (
    <p className="r-prov">
      <span className="r-prov-kind">
        {kind === "simulation"
          ? t.chart.simulation
          : kind === "emulation"
            ? t.chart.emulation
            : t.chart.wallClock}
      </span>
      {seeds !== undefined && <span>{t.chart.seeds(seeds)}</span>}
      {first && last && (
        <span>
          {runs.length === 1 ? t.chart.run : `${runs.length} ${t.chart.runs}`}{" "}
          <code>
            {first.experiment}/{first.id}
            {runs.length > 1 && ` … ${last.id}`}
          </code>
        </span>
      )}
    </p>
  );
}

/** The table twin of a chart: the same numbers, readable without the drawing. */
export function ValueTable({
  t,
  caption,
  head,
  rows,
  note,
  open = false,
}: {
  t: ResultsMessages;
  caption: string;
  head: ReactNode[];
  rows: ReactNode[][];
  note?: string;
  open?: boolean;
}) {
  return (
    <details className="r-details" open={open}>
      <summary>{t.chart.table}</summary>
      <div className="r-scroll">
        <table className="r-table">
          <caption>{caption}</caption>
          <thead>
            <tr>
              {head.map((h, i) => (
                <th key={i} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) =>
                  j === 0 ? (
                    <th key={j} scope="row">
                      {c}
                    </th>
                  ) : (
                    <td key={j}>{c}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && <p className="r-table-note">{note}</p>}
    </details>
  );
}

/** `29.2% ± 1.6`: a ratio with the half-width of its interval in percentage points. */
export function pctCi(f: Format, s: Stat | undefined): string {
  return s ? `${f.pct(s.mean)} ± ${f.points(s.ci95)}` : "–";
}
/** `−34.6 ms ± 3.8`. */
export function msCi(f: Format, s: Stat | undefined, signed = false): string {
  return s ? `${f.ms(s.mean, 1, signed)} ± ${f.num(s.ci95)}` : "–";
}

function modeHead(t: ResultsMessages, id: EvalModeId): ReactNode {
  const st = MODE_STYLE[id];
  return (
    <span className="r-th-mode">
      <SeriesKey tone={st.tone} dash={st.dash} marker={st.marker} />
      {modeLabel(t, id)}
    </span>
  );
}

function upperBound(series: ChartSeries[], floor: number): number {
  let max = floor;
  for (const s of series) for (const p of s.points) max = Math.max(max, p.hi ?? p.y);
  return max;
}

/**
 * Upstream reduction against B0 along one swept parameter: B1, B2 and B3 with their intervals,
 * the perfect-cache bound as a dotted line, and the gain of sharing over private caches in halftone.
 */
export function ReductionFigure({
  t,
  f,
  sweep,
  copy,
  xFormat,
  caption,
  compact = false,
  bound = true,
  modes = ["B1", "B2", "B3"],
  info,
}: {
  t: ResultsMessages;
  f: Format;
  sweep: SweepData;
  copy: { title: string; desc: string; x: string; y?: string };
  xFormat: (v: number) => string;
  caption: string;
  compact?: boolean;
  bound?: boolean;
  modes?: EvalModeId[];
  /** A note behind an info button beside the title. */
  info?: { label: string; body: ReactNode };
}) {
  const shown = modes.filter((m) => sweep.modes.some((x) => x.id === m));
  const series: ChartSeries[] = [];
  if (bound) {
    series.push({
      id: "bound",
      label: t.modes.bound,
      tone: "ink",
      reference: true,
      points: seriesOf(sweep, "oracle_reduction", "B0").map((p) => ({
        x: p.index,
        y: p.stat.mean,
        text: f.pct(p.stat.mean),
      })),
    });
  }
  for (const m of shown) {
    series.push({
      id: m,
      label: modeLabel(t, m),
      short: m,
      ...MODE_STYLE[m],
      points: seriesOf(sweep, "upstream_reduction", m).map((p) => ({
        x: p.index,
        y: p.stat.mean,
        lo: p.stat.mean - p.stat.ci95,
        hi: p.stat.mean + p.stat.ci95,
        text: pctCi(f, p.stat),
      })),
    });
  }
  const top = upperBound(series, 0.05);
  const ticks = niceTicks(0, top, compact ? 4 : 5);
  const yMax = Math.max(top, ticks[ticks.length - 1] ?? top) * 1.04;
  const n = sweep.values.length;
  return (
    <InView className={compact ? "r-figure-compact" : ""}>
      <h3 className="r-figure-title">
        {copy.title}
        {info && <InfoTip label={info.label}>{info.body}</InfoTip>}
      </h3>
      <LineChart
        title={copy.title}
        desc={copy.desc}
        series={series}
        xDomain={[-0.3, n - 1 + 0.3]}
        yDomain={[0, yMax]}
        xTicks={sweep.values.map((v, i): Tick => ({ at: i, label: xFormat(v) }))}
        yTicks={ticks.map((v): Tick => ({ at: v, label: f.pct(v, 0) }))}
        xLabel={copy.x}
        yLabel={copy.y ?? t.sensitivity.y}
        {...(!compact &&
          shown.includes("B1") &&
          shown.includes("B2") && { fill: { from: "B2", to: "B1", tone: "data" as Tone } })}
        {...(compact && { width: 420, height: 300, labelRoom: 44 })}
        labels={chartLabels(t, t.chart.noteCi(sweep.seeds))}
      />
      <figcaption>{caption}</figcaption>
      <Provenance t={t} kind="simulation" runs={[sweep.run]} seeds={sweep.seeds} />
      <ValueTable
        t={t}
        caption={`${copy.title}. ${t.chart.meanCi}`}
        head={[copy.x, ...shown.map((m) => modeHead(t, m)), ...(bound ? [t.modes.bound] : [])]}
        rows={sweep.values.map((v, i) => [
          xFormat(v),
          ...shown.map((m) => pctCi(f, sweep.metrics.upstream_reduction?.[m]?.[i])),
          ...(bound ? [f.pct(sweep.metrics.oracle_reduction?.B0?.[i]?.mean ?? Number.NaN)] : []),
        ])}
      />
    </InView>
  );
}

/** The latency of every call at the base point, as a cumulative distribution up to p99. */
export function CdfFigure({
  t,
  f,
  sweep,
  caption,
}: {
  t: ResultsMessages;
  f: Format;
  sweep: SweepData;
  caption: string;
}) {
  const modes = (["B0", "B1", "B2", "B3"] as EvalModeId[]).filter((m) => (sweep.cdf[m]?.length ?? 0) > 99);
  const p99 = Math.max(...modes.map((m) => sweep.cdf[m]?.[99] ?? 0));
  const ticks = niceTicks(0, p99, 6);
  const xMax = Math.max(p99, ticks[ticks.length - 1] ?? p99);
  const series: ChartSeries[] = modes.map((m) => ({
    id: m,
    label: modeLabel(t, m),
    short: m,
    tone: MODE_STYLE[m].tone,
    dash: MODE_STYLE[m].dash,
    marker: "none",
    // From the fastest call to the 99th percentile; the curve starts on the axis.
    points: [
      { x: sweep.cdf[m]?.[0] ?? 0, y: 0, head: "p0", text: f.ms(sweep.cdf[m]?.[0] ?? 0) },
      ...(sweep.cdf[m] ?? []).slice(1, 100).map((latency, i) => ({
        x: latency,
        y: (i + 1) / 100,
        head: `p${i + 1}`,
        text: f.ms(latency),
      })),
    ],
  }));
  const qs = [10, 25, 50, 75, 90, 95, 99];
  return (
    <InView>
      <h3 className="r-figure-title">{t.latency.cdf.title}</h3>
      <LineChart
        title={t.latency.cdf.title}
        desc={t.latency.cdf.desc}
        series={series}
        xDomain={[0, xMax]}
        yDomain={[0, 1]}
        xTicks={ticks.map((v): Tick => ({ at: v, label: f.int(v) }))}
        yTicks={[0, 0.25, 0.5, 0.75, 1].map((v): Tick => ({ at: v, label: f.pct(v, 0) }))}
        xLabel={t.latency.cdf.x}
        yLabel={t.latency.cdf.y}
        readout="nearest"
        labels={chartLabels(t, t.chart.notePooled(sweep.seeds))}
      />
      <figcaption>{caption}</figcaption>
      <Provenance t={t} kind="simulation" runs={[sweep.run]} seeds={sweep.seeds} />
      <ValueTable
        t={t}
        caption={t.latency.cdf.title}
        head={[t.latency.cdf.y, ...modes.map((m) => modeHead(t, m))]}
        rows={qs.map((q) => [f.pct(q / 100, 0), ...modes.map((m) => f.ms(sweep.cdf[m]?.[q] ?? Number.NaN))])}
      />
    </InView>
  );
}

/** Change of the per-run median against B0 along the swept parameter, paired by seed. */
export function DeltaFigure({
  t,
  f,
  sweep,
  xFormat,
}: {
  t: ResultsMessages;
  f: Format;
  sweep: SweepData;
  xFormat: (v: number) => string;
}) {
  const modes = (["B1", "B2", "B3"] as EvalModeId[]).filter((m) => sweep.modes.some((x) => x.id === m));
  const metric = "latency_p50_vs_b0_ms";
  const series: ChartSeries[] = modes.map((m) => ({
    id: m,
    label: modeLabel(t, m),
    short: m,
    ...MODE_STYLE[m],
    points: seriesOf(sweep, metric, m).map((p) => ({
      x: p.index,
      y: p.stat.mean,
      lo: p.stat.mean - p.stat.ci95,
      hi: p.stat.mean + p.stat.ci95,
      text: msCi(f, p.stat, true),
    })),
  }));
  let low = 0;
  let high = 0;
  for (const s of series) {
    for (const p of s.points) {
      low = Math.min(low, p.lo ?? p.y);
      high = Math.max(high, p.hi ?? p.y);
    }
  }
  const ticks = niceTicks(low, Math.max(0, high), 6);
  const yMin = Math.min(low, ticks[0] ?? low);
  const span = Math.max(0, high) - yMin || 1;
  const n = sweep.values.length;
  return (
    <InView>
      <h3 className="r-figure-title">{t.latency.delta.title}</h3>
      <LineChart
        title={t.latency.delta.title}
        desc={t.latency.delta.desc}
        series={series}
        xDomain={[-0.3, n - 1 + 0.3]}
        yDomain={[yMin - span * 0.04, Math.max(0, high) + span * 0.06]}
        xTicks={sweep.values.map((v, i): Tick => ({ at: i, label: xFormat(v) }))}
        yTicks={ticks.map((v): Tick => ({ at: v, label: f.int(v) }))}
        xLabel={t.latency.delta.x}
        yLabel={t.latency.delta.y}
        rule={0}
        labels={chartLabels(t, t.chart.noteCi(sweep.seeds))}
      />
      <figcaption>{t.latency.delta.caption}</figcaption>
      <Provenance t={t} kind="simulation" runs={[sweep.run]} seeds={sweep.seeds} />
      <ValueTable
        t={t}
        caption={`${t.latency.delta.title}. ${t.chart.meanCi}`}
        head={[t.latency.delta.x, ...modes.map((m) => modeHead(t, m))]}
        rows={sweep.values.map((v, i) => [
          xFormat(v),
          ...modes.map((m) => msCi(f, sweep.metrics[metric]?.[m]?.[i], true)),
        ])}
      />
    </InView>
  );
}

const OP_STYLE: Record<string, { tone: Tone; dash: boolean; marker: Marker }> = {
  canonicalizeArgs: { tone: "interest", dash: false, marker: "circle" },
  makeName: { tone: "interest", dash: true, marker: "square" },
  signData: { tone: "data", dash: false, marker: "circle" },
  verifyData: { tone: "data", dash: true, marker: "diamond" },
};

/** E1: median time per call by payload size, both axes logarithmic, with the spread over runs. */
export function MicrobenchFigure({ t, f, e1 }: { t: ResultsMessages; f: Format; e1: Micro }) {
  const sizes = e1.sizesBytes;
  const series: ChartSeries[] = e1.ops.map((o) => ({
    id: o.op,
    label: o.op,
    ...(OP_STYLE[o.op] ?? { tone: "muted" as Tone, dash: false, marker: "circle" as Marker }),
    points: o.cells.map((c) => ({
      x: sizes.indexOf(c.sizeBytes),
      y: c.p50Us,
      lo: c.p50MinUs,
      hi: c.p50MaxUs,
      text: `${f.us(c.p50Us)} (${f.us(c.p50MinUs)} – ${f.us(c.p50MaxUs)})`,
    })),
  }));
  let low = Number.POSITIVE_INFINITY;
  let high = 0;
  for (const s of series) {
    for (const p of s.points) {
      low = Math.min(low, p.lo ?? p.y);
      high = Math.max(high, p.hi ?? p.y);
    }
  }
  const decades: number[] = [];
  for (let e = Math.floor(Math.log10(low)); e <= Math.ceil(Math.log10(high)); e++) decades.push(10 ** e);
  const yDomain: [number, number] = [low / 1.5, high * 1.5];
  const yTicks = decades.filter((v) => v >= yDomain[0] && v <= yDomain[1]);
  const last = e1.runs[e1.runs.length - 1];
  return (
    <InView>
      <h3 className="r-figure-title">{t.e1.chart.title}</h3>
      <LineChart
        title={t.e1.chart.title}
        desc={t.e1.chart.desc}
        series={series}
        xDomain={[-0.3, sizes.length - 1 + 0.3]}
        yDomain={yDomain}
        yScale="log"
        xTicks={sizes.map((s, i): Tick => ({ at: i, label: f.bytes(s) }))}
        yTicks={yTicks.map(
          (v): Tick => ({ at: v, label: v >= 1000 ? `${f.int(v / 1000)} ms` : `${f.int(v)} µs` }),
        )}
        xLabel={t.e1.chart.x}
        yLabel={t.e1.chart.y}
        labelRoom={150}
        labels={chartLabels(t, t.chart.noteRange(e1.runs.length))}
      />
      <figcaption>
        {t.e1.chart.caption({ runs: e1.runs.length, node: last?.node ?? "", cpu: last?.cpu ?? "" })}
      </figcaption>
      <Provenance t={t} kind="wall-clock" runs={e1.runs} />
      <ValueTable
        t={t}
        caption={`${t.e1.chart.title}: ${t.e1.chart.y}`}
        head={[
          t.e1.columns.size,
          t.e1.columns.p50,
          t.e1.columns.range,
          t.e1.columns.p95,
          t.e1.columns.p99,
          t.e1.columns.iterations,
        ]}
        rows={e1.ops.flatMap((o) =>
          o.cells.map((c) => [
            <span key="k" className="r-op">
              <code>{o.op}</code> {f.bytes(c.sizeBytes)}
            </span>,
            f.us(c.p50Us),
            `${f.us(c.p50MinUs)} – ${f.us(c.p50MaxUs)}`,
            f.us(c.p95Us),
            f.us(c.p99Us),
            f.int(c.iterations),
          ]),
        )}
      />
    </InView>
  );
}
