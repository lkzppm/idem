# /// script
# requires-python = ">=3.11"
# dependencies = ["matplotlib==3.11.2"]
# ///
"""Render the report figures from the committed results (spec/05-evaluation.md §5).

    uv run experiments/plots/make_figures.py

Reads only `experiments/results/<experiment>/<run-id>/` (the latest run of each sweep and of the
safety suite, every run of the microbenchmarks) and writes `experiments/plots/out/*.{pdf,png}` plus
`captions.json`. Each figure carries, in its footer and in its caption, this script's name, the run
ids it was drawn from and, for E2 and E5, the word "simulation". Nothing is computed here beyond
medians over the E1 repetitions: the means and 95% confidence intervals come from `summary.csv`.
"""

from __future__ import annotations

import csv
import json
import statistics
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import matplotlib.ticker  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "experiments" / "results"
OUT = Path(__file__).resolve().parent / "out"
SCRIPT = "experiments/plots/make_figures.py"

# The project's two accents, one meaning each: blue = requests and the baselines that only send
# requests, yellow = answers served from the network (IDEM). Grey for the rest.
INTEREST = "#0b63ce"
DATA = "#f2ac00"
INK = "#0a0a0a"
GREY = "#8f8f8f"
STYLE = {
    "B0": dict(color=INTEREST, linestyle="-", marker="o", label="B0 mcp-direct"),
    "B1": dict(color=INTEREST, linestyle="--", marker="s", label="B1 mcp-local-cache"),
    "B2": dict(color=DATA, linestyle="-", marker="o", label="B2 idem"),
    "B3": dict(color=DATA, linestyle="--", marker="D", label="B3 idem-tree"),
    "B4": dict(color=GREY, linestyle=":", marker="x", label="B4 idem-noverify"),
    # The third blue baseline: dash-dot and diamonds, so it parts from B0 and B1 without colour.
    "B5": dict(color=INTEREST, linestyle="-.", marker="D", label="B5 mcp-gateway-cache"),
}

plt.rcParams.update(
    {
        "font.size": 9,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "axes.grid": True,
        "grid.color": "#e6e6e6",
        "grid.linewidth": 0.6,
        "legend.frameon": False,
        "figure.dpi": 150,
        "savefig.bbox": "tight",
    }
)


def runs_of(experiment: str) -> list[Path]:
    """Finished run folders of an experiment, oldest first (run ids sort by time)."""
    folder = RESULTS / experiment
    if not folder.is_dir():
        return []
    return sorted(p for p in folder.iterdir() if (p / "metrics.csv").is_file() and (p / "env.json").is_file())


def rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="") as f:
        return list(csv.DictReader(f))


class Sweep:
    """The latest run of a sweep: `stat(metric, mode)` gives (values, means, ci95)."""

    def __init__(self, experiment: str):
        found = runs_of(experiment)
        if not found:
            raise FileNotFoundError(f"no runs of {experiment} under {RESULTS}")
        self.dir = found[-1]
        self.id = self.dir.name
        self.experiment = experiment
        self.config = json.loads((self.dir / "config.json").read_text())
        self.summary = rows(self.dir / "summary.csv")
        self.values = [float(v) for v in self.config["sweep"]["values"]]
        self.modes = self.config["modes"]
        self.seeds = self.config["seeds"]["count"]

    def stat(self, metric: str, mode: str) -> tuple[list[float], list[float], list[float]]:
        by_value = {
            float(r["value"]): (float(r["mean"]), float(r["ci95"]))
            for r in self.summary
            if r["metric"] == metric and r["mode"] == mode and r["n"] != "0"
        }
        xs = [v for v in self.values if v in by_value]
        return xs, [by_value[v][0] for v in xs], [by_value[v][1] for v in xs]

    def cdf(self, mode: str, value: float) -> tuple[list[float], list[float]]:
        pts = [
            (float(r["latency_ms"]), float(r["q"]) / 100)
            for r in rows(self.dir / "latency_cdf.csv")
            if r["mode"] == mode and float(r["value"]) == value
        ]
        return [p[0] for p in pts], [p[1] for p in pts]

    @property
    def ref(self) -> str:
        return f"{self.experiment}/{self.id}"


