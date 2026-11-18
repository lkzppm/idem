import { describe, expect, it } from "vitest";
import { buildTopology, defaultConfig, type SimConfig } from "./config";
import { type FingerprintCase, fingerprint, sweepCases } from "./fingerprint.test-helpers";

/**
 * Regression guard (ADR-027): configurations without `producers` must run exactly as they did
 * before the simulator learned arbitrary graphs and several producers. The snapshot was recorded
 * on the code before that change; `pnpm --filter @idem/sim run fingerprint` checks every seed.
 */

function extraCases(): FingerprintCase[] {
  const out: FingerprintCase[] = [];
  for (const mode of ["mcp-direct", "mcp-local-cache", "idem", "idem-noverify"] as const) {
    out.push({ id: `default/${mode}`, cfg: defaultConfig({ mode }), seed: 42 });
  }
  out.push({
    id: "tree-loss/idem",
    cfg: defaultConfig({
      topology: buildTopology({
        kind: "tree",
        agents: 8,
        agentLinkMs: 5,
        coreLinkMs: 10,
        producerLinkMs: 40,
        lossPct: 3,
        bandwidthMbps: 50,
        edges: 3,
      }),
    }),
    seed: 5,
  });
  out.push({ id: "attacks/idem", cfg: defaultConfig(), seed: 11, attacks: true });
  const trace: SimConfig = defaultConfig({
    topology: buildTopology({ kind: "star", agents: 3, agentLinkMs: 5, producerLinkMs: 40 }),
    workload: {
      kind: "trace",
      records: [
        { t: 0, agent: 0, tool: "fetch_page", args: { url: "https://corpus.idem.dev/doc/1?v=1&lang=en" } },
        { t: 5, agent: 1, tool: "fetch_page", args: { url: "https://CORPUS.idem.dev/doc/1?lang=en&v=1" } },
        { t: 9, agent: 2, tool: "my_notes", args: {} },
        { t: 20, agent: 0, tool: "send_email", args: { to: "a@example.com", body: "hi" } },
        { t: 400, agent: 2, tool: "fetch_page", args: { url: "https://corpus.idem.dev/doc/1#x" } },
        { t: 410, agent: 1, tool: "fetch_page", args: { url: 42 } },
        { t: 500, agent: 0, tool: "no_such_tool", args: {} },
      ],
    },
  });
  for (const mode of ["mcp-local-cache", "idem"] as const) {
    out.push({ id: `trace/${mode}`, cfg: { ...trace, mode }, seed: 3 });
  }
  return out;
}

async function fingerprints(cases: FingerprintCase[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const c of cases) out[c.id] = await fingerprint(c);
  return out;
}

describe("legacy configurations run unchanged (ADR-027)", () => {
  it("every E2 sweep point in experiments/configs, first seed, every mode", async () => {
    expect(await fingerprints(sweepCases({ seeds: 1 }))).toMatchSnapshot();
  }, 120_000);

  it("default config, tree with loss, attacks and trace replay", async () => {
    expect(await fingerprints(extraCases())).toMatchSnapshot();
  }, 60_000);
});
