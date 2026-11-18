import type { EmulationData, EmulationModeId, NfdData } from "@idem/sim";
import type { ResultsMessages } from "@/lib/i18n/messages/results";
import type { Format } from "@/lib/results/format";
import { e4At, nfdReading } from "@/lib/results/native";
import { type ChartSeries, type Marker, niceTicks, type Tick, type Tone } from "./chart";
import { chartLabels, Provenance, ValueTable } from "./figures";
import { InView } from "./in-view";
import { LineChart } from "./interactive-chart";
import { ChartTabs } from "./tabs";

/**
 * The lead section of the page: IDEM on real NDN. E4 puts the HTTP overlay and the native binding on
 * the same emulated links and varies the loss; the NFD check says whether the native binding does
 * what the protocol says against real forwarders. Until E4 has a run folder the page says so and
 * shows no number for it.
 */

/** How each E4 mode is drawn: colour for what it carries, dash and marker for which mode. */
export const E4_STYLE: Record<EmulationModeId, { tone: Tone; dash: boolean; marker: Marker }> = {
  B0: { tone: "interest", dash: false, marker: "circle" },
  B2: { tone: "data", dash: false, marker: "circle" },
  B3: { tone: "data", dash: true, marker: "diamond" },
  N2: { tone: "ink", dash: false, marker: "square" },
  N3: { tone: "ink", dash: true, marker: "diamond" },
};

const label = (t: ResultsMessages, id: EmulationModeId) => `${id} ${t.modes[id]}`;

/** A verdict square for a pass or a fail: full or crossed, with the word beside it. */
function PassMark({ pass, word }: { pass: boolean; word: string }) {
  return (
    <span className="r-status" data-status={pass ? "supported" : "refuted"}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <rect x="1.5" y="1.5" width="13" height="13" rx="2" className="r-status-box" />
        {pass ? (
          <rect x="1.5" y="1.5" width="13" height="13" rx="2" className="r-status-fill" />
        ) : (
          <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" className="r-status-x" />
        )}
      </svg>
      {word}
    </span>
  );
}

interface MetricSpec {
  id: string;
  metric: string;
  copy: { title: string; desc: string; y: string; tab: string };
  /** Mean and half-width, as the readout prints them. */
  value: (v: number) => string;
  ci: (v: number) => string;
  tick: (v: number) => string;
  /** Start the y axis at zero; ratios that sit near one do not. */
  zero: boolean;
}

function LossChart({
  t,
  f,
  e4,
  spec,
}: {
  t: ResultsMessages;
  f: Format;
  e4: EmulationData;
  spec: MetricSpec;
}) {
  const series: ChartSeries[] = [];
  for (const m of e4.modes) {
    const points = e4.lossPct.flatMap((_, i) => {
      const s = e4At(e4, spec.metric, m.id, i);
      return s
        ? [
            {
              x: i,
              y: s.mean,
              lo: s.mean - s.ci95,
              hi: s.mean + s.ci95,
              text: `${spec.value(s.mean)} ± ${spec.ci(s.ci95)}`,
            },
          ]
        : [];
    });
    if (points.length > 0) {
      series.push({ id: m.id, label: label(t, m.id), short: m.id, ...E4_STYLE[m.id], points });
    }
  }
  let low = Number.POSITIVE_INFINITY;
  let high = 0;
  for (const s of series) {
    for (const p of s.points) {
      low = Math.min(low, p.lo ?? p.y);
      high = Math.max(high, p.hi ?? p.y);
    }
  }
  if (!Number.isFinite(low)) low = 0;
  const bottom = spec.zero ? 0 : low;
  const ticks = niceTicks(bottom, high, 5);
  const yMin = Math.min(bottom, ticks[0] ?? bottom);
  const yMax = Math.max(high, ticks[ticks.length - 1] ?? high);
  const pad = (yMax - yMin || 1) * 0.05;
  return (
    <LineChart
      title={spec.copy.title}
      desc={spec.copy.desc}
      series={series}
      xDomain={[-0.3, e4.lossPct.length - 1 + 0.3]}
      yDomain={[spec.zero ? 0 : yMin - pad, yMax + pad]}
      xTicks={e4.lossPct.map((v, i): Tick => ({ at: i, label: `${f.num(v, v % 1 ? 1 : 0)}%` }))}
      yTicks={ticks.map((v): Tick => ({ at: v, label: spec.tick(v) }))}
      xLabel={t.native.e4.x}
      yLabel={spec.copy.y}
      labels={chartLabels(t, t.chart.noteCi(e4.seeds))}
    />
  );
}

