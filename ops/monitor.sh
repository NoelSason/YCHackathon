#!/usr/bin/env bash
# Overnight health monitor for Level AI. Every 5 minutes it checks the public site, the public
# console, the activity log, the solver heartbeat, and both cloud iPhones, and appends one line to
# /tmp/levelai-monitor.log. When a check stays red for 15 minutes or more it runs that check's
# documented recovery (at most once every 20 minutes per check) and writes one human-readable row
# to activity_log as agent "watchdog". Nothing is written to activity_log unless a recovery ran.
#
# It also restarts any of the three keepalive watchdogs that has died (immediately), holds a
# caffeinate assertion for the whole Mac, rotates logs over 50 MB, and once an hour records the
# Monid and Naïve balances and whether the Vercel CLI is still signed in, and saves a replay
# snapshot for ./demo.sh --replay (newest 6 kept in demo/data/).
#
#   ops/monitor.sh            run forever (ops/keepalive.sh runs it for you)
#   ops/monitor.sh --once     one pass, no recoveries (a dry run you can read)
#
# Restarts go only through ports (lsof -sTCP:LISTEN), the existing scripts, or the keepalives.
# It never kills tsx by name, never resets or releases a phone, and never prints a secret.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
TMP="${TMPDIR:-/tmp}"
LOG="${MONITOR_LOG:-/tmp/levelai-monitor.log}"
STATE="$TMP/levelai-monitor"
INTERVAL="${MONITOR_INTERVAL_S:-300}"
RED_AFTER_S="${MONITOR_RED_AFTER_S:-900}"      # 15 min red before a recovery
RETRY_AFTER_S="${MONITOR_RETRY_AFTER_S:-1200}" # then at most one recovery per 20 min per check
SITE="${SITE_URL:-https://levelai.vercel.app}"
CONSOLE="${DEMO_CONSOLE_URL:-https://levelai-console.vercel.app}"
ONCE=0; [ "${1:-}" = "--once" ] && ONCE=1
mkdir -p "$STATE"

say() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }
envrun() { (set -a; . "$ROOT/.env"; set +a; "$@"); }
now() { date +%s; }

# Watchdog row in activity_log: only called after a recovery actually ran.
record() { # record <action> <reason> <result>
  envrun env NODE_NO_WARNINGS=1 node "$ROOT/ops/db.cjs" log "$1" "$2" "$3" >/dev/null 2>>"$LOG" || say "  (couldn't write the activity_log row: $1)"
}

# mark <check> ok|fail → prints how long it has been red, in seconds (0 when ok)
mark() {
  local f="$STATE/$1.since"
  if [ "$2" = "ok" ]; then rm -f "$f"; echo 0; return; fi
  [ -f "$f" ] || now > "$f"
  # At least 1 s, so the first failing pass already reads RED (0 would print OK).
  local d=$(( $(now) - $(cat "$f") )); [ "$d" -gt 0 ] || d=1
  echo "$d"
}

# due <check> → true when a recovery may run now (red long enough, none in the last 20 min)
due() {
  local red="$2" last=0
  [ "$ONCE" = 1 ] && return 1
  [ "$red" -ge "$RED_AFTER_S" ] || return 1
  [ -f "$STATE/$1.recovered" ] && last="$(cat "$STATE/$1.recovered")"
  [ $(( $(now) - last )) -ge "$RETRY_AFTER_S" ] || return 1
  now > "$STATE/$1.recovered"
  return 0
}

code_of() { curl -s -o /dev/null -m "${2:-15}" -w '%{http_code}' "$1" 2>/dev/null || true; }
mins() { echo "$(( $1 / 60 ))m"; }

running() { pgrep -f "$1" >/dev/null 2>&1; }

