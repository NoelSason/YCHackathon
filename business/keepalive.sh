#!/usr/bin/env bash
# Keeps the business server (:8787, behind levelai.vercel.app) running: checks /health every 15 s and
# restarts it if it's down. It leaves the tunnel alone, so the public URL doesn't change.
# Start once, in the background:  (business/keepalive.sh > /tmp/levelai-biz-keepalive.log 2>&1 &)
set -uo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8787}"
while true; do
  code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://localhost:${PORT}/health" || true)"
  if [ "$code" = "000" ]; then
    echo "$(date '+%H:%M:%S') business server down; restarting"
    (set -a; . ../.env; set +a; PORT="$PORT" nohup npx --no-install tsx src/server.ts > "${TMPDIR:-/tmp}/levelai-business.log" 2>&1 &)
    sleep 20
  fi
  sleep 15
done
