#!/usr/bin/env bash
# `pnpm exp:ndn`: start three NFD forwarders (compose project `idem-nfd`: edge1, edge2 → regional),
# run the @idem/ndn NFD check against them, write experiments/results/ndn-nfd/<run-id>/, and remove
# the containers and the network this compose file created (nothing else). Needs Docker.
#
#   pnpm exp:ndn                    # all scenarios, writes a run folder
#   pnpm exp:ndn --only S2,S3       # a subset (extra arguments go to nfd-check.ts)
#   IDEM_NFD_KEEP=1 pnpm exp:ndn    # leave the forwarders running (e.g. for IDEM_NFD=1 pnpm test)
set -euo pipefail
cd "$(dirname "$0")/../../.."

COMPOSE=(docker compose -f experiments/ndn/nfd/compose.yaml)
cleanup() {
  if [ -z "${IDEM_NFD_KEEP:-}" ]; then "${COMPOSE[@]}" down --remove-orphans >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

# Fresh forwarders every run: empty Content Stores, no routes left by an earlier run.
"${COMPOSE[@]}" down --remove-orphans >/dev/null 2>&1 || true
"${COMPOSE[@]}" up -d

# Config: experiments/ndn/nfd/config.json (the default of nfd-check.ts).
pnpm --silent --filter @idem/ndn nfd:check "$@"