ensure_keepalives() {
  if ! running "business/keepalive.sh|bash ./keepalive.sh"; then
    (nohup "$ROOT/business/keepalive.sh" >> /tmp/levelai-biz-keepalive.log 2>&1 &)
    say "  restarted business/keepalive.sh (it wasn't running)"
    [ "$ONCE" = 1 ] || record "restarted the business server's watchdog" "business/keepalive.sh wasn't running, so nothing would restart the server or its tunnel" "started it again"
  fi
  if ! running "demo/keepalive.sh"; then
    (nohup "$ROOT/demo/keepalive.sh" >> /tmp/levelai-keepalive.log 2>&1 &)
    say "  restarted demo/keepalive.sh (it wasn't running)"
    [ "$ONCE" = 1 ] || record "restarted the console's watchdog" "demo/keepalive.sh wasn't running, so nothing would restart the console or its tunnel" "started it again"
  fi
  if ! running "solver-keepalive.sh"; then
    (cd "$ROOT/solver" && nohup ../solver-keepalive.sh >> /tmp/levelai-solver-keepalive.log 2>&1 &)
    say "  restarted solver-keepalive.sh (it wasn't running)"
    [ "$ONCE" = 1 ] || record "restarted the solver worker's watchdog" "solver-keepalive.sh wasn't running, so no worker was measuring levels" "started it again"
  fi
}

rotate_logs() { # truncate append-mode logs over 50 MB (keeps the last 2,000 lines)
  local f
  for f in "$TMP/levelai-business.log" "$TMP/levelai-solver.log" "$LOG" /tmp/levelai-biz-keepalive.log /tmp/levelai-keepalive.log; do
    [ -f "$f" ] || continue
    if [ "$(stat -f %z "$f" 2>/dev/null || echo 0)" -gt 52428800 ]; then
      tail -n 2000 "$f" > "$f.tmp" && cat "$f.tmp" > "$f" && rm -f "$f.tmp"
      say "  rotated $f (over 50 MB)"
    fi
  done
}

hourly() { # balances and the Vercel login, at most once an hour
  local f="$STATE/hourly.at" last=0
  [ -f "$f" ] && last="$(cat "$f")"
  [ $(( $(now) - last )) -ge 3600 ] || [ "$ONCE" = 1 ] || return 0
  now > "$f"
  local monid naive vercel
  monid="$(monid balance 2>/dev/null | grep -oE '\$[0-9.]+' | head -1)"
  naive="$(envrun bash -c 'curl -s -m 20 -H "Authorization: Bearer $NAIVE_API_KEY_SOCIAL" https://api.vetta.sh/v1/credits/balance' 2>/dev/null \
    | sed -nE 's/.*"balance_micro_usd":([0-9]+).*/\1/p' | awk '{ printf "$%.2f", $1 / 1000000 }')"
  if (cd "$ROOT/site" && vercel whoami >/dev/null 2>&1); then vercel=ok; else vercel=SIGNED-OUT; fi
  say "  balances: monid=${monid:-unknown} naive_team=${naive:-unknown} vercel_cli=$vercel"
  [ "$vercel" = ok ] || say "  WARN: the Vercel CLI is signed out; tunnel restarts can't update the public addresses. Run: vercel login"
  if [ -f "$TMP/levelai-deploy-failures.log" ] && [ -n "$(find "$TMP/levelai-deploy-failures.log" -mmin -60 2>/dev/null)" ]; then
    say "  WARN: deploy failures in the last hour: $(tail -1 "$TMP/levelai-deploy-failures.log")"
  fi
  # A fresh replay file for ./demo.sh --replay (the on-stage fallback); keep the newest 6.
  if [ "$ONCE" = 0 ]; then
    local snap
    snap="$(cd "$ROOT" && NODE_NO_WARNINGS=1 npm --prefix demo run --silent snapshot 2>&1 | sed -nE 's/^Saved ([0-9]+) events to (.*)$/\1 events, \2/p')"
    say "  replay snapshot: ${snap:-failed}"
    ls -t "$ROOT"/demo/data/run-*.jsonl 2>/dev/null | tail -n +7 | while read -r old; do rm -f "$old"; done
  fi
}