CAPTIONS: dict[str, str] = {}


def finish(fig, name: str, caption: str, refs: list[str], simulation: bool, emulation: bool = False) -> None:
    kind = "simulation" if simulation else "emulation" if emulation else ""
    label = f"{kind} · " if kind else ""
    footer = f"{label}{SCRIPT} · runs: {', '.join(refs)}"
    fig.text(0.01, -0.07, footer, fontsize=5.5, color=GREY, ha="left", va="top", wrap=True)
    OUT.mkdir(parents=True, exist_ok=True)
    for ext in ("pdf", "png"):
        fig.savefig(OUT / f"{name}.{ext}")
    plt.close(fig)
    prefix = f"{kind.capitalize()}. " if kind else ""
    CAPTIONS[name] = f"{caption} ({prefix}Script: {SCRIPT}; runs: {', '.join(refs)}.)"
    print(f"wrote {name}")


def percent(ax, axis: str = "y") -> None:
    fmt = matplotlib.ticker.PercentFormatter(xmax=1, decimals=0)
    (ax.yaxis if axis == "y" else ax.xaxis).set_major_formatter(fmt)


def reduction_figure(
    experiment: str,
    name: str,
    xlabel: str,
    caption: str,
    log2: bool = False,
    modes: tuple[str, ...] = ("B1", "B5", "B2", "B3"),
    xpercent: bool = False,
    legend_above: bool = False,
) -> None:
    s = Sweep(experiment)
    fig, ax = plt.subplots(figsize=(4.6, 3.0))
    xs, oracle, _ = s.stat("oracle_reduction", "B0")
    ax.plot(xs, oracle, color=INK, linewidth=0.8, linestyle=(0, (1, 2)), label="perfect shared cache")
    for mode in modes:
        if mode not in s.modes:
            continue
        xs, mean, ci = s.stat("upstream_reduction", mode)
        ax.errorbar(xs, mean, yerr=ci, capsize=2.5, linewidth=1.6, markersize=4, **STYLE[mode])
    if log2:
        ax.set_xscale("log", base=2)
        ax.set_xticks(s.values, [f"{v:g}" for v in s.values])
    ax.set_xlabel(xlabel)
    ax.set_ylabel("upstream reduction vs. B0")
    ax.set_ylim(bottom=0)
    percent(ax)
    if xpercent:
        percent(ax, "x")
    if legend_above:
        ax.legend(loc="lower center", fontsize=7, ncols=2, bbox_to_anchor=(0.5, 1.0))
    else:
        ax.legend(loc="upper left", fontsize=7)
    finish(fig, name, f"{caption} Mean over {s.seeds} seeds; bars are 95% confidence intervals.", [s.ref], True)


