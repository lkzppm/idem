import Link from "next/link";
import type { ReactNode } from "react";
import type { Locale } from "@/lib/i18n/locale";
import type { ResultsMessages } from "@/lib/i18n/messages/results";
import {
  type EvalModeId,
  RESULTS,
  type ResultsData,
  type Stat,
  type SweepData,
  significantly,
  statAt,
} from "@/lib/results/data";
import { type Format, makeFormat } from "@/lib/results/format";
import { e4Reading, nfdReading } from "@/lib/results/native";
import { computeVerdicts, type VerdictStatus } from "@/lib/results/verdicts";
import { Breakdown } from "./breakdown";
import { SplitBar, type Tone } from "./chart";
import {
  CdfFigure,
  CodeSweepFigure,
  DeltaFigure,
  MicrobenchFigure,
  MODE_STYLE,
  modeLabel,
  msCi,
  Provenance,
  pctCi,
  ReductionFigure,
  ValueTable,
} from "./figures";
import { NativeSection } from "./native";

type RunRef = SweepData["run"];

/** A square glyph for a verdict: full, half, crossed or empty. Shape and words, never colour alone. */
function Status({ status, t }: { status: VerdictStatus; t: ResultsMessages }) {
  return (
    <span className="r-status" data-status={status}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <rect x="1.5" y="1.5" width="13" height="13" rx="2" className="r-status-box" />
        {status === "supported" && (
          <rect x="1.5" y="1.5" width="13" height="13" rx="2" className="r-status-fill" />
        )}
        {status === "partly" && (
          <path d="M1.5 3.5a2 2 0 0 1 2-2H8v13H3.5a2 2 0 0 1-2-2Z" className="r-status-fill" />
        )}
        {status === "refuted" && <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" className="r-status-x" />}
      </svg>
      {t.status[status]}
    </span>
  );
}

/**
 * One stop of the page and of the mini navbar (`data-nav-*`, read by `components/site/section-nav`).
 * Each opens with the question it answers and, when the data allows one, a one-line verdict
 * computed from that data.
 */
function Section({
  id,
  nav,
  title,
  lead,
  ask,
  children,
}: {
  id: string;
  nav: string;
  title: string;
  lead?: string;
  ask: { label: string; verdictLabel: string; question: string; verdict?: string };
  children: ReactNode;
}) {
  return (
    <section
      className="r-section"
      id={id}
      data-nav-section=""
      data-nav-label={nav}
      aria-labelledby={`${id}-title`}
    >
      <header className="r-section-head">
        <h2 id={`${id}-title`}>{title}</h2>
        {lead && <p className="r-lead">{lead}</p>}
      </header>
      <dl className="r-ask">
        <div>
          <dt>{ask.label}</dt>
          <dd>{ask.question}</dd>
        </div>
        {ask.verdict && (
          <div className="r-ask-verdict">
            <dt>{ask.verdictLabel}</dt>
            <dd>{ask.verdict}</dd>
          </div>
        )}
      </dl>
      {children}
    </section>
  );
}

function Hypothesis({
  id,
  status,
  claim,
  t,
  children,
}: {
  id: string;
  status: VerdictStatus;
  claim: string;
  t: ResultsMessages;
  children: ReactNode;
}) {
  return (
    <li className="r-hyp" data-status={status}>
      <div className="r-hyp-id">{id}</div>
      <div className="r-hyp-body">
        <Status status={status} t={t} />
        <p className="r-hyp-claim">{claim}</p>
        <div className="r-hyp-evidence">{children}</div>
      </div>
    </li>
  );
}

const abs = (n: number) => Math.abs(n);

/** What an attack that got through is called, by what the protocol says of that variant. */
function outcomeWord(t: ResultsMessages, expected: "rejected" | "limit" | "leaks"): string {
  return expected === "rejected" ? t.e5.accepted : expected === "limit" ? t.e5.acceptedLimit : t.e5.leaked;
}

function durationOf(f: Format, ms: number): string {
  return ms >= 60_000 ? f.duration(ms) : `${f.num(ms / 1000, 1)} s`;
}

/**
 * The results page. A pure function of the committed data and the dictionary, so it renders the
 * same on the server for any request; `app/benchmarks/page.tsx` only chooses the locale.
 */
export function ResultsView({
  locale,
  t,
  data = RESULTS,
}: {
  locale: Locale;
  t: ResultsMessages;
  data?: ResultsData;
}) {
  const f = makeFormat(locale);
  const v = computeVerdicts(data);
  const agents = data.sweeps["e2-agents"];
  const overlap = data.sweeps["e2-overlap"];
  const ttl = data.sweeps["e2-ttl"];
  const csSize = data.sweeps["e2-cs-size"];
  const think = data.sweeps["e2-think-time"];
  const mixed = data.sweeps["e2-mixed"];
  const surface = data.sweeps["e2-surface"];
  const burst = data.sweeps["e2-code-burst"];
  const sync = data.sweeps["e2-code-sync"];
  const { e1, e5, e4, nfd, missOverhead: miss } = data;
  const e4Read = e4 ? e4Reading(e4) : undefined;
  const nfdRead = nfdReading(nfd);
  const base = agents?.base;
  const baseAgents = agents ? f.int(agents.baseValue) : "";
  const allRuns: RunRef[] = [
    ...(e4 ? [e4.run] : []),
    ...(nfd?.runs.map((r) => r.run) ?? []),
    ...(e1?.runs ?? []),
    ...Object.values(data.sweeps).map((s) => s.run),
    ...(e5 ? [e5.run] : []),
  ];
  const at = (s: SweepData | undefined, metric: string, mode: EvalModeId, value: number): Stat | undefined =>
    s ? statAt(s, metric, mode, value) : undefined;
  const maxMean = (s: SweepData | undefined, metric: string, mode: EvalModeId): number =>
    Math.max(0, ...(s?.metrics[metric]?.[mode] ?? []).map((x) => (x && x.n > 0 ? x.mean : 0)));

  // ---- pieces of sentences that need a little arithmetic on the data
  const pitBase = maxMean(agents, "pit_aggregation_ratio", "B2");
  const thinkMin = think ? Math.min(...think.values) : undefined;
  const pitShortest = thinkMin !== undefined ? at(think, "pit_aggregation_ratio", "B2", thinkMin) : undefined;
  const bytesOne = at(agents, "bytes_reduction", "B2", 1);
  const bytesOneB1 = at(agents, "bytes_reduction", "B1", 1);
  const bytesBase = agents ? at(agents, "bytes_reduction", "B2", agents.baseValue) : undefined;
  const b4 = agents ? at(agents, "latency_mean_vs_b2_ms", "B4", agents.baseValue) : undefined;
  const b3 = agents ? at(agents, "latency_mean_vs_b2_ms", "B3", agents.baseValue) : undefined;
  // The largest store budget at which the shared store clearly loses to private caches: the two
  // 95% intervals do not overlap.
  const csLosing = csSize
    ? [...csSize.values].reverse().find((x) => {
        const b2 = at(csSize, "upstream_reduction", "B2", x);
        const b1 = at(csSize, "upstream_reduction", "B1", x);
        return b2 !== undefined && b1 !== undefined && b2.mean + b2.ci95 < b1.mean - b1.ci95;
      })
    : undefined;
  const lateMax = Math.max(maxMean(ttl, "late_serves", "B2"), maxMean(ttl, "late_serves", "B3"));
  const lateWorst = Math.max(
    0,
    ...(["B2", "B3"] as const).flatMap((m) =>
      (ttl?.metrics.max_late_ms?.[m] ?? []).map((x) => (x && x.n > 0 ? x.max : 0)),
    ),
  );
  const cores = e1?.runs[0]?.cores ?? 0;
  const busyRuns = (e1?.runs ?? []).filter(
    (r) => Math.max(r.loadavgStart[0] ?? 0, r.loadavgEnd[0] ?? 0) > cores,
  );
  const busyMax = Math.max(0, ...busyRuns.flatMap((r) => [r.loadavgStart[0] ?? 0, r.loadavgEnd[0] ?? 0]));
  const cell = (op: string, size: number) =>
    e1?.ops.find((o) => o.op === op)?.cells.find((c) => c.sizeBytes === size);
  const smallSize = e1?.sizesBytes[1] ?? e1?.sizesBytes[0] ?? 0;
  const bigSize = e1 ? Math.max(...e1.sizesBytes) : 0;

  const expected = e5?.rows.filter((r) => r.expected === "rejected") ?? [];
  const findings = expected.filter((r) => r.accepted > 0);
  const declared = e5?.rows.filter((r) => r.expected !== "rejected") ?? [];
  const attacks = e5 ? [...new Set(e5.rows.map((r) => r.attack))] : [];

  const whoTone: Record<string, Tone> = { consumer: "interest", edge: "ink", producer: "data" };

  // ---- IDEM against the shared gateway cache (B5): B2's reduction against B5, as a phrase whose
  // direction follows its 95% interval, so it reads right whichever way a rerun turns out.
  const vsB5 = (s: SweepData | undefined, x: number) => at(s, "upstream_reduction_vs_b5", "B2", x);
  const gap = (st: Stat | undefined): string => {
    if (!st) return "–";
    const side = significantly(st, "above") ? "above" : significantly(st, "below") ? "below" : "none";
    return t.gateway.gap({
      side,
      value: side === "none" ? f.pct(st.mean) : f.pct(abs(st.mean)),
      ci: f.points(st.ci95),
    });
  };
  const ends = (s: SweepData | undefined) =>
    s ? { lo: Math.min(...s.values), hi: Math.max(...s.values) } : undefined;
  const surfaceEnds = ends(surface);
  const burstEnds = ends(burst);
  const syncEnds = ends(sync);
  const dupText = (st: Stat | undefined) => (st ? `${f.num(st.mean, 1)} (±${f.num(st.ci95, 1)})` : "–");
  const red = (s: SweepData | undefined, mode: EvalModeId, x: number) =>
    f.pct(at(s, "upstream_reduction", mode, x)?.mean ?? Number.NaN);
  const codePoint = (s: SweepData | undefined, x: number) => ({
    dup: dupText(at(s, "gateway_inflight_duplicates", "B5", x)),
    pit: pctCi(f, at(s, "pit_aggregation_ratio", "B2", x)),
    gap: pctCi(f, vsB5(s, x)),
  });
  const h6Count = v.h6.trends.filter((x) => x.grows).length;
  const baseline = e5?.baseline ?? [];

  // ---- the question each section answers, and a one-line verdict computed from its data
  const ask = { label: t.ask.question, verdictLabel: t.ask.verdict };
  const e4Sentence = e4Read
    ? t.ask.native.e4({
        loss: f.num(e4Read.loss, e4Read.loss % 1 ? 1 : 0),
        n2ok: f.pct(e4Read.n2.success?.mean ?? Number.NaN, 1),
        b2ok: f.pct(e4Read.b2.success?.mean ?? Number.NaN, 1),
        n2p50: e4Read.n2.p50 ? f.ms(e4Read.n2.p50.mean) : "–",
        b2p50: e4Read.b2.p50 ? f.ms(e4Read.b2.p50.mean) : "–",
        n2p95: e4Read.n2.p95 ? f.ms(e4Read.n2.p95.mean) : "–",
        b2p95: e4Read.b2.p95 ? f.ms(e4Read.b2.p95.mean) : "–",
        n2bytes: e4Read.n2.bytes ? f.bytes(e4Read.n2.bytes.mean) : "–",
        b2bytes: e4Read.b2.bytes ? f.bytes(e4Read.b2.bytes.mean) : "–",
      })
    : e4
      ? t.ask.native.e4Partial
      : t.ask.native.e4Pending;
  const nfdSentence = nfdRead
    ? t.ask.native.nfd({
        passed: f.int(nfdRead.latest.passed),
        total: f.int(nfdRead.latest.total),
        stopped: nfdRead.stopped.join(", "),
        failing: nfdRead.failing.join(", "),
        previous: nfdRead.previous
          ? t.ask.native.nfdPrevious(f.int(nfdRead.previous.passed), f.int(nfdRead.previous.total))
          : "",
      })
    : "";
  const nativeVerdict = `${e4Sentence} ${nfdSentence}`.trim();
  const hypCount = (status: VerdictStatus) =>
    [
      v.h1.status,
      v.h2.status,
      v.h3.status,
      "not-evaluated" as VerdictStatus,
      v.h5.status,
      v.h6.status,
    ].filter((x) => x === status).length;

  return (
    <main className="results">
      <div className="r-page">
        <header className="r-hero">
          <p className="r-kicker">{t.hero.kicker}</p>
          <h1>{t.hero.title}</h1>
          <p className="r-lead">{t.hero.lead}</p>
          <dl className="r-kinds" aria-label={t.hero.kindsLabel}>
            {t.hero.kinds.map((k) => (
              <div key={k.id}>
                <dt>{k.name}</dt>
                <dd>
                  {k.text}
                  {k.id === "e4" && !e4 && <strong> {t.hero.notRun}</strong>}
                </dd>
              </div>
            ))}
          </dl>
        </header>

        <ul className="r-tiles" aria-label={t.tiles.label}>
          {nfdRead && (
            <li className="r-tile t-data">
              <span className="r-tile-value">
                {t.tiles.nfd.value(f.int(nfdRead.latest.passed), f.int(nfdRead.latest.total))}
              </span>
              <span className="r-tile-label">{t.tiles.nfd.label}</span>
              <span className="r-tile-sub">
                <a href="#native">
                  {t.tiles.nfd.sub({
                    stopped: nfdRead.stopped.length,
                    previous: nfdRead.previous
                      ? t.tiles.nfd.earlier(f.int(nfdRead.previous.passed), f.int(nfdRead.previous.total))
                      : "",
                  })}
                </a>
              </span>
            </li>
          )}
          {e4Read ? (
            <li className="r-tile t-data">
              <span className="r-tile-value">{f.pct(e4Read.n2.success?.mean ?? Number.NaN, 0)}</span>
              <span className="r-tile-label">
                {t.tiles.e4.label(f.num(e4Read.loss, e4Read.loss % 1 ? 1 : 0))}
              </span>
              <span className="r-tile-sub">
                <a href="#native">{t.tiles.e4.sub(f.pct(e4Read.b2.success?.mean ?? Number.NaN, 0))}</a>
              </span>
            </li>
          ) : (
            <li className="r-tile t-muted" data-pending="">
              <span className="r-tile-value">{t.tiles.e4.pending}</span>
              <span className="r-tile-label">{t.tiles.e4.pendingLabel}</span>
              <span className="r-tile-sub">
                <a href="#native">{t.tiles.e4.pendingSub}</a>
              </span>
            </li>
          )}
          {v.h1.base && (
            <li className="r-tile t-data">
              <span className="r-tile-value">{f.pct(Math.abs(v.h1.base.vsB0.mean))}</span>
              <span className="r-tile-label">{t.tiles.upstream.label}</span>
              <span className="r-tile-sub">
                {t.tiles.upstream.sub(baseAgents, f.points(v.h1.base.vsB0.ci95))}
              </span>
            </li>
          )}
          {v.e5 && (
            <li className="r-tile t-ink">
              <span className="r-tile-value">
                {t.tiles.safety.value(f.int(v.e5.allRejected), f.int(v.e5.expectedRejected))}
              </span>
              <span className="r-tile-label">{t.tiles.safety.label}</span>
              <span className="r-tile-sub">
                <a href="#safety">{t.tiles.safety.sub(v.e5.findings.length, v.e5.declared.length)}</a>
              </span>
            </li>
          )}
        </ul>

        <Section
          id="native"
          nav={t.nav.native}
          title={t.native.title}
          lead={t.native.lead}
          ask={{
            ...ask,
            question: t.native.question,
            verdict: nativeVerdict,
          }}
        >
          <NativeSection t={t} f={f} e4={e4} nfd={nfd} />
        </Section>

        <Section
          id="hypotheses"
          nav={t.nav.verdicts}
          title={t.hyp.title}
          lead={t.hyp.lead}
          ask={{
            ...ask,
            question: t.hyp.question,
            verdict: t.hyp.verdict({
              supported: hypCount("supported"),
              partly: hypCount("partly"),
              refuted: hypCount("refuted"),
              pending: hypCount("not-evaluated"),
            }),
          }}
        >
          <ol className="r-hyps">
            <Hypothesis id="H1" status={v.h1.status} claim={t.hyp.h1.claim} t={t}>
              {v.h1.base && (
                <p>
                  {t.hyp.h1.base({
                    agents: f.int(v.h1.base.agents),
                    vsB0: f.pct(v.h1.base.vsB0.mean),
                    ciB0: f.points(v.h1.base.vsB0.ci95),
                    vsB1: f.pct(v.h1.base.vsB1.mean),
                    ciB1: f.points(v.h1.base.vsB1.ci95),
                  })}{" "}
                  {v.h1.largest &&
                    t.hyp.h1.largest({
                      agents: f.int(v.h1.largest.agents),
                      vsB0: f.pct(v.h1.largest.vsB0.mean),
                      vsB1: f.pct(v.h1.largest.vsB1.mean),
                    })}
                </p>
              )}
              {v.h1.alone &&
                v.h1.noOverlap &&
                abs(v.h1.alone.mean) < 1e-9 &&
                abs(v.h1.noOverlap.mean) < 1e-9 && <p>{t.hyp.h1.alone}</p>}
              <p className="r-rule-text">
                {t.hyp.h1.rule({ aboveB0: v.h1.aboveB0, aboveB1: v.h1.aboveB1, points: v.h1.sharedPoints })}
              </p>
            </Hypothesis>
            <Hypothesis id="H2" status={v.h2.status} claim={t.hyp.h2.claim} t={t}>
              {v.h2.base && (
                <p>
                  {t.hyp.h2.base({
                    agents: f.int(v.h2.base.agents),
                    p50: f.ms(abs(v.h2.base.p50.mean)),
                    ci50: f.num(v.h2.base.p50.ci95),
                    p95: f.ms(abs(v.h2.base.p95.mean)),
                    ci95: f.num(v.h2.base.p95.ci95),
                  })}
                </p>
              )}
              {v.h2.overheadUs !== undefined && v.h2.overheadShare !== undefined && (
                <p>
                  {t.hyp.h2.overhead({ us: f.us(v.h2.overheadUs), share: f.pct(v.h2.overheadShare, 2) })}{" "}
                  {v.h2.noOverlapP50 &&
                    v.h2.noOverlapP50.mean > 0 &&
                    t.hyp.h2.noOverlap(f.ms(v.h2.noOverlapP50.mean, 2))}
                </p>
              )}
              <p className="r-rule-text">
                {t.hyp.h2.rule({
                  p50: v.h2.p50Below,
                  p95: v.h2.p95Below,
                  p99: v.h2.p99Below,
                  points: v.h2.points,
                })}
              </p>
            </Hypothesis>
            <Hypothesis id="H3" status={v.h3.status} claim={t.hyp.h3.claim} t={t}>
              {e5 && (
                <>
                  <p>
                    {t.hyp.h3.integrity({
                      accepted: f.int(v.h3.integrityAccepted),
                      trials: f.int(v.h3.integrityTrials),
                      variants: v.h3.integrityVariants,
                    })}
                  </p>
                  <p>
                    {v.h3.privateAccepted === 0
                      ? t.hyp.h3.privateClean({
                          trials: f.int(v.h3.privateTrials),
                          variants: v.h3.privateVariants,
                        })
                      : t.hyp.h3.privateLeak({
                          accepted: f.int(v.h3.privateAccepted),
                          trials: f.int(v.h3.privateTrials),
                          variants: v.h3.privateVariants,
                          leaking: v.h3.privateLeakingVariants.join(", "),
                        })}
                  </p>
                  <p className="r-rule-text">{t.hyp.h3.rule}</p>
                </>
              )}
            </Hypothesis>
            <Hypothesis id="H4" status="not-evaluated" claim={t.hyp.h4.claim} t={t}>
              <p>{e4 ? t.hyp.h4.ran : t.hyp.h4.evidence}</p>
            </Hypothesis>
            <Hypothesis id="H5" status={v.h5.status} claim={t.hyp.h5.claim} t={t}>
              {(() => {
                const top = v.h5.a.surface[v.h5.a.surface.length - 1];
                return (
                  top?.vsB5 && (
                    <p>
                      {t.hyp.h5.surface({
                        above: v.h5.a.surface.filter((p) => p.agrees).length,
                        points: v.h5.a.surface.length,
                        top: f.pct(top.value, 0),
                        vsB5: f.pct(top.vsB5.mean),
                        ci: f.points(top.vsB5.ci95),
                      })}
                    </p>
                  )
                );
              })()}
              {v.h5.a.inflight.length + v.h5.a.neither.length > 0 && (
                <p>
                  {t.hyp.h5.inflight({
                    above: v.h5.a.inflight.filter((p) => p.agrees).length,
                    points: v.h5.a.inflight.length,
                    neither: v.h5.a.neither.length,
                    neitherAgree: v.h5.a.neither.filter((p) => p.agrees).length,
                  })}
                  {v.h5.a.unclassified.length > 0 && ` ${t.hyp.h5.unclassified(v.h5.a.unclassified.length)}`}
                </p>
              )}
              {v.h5.b.pairs.length > 0 && (
                <p>
                  {t.hyp.h5.attacks({
                    holding: v.h5.b.pairs.filter((p) => p.holds).length,
                    pairs: v.h5.b.pairs.length,
                  })}
                </p>
              )}
              <p className="r-rule-text">{t.hyp.h5.rule}</p>
            </Hypothesis>
            <Hypothesis id="H6" status={v.h6.status} claim={t.hyp.h6.claim} t={t}>
              {v.h6.trends.map(
                (x) =>
                  x.from &&
                  x.to && (
                    <p key={`${x.sweep}/${x.metric}`}>
                      {t.hyp.h6.trend({
                        what: t.hyp.h6.what[`${x.sweep}/${x.metric}`] ?? `${x.sweep} ${x.metric}`,
                        from: pctCi(f, x.from.stat),
                        to: pctCi(f, x.to.stat),
                        grows: x.grows,
                      })}
                    </p>
                  ),
              )}
              <p className="r-rule-text">{t.hyp.h6.rule({ grows: h6Count, all: v.h6.trends.length })}</p>
            </Hypothesis>
          </ol>
        </Section>

        {agents && overlap && (
          <Section
            id="redundancy"
            nav={t.nav.redundancy}
            title={t.redundancy.title}
            lead={t.redundancy.lead}
            ask={{
              ...ask,
              question: t.redundancy.question,
              ...(v.h1.base && {
                verdict: t.redundancy.verdict({
                  agents: f.int(v.h1.base.agents),
                  b2: f.pct(v.h1.base.vsB0.mean),
                  ci: f.points(v.h1.base.vsB0.ci95),
                  b1: f.pct(v.h1.base.b1.mean),
                  b5: f.pct(at(agents, "upstream_reduction", "B5", v.h1.base.agents)?.mean ?? Number.NaN),
                }),
              }),
            }}
          >
            <ReductionFigure
              t={t}
              f={f}
              sweep={agents}
              copy={t.redundancy.agents}
              xFormat={(x) => f.int(x)}
              caption={t.redundancy.agents.caption}
            />
            <p className="r-note">{t.redundancy.agents.note}</p>
            <ReductionFigure
              t={t}
              f={f}
              sweep={overlap}
              copy={t.redundancy.overlap}
              xFormat={(x) => f.num(x, 1)}
              caption={t.redundancy.overlap.caption}
            />
            {v.h1.base && vsB5(agents, v.h1.base.agents) && base && (
              <p className="r-note">
                {t.redundancy.vsB5({
                  agents: f.int(v.h1.base.agents),
                  surface: f.pct(base.workload.surfaceVariation, 0),
                  gap: gap(vsB5(agents, v.h1.base.agents)),
                })}
              </p>
            )}
            {pitShortest && thinkMin !== undefined && (
              <p className="r-note">
                {t.redundancy.pit({
                  base: f.pct(pitBase, 1),
                  shortest: f.pct(pitShortest.mean, 1),
                  think: f.duration(thinkMin),
                })}
              </p>
            )}
            {bytesOne && bytesOneB1 && bytesBase && v.h1.base && (
              <p className="r-note">
                {t.redundancy.bytes({
                  one: f.pct(bytesOne.mean),
                  b1: f.pct(bytesOneB1.mean),
                  base: f.pct(bytesBase.mean),
                  calls: f.pct(v.h1.base.vsB0.mean),
                })}
              </p>
            )}
            <ValueTable
              t={t}
              caption={`${t.redundancy.agents.title}: B2. ${t.chart.meanCi}`}
              head={[
                t.redundancy.agents.x,
                t.redundancy.columns.vsB0,
                t.redundancy.columns.vsB1,
                t.redundancy.columns.vsB5,
                t.redundancy.columns.bytes,
                t.redundancy.columns.hit,
                t.redundancy.columns.pit,
              ]}
              rows={agents.values.map((x) => [
                f.int(x),
                pctCi(f, at(agents, "upstream_reduction", "B2", x)),
                pctCi(f, at(agents, "upstream_reduction_vs_b1", "B2", x)),
                pctCi(f, vsB5(agents, x)),
                pctCi(f, at(agents, "bytes_reduction", "B2", x)),
                pctCi(f, at(agents, "cs_hit_ratio", "B2", x)),
                pctCi(f, at(agents, "pit_aggregation_ratio", "B2", x)),
              ])}
            />
          </Section>
        )}

        {surface && burst && sync && surfaceEnds && burstEnds && syncEnds && (
          <Section
            id="gateway"
            nav={t.nav.gateway}
            title={t.gateway.title}
            lead={t.gateway.lead}
            ask={{
              ...ask,
              question: t.gateway.question,
              verdict: t.gateway.verdict({
                zeroValue: f.pct(surfaceEnds.lo, 0),
                b5zero: red(surface, "B5", surfaceEnds.lo),
                b2zero: red(surface, "B2", surfaceEnds.lo),
                zero: gap(vsB5(surface, surfaceEnds.lo)),
                topValue: f.pct(surfaceEnds.hi, 0),
                top: gap(vsB5(surface, surfaceEnds.hi)),
                burstValue: f.int(burstEnds.hi),
                burst: gap(vsB5(burst, burstEnds.hi)),
              }),
            }}
          >
            <ReductionFigure
              t={t}
              f={f}
              sweep={surface}
              copy={t.gateway.surface}
              xFormat={(x) => f.pct(x, 0)}
              caption={t.gateway.surface.caption({
                agents: f.int(surface.base.workload.agents),
                overlap: f.num(surface.base.workload.overlap, 1),
              })}
              modes={["B1", "B5", "B2"]}
              fillTo="B5"
              extra={[
                {
                  head: t.gateway.chart.columns.vsB5,
                  cell: (i) => pctCi(f, surface.metrics.upstream_reduction_vs_b5?.B2?.[i]),
                },
              ]}
            />
            <p className="r-note">
              {t.gateway.surface.reading({
                zero: f.pct(surfaceEnds.lo, 0),
                b5zero: red(surface, "B5", surfaceEnds.lo),
                b2zero: red(surface, "B2", surfaceEnds.lo),
                bound: f.pct(at(surface, "oracle_reduction", "B0", surfaceEnds.lo)?.mean ?? Number.NaN),
                gap: pctCi(f, vsB5(surface, surfaceEnds.lo)),
                top: f.pct(surfaceEnds.hi, 0),
                b5top: red(surface, "B5", surfaceEnds.hi),
                b2top: red(surface, "B2", surfaceEnds.hi),
                gapTop: pctCi(f, vsB5(surface, surfaceEnds.hi)),
              })}
            </p>
            <CodeSweepFigure
              t={t}
              f={f}
              sweep={burst}
              copy={t.gateway.burst}
              xFormat={(x) => f.int(x)}
              caption={t.gateway.burst.caption({
                agents: f.int(burst.base.workload.agents),
                calls: f.int(burst.base.workload.callsPerAgent),
                spread: f.duration(burst.base.workload.startSpreadMs ?? burst.base.workload.thinkTimeMs),
              })}
            />
            {(() => {
              const one = codePoint(burst, burstEnds.lo);
              const top = codePoint(burst, burstEnds.hi);
              return (
                <p className="r-note">
                  {t.gateway.burst.reading({
                    one: f.int(burstEnds.lo),
                    dupOne: one.dup,
                    pitOne: one.pit,
                    gapOne: one.gap,
                    top: f.int(burstEnds.hi),
                    dupTop: top.dup,
                    pitTop: top.pit,
                    gapTop: top.gap,
                  })}
                </p>
              );
            })()}
            <CodeSweepFigure
              t={t}
              f={f}
              sweep={sync}
              copy={t.gateway.sync}
              xFormat={(x) => f.duration(x)}
              caption={t.gateway.sync.caption({
                agents: f.int(sync.base.workload.agents),
                calls: f.int(sync.base.workload.callsPerAgent),
                burst: f.int(sync.base.workload.burst?.size ?? 1),
              })}
            />
            {(() => {
              const wide = codePoint(sync, syncEnds.hi);
              const narrow = codePoint(sync, syncEnds.lo);
              return (
                <p className="r-note">
                  {t.gateway.sync.reading({
                    wide: f.duration(syncEnds.hi),
                    dupWide: wide.dup,
                    pitWide: wide.pit,
                    gapWide: wide.gap,
                    narrow:
                      syncEnds.lo === 0
                        ? t.gateway.sync.instant
                        : t.gateway.sync.within(f.duration(syncEnds.lo)),
                    dupNarrow: narrow.dup,
                    pitNarrow: narrow.pit,
                    gapNarrow: narrow.gap,
                  })}
                </p>
              );
            })()}
          </Section>
        )}

        {agents && base && (
          <Section
            id="latency"
            nav={t.nav.latency}
            ask={{
              ...ask,
              question: t.latency.question,
              ...(v.h2.base && {
                verdict: t.latency.verdict({
                  agents: f.int(v.h2.base.agents),
                  p50: f.ms(abs(v.h2.base.p50.mean)),
                  ci: f.num(v.h2.base.p50.ci95),
                  cpu: v.h2.overheadUs !== undefined ? f.us(v.h2.overheadUs) : "–",
                  share: v.h2.overheadShare !== undefined ? f.pct(v.h2.overheadShare, 2) : "–",
                }),
              }),
            }}
            title={t.latency.title}
            lead={t.latency.lead({
              agent: f.ms(base.topology.agentLinkMs, 0),
              producer: f.ms(base.topology.producerLinkMs, 0),
              service: f.ms(base.producer.serviceMedianMs, 0),
            })}
          >
            <CdfFigure
              t={t}
              f={f}
              sweep={agents}
              caption={t.latency.cdf.caption({
                agents: f.int(agents.cdfValue),
                hit: f.pct(at(agents, "cs_hit_ratio", "B2", agents.cdfValue)?.mean ?? Number.NaN),
                local: f.pct(at(agents, "upstream_reduction", "B1", agents.cdfValue)?.mean ?? Number.NaN),
                gateway: f.pct(at(agents, "upstream_reduction", "B5", agents.cdfValue)?.mean ?? Number.NaN),
              })}
            />
            <DeltaFigure t={t} f={f} sweep={agents} xFormat={(x) => f.int(x)} />
            <div className="r-block">
              <h3>{t.latency.table.title(baseAgents)}</h3>
              <div className="r-scroll">
                <table className="r-table r-table-open">
                  <thead>
                    <tr>
                      <th scope="col">{t.chart.mode}</th>
                      <th scope="col">p50</th>
                      <th scope="col">p95</th>
                      <th scope="col">p99</th>
                      <th scope="col">Δ p50</th>
                      <th scope="col">Δ p95</th>
                      <th scope="col">Δ p99</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agents.modes.map((m) => (
                      <tr key={m.id}>
                        <th scope="row">{modeLabel(t, m.id)}</th>
                        {["latency_p50_ms", "latency_p95_ms", "latency_p99_ms"].map((k) => (
                          <td key={k}>{msCi(f, at(agents, k, m.id, agents.baseValue))}</td>
                        ))}
                        {["latency_p50_vs_b0_ms", "latency_p95_vs_b0_ms", "latency_p99_vs_b0_ms"].map((k) => (
                          <td key={k}>
                            {m.id === "B0" ? "–" : msCi(f, at(agents, k, m.id, agents.baseValue), true)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="r-table-note">
                p50, p95, p99: {t.latency.table.p}. Δ: {t.latency.table.d}.
              </p>
              <p className="r-note">{t.latency.tail}</p>
            </div>
            {miss && (
              <div className="r-block">
                <h3>{t.latency.overhead.title}</h3>
                <p className="r-note">
                  {t.latency.overhead.lead({
                    args: f.bytes(miss.argBytes),
                    result: f.bytes(miss.resultBytes),
                  })}
                </p>
                <Breakdown
                  label={t.latency.overhead.bar}
                  total={t.latency.overhead.barTotal(f.us(miss.totalUs))}
                  steps={miss.steps.map((st, i) => ({
                    key: `${i}`,
                    value: st.us,
                    tone: whoTone[st.who] ?? "muted",
                    who: t.latency.overhead.who[st.who] ?? st.who,
                    what: st.what,
                    cost: f.us(st.us),
                    share: f.pct(st.us / miss.totalUs, 0),
                  }))}
                />
                <p className="r-note">
                  {t.latency.overhead.total({
                    us: f.us(miss.totalUs),
                    share: f.pct(miss.totalUs / (miss.roundTripMs * 1000), 2),
                    rtt: f.ms(miss.roundTripMs, 0),
                    service: f.ms(miss.serviceMedianMs, 0),
                  })}{" "}
                  {b4 && b4.mean < 0 && t.latency.overhead.b4(f.us(abs(b4.mean) * 1000))}{" "}
                  {b3 && b3.mean > 0 && t.latency.overhead.b3(f.ms(b3.mean, 2))}
                </p>
                {e1 && <Provenance t={t} kind="wall-clock" runs={e1.runs} />}
              </div>
            )}
          </Section>
        )}

        {ttl && csSize && think && (
          <Section
            id="sensitivity"
            nav={t.nav.sensitivity}
            title={t.sensitivity.title}
            lead={t.sensitivity.lead}
            ask={{
              ...ask,
              question: t.sensitivity.question,
              verdict: t.sensitivity.verdict({
                losing: csLosing !== undefined ? f.bytes(csLosing) : "",
                late: f.num(lateMax, 1),
                max: f.ms(lateWorst, 1),
              }),
            }}
          >
            <ReductionFigure
              t={t}
              f={f}
              sweep={ttl}
              copy={t.sensitivity.ttl}
              xFormat={(x) => f.duration(x)}
              caption={t.sensitivity.ttl.caption}
              bound={false}
              info={{
                label: t.sensitivity.staleLabel,
                body: t.sensitivity.stale({ late: f.num(lateMax, 1), max: f.ms(lateWorst, 1) }),
              }}
            />
            <div className="r-pair">
              <ReductionFigure
                t={t}
                f={f}
                sweep={csSize}
                copy={t.sensitivity.cs}
                xFormat={(x) => f.bytes(x)}
                caption={
                  csLosing !== undefined
                    ? t.sensitivity.cs.caption({
                        size: f.bytes(csLosing),
                        b2: f.pct(at(csSize, "upstream_reduction", "B2", csLosing)?.mean ?? Number.NaN),
                        b1: f.pct(at(csSize, "upstream_reduction", "B1", csLosing)?.mean ?? Number.NaN),
                      })
                    : ""
                }
                compact
                bound={false}
              />
              <ReductionFigure
                t={t}
                f={f}
                sweep={think}
                copy={t.sensitivity.think}
                xFormat={(x) => f.duration(x)}
                caption={t.sensitivity.think.caption}
                compact
                bound={false}
              />
            </div>
            {mixed && (
              <div className="r-block">
                <h3>{t.sensitivity.mixed.title}</h3>
                <p className="r-note">{t.sensitivity.mixed.lead}</p>
                <div className="r-scroll">
                  <table className="r-table r-table-open">
                    <thead>
                      <tr>
                        <th scope="col">{t.sensitivity.mixed.fraction}</th>
                        <th scope="col">{modeLabel(t, "B1")}</th>
                        <th scope="col">{modeLabel(t, "B5")}</th>
                        <th scope="col">{modeLabel(t, "B2")}</th>
                        <th scope="col">{t.modes.bound}</th>
                        <th scope="col">{t.sensitivity.mixed.bypass}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mixed.values.map((x) => (
                        <tr key={x}>
                          <th scope="row">{f.pct(x, 0)}</th>
                          <td>{pctCi(f, at(mixed, "upstream_reduction", "B1", x))}</td>
                          <td>{pctCi(f, at(mixed, "upstream_reduction", "B5", x))}</td>
                          <td>{pctCi(f, at(mixed, "upstream_reduction", "B2", x))}</td>
                          <td>{f.pct(at(mixed, "oracle_reduction", "B0", x)?.mean ?? Number.NaN)}</td>
                          <td>{f.num(at(mixed, "bypasses", "B2", x)?.mean ?? Number.NaN, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {(["failed", "stale_serves", "safety_violations"] as const).every((k) =>
                  mixed.modes.every((m) => maxMean(mixed, k, m.id) === 0),
                ) && (
                  <p className="r-note">
                    {t.sensitivity.mixed.clean({
                      runs: f.int(mixed.modes.length * mixed.values.length * mixed.seeds),
                    })}
                  </p>
                )}
                <Provenance t={t} kind="simulation" runs={[mixed.run]} seeds={mixed.seeds} />
              </div>
            )}
          </Section>
        )}

        {e1 && (
          <Section
            id="cost"
            nav={t.nav.cost}
            title={t.e1.title}
            lead={t.e1.lead}
            ask={{
              ...ask,
              question: t.e1.question,
              verdict: t.e1.verdict({
                small: f.bytes(smallSize),
                verify: f.us(cell("verifyData", smallSize)?.p50Us ?? Number.NaN),
                big: f.bytes(bigSize),
                canon: f.us(cell("canonicalizeArgs", bigSize)?.p50Us ?? Number.NaN),
              }),
            }}
          >
            <MicrobenchFigure t={t} f={f} e1={e1} />
            <p className="r-note">
              {t.e1.reading({
                small: f.bytes(smallSize),
                verify: f.us(cell("verifyData", smallSize)?.p50Us ?? Number.NaN),
                canon: f.us(cell("canonicalizeArgs", bigSize)?.p50Us ?? Number.NaN),
              })}
            </p>
            <p className="r-note">
              {t.e1.load({
                busy: busyRuns.length,
                runs: e1.runs.length,
                cores: f.int(cores),
                max: f.num(busyMax, 0),
              })}{" "}
              {t.e1.browser}
            </p>
          </Section>
        )}

        {e5 && (
          <Section
            id="safety"
            nav={t.nav.safety}
            ask={{
              ...ask,
              question: t.e5.question,
              ...(v.e5 && {
                verdict: t.e5.verdict({
                  stopped: f.int(v.e5.allRejected),
                  expected: f.int(v.e5.expectedRejected),
                  findings: v.e5.findings.length,
                  limits: v.e5.declared.length,
                }),
              }),
            }}
            title={t.e5.title}
            lead={t.e5.lead({ trials: f.int(e5.trials), variants: e5.rows.length })}
          >
            <div className="r-findings" data-count={findings.length}>
              {findings.length === 0 ? (
                <p>{t.e5.findings.none}</p>
              ) : (
                <>
                  <h3>{t.e5.findings.title(findings.length)}</h3>
                  <p>{t.e5.findings.lead}</p>
                  <ul>
                    {findings.map((r) => (
                      <li key={r.variant}>
                        <p className="r-finding-head">
                          <code>{r.variant}</code>
                          <span>{t.e5.findings.every(f.int(r.accepted), f.int(r.trials))}</span>
                        </p>
                        <p>{t.e5.findings.text[r.variant] ?? r.summary}</p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            {declared.length > 0 && (
              <div className="r-declared">
                <h3>{t.e5.limits.title}</h3>
                <p>{t.e5.limits.lead}</p>
                <ul>
                  {declared.map((r) => (
                    <li key={r.variant}>
                      <p className="r-finding-head">
                        <code>{r.variant}</code>
                        <span>
                          {(r.expected === "leaks" ? t.e5.limits.leaked : t.e5.limits.every)(
                            f.int(r.accepted),
                            f.int(r.trials),
                          )}
                        </span>
                      </p>
                      <p>{t.e5.limits.text[r.variant] ?? r.summary}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="r-scroll">
              <table className="r-table r-table-open r-safety">
                <thead>
                  <tr>
                    <th scope="col">{t.e5.columns.variant}</th>
                    <th scope="col">{t.e5.columns.where}</th>
                    <th scope="col">{t.e5.columns.rejected}</th>
                    <th scope="col">{t.e5.columns.outcome}</th>
                  </tr>
                </thead>
                {attacks.map((attack) => (
                  <tbody key={attack}>
                    <tr className="r-group">
                      <th colSpan={4} scope="colgroup">
                        {t.e5.attack[attack] ?? attack}
                      </th>
                    </tr>
                    {e5.rows
                      .filter((r) => r.attack === attack)
                      .map((r) => {
                        const bad = r.accepted > 0;
                        return (
                          <tr
                            key={r.variant}
                            className={
                              bad ? (r.expected === "rejected" ? "is-finding" : "is-limit") : undefined
                            }
                          >
                            <th scope="row">
                              <code>{r.variant}</code>
                              <span className="r-what">{t.e5.what[r.variant] ?? r.summary}</span>
                              {r.assumes && (
                                <span className="r-assumes">
                                  {t.e5.precondition} {t.e5.assumes[r.variant] ?? r.assumes}
                                </span>
                              )}
                            </th>
                            <td>{t.e5.where[r.where] ?? r.where}</td>
                            <td className="r-count">
                              <span className="r-count-n">
                                {f.int(r.rejected)} / {f.int(r.trials)}
                              </span>
                              <SplitBar
                                label={`${f.int(r.rejected)} / ${f.int(r.trials)}`}
                                parts={[
                                  {
                                    key: "r",
                                    value: r.rejected,
                                    tone: "ink",
                                    title: `${t.e5.columns.rejected}: ${f.int(r.rejected)}`,
                                  },
                                  {
                                    key: "a",
                                    value: r.accepted,
                                    tone: "data",
                                    title: `${outcomeWord(t, r.expected)}: ${f.int(r.accepted)}`,
                                  },
                                ]}
                              />
                              {bad && (
                                <span className="r-count-bad">
                                  {f.int(r.accepted)} {outcomeWord(t, r.expected)}
                                </span>
                              )}
                            </td>
                            <td>
                              <ul className="r-mech">
                                {r.mechanisms.map((m) => (
                                  <li key={m.mechanism}>
                                    <code>{m.mechanism}</code>
                                    <span className="r-times"> ×&nbsp;{f.int(m.count)}</span>
                                  </li>
                                ))}
                              </ul>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                ))}
              </table>
            </div>
            {baseline.length > 0 && (
              <div className="r-block r-baseline">
                <h3>{t.e5.baseline.title}</h3>
                <p className="r-note">{t.e5.baseline.lead}</p>
                <div className="r-scroll">
                  <table className="r-table r-table-open r-safety">
                    <thead>
                      <tr>
                        <th scope="col">{t.e5.baseline.columns.attack}</th>
                        <th scope="col">{t.e5.baseline.columns.b5}</th>
                        <th scope="col">{t.e5.baseline.columns.idem}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {baseline.map((r) => {
                        const mirror = e5.rows.find((x) => x.variant === r.mirrors);
                        const count = (row: { rejected: number; accepted: number; trials: number }) => (
                          <>
                            <span className="r-count-n">
                              {t.e5.baseline.accepted(f.int(row.accepted), f.int(row.trials))}
                            </span>
                            <SplitBar
                              label={`${t.e5.accepted}: ${f.int(row.accepted)} / ${f.int(row.trials)}`}
                              parts={[
                                {
                                  key: "r",
                                  value: row.rejected,
                                  tone: "ink",
                                  title: `${t.e5.columns.rejected}: ${f.int(row.rejected)}`,
                                },
                                {
                                  key: "a",
                                  value: row.accepted,
                                  tone: "data",
                                  title: `${t.e5.accepted}: ${f.int(row.accepted)}`,
                                },
                              ]}
                            />
                          </>
                        );
                        return (
                          <tr key={r.variant}>
                            <th scope="row">
                              <code>{r.variant}</code>
                              <span className="r-what">{t.e5.what[r.variant] ?? r.summary}</span>
                              {r.assumes && (
                                <span className="r-assumes">
                                  {t.e5.precondition} {t.e5.assumes[r.variant] ?? r.assumes}
                                </span>
                              )}
                            </th>
                            <td className="r-count">{count(r)}</td>
                            <td className="r-count">
                              <code>{r.mirrors}</code>
                              {mirror ? (
                                count(mirror)
                              ) : (
                                <span className="r-count-n">{t.e5.baseline.missing}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="r-note">
                  {t.e5.baseline.pair({
                    holding: v.h5.b.pairs.filter((p) => p.holds).length,
                    pairs: v.h5.b.pairs.length,
                  })}{" "}
                  {t.e5.baseline.reading}
                </p>
              </div>
            )}
            <Provenance t={t} kind="simulation" runs={[e5.run]} />
          </Section>
        )}

        <Section
          id="method"
          nav={t.nav.method}
          title={t.method.title}
          lead={t.method.lead}
          ask={{ ...ask, question: t.method.question }}
        >
          <p>
            <Link href="/docs/evaluation" className="r-link">
              {t.method.docs} →
            </Link>
          </p>
          <div className="r-block">
            <h3>{t.method.modesTitle}</h3>
            <dl className="r-modes">
              {(Object.keys(MODE_STYLE) as EvalModeId[]).map((id) => (
                <div key={id}>
                  <dt>
                    <code>{id}</code> {t.modes[id]}
                  </dt>
                  <dd>{t.modes.desc[id]}</dd>
                </div>
              ))}
            </dl>
          </div>
          {agents && base && (
            <div className="r-block">
              <h3>{t.method.baseTitle}</h3>
              <p className="r-note">{t.method.baseLead}</p>
              <dl className="r-params">
                {(
                  [
                    [t.method.base.agents, f.int(base.workload.agents)],
                    [t.method.base.calls, f.int(base.workload.callsPerAgent)],
                    [
                      t.method.base.catalog,
                      t.method.base.catalogValue(
                        f.int(base.workload.catalogSize),
                        f.num(base.workload.zipfAlpha, 1),
                      ),
                    ],
                    [t.method.base.overlap, f.num(base.workload.overlap, 1)],
                    [t.method.base.think, t.method.base.thinkValue(f.duration(base.workload.thinkTimeMs))],
                    [
                      t.method.base.surface,
                      t.method.base.surfaceValue(f.pct(base.workload.surfaceVariation, 0)),
                    ],
                    [
                      t.method.base.links,
                      t.method.base.linksValue(
                        f.ms(base.topology.agentLinkMs, 0),
                        f.ms(base.topology.producerLinkMs, 0),
                      ),
                    ],
                    [
                      t.method.base.tree,
                      t.method.base.treeValue(
                        base.topology.tree.edges,
                        f.ms(base.topology.tree.coreLinkMs, 0),
                        f.ms(base.topology.tree.producerLinkMs, 0),
                      ),
                    ],
                    [
                      t.method.base.service,
                      t.method.base.serviceValue(
                        f.ms(base.producer.serviceMedianMs, 0),
                        f.num(base.producer.serviceSigma, 1),
                      ),
                    ],
                    [t.method.base.result, t.method.base.resultValue(f.bytes(base.producer.pageBytesMedian))],
                    [t.method.base.ttl, f.duration(base.producer.ttlMs)],
                    [t.method.base.cs, t.method.base.csValue(f.bytes(base.cs.maxBytes), base.cs.policy)],
                    [t.method.base.loss, f.pct(base.topology.lossPct / 100, 0)],
                    [t.method.base.seeds, t.method.base.seedsValue(agents.seeds, agents.run.seed)],
                    ...(agents.processing
                      ? [[t.method.base.cpu, t.method.base.cpuValue(agents.processing.runs.length)]]
                      : []),
                  ] as [string, string][]
                ).map(([k, val]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{val}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <div className="r-block">
            <h3>{t.method.notRunTitle}</h3>
            <ul className="r-list">
              {[t.method.notRun.e3, ...(e4 ? [] : [t.method.notRun.e4]), t.method.notRun.browser].map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
          <div className="r-block">
            <h3>{t.method.reproduceTitle}</h3>
            <p className="r-note">{t.method.reproduce}</p>
            <pre className="r-code">
              <code>{"pnpm i\nexperiments/run-all.sh"}</code>
            </pre>
          </div>
          <div className="r-block">
            <h3>{t.method.runsTitle}</h3>
            <p className="r-note">{t.method.runsLead(data.sourceDigest.slice(0, 8))}</p>
            <div className="r-scroll">
              <table className="r-table r-table-open r-runs">
                <thead>
                  <tr>
                    <th scope="col">{t.method.runs.id}</th>
                    <th scope="col">{t.method.runs.seed}</th>
                    <th scope="col">{t.method.runs.digest}</th>
                    <th scope="col">{t.method.runs.load}</th>
                    <th scope="col">{t.method.runs.duration}</th>
                  </tr>
                </thead>
                <tbody>
                  {allRuns.map((r) => (
                    <tr key={`${r.experiment}/${r.id}`}>
                      <th scope="row">
                        <code>
                          {r.experiment}/{r.id}
                        </code>
                      </th>
                      <td>{r.seed}</td>
                      <td>
                        <code>{r.sourceDigest.slice(0, 8)}</code>
                      </td>
                      <td>
                        {f.num(r.loadavgStart[0] ?? Number.NaN, 1)} →{" "}
                        {f.num(r.loadavgEnd[0] ?? Number.NaN, 1)}
                      </td>
                      <td>{durationOf(f, r.durationMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {allRuns[0] && (
              <p className="r-table-note">
                {t.method.runs.env(
                  allRuns[0].node,
                  allRuns[0].cpu,
                  f.int(allRuns[0].cores),
                  allRuns[0].platform,
                )}
              </p>
            )}
          </div>
        </Section>
      </div>
    </main>
  );
}