recover_site() { # the documented recovery for the public site
  local tunnel direct
  tunnel="$(grep -aoE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TMP/levelai-live/tunnel.log" 2>/dev/null | tail -1 || true)"
  direct="$( [ -n "$tunnel" ] && code_of "$tunnel/health" || echo 000)"
  if [ "$direct" = "200" ]; then
    if (cd "$ROOT/site" && vercel deploy --prod --yes > "$TMP/levelai-site-redeploy.log" 2>&1); then
      echo "the tunnel was fine, so only site/ was redeployed"
    else
      echo "the tunnel was fine but redeploying site/ failed (see $TMP/levelai-site-redeploy.log)"
    fi
  else
    pkill -f "cloudflared tunnel --no-autoupdate --url http://localhost:8787" 2>/dev/null || true
    lsof -ti tcp:8787 -sTCP:LISTEN | xargs kill 2>/dev/null || true
    sleep 2
    (cd "$ROOT/business" && nohup ./live.sh > /tmp/levelai-live.log 2>&1 &)
    echo "reran business/live.sh (new tunnel, site redeployed, server restarted)"
  fi
}

recover_console() {
  if [ "$(code_of http://localhost:4545/ 5)" = "000" ]; then
    echo "the console isn't up locally; its keepalive restarts ./demo.sh"
  elif "$ROOT/demo/console.sh" >> /tmp/levelai-console-restart.log 2>&1; then
    echo "reran demo/console.sh (new tunnel, console redeployed)"
  else
    echo "reran demo/console.sh, which failed (see /tmp/levelai-console-restart.log)"
  fi
}

recover_solver() { # ask the worker to stop gracefully; solver-keepalive.sh starts a fresh one in 10 s
  local ka pids
  ka="$(pgrep -f 'bash ../solver-keepalive.sh' | head -1)"
  [ -n "$ka" ] || { echo "no solver keepalive to restart through"; return; }
  pids="$(pgrep -P "$ka" 2>/dev/null)"
  local all="" p
  while [ -n "$pids" ]; do
    all="$all $pids"; local next=""
    for p in $pids; do next="$next $(pgrep -P "$p" 2>/dev/null)"; done
    pids="$(echo $next)"
  done
  for p in $all; do ps -o command= -p "$p" 2>/dev/null | grep -q 'src/worker.ts' && kill -TERM "$p" 2>/dev/null; done
  echo "sent the stale worker SIGTERM; solver-keepalive.sh restarts it"
}

