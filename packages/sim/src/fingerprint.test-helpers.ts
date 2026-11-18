import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { b64uEncode, sha256, utf8 } from "@idem/core";
import type { SimConfig } from "./config";
import { repoRoot } from "./experiments/node-io";
import {
  applyParam,
  type EvalModeId,
  parseExperimentConfig,
  parseProcessingCosts,
  simConfigFor,
} from "./experiments/spec";
import { Simulation } from "./simulation";

/**
 * Fingerprints of simulator runs, to check that a refactor leaves every run of a committed
 * configuration unchanged (ADR-027). A fingerprint hashes what a run reports: the metrics, the
 * workload statistics, every latency, call record, transmission and forwarder event (minus the
 * wall-clock `us` of verify events). Only the fields that existed when the fingerprints were first
 * recorded are hashed, so adding a field to a record does not change a fingerprint.
 */

const METRIC_KEYS = [
  "calls",
  "completed",
  "failed",
  "upstreamCalls",
  "csHits",
  "pitAggregations",
  "edgeInterests",
  "csHitRatio",
  "pitAggregationRatio",
  "localCacheHits",
  "latencyMs",
  "producerLinkBytes",
  "verifyFailures",
  "staleServes",
  "safetyViolations",
  "retries",
  "durationMs",
  "coreCsHits",
  "bypasses",
  "csEvictions",
  "lateServes",
  "maxLateMs",
] as const;
const CALL_KEYS = [
  "agent",
  "tool",
  "t0",
  "t1",
  "latencyMs",
  "ok",
  "via",
  "attempts",
  "stale",
  "lateMs",
] as const;
const TX_KEYS = ["link", "from", "to", "kind", "label", "bytes", "t0", "t1", "lost", "tampered"] as const;

function pick(o: object, keys: readonly string[]): unknown[] {
  return keys.map((k) => (o as Record<string, unknown>)[k] ?? null);
}

/** One run to fingerprint. */
export interface FingerprintCase {
  id: string;
  cfg: SimConfig;
  seed: number;
  /** Inject the three sandbox attacks at t = 500 ms. */
  attacks?: boolean;
}

/** Run a case and hash everything it reports. */
export async function fingerprint(c: FingerprintCase): Promise<string> {
  const lines: string[] = [];
  const sim = await Simulation.create(c.cfg, {
    seed: c.seed,
    keepEvents: true,
    onTransmit: (tx) => lines.push(`tx ${JSON.stringify(pick(tx, TX_KEYS))}`),
    onCall: (r) => lines.push(`call ${JSON.stringify(pick(r, CALL_KEYS))}`),
    onAttack: (a) => lines.push(`attack ${JSON.stringify([a.kind, a.t, a.rejected, a.detail])}`),
  });
  const stats = await sim.workloadStats();
  if (c.attacks) {
    await sim.runUntil(500);
    sim.attackTamper();
    await sim.attackForge(0);
    await sim.attackPrivateProbe(0, 1);
  }
  const r = await sim.run();
  lines.push(`stats ${JSON.stringify(stats)}`);
  lines.push(`metrics ${JSON.stringify(pick(r.metrics, METRIC_KEYS))}`);
  lines.push(`latencies ${JSON.stringify(sim.metrics.latencies)}`);
  for (const e of r.events ?? []) {
    const { us: _wallClock, ...rest } = e as typeof e & { us?: number };
    lines.push(`event ${JSON.stringify(rest)}`);
  }
  return b64uEncode(await sha256(utf8(lines.join("\n"))));
}

/**
 * The runs of every E2 sweep in `experiments/configs/`: each value × mode × seed, as the CLI
 * would run them. `seeds` limits the seeds per point (default: all of the config's).
 */
export function sweepCases(opts: { seeds?: number; only?: string } = {}): FingerprintCase[] {
  const dir = join(repoRoot(), "experiments", "configs");
  const out: FingerprintCase[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".json") || (opts.only !== undefined && !file.startsWith(opts.only))) continue;
    const raw = JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, unknown>;
    if (raw.kind !== "sweep") continue;
    const cfg = parseExperimentConfig(raw);
    if (cfg.kind !== "sweep") continue;
    const costs =
      typeof cfg.processing === "string"
        ? parseProcessingCosts(JSON.parse(readFileSync(join(dir, cfg.processing), "utf8")))
        : cfg.processing;
    const count = Math.min(cfg.seeds.count, opts.seeds ?? cfg.seeds.count);
    for (const value of cfg.sweep.values) {
      const base = applyParam(cfg.base, cfg.sweep.param, value);
      for (const mode of cfg.modes as EvalModeId[]) {
        for (let s = 0; s < count; s++) {
          const seed = cfg.seeds.first + s;
          out.push({
            id: `${cfg.experiment}/${cfg.sweep.param}=${value}/${mode}/seed=${seed}`,
            cfg: simConfigFor(base, mode, costs),
            seed,
          });
        }
      }
    }
  }
  return out;
}
