#!/usr/bin/env bash
# Keeps one solver worker running on this laptop (claims queued solver_runs with SKIP LOCKED, so it's
# safe next to other workers). Restarts it if it exits.
cd "$(dirname "$0")/solver"
while true; do
  echo "$(date '+%H:%M:%S') starting solver worker"
  (set -a; . ../.env; set +a; caffeinate -i npx --no-install tsx src/worker.ts) >> "${TMPDIR:-/tmp}/levelai-solver.log" 2>&1
  echo "$(date '+%H:%M:%S') solver worker exited; restarting in 10 s"
  sleep 10
done