def code_figure(experiment: str, name: str, xlabel: str, caption: str, xscale: float = 1.0, reverse: bool = False) -> None:
    """A W-code sweep (H6): upstream reduction of B1, B5 and B2, B2's PIT aggregation and B5's in-flight duplicates."""
    s = Sweep(experiment)
    fig, (ax, ax2, ax3) = plt.subplots(1, 3, figsize=(9.6, 2.8))
    # Evenly spaced points (the swept values span orders of magnitude and include 0), in the
    # direction the hypothesis reads: growing bursts, or a start window that shrinks.
    order = s.values[::-1] if reverse else s.values
    pos = {v: i for i, v in enumerate(order)}

    def scaled(xs: list[float]) -> list[int]:
        return [pos[x] for x in xs]

    xs, oracle, _ = s.stat("oracle_reduction", "B0")
    ax.plot(scaled(xs), oracle, color=INK, linewidth=0.8, linestyle=(0, (1, 2)), label="perfect shared cache")
    for mode in ("B1", "B5", "B2"):
        xs, mean, ci = s.stat("upstream_reduction", mode)
        ax.errorbar(scaled(xs), mean, yerr=ci, capsize=2.5, linewidth=1.5, markersize=3.5, **STYLE[mode])
    ax.set_ylabel("upstream reduction vs. B0")
    ax.set_ylim(bottom=0)
    percent(ax)
    # One legend above the three panels, clear of every line.
    fig.legend(*ax.get_legend_handles_labels(), fontsize=7, loc="lower center", ncols=4, bbox_to_anchor=(0.5, 0.98))
    fig.subplots_adjust(wspace=0.38)
    xs, mean, ci = s.stat("pit_aggregation_ratio", "B2")
    ax2.errorbar(scaled(xs), mean, yerr=ci, capsize=2.5, linewidth=1.5, markersize=3.5, **STYLE["B2"])
    ax2.set_ylabel("PIT aggregation ratio (B2)")
    ax2.set_ylim(bottom=0)
    percent(ax2)
    xs, mean, ci = s.stat("gateway_inflight_duplicates", "B5")
    ax3.errorbar(scaled(xs), mean, yerr=ci, capsize=2.5, linewidth=1.5, markersize=3.5, **STYLE["B5"])
    ax3.set_ylabel("in-flight duplicates per run (B5)")
    ax3.set_ylim(bottom=0)
    for a in (ax, ax2, ax3):
        a.set_xticks(range(len(order)), [f"{v / xscale:g}" for v in order])
        a.set_xlabel(xlabel)
    finish(fig, name, f"{caption} Mean over {s.seeds} seeds; bars are 95% confidence intervals.", [s.ref], True)


def latency_figure() -> None:
    s = Sweep("e2-agents")
    base = float(s.config["base"]["workload"]["agents"])
    fig, (ax, ax2) = plt.subplots(1, 2, figsize=(7.4, 3.0))
    for mode in ("B0", "B1", "B5", "B2", "B3"):
        if mode not in s.modes:
            continue
        x, q = s.cdf(mode, base)
        ax.plot(x, q, linewidth=1.6, color=STYLE[mode]["color"], linestyle=STYLE[mode]["linestyle"], label=STYLE[mode]["label"])
    ax.set_xlabel("latency per call (ms)")
    ax.set_ylabel("fraction of calls")
    percent(ax)
    ax.set_xlim(0, 700)
    ax.legend(loc="lower right", fontsize=7)
    ax.set_title(f"all calls at {base:g} agents, pooled over seeds", fontsize=8)
    for mode in ("B1", "B5", "B2"):
        for metric, alpha in (("latency_p50_vs_b0_ms", 1.0), ("latency_p95_vs_b0_ms", 0.45)):
            xs, mean, ci = s.stat(metric, mode)
            style = {**STYLE[mode], "label": f"{mode} {'p50' if 'p50' in metric else 'p95'}"}
            ax2.errorbar(xs, mean, yerr=ci, capsize=2.5, linewidth=1.4, markersize=3.5, alpha=alpha, **style)
    ax2.axhline(0, color=INK, linewidth=0.8)
    ax2.set_xscale("log", base=2)
    ax2.set_xticks(s.values, [f"{v:g}" for v in s.values])
    ax2.set_xlabel("agents")
    ax2.set_ylabel("latency − B0, same seed (ms)")
    ax2.legend(fontsize=7, ncols=2)
    finish(
        fig,
        "e2-latency",
        f"Left: distribution of the consumer-observed latency of every call. Right: change of the per-run p50 and p95 against B0, paired by seed (mean over {s.seeds} seeds, 95% CI).",
        [s.ref],
        True,
    )


