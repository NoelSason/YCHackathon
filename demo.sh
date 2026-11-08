#!/usr/bin/env bash
# Start the demo stage: one live screen that shows the company's agents working.
#
#   ./demo.sh                     live, from the activity log in Neon (the normal way)
#   ./demo.sh --replay <file>     play back a run saved with `npm --prefix demo run snapshot`
#   ./demo.sh --sample            invented data for rehearsing the layout (labeled on screen)
#   ./demo.sh --check             check the stage's setup and exit (0 = ready)
#
# Opens a full-screen Chrome window. Press F for full screen, D for setup details.
set -euo pipefail
cd "$(dirname "$0")/demo"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js isn't installed. Install Node 22 or newer, then run this again." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "First run: installing the stage's packages..."
  npm install --silent --no-audit --no-fund
fi

open_flag="--open"
for a in "$@"; do
  if [ "$a" = "--check" ] || [ "$a" = "--no-open" ]; then open_flag=""; fi
done

exec npx --no-install tsx src/server.ts $open_flag "$@"
