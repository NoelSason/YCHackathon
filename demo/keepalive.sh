#!/usr/bin/env bash
# Keeps the demo console (./demo.sh on :4545) running: checks every 10 s and restarts it if it's down.
# Start once, in the background:  (demo/keepalive.sh > /tmp/levelai-keepalive.log 2>&1 &)
set -uo pipefail
cd "$(dirname "$0")/.."
PORT="${DEMO_PORT:-4545}"
while true; do
  code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://localhost:${PORT}/" || true)"
  if [ "$code" = "000" ]; then
    echo "$(date '+%H:%M:%S') console down; restarting"
    (./demo.sh --no-open > "${TMPDIR:-/tmp}/levelai-demo.log" 2>&1 &)
    sleep 15
  fi
  sleep 10
done