def sensitivity_figure() -> None:
    panels = [
        ("e2-ttl", "TTL (s)", 1000.0, True),
        ("e2-cs-size", "Content Store budget (KiB)", 1024.0, False),
        ("e2-think-time", "mean think time (s)", 1000.0, True),
    ]
    fig, axes = plt.subplots(1, 3, figsize=(9.6, 2.8), sharey=True)
    refs = []
    for ax, (experiment, xlabel, scale, log) in zip(axes, panels):
        s = Sweep(experiment)
        refs.append(s.ref)
        for mode in ("B1", "B5", "B2", "B3"):
            if mode not in s.modes:
                continue
            xs, mean, ci = s.stat("upstream_reduction", mode)
            ax.errorbar([x / scale for x in xs], mean, yerr=ci, capsize=2.5, linewidth=1.5, markersize=3.5, **STYLE[mode])
        if log:
            ax.set_xscale("log")
        else:
            ax.set_xscale("symlog", linthresh=16)
        ax.set_xlabel(xlabel)
        percent(ax)
    axes[0].set_ylabel("upstream reduction vs. B0")
    axes[0].legend(fontsize=7, loc="upper left")
    finish(
        fig,
        "e2-sensitivity",
        "Upstream reduction at the base workload when one parameter changes: the manifest TTL, the byte budget of each Content Store, and the agents' mean think time (mean over seeds, 95% CI).",
        refs,
        True,
    )


def mixed_figure() -> None:
    s = Sweep("e2-mixed")
    fig, ax = plt.subplots(figsize=(4.6, 3.0))
    xs, oracle, _ = s.stat("oracle_reduction", "B0")
    ax.plot(xs, oracle, color=INK, linewidth=0.8, linestyle=(0, (1, 2)), label="perfect shared cache")
    for mode in ("B1", "B5", "B2", "B3"):
        if mode not in s.modes:
            continue
        xs, mean, ci = s.stat("upstream_reduction", mode)
        ax.errorbar(xs, mean, yerr=ci, capsize=2.5, linewidth=1.6, markersize=4, **STYLE[mode])
    ax.set_xlabel("fraction of side-effecting calls (never cacheable)")
    ax.set_ylabel("upstream reduction vs. B0")
    ax.set_ylim(bottom=0)
    percent(ax)
    percent(ax, "x")
    ax.legend(fontsize=7)
    finish(
        fig,
        "e2-mixed",
        f"W-mixed: 10% of the calls are private, and a growing share has side effects and bypasses the cache (mean over {s.seeds} seeds, 95% CI).",
        [s.ref],
        True,
    )


def microbench_figure() -> None:
    found = runs_of("e1-node")
    if not found:
        raise FileNotFoundError("no runs of e1-node")
    config = (found[-1] / "config.json").read_text()
    found = [r for r in found if (r / "config.json").read_text() == config]
    data: dict[tuple[str, int], list[float]] = {}
    for run in found:
        for r in rows(run / "metrics.csv"):
            data.setdefault((r["op"], int(r["size_bytes"])), []).append(float(r["p50_us"]))
    ops = {
        "canonicalizeArgs": dict(color=INTEREST, linestyle="-", marker="o"),
        "makeName": dict(color=INTEREST, linestyle="--", marker="s"),
        "signData": dict(color=DATA, linestyle="-", marker="o"),
        "verifyData": dict(color=DATA, linestyle="--", marker="D"),
    }
    sizes = sorted({size for _, size in data})
    fig, ax = plt.subplots(figsize=(4.8, 3.1))
    for op, style in ops.items():
        med = [statistics.median(data[(op, s)]) for s in sizes]
        lo = [min(data[(op, s)]) for s in sizes]
        hi = [max(data[(op, s)]) for s in sizes]
        kib = [s / 1024 for s in sizes]
        ax.fill_between(kib, lo, hi, color=style["color"], alpha=0.15, linewidth=0)
        ax.plot(kib, med, linewidth=1.6, markersize=4, label=op, **style)
    ax.set_xscale("log", base=2)
    ax.set_yscale("log")
    ax.set_xticks([s / 1024 for s in sizes], [f"{s // 1024}" for s in sizes])
    ax.set_xlabel("payload (KiB)")
    ax.set_ylabel("median time per call (µs)")
    ax.legend(fontsize=7)
    env = json.loads((found[-1] / "env.json").read_text())
    finish(
        fig,
        "e1-cost",
        f"Cost of one call by payload size on {env['cpuModel']}, Node {env['node']}: median over {len(found)} runs of each run's median; the band spans the runs.",
        [f"e1-node/{r.name}" for r in found],
        False,
    )


