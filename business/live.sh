#!/usr/bin/env bash
# Run the business server on this laptop with a public URL, for the live demo and the overnight run.
#
#   business/live.sh            start the server and a Cloudflare quick tunnel, and write the URLs into .env
#
# Why the laptop: Research calls the Monid CLI, and drafts live in memory, so neither works in a serverless
# function. Keep this running (and the laptop awake: `caffeinate` is started for you) through the demo.
# A quick tunnel's URL changes every restart; this script rewrites DEMO_JOIN_URL / BUSINESS_MCP_URL /
# PUBLIC_BASE_URL in the repo's .env each time, so restart ./demo.sh after restarting this.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
PORT="${PORT:-8787}"
LOG_DIR="${TMPDIR:-/tmp}/levelai-live"
mkdir -p "$LOG_DIR"

command -v cloudflared >/dev/null || { echo "Install cloudflared first: brew install cloudflared" >&2; exit 1; }
[ -d node_modules ] || npm install --silent --no-audit --no-fund

set_env() { # set_env KEY VALUE: replace or append KEY in the repo's .env
  local key="$1" val="$2" file="$ROOT/.env"
  if grep -q "^${key}=" "$file"; then
    /usr/bin/sed -i '' "s|^${key}=.*|${key}=${val}|" "$file"
  else
    printf '%s=%s\n' "$key" "$val" >> "$file"
  fi
}

echo "Starting the tunnel..."
cloudflared tunnel --no-autoupdate --url "http://localhost:${PORT}" > "$LOG_DIR/tunnel.log" 2>&1 &
TUNNEL_PID=$!
URL=""
for _ in $(seq 1 60); do
  URL="$(grep -aoE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/tunnel.log" | head -1 || true)"
  [ -n "$URL" ] && break
  sleep 1
done
[ -n "$URL" ] || { echo "The tunnel didn't start. See $LOG_DIR/tunnel.log" >&2; kill "$TUNNEL_PID"; exit 1; }

# Permanent public addresses: levelai.vercel.app forwards the live pages to this tunnel, so links in
# emails, posts, QR codes, and the agents' tool address (/mcp, stored once in Naïve's vault) keep
# working across restarts.
SITE="${SITE_URL:-https://levelai.vercel.app}"
cat > "$ROOT/site/vercel.json" <<JSON
{
  "rewrites": [
    { "source": "/join", "destination": "$URL/join" },
    { "source": "/leads", "destination": "$URL/leads" },
    { "source": "/playtest", "destination": "$URL/playtest" },
    { "source": "/playtest-orders", "destination": "$URL/playtest-orders" },
    { "source": "/webhooks/:path*", "destination": "$URL/webhooks/:path*" },
    { "source": "/mcp", "destination": "$URL/mcp" }
  ]
}
JSON
if command -v vercel >/dev/null && [ -d "$ROOT/site/.vercel" ]; then
  echo "Pointing $SITE/join and /playtest at this tunnel..."
  (cd "$ROOT/site" && vercel deploy --prod --yes > "$LOG_DIR/site-deploy.log" 2>&1) && PUBLIC="$SITE" || { echo "Site update failed; using the tunnel URL. See $LOG_DIR/site-deploy.log"; PUBLIC="$URL"; }
else
  PUBLIC="$URL"
fi

set_env PUBLIC_BASE_URL "$PUBLIC"
set_env DEMO_JOIN_URL "$PUBLIC/join"
set_env BUSINESS_MCP_URL "$PUBLIC/mcp"
if ! grep -q "^BUSINESS_MCP_TOKEN=." "$ROOT/.env"; then set_env BUSINESS_MCP_TOKEN "$(openssl rand -hex 24)"; fi

caffeinate -dimsu -w $$ &
trap 'kill "$TUNNEL_PID" 2>/dev/null || true' EXIT

echo ""
echo "  Signup page:  $PUBLIC/join"
echo "  Playtests:    $PUBLIC/playtest"
echo "  Tunnel:       $URL"
echo "  Agent tools:  $PUBLIC/mcp"
echo "  Health:       $URL/health"
echo ""
echo "  Written to .env as DEMO_JOIN_URL, BUSINESS_MCP_URL, and PUBLIC_BASE_URL. Restart ./demo.sh to show the QR."
echo ""
set -a; . "$ROOT/.env"; set +a
PORT="$PORT" exec npx --no-install tsx src/server.ts
