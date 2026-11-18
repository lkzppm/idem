// Opt-in: the @idem/ndn scenarios against a real NFD (experiments/ndn/nfd). Skipped unless
// IDEM_NFD=1, so `pnpm test` and CI never need Docker. Start the forwarders first:
//
//   docker compose -f experiments/ndn/nfd/compose.yaml up -d
//   IDEM_NFD=1 pnpm vitest run packages/ndn/src/nfd.test.ts
//   docker compose -f experiments/ndn/nfd/compose.yaml down
//
// `pnpm exp:ndn` does all of this and also writes a run folder under experiments/results/ndn-nfd/.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type NfdCheckConfig, waitForNfd } from "../scripts/nfd/harness";
import { runScenario, SCENARIOS, setupWorld, type World } from "../scripts/nfd/scenarios";

const CONFIG = join(import.meta.dirname, "..", "..", "..", "experiments", "ndn", "nfd", "config.json");

describe.skipIf(process.env.IDEM_NFD !== "1")("against a real NFD (IDEM_NFD=1)", () => {
  let world: World | undefined;

  beforeAll(async () => {
    const cfg = JSON.parse(readFileSync(CONFIG, "utf8")) as NfdCheckConfig;
    await waitForNfd(cfg);
    world = await setupWorld(cfg);
  }, 60_000);

  afterAll(() => world?.producer.close());

  for (const s of SCENARIOS) {
    it(`${s.id}: ${s.title} [${s.rules.join("] [")}]`, async () => {
      if (!world) throw new Error("no world");
      const r = await runScenario(world, s);
      expect(r.error).toBeUndefined();
      expect(r.checks.filter((c) => !c.pass)).toEqual([]);
      expect(r.checks.length).toBeGreaterThan(0);
    }, 120_000);
  }
});