function CdfChart({ t, f, e4, index }: { t: ResultsMessages; f: Format; e4: EmulationData; index: number }) {
  const modes = e4.modes.map((m) => m.id).filter((m) => (e4.cdf[m]?.[index]?.length ?? 0) > 99);
  const curve = (m: EmulationModeId) => e4.cdf[m]?.[index] ?? [];
  const p99 = Math.max(0, ...modes.map((m) => curve(m)[99] ?? 0));
  const ticks = niceTicks(0, p99, 6);
  const xMax = Math.max(p99, ticks[ticks.length - 1] ?? p99);
  const series: ChartSeries[] = modes.map((m) => ({
    id: m,
    label: label(t, m),
    short: m,
    tone: E4_STYLE[m].tone,
    dash: E4_STYLE[m].dash,
    marker: "none",
    points: [
      { x: curve(m)[0] ?? 0, y: 0, head: "p0", text: f.ms(curve(m)[0] ?? 0) },
      ...curve(m)
        .slice(1, 100)
        .map((ms, i) => ({ x: ms, y: (i + 1) / 100, head: `p${i + 1}`, text: f.ms(ms) })),
    ],
  }));
  return (
    <LineChart
      title={t.native.e4.cdf.title}
      desc={t.native.e4.cdf.desc}
      series={series}
      xDomain={[0, xMax]}
      yDomain={[0, 1]}
      xTicks={ticks.map((v): Tick => ({ at: v, label: f.int(v) }))}
      yTicks={[0, 0.25, 0.5, 0.75, 1].map((v): Tick => ({ at: v, label: f.pct(v, 0) }))}
      xLabel={t.native.e4.cdf.x}
      yLabel={t.native.e4.cdf.y}
      readout="nearest"
      labels={chartLabels(t, t.chart.notePooled(e4.seeds))}
    />
  );
}

/** E4 with its numbers: four metrics against loss, the latency distribution per loss level, the table. */
function E4Figures({ t, f, e4 }: { t: ResultsMessages; f: Format; e4: EmulationData }) {
  const c = t.native.e4.chart;
  const specs: MetricSpec[] = [
    {
      id: "completion",
      metric: "success_ratio",
      copy: c.completion,
      value: (v) => f.pct(v),
      ci: (v) => f.points(v),
      tick: (v) => f.pct(v, 0),
      zero: false,
    },
    {
      id: "p50",
      metric: "latency_p50_ms",
      copy: c.p50,
      value: (v) => f.ms(v),
      ci: (v) => f.num(v),
      tick: (v) => f.int(v),
      zero: true,
    },
    {
      id: "p95",
      metric: "latency_p95_ms",
      copy: c.p95,
      value: (v) => f.ms(v),
      ci: (v) => f.num(v),
      tick: (v) => f.int(v),
      zero: true,
    },
    {
      id: "bytes",
      metric: "producer_link_bytes",
      copy: c.bytes,
      value: (v) => f.bytes(v),
      ci: (v) => f.bytes(v),
      tick: (v) => f.bytes(v),
      zero: true,
    },
  ];
  const shown = specs.filter((s) => e4.modes.some((m) => e4At(e4, s.metric, m.id, 0)));
  const cell = (
    metric: string,
    m: EmulationModeId,
    i: number,
    fmt: (v: number) => string,
    ci: (v: number) => string,
  ) => {
    const s = e4At(e4, metric, m, i);
    return s ? `${fmt(s.mean)} ± ${ci(s.ci95)}` : "–";
  };
  return (
    <>
      <InView>
        <h3 className="r-figure-title">{t.native.e4.chartsTitle}</h3>
        <ChartTabs
          label={t.native.e4.tabs}
          panels={shown.map((spec) => ({
            id: spec.id,
            label: spec.copy.tab,
            node: <LossChart t={t} f={f} e4={e4} spec={spec} />,
          }))}
        />
        <figcaption>
          {t.native.e4.caption({
            agents: f.int(e4.workload.agents),
            calls: f.int(e4.workload.callsPerAgent),
            seeds: e4.seeds,
          })}
        </figcaption>
        <Provenance t={t} kind="emulation" runs={[e4.run]} seeds={e4.seeds} />
        <ValueTable
          t={t}
          caption={`${t.native.e4.chartsTitle}. ${t.chart.meanCi}`}
          head={[
            t.native.e4.table.row,
            t.native.e4.table.completion,
            t.native.e4.table.p50,
            t.native.e4.table.p95,
            t.native.e4.table.bytes,
            t.native.e4.table.retrans,
          ]}
          rows={e4.lossPct.flatMap((loss, i) =>
            e4.modes.map((m) => [
              `${m.id} · ${f.num(loss, loss % 1 ? 1 : 0)}%`,
              cell(
                "success_ratio",
                m.id,
                i,
                (v) => f.pct(v),
                (v) => f.points(v),
              ),
              cell(
                "latency_p50_ms",
                m.id,
                i,
                (v) => f.ms(v),
                (v) => f.num(v),
              ),
              cell(
                "latency_p95_ms",
                m.id,
                i,
                (v) => f.ms(v),
                (v) => f.num(v),
              ),
              cell(
                "producer_link_bytes",
                m.id,
                i,
                (v) => f.bytes(v),
                (v) => f.bytes(v),
              ),
              cell(
                "retransmissions",
                m.id,
                i,
                (v) => f.num(v, 1),
                (v) => f.num(v, 1),
              ),
            ]),
          )}
        />
      </InView>
      <InView>
        <h3 className="r-figure-title">{t.native.e4.cdf.title}</h3>
        <ChartTabs
          label={t.native.e4.cdf.tabs}
          panels={e4.lossPct.map((loss, i) => ({
            id: `loss${i}`,
            label: t.native.e4.cdf.tab(`${f.num(loss, loss % 1 ? 1 : 0)}%`),
            node: <CdfChart t={t} f={f} e4={e4} index={i} />,
          }))}
        />
        <figcaption>{t.native.e4.cdf.caption}</figcaption>
        <Provenance t={t} kind="emulation" runs={[e4.run]} seeds={e4.seeds} />
      </InView>
      {e4.discardedRuns > 0 && <p className="r-note">{t.native.e4.guard(e4.discardedRuns)}</p>}
    </>
  );
}

