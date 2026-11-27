import type { ResultsData, Stat } from "@idem/sim";
import { describe, expect, it } from "vitest";
import { RESULTS } from "./data";
import { computeVerdicts } from "./verdicts";

const stat = (mean: number, ci95: number): Stat => ({
  mean,
  ci95,
  min: mean - ci95,
  max: mean + ci95,
  n: 30,
});

/** A copy of the committed results with one metric of one mode replaced along a sweep. */
function withSeries(
  data: ResultsData,
  sweep: string,
  metric: string,
  mode: "B2" | "B5",
  values: Stat[],
): ResultsData {
  const out = structuredClone(data);
  const s = out.sweeps[sweep];
  if (!s) throw new Error(`no ${sweep} in the committed results`);
  const byMode = s.metrics[metric] ?? {};
  byMode[mode] = values;
  s.metrics[metric] = byMode;
  return out;
}

const flat = (n: number, mean: number, ci: number) => Array.from({ length: n }, () => stat(mean, ci));

describe("the H5 and H6 verdicts follow spec 05 §4", () => {
  it("evaluates H5 (a) on the surface and in-flight sets, and H5 (b) on the baseline pairs", () => {
    const v = computeVerdicts(RESULTS);
    const surface = RESULTS.sweeps["e2-surface"];
    expect(v.h5.a.surface.length).toBe(surface?.values.filter((x) => x > 0).length);
    expect(v.h5.b.pairs.length).toBe(RESULTS.e5?.baseline?.length ?? 0);
    for (const p of v.h5.b.pairs) {
      expect(p.holds).toBe(p.baselineAccepted >= 1 && p.mirrorAccepted === 0);
    }
  });

  it("puts a surface-0 point with no duplicates in flight in the 'neither' set", () => {
    const n = RESULTS.sweeps["e2-code-sync"]?.values.length ?? 0;
    let d = withSeries(RESULTS, "e2-code-sync", "gateway_inflight_duplicates", "B5", flat(n, 0, 0));
    d = withSeries(d, "e2-code-sync", "upstream_reduction_vs_b5", "B2", flat(n, 0, 0));
    const v = computeVerdicts(d);
    expect(v.h5.a.neither.filter((p) => p.sweep === "e2-code-sync").length).toBe(n);
    expect(v.h5.a.neither.every((p) => p.agrees)).toBe(true);
    // A clear gain where nothing was in flight breaks the "same number" half.
    const gain = withSeries(d, "e2-code-sync", "upstream_reduction_vs_b5", "B2", flat(n, 0.1, 0.01));
    const w = computeVerdicts(gain);
    expect(w.h5.a.status).toBe("partly");
  });

  it("leaves a positive mean of duplicates whose interval reaches zero unevaluated", () => {
    const n = RESULTS.sweeps["e2-code-sync"]?.values.length ?? 0;
    const d = withSeries(RESULTS, "e2-code-sync", "gateway_inflight_duplicates", "B5", flat(n, 0.1, 0.2));
    const v = computeVerdicts(d);
    expect(v.h5.a.unclassified.length).toBe(n);
  });

  it("refutes H5 (a) when no surface or in-flight point is above zero", () => {
    let d = RESULTS;
    for (const id of ["e2-surface", "e2-code-burst", "e2-code-sync"]) {
      d = withSeries(
        d,
        id,
        "upstream_reduction_vs_b5",
        "B2",
        flat(d.sweeps[id]?.values.length ?? 0, 0, 0.01),
      );
    }
    expect(computeVerdicts(d).h5.a.status).toBe("refuted");
  });

  it("H6: a metric grows only when its ends are apart and no consecutive pair is apart the other way", () => {
    const n = RESULTS.sweeps["e2-code-burst"]?.values.length ?? 0;
    const rising = Array.from({ length: n }, (_, i) => stat(i * 0.05, 0.01));
    const dip = rising.map((s, i) => (i === 2 ? stat(0, 0.001) : s));
    const up = computeVerdicts(withSeries(RESULTS, "e2-code-burst", "pit_aggregation_ratio", "B2", rising));
    expect(up.h6.trends[0]?.grows).toBe(true);
    const down = computeVerdicts(withSeries(RESULTS, "e2-code-burst", "pit_aggregation_ratio", "B2", dip));
    expect(down.h6.trends[0]?.grows).toBe(false);
    expect(down.h6.status).not.toBe("supported");
    // e2-code-sync is read from its widest start window to its narrowest.
    const m = RESULTS.sweeps["e2-code-sync"]?.values.length ?? 0;
    const falling = Array.from({ length: m }, (_, i) => stat((m - 1 - i) * 0.05, 0.01));
    const sync = computeVerdicts(withSeries(RESULTS, "e2-code-sync", "pit_aggregation_ratio", "B2", falling));
    expect(sync.h6.trends[2]?.grows).toBe(true);
  });
});
