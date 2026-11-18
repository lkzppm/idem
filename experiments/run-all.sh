#!/usr/bin/env bash
# One command to reproduce E1, E2 and E5 from a clean checkout (spec/05-evaluation.md, roadmap M4):
#
#   pnpm i && experiments/run-all.sh
#
# Every step writes a new run folder under experiments/results/<experiment>/<run-id>/; nothing is
# overwritten. E1 is wall-clock, so it runs first, alone, and is repeated (E1_RUNS, default 5); its
# medians then price CPU work in the E2 sweeps (experiments/configs/processing.json). E2 and E5
# run on the virtual clock and are deterministic for their seeds.
set -euo pipefail
cd "$(dirname "$0")/.."

E1_RUNS="${E1_RUNS:-5}"

for _ in $(seq "$E1_RUNS"); do
  pnpm --silent sim -- --config experiments/configs/e1-node.json --quiet
  sleep 1 # distinct run ids (they carry the second)
done
pnpm --silent sim -- calibrate --from e1-node --out experiments/configs/processing.json
pnpm --silent exec biome format --write experiments/configs/processing.json >/dev/null # keep `pnpm lint` green

for sweep in e2-agents e2-overlap e2-ttl e2-cs-size e2-think-time e2-mixed; do
  pnpm --silent sim -- --config "experiments/configs/$sweep.json" --quiet
done
pnpm --silent sim -- --config experiments/configs/e5-safety.json --quiet

# The JSON the /results page is built from, then the figures (needs uv; skipped without it).
pnpm --silent sim -- export-web
pnpm --silent exec biome format --write apps/web/lib/results/data.json >/dev/null
if [ -n "${SKIP_FIGURES:-}" ]; then
  echo "SKIP_FIGURES set: skipped experiments/plots/make_figures.py" >&2
elif command -v uv >/dev/null 2>&1; then
  uv run experiments/plots/make_figures.py
else
  echo "uv not found: skipped experiments/plots/make_figures.py" >&2
fi
