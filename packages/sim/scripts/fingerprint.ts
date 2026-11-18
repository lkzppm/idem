// Fingerprint every run of the E2 sweeps in experiments/configs (ADR-027): one line per run,
// `<id> <hash>`, on stdout. Run it before and after a change to the simulator and diff the outputs;
// identical files mean identical metrics, records and event streams for every committed config.
//
//   pnpm --filter @idem/sim run fingerprint [--seeds 30] [--only e2-agents] > before.txt
import { fingerprint, sweepCases } from "../src/fingerprint.test-helpers";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const seeds = flag("--seeds");
const only = flag("--only");
const cases = sweepCases({
  ...(seeds !== undefined && { seeds: Number(seeds) }),
  ...(only !== undefined && { only }),
});
let done = 0;
for (const c of cases) {
  process.stdout.write(`${c.id} ${await fingerprint(c)}\n`);
  if (++done % 100 === 0) process.stderr.write(`  ${done}/${cases.length}\n`);
}
