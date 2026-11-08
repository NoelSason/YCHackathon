#!/usr/bin/env bash
# Put the demo console (./demo.sh on :4545) on a public, password-protected address:
#   https://levelai-console.vercel.app  →  a Cloudflare quick tunnel  →  localhost:4545
# The password is DEMO_PASSWORD in the repo's .env (generated on first run; any username works).
# Run it after ./demo.sh is up. Re-run it whenever the tunnel or laptop restarts.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
PORT="${DEMO_PORT:-4545}"
LOG_DIR="${TMPDIR:-/tmp}/levelai-console"
mkdir -p "$LOG_DIR"

set_env() { local key="$1" val="$2" file="$ROOT/.env"
  if grep -q "^${key}=" "$file"; then /usr/bin/sed -i '' "s|^${key}=.*|${key}=${val}|" "$file"; else printf '%s=%s\n' "$key" "$val" >> "$file"; fi; }

grep -q "^DEMO_PASSWORD=." "$ROOT/.env" || set_env DEMO_PASSWORD "$(openssl rand -base64 12 | tr -dc 'A-Za-z0-9' | head -c 14)"
curl -s -o /dev/null -m 5 "http://localhost:${PORT}/" || { echo "Start the console first: ./demo.sh (it must be running with DEMO_PASSWORD set)" >&2; exit 1; }

pkill -f "cloudflared tunnel --no-autoupdate --url http://localhost:${PORT}" 2>/dev/null || true
cloudflared tunnel --no-autoupdate --url "http://localhost:${PORT}" > "$LOG_DIR/tunnel.log" 2>&1 &
URL=""
for _ in $(seq 1 60); do
  URL="$(grep -aoE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/tunnel.log" | grep -v '://api\.trycloudflare' | head -1 || true)"
  [ -n "$URL" ] && break
  sleep 1
done
[ -n "$URL" ] || { echo "The tunnel didn't start. See $LOG_DIR/tunnel.log" >&2; exit 1; }

cat > console-site/vercel.json <<JSON
{ "rewrites": [ { "source": "/", "destination": "$URL/" }, { "source": "/:path*", "destination": "$URL/:path*" } ] }
JSON
(cd console-site && vercel deploy --prod --yes --name levelai-console > "$LOG_DIR/deploy.log" 2>&1) || { echo "Deploy failed; use the tunnel directly: $URL"; exit 1; }
set_env DEMO_CONSOLE_URL "https://levelai-console.vercel.app"
echo ""
echo "  Console:   https://levelai-console.vercel.app   (tunnel: $URL)"
echo "  Password:  in .env as DEMO_PASSWORD (any username)"
echo ""