def safety_figure() -> None:
    found = runs_of("e5-safety")
    if not found:
        raise FileNotFoundError("no runs of e5-safety")
    run = found[-1]
    table = rows(run / "metrics.csv")[::-1]
    fig, ax = plt.subplots(figsize=(6.2, 0.22 * len(table) + 0.8))
    names = [r["variant"] for r in table]
    rejected = [int(r["rejected"]) for r in table]
    accepted = [int(r["accepted"]) for r in table]
    ax.barh(names, rejected, color=INK, height=0.62, label="rejected")
    ax.barh(names, accepted, left=rejected, color=DATA, height=0.62, hatch="///", edgecolor=INK, linewidth=0.4, label="accepted / leaked")
    ax.set_xlabel("trials")
    ax.grid(axis="y", visible=False)
    ax.tick_params(axis="y", labelsize=7)
    ax.legend(fontsize=7, loc="lower right", bbox_to_anchor=(1, 1.01), ncols=2)
    finish(
        fig,
        "e5-safety",
        f"Outcome of every attack variant over {table[0]['trials']} trials each, against the core engine on a virtual clock. A variant counts as rejected only if no victim accepted forged, foreign or out-of-lifetime content and no cache kept any. The {sum(1 for r in table if r['expected'] == 'baseline')} baseline/ rows run the attack of the IDEM variant they mirror against B5, the unsigned shared gateway cache: acceptance is their expected outcome, and they are not IDEM claims.",
        [f"e5-safety/{run.name}"],
        True,
    )


E4_STYLE = {
    "B0": dict(color=INTEREST, linestyle="-", marker="o", label="B0 overlay, plain calls"),
    "B2": dict(color=DATA, linestyle="-", marker="o", label="B2 overlay, star"),
    "B3": dict(color=DATA, linestyle="--", marker="D", label="B3 overlay, tree"),
    "N2": dict(color=INK, linestyle="-", marker="s", label="N2 native NDN, star"),
    "N3": dict(color=INK, linestyle="--", marker="^", label="N3 native NDN, tree"),
}