pass() {
  ensure_keepalives
  rotate_logs

  # 1. Public /health
  local h hred
  h="$(curl -s -m 15 "$SITE/health" 2>/dev/null || true)"
  if echo "$h" | grep -q '"ok":true'; then hred="$(mark health ok)"; h=200; else hred="$(mark health fail)"; h="$(code_of "$SITE/health")"; fi

  # 2. Public console: 401 without the password is healthy
  local c cred
  c="$(code_of "$CONSOLE/")"
  if [ "$c" = "401" ]; then cred="$(mark console ok)"; else cred="$(mark console fail)"; fi

  # 3 and 4. Activity log and solver heartbeat
  local fresh agent_age solver_age playtest_age ared sred kill
  fresh="$(envrun env NODE_NO_WARNINGS=1 node "$ROOT/ops/db.cjs" fresh 2>&1 | tail -1)"
  agent_age="$(echo "$fresh" | sed -nE 's/.*agent_age_s=([0-9]+).*/\1/p')"
  solver_age="$(echo "$fresh" | sed -nE 's/.*solver_age_s=([0-9]+).*/\1/p')"
  playtest_age="$(echo "$fresh" | sed -nE 's/.*playtest_age_s=([0-9]+).*/\1/p')"
  kill="$(echo "$fresh" | sed -nE 's/.*kill_switch=([a-z]+).*/\1/p')"
  if [ -n "$agent_age" ] && [ "$agent_age" -le 1800 ]; then ared="$(mark activity ok)"; else ared="$(mark activity fail)"; fi
  if [ -n "$solver_age" ] && [ "$solver_age" -le 180 ]; then sred="$(mark solver ok)"; else sred="$(mark solver fail)"; fi

  # 5. Both phones, read-only
  local phones pred
  phones="$(envrun bash -c '
    for id in "$MOBILERUN_DEVICE_ID" "${MOBILERUN_APPSTORE_DEVICE_ID:-}"; do
      [ -n "$id" ] || continue
      s="$(curl -s -m 15 -H "Authorization: Bearer $MOBILERUN_API_KEY" "https://api.mobilerun.ai/v1/devices/$id" | sed -nE "s/.*\"state\":\"([a-z_]+)\".*/\1/p")"
      printf "%s " "${s:-unreachable}"
    done' 2>/dev/null)"
  phones="$(echo $phones | tr ' ' '/')"
  if echo "/$phones/" | grep -qE '/(ready|busy|running|assigned)/' && ! echo "/$phones/" | grep -qE '/(unreachable|terminated|error|failed)/'; then pred="$(mark phone ok)"; else pred="$(mark phone fail)"; fi

  local status=OK
  [ "$hred$cred$ared$sred$pred" = "00000" ] || status=RED
  say "$status health=$h$( [ "$hred" -gt 0 ] && echo "(red $(mins "$hred"))") console=$c$( [ "$cred" -gt 0 ] && echo "(red $(mins "$cred"))") agent_row_age=${agent_age:-?}s$( [ "$ared" -gt 0 ] && echo "(red $(mins "$ared"))") solver_heartbeat_age=${solver_age:-?}s$( [ "$sred" -gt 0 ] && echo "(red $(mins "$sred"))") playtest_row_age=${playtest_age:-?}s phones=${phones:-?}$( [ "$pred" -gt 0 ] && echo "(red $(mins "$pred"))") kill_switch=${kill:-?}"
  [ -n "$agent_age" ] || say "  db check failed: $fresh"

  # Recoveries, only for checks red 15+ minutes
  local out
  if due health "$hred"; then
    out="$(recover_site)"; say "  RECOVERY health: $out"
    record "restarted the public site's connection" "levelai.vercel.app/health had failed for $(mins "$hred") (last code $h)" "$out"
  fi
  if due console "$cred"; then
    out="$(recover_console)"; say "  RECOVERY console: $out"
    record "restarted the console's public address" "levelai-console.vercel.app had failed for $(mins "$cred") (last code $c)" "$out"
  fi
  if due activity "$ared"; then
    if [ "$kill" = "true" ]; then
      say "  activity is quiet but the kill switch is on; not restarting anything"
    else
      lsof -ti tcp:8787 -sTCP:LISTEN | xargs kill 2>/dev/null || true
      out="restarted the business server by its port; business/keepalive.sh brings it back within 15 s"
      say "  RECOVERY activity: $out"
      record "restarted the business server" "no agent wrote to the activity log for $(mins "${agent_age:-0}") (its loops run every 10 to 30 min)" "$out"
    fi
  fi
  if due solver "$sred"; then
    out="$(recover_solver)"; say "  RECOVERY solver: $out"
    record "restarted the solver worker" "no live solver heartbeat for $(mins "$sred")" "$out"
  fi
  if [ "$pred" -ge "$RED_AFTER_S" ]; then
    say "  phone red for $(mins "$pred") ($phones). No automatic recovery: a person checks the Mobilerun dashboard."
  fi
  hourly
}

if [ "$ONCE" = 1 ]; then pass; tail -n 8 "$LOG"; exit 0; fi
caffeinate -ims -w $$ &
say "monitor started (pid $$, every ${INTERVAL}s, recovery after ${RED_AFTER_S}s red)"
while true; do
  started="$(now)"
  pass
  left=$(( INTERVAL - ($(now) - started) ))
  [ "$left" -gt 10 ] || left=10
  sleep "$left"
done
