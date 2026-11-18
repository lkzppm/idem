import type { EmulationData, EmulationModeId, ResultsData, Stat } from "@idem/sim";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { results } from "@/lib/i18n/messages/results";
import { RESULTS } from "@/lib/results/data";
import { e4Reading, nfdReading } from "@/lib/results/native";
import { ResultsView } from "./view";

const render = (locale: "en" | "pt", data: ResultsData = RESULTS): string =>
  renderToStaticMarkup(createElement(ResultsView, { locale, t: results[locale], data }));

const count = (s: string, needle: string): number => s.split(needle).length - 1;

/** A synthetic E4 result, in memory only: the page shows E4 only once a real run folder is committed. */
function fixtureE4(): EmulationData {
  const stat = (mean: number): Stat => ({ mean, ci95: mean / 20, min: mean * 0.9, max: mean * 1.1, n: 3 });
  const modes: EmulationModeId[] = ["B0", "B2", "B3", "N2", "N3"];
  const lossPct = [0, 1, 5];
  const metrics: EmulationData["metrics"] = {};
  const cdf: EmulationData["cdf"] = {};
  const metric = (name: string, base: number) => {
    const byMode: Partial<Record<EmulationModeId, Stat[]>> = {};
    modes.forEach((m, mi) => {
      byMode[m] = lossPct.map((_, i) => stat(base * (1 + mi * 0.1 + i * 0.2)));
    });
    metrics[name] = byMode;
  };
  metric("success_ratio", 0.5);
  metric("latency_p50_ms", 100);
  metric("latency_p95_ms", 300);
  metric("producer_link_bytes", 50_000);
  metric("retransmissions", 4);
  for (const [mi, m] of modes.entries()) {
    cdf[m] = lossPct.map((_, i) => Array.from({ length: 101 }, (_, q) => 10 + q * (1 + mi * 0.1 + i * 0.3)));
  }
  const base = RESULTS.sweeps["e2-agents"]?.run;
  if (!base) throw new Error("the committed results have no e2-agents run");
  return {
    run: { ...base, experiment: "e4", id: "fixture" },
    title: "E4 fixture",
    seeds: 3,
    lossPct,
    modes: modes.map((id) => ({ id, binding: id.startsWith("N") ? "native" : "overlay" })),
    workload: { agents: 8, callsPerAgent: 20, catalogSize: 50, overlap: 0.5, thinkTimeMs: 2000 },
    links: { agentMs: 5, starProducerMs: 40, treeCoreMs: 10, treeProducerMs: 30 },
    producer: { serviceMedianMs: 150, ttlMs: 60000, pageBytesMedian: 2048 },
    native: { interestLifetimeMs: 1000, retransmissions: 4 },
    discardedRuns: 1,
    metrics,
    cdf,
  };
}

describe("the benchmarks page", () => {
  for (const locale of ["en", "pt"] as const) {
    it(`marks one nav section per stop, native NDN first (${locale})`, () => {
      const out = render(locale);
      const ids = [...out.matchAll(/<section[^>]*\bid="([a-z0-9-]+)"[^>]*data-nav-section/g)].map(
        (m) => m[1],
      );
      expect(ids).toEqual([
        "native",
        "hypotheses",
        "redundancy",
        "latency",
        "sensitivity",
        "cost",
        "safety",
        "method",
      ]);
      // Every stop has its label and opens with a question.
      expect(count(out, "data-nav-label=")).toBe(8);
      expect(count(out, 'class="r-ask"')).toBe(8);
    });

    it(`says E4 has not run, and shows no E4 chart, while there is no E4 data (${locale})`, () => {
      const out = render(locale);
      expect(RESULTS.e4).toBeNull();
      expect(out).toContain("r-pending");
      expect(out).toContain("data-pending");
      expect(out).not.toContain("r-tablist");
    });

    it(`gives every chart a readout, a legend of toggles and a hint (${locale})`, () => {
      const out = render(locale);
      const charts = count(out, 'class="r-chart-block"');
      expect(charts).toBeGreaterThan(5);
      expect(count(out, 'aria-pressed="true"')).toBeGreaterThanOrEqual(charts * 2);
      expect(count(out, 'class="r-chart-hint"')).toBe(charts);
    });
  }

  it("has no thick coloured edge on a rounded box (the C shape the author rejects)", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(`${import.meta.dirname}/../../app/styles/results.css`, "utf8");
    expect(css).not.toMatch(/border-(top|left|right|bottom)\s*:\s*[3-9]px/);
    expect(css).not.toMatch(/border-(top|left|right|bottom)-width\s*:\s*[3-9]px/);
  });

  it("lays the E4 data out as tabs, a distribution per loss level and a table when it exists", () => {
    const e4 = fixtureE4();
    const out = render("en", { ...RESULTS, e4 });
    expect(out).not.toContain("r-pending");
    expect(out).toContain("r-tablist");
    expect(count(out, 'role="tab"')).toBe(4 + 3);
    expect(out).toContain("N2 IDEM on native NDN");
    // The verdict names both stars at the highest loss, with numbers from the data.
    expect(out).toMatch(/At 5% loss on every link, the native star \(N2\) answered/);
  });

  it("states the E4 comparison from the data, native star against overlay star at the highest loss", () => {
    const read = e4Reading(fixtureE4());
    expect(read?.loss).toBe(5);
    expect(read?.n2.success?.mean).toBeCloseTo(0.5 * (1 + 3 * 0.1 + 2 * 0.2));
    expect(read?.b2.success?.mean).toBeCloseTo(0.5 * (1 + 1 * 0.1 + 2 * 0.2));
    // Without both stars there is nothing to compare.
    const e4 = fixtureE4();
    e4.modes = e4.modes.filter((m) => m.id !== "N2");
    expect(e4Reading(e4)).toBeUndefined();
  });

  it("reads the NFD runs: the latest, the one before and the scenarios that stopped on an error", () => {
    const read = nfdReading(RESULTS.nfd);
    expect(read?.latest.run.id).toBe(RESULTS.nfd?.runs[RESULTS.nfd.runs.length - 1]?.run.id);
    expect(read?.stopped.length).toBe(read?.latest.scenarios.filter((s) => s.error).length);
    expect(nfdReading(null)).toBeUndefined();
  });
});