def e4_figures() -> None:
    """E4 (emulation): overlay vs native NDN under loss, from the latest `e4` run."""
    found = runs_of("e4")
    if not found:
        print("skipped e4 figures: no run under experiments/results/e4")
        return
    run = found[-1]
    ref = f"e4/{run.name}"
    config = json.loads((run / "config.json").read_text())
    summary = rows(run / "summary.csv")
    seeds = config["seeds"]["count"]

    def series(metric: str, mode: str) -> tuple[list[float], list[float], list[float]]:
        pts = sorted(
            (float(r["loss_pct"]), float(r["mean"]), float(r["ci95"]))
            for r in summary
            if r["metric"] == metric and r["mode"] == mode and r["n"] != "0"
        )
        return [p[0] for p in pts], [p[1] for p in pts], [p[2] for p in pts]

    def per_loss(name: str, panels: list[tuple[str, str, float]], caption: str) -> None:
        fig, axes = plt.subplots(1, len(panels), figsize=(3.3 * len(panels), 2.6))
        axes = axes if len(panels) > 1 else [axes]
        for ax, (metric, ylabel, scale) in zip(axes, panels):
            for mode in config["modes"]:
                xs, ys, ci = series(metric, mode)
                if xs:
                    ax.errorbar(xs, [y * scale for y in ys], yerr=[c * scale for c in ci], capsize=2, **E4_STYLE[mode])
            ax.set_xlabel("loss per link and direction (%)")
            ax.set_ylabel(ylabel)
            ax.set_xticks(config["lossPct"])
        axes[-1].legend(fontsize=6.5)
        finish(fig, name, f"{caption} Mean over {seeds} seeds; bars are 95% confidence intervals.", [ref], False, True)

    per_loss(
        "e4-producer-link",
        [("upstream_calls", "calls reaching the producer", 1.0), ("producer_link_bytes", "producer-link traffic (KiB)", 1 / 1024)],
        "Calls that reached the producer and frames received over the producer link (both directions, Ethernet frames) against link loss, HTTP overlay vs native NDN on the same Docker links.",
    )
    per_loss(
        "e4-latency",
        [("latency_p50_ms", "p50 latency (ms)", 1.0), ("latency_p95_ms", "p95 latency (ms)", 1.0), ("success_ratio", "calls answered", 1.0)],
        "Consumer-observed latency of answered calls and the fraction of calls answered, against link loss. The overlay recovers loss in TCP; the native consumer re-expresses an Interest with a fresh Nonce after its lifetime.",
    )

    # Per-hop answers at the lowest loss of the run: where calls were absorbed before the producer.
    hops = rows(run / "hops.csv")
    loss0 = min(config["lossPct"])
    modes = [m for m in config["modes"] if m != "B0"]
    nodes = ["edge1", "edge2", "regional", "producer-nfd"]
    shades = {"edge1": DATA, "edge2": "#f7cd66", "regional": INTEREST, "producer-nfd": GREY}
    fig, ax = plt.subplots(figsize=(4.6, 2.6))
    for i, mode in enumerate(modes):
        bottom = 0.0
        for node in nodes:
            vals = [float(h["cs_hits"]) for h in hops if h["mode"] == mode and h["node"] == node and float(h["loss_pct"]) == loss0]
            if not vals:
                continue
            v = statistics.mean(vals)
            ax.bar(i, v, bottom=bottom, color=shades[node], label=node if i == 0 or node not in ax.get_legend_handles_labels()[1] else None)
            bottom += v
    ax.set_xticks(range(len(modes)), modes)
    ax.set_ylabel("Content Store hits per run")
    ax.legend(fontsize=6.5)
    finish(fig, "e4-hops", f"Content Store hits per forwarder at {loss0}% loss, mean over {seeds} seeds (hops.csv).", [ref], False, True)


def main() -> None:
    reduction_figure("e2-agents", "e2-agents", "agents", "Calls reaching the producer, relative to direct MCP, as the swarm grows (W-syn, overlap 0.5).", log2=True)
    reduction_figure("e2-overlap", "e2-overlap", "cross-agent overlap", "Calls reaching the producer, relative to direct MCP, as more of each agent's calls come from the shared catalog (W-syn, 8 agents).")
    latency_figure()
    sensitivity_figure()
    mixed_figure()
    w = Sweep("e2-surface").config["base"]["workload"]
    reduction_figure(
        "e2-surface",
        "e2-surface",
        "URLs written in an equivalent form",
        f"Calls reaching the producer, relative to direct MCP, as more of the URLs are written in an equivalent form (W-syn, {w['agents']} agents, overlap {w['overlap']:g}). B5 keys on the arguments as sent; IDEM on the producer-declared canonical arguments.",
        modes=("B1", "B5", "B2"),
        xpercent=True,
        legend_above=True,
    )
    w = Sweep("e2-code-burst").config["base"]["workload"]
    code_figure(
        "e2-code-burst",
        "e2-code-burst",
        "calls sent at once per step",
        f"W-code: {w['agents']} agents x {w['callsPerAgent']} calls, no surface variation, agents start within {w['startSpreadMs'] / 1000:g} s, as the burst grows. Left: upstream reduction against direct MCP; middle: share of cacheable requests B2's PIT aggregated; right: calls per run B5 sent upstream while an identical call was in flight.",
    )
    w = Sweep("e2-code-sync").config["base"]["workload"]
    code_figure(
        "e2-code-sync",
        "e2-code-sync",
        "window in which the agents start (s)",
        f"W-code: {w['agents']} agents x {w['callsPerAgent']} calls in bursts of {w['burst']['size']}, no surface variation, as the agents' start window shrinks. Panels as in e2-code-burst.",
        xscale=1000.0,
        reverse=True,
    )
    microbench_figure()
    safety_figure()
    e4_figures()
    (OUT / "captions.json").write_text(json.dumps(CAPTIONS, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
