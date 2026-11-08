#!/usr/bin/env bash
# Keeps the demo console up. Every 10 s:
#  - local stage (:4545) down → restart ./demo.sh
#  - local up but the public console (levelai-console.vercel.app) fails 3 checks in a row → the
#    tunnel died, so rerun demo/console.sh (new tunnel, console site redeployed)
# Start once, in the background:  (demo/keepalive.sh > /tmp/levelai-keepalive.log 2>&1 &)
set -uo pipefail
cd "$(dirname "$0")/.."
PORT="${DEMO_PORT:-4545}"
PUBLIC="${DEMO_CONSOLE_URL:-https://levelai-console.vercel.app}"
misses=0
while true; do
  code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://localhost:${PORT}/" || true)"
  if [ "$code" = "000" ]; then
    echo "$(date '+%H:%M:%S') console down; restarting"
    (./demo.sh --no-open > "${TMPDIR:-/tmp}/levelai-demo.log" 2>&1 &)
    sleep 15
  else
    # 401 means the tunnel reached the stage and it asked for the password: healthy.
    pub="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$PUBLIC/" || true)"
    if [ "$pub" = "401" ] || [ "$pub" = "200" ]; then misses=0; else misses=$((misses + 1)); fi
    if [ "$misses" -ge 3 ]; then
      echo "$(date '+%H:%M:%S') public console failing ($pub); restarting tunnel"
      demo/console.sh >> /tmp/levelai-console-restart.log 2>&1 || echo "$(date '+%H:%M:%S') console.sh failed"
      misses=0
      sleep 60
    fi
  fi
  sleep 10
done
