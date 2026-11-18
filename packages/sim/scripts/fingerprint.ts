// Fingerprints of simulator runs (ADR-027; see src/fingerprint.test-helpers.ts).
//
// Default: every run of the E2 sweeps in experiments/configs, one line per run, `<id> <hash>`.
// Run it before and after a change to the simulator on the same machine and diff the outputs:
// identical files mean identical metrics, records and event streams for every committed config.
//
//   pnpm --filter @idem/sim run fingerprint [--seeds 30] [--only e2-agents] > before.txt
//
// `--pinned`: the JSON object `{ <case id>: <hash> }` of the cases legacy.test.ts pins for the
// current platform (`process.platform`), to paste under that platform's key in
// src/__snapshots__/legacy.fingerprints.json. Record it on the code *before* a change.
import { fingerprint, pinnedFingerprints, sweepCases } from "../src/fingerprint.test-helpers";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

if (argv.includes("--pinned")) {
  process.stdout.write(`${JSON.stringify({ [process.platform]: await pinnedFingerprints() }, null, 2)}\n`);
} else {
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
}
