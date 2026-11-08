#!/usr/bin/env bash
# Keeps the business side up. Every 15 s:
#  - local server (:8787) down → restart it (tunnel untouched, public URL unchanged)
#  - local up but the public site (levelai.vercel.app/health) fails 3 checks in a row → the tunnel
#    died, so rerun live.sh (new tunnel, rewrites redeployed, server restarted)
# Start once, in the background:  (business/keepalive.sh > /tmp/levelai-biz-keepalive.log 2>&1 &)
set -uo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8787}"
PUBLIC="${PUBLIC_HEALTH_URL:-https://levelai.vercel.app/health}"
misses=0
while true; do
  code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://localhost:${PORT}/health" || true)"
  if [ "$code" = "000" ]; then
    echo "$(date '+%H:%M:%S') business server down; restarting"
    (set -a; . ../.env; set +a; PORT="$PORT" nohup npx --no-install tsx src/server.ts > "${TMPDIR:-/tmp}/levelai-business.log" 2>&1 &)
    sleep 20
  else
    pub="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$PUBLIC" || true)"
    if [ "$pub" = "200" ]; then misses=0; else misses=$((misses + 1)); fi
    if [ "$misses" -ge 3 ]; then
      echo "$(date '+%H:%M:%S') public site failing ($pub); restarting tunnel via live.sh"
      pkill -f "cloudflared tunnel --no-autoupdate --url http://localhost:${PORT}" || true
      lsof -ti "tcp:${PORT}" -sTCP:LISTEN | xargs kill 2>/dev/null || true
      sleep 2
      (./live.sh > /tmp/levelai-live.log 2>&1 &)
      misses=0
      sleep 90
    fi
  fi
  sleep 15
done