/** Shown while `experiments/results/e4` has no run folder: what E4 will measure, and no number. */
function E4Pending({ t }: { t: ResultsMessages }) {
  const p = t.native.e4.pending;
  return (
    <div className="r-pending">
      <h3>{p.title}</h3>
      <p>{p.text}</p>
      <dl className="r-modes">
        {(["B0", "B2", "B3", "N2", "N3"] as const).map((id) => (
          <div key={id}>
            <dt>
              <code>{id}</code> {t.modes[id]}
            </dt>
            <dd>{t.modes.desc[id]}</dd>
          </div>
        ))}
      </dl>
      <p className="r-note">{p.will}</p>
      <pre className="r-code">
        <code>pnpm exp:e4</code>
      </pre>
    </div>
  );
}

/** The conformance check of the native binding against real NFD forwarders: one row per scenario. */
function NfdBlock({ t, f, nfd }: { t: ResultsMessages; f: Format; nfd: NfdData }) {
  const read = nfdReading(nfd);
  if (!read) return null;
  const { latest, previous } = read;
  const n = t.native.nfd;
  return (
    <div className="r-block">
      <h3>{n.title}</h3>
      <p className="r-note">{n.lead}</p>
      <ol className="r-scenarios">
        {latest.scenarios.map((s) => (
          <li key={s.id} data-pass={s.pass ? "" : undefined}>
            <PassMark pass={s.pass} word={s.pass ? n.pass : n.fail} />
            <span className="r-scn-body">
              <span className="r-scn-name">
                <code>{s.id}</code> {n.scenario[s.id] ?? s.title}
              </span>
              <span className="r-scn-meta">
                {s.rules.length > 0 && <span>{s.rules.map((r) => `[${r}]`).join(" ")}</span>}
                {s.error !== undefined ? (
                  <span>
                    {n.stopped} <code>{s.error}</code>
                  </span>
                ) : (
                  <span>{n.checks(s.checks, s.failed)}</span>
                )}
              </span>
            </span>
          </li>
        ))}
      </ol>
      <p className="r-note">
        {n.version({ nfd: latest.nfd, ndnts: latest.ndnts, image: latest.image })}{" "}
        {previous &&
          n.previous({
            id: previous.run.id,
            passed: f.int(previous.passed),
            total: f.int(previous.total),
          })}
      </p>
      <Provenance t={t} kind="wall-clock" runs={[latest.run]} />
    </div>
  );
}

/** The whole lead section's body: E4 first (its figures or its pending state), then the NFD check. */
export function NativeSection({
  t,
  f,
  e4,
  nfd,
}: {
  t: ResultsMessages;
  f: Format;
  e4: EmulationData | null;
  nfd: NfdData | null;
}) {
  return (
    <>
      <div className="r-block r-first">
        <h3>{t.native.e4.title}</h3>
        <p className="r-note">{t.native.e4.lead}</p>
        {e4 ? <E4Figures t={t} f={f} e4={e4} /> : <E4Pending t={t} />}
      </div>
      {nfd && <NfdBlock t={t} f={f} nfd={nfd} />}
    </>
  );
}
