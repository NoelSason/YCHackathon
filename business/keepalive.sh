#!/usr/bin/env bash
# Keeps the business side up. Every 15 s:
#  - local server (:8787) down → restart it (tunnel untouched, public URL unchanged)
#  - local up but the public site (levelai.vercel.app/health) fails 3 checks in a row:
#      - the current tunnel still answers → only the Vercel rewrite is wrong (e.g. a deploy failed),
#        so redeploy site/ (at most every 10 min) and leave the server alone
#      - the tunnel is dead too → rerun live.sh (new tunnel, rewrites redeployed, server restarted)
# Holds a caffeinate assertion for as long as it runs, so a server it restarts keeps the Mac awake.
# Start once, in the background:  (business/keepalive.sh > /tmp/levelai-biz-keepalive.log 2>&1 &)
set -uo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8787}"
PUBLIC="${PUBLIC_HEALTH_URL:-https://levelai.vercel.app/health}"
TUNNEL_LOG="${TMPDIR:-/tmp}/levelai-live/tunnel.log"
DEPLOY_FAILS="${TMPDIR:-/tmp}/levelai-deploy-failures.log"
caffeinate -ims -w $$ &
misses=0
last_redeploy=0
while true; do
  code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://localhost:${PORT}/health" || true)"
  if [ "$code" = "000" ]; then
    echo "$(date '+%H:%M:%S') business server down; restarting"
    (set -a; . ../.env; set +a; PORT="$PORT" nohup npx --no-install tsx src/server.ts >> "${TMPDIR:-/tmp}/levelai-business.log" 2>&1 &)
    sleep 20
  else
    pub="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$PUBLIC" || true)"
    if [ "$pub" = "200" ]; then misses=0; else misses=$((misses + 1)); fi
    if [ "$misses" -ge 3 ]; then
      tunnel="$(grep -aoE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | grep -v '://api\.trycloudflare' | tail -1 || true)"
      direct="000"
      [ -n "$tunnel" ] && direct="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$tunnel/health" || true)"
      if [ "$direct" = "200" ]; then
        now="$(date +%s)"
        if [ $((now - last_redeploy)) -ge 600 ]; then
          echo "$(date '+%H:%M:%S') public site failing ($pub) but the tunnel answers; redeploying site/ only"
          last_redeploy="$now"
          if ! (cd ../site && vercel deploy --prod --yes > "${TMPDIR:-/tmp}/levelai-site-redeploy.log" 2>&1); then
            echo "$(date '+%Y-%m-%d %H:%M:%S') site redeploy failed (see ${TMPDIR:-/tmp}/levelai-site-redeploy.log)" | tee -a "$DEPLOY_FAILS"
          fi
        fi
      else
        echo "$(date '+%H:%M:%S') public site failing ($pub), tunnel dead ($direct); restarting tunnel via live.sh"
        pkill -f "cloudflared tunnel --no-autoupdate --url http://localhost:${PORT}" || true
        lsof -ti "tcp:${PORT}" -sTCP:LISTEN | xargs kill 2>/dev/null || true
        sleep 2
        (./live.sh > /tmp/levelai-live.log 2>&1 &)
        sleep 90
      fi
      misses=0
    fi
  fi
  sleep 15
done
