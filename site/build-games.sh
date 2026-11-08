#!/usr/bin/env bash
# Rebuilds every browser game into site/games/<id>/ so the site serves it at /games/<id>/.
# Rerun after a teammate changes a game, then deploy the site.
#
#   ./site/build-games.sh            # all games
#   ./site/build-games.sh racer      # one game
#
# Each game builds with its own `npm run build` (games/<id>/build.mjs) into games/<id>/dist/.
# This script copies that bundle and adds <base href="/games/<id>/"> so the relative asset paths
# work whether the page is opened as /games/<id> or /games/<id>/. Game code isn't changed.
#
# It also writes site/games/published.json: which games the site's public level API
# (/levels-latest?game=<id>) answers for. The /games hub only asks the API about those games, so
# visitors don't see failed requests for games the API doesn't serve yet.
#
# The hub page (site/games/index.html) and its card images (site/games/thumbs/) are static files;
# this script leaves them alone. Retake a thumbnail by screenshotting the game's board.
#
# match3 isn't built here: its web player is site/play.html (built from player/), at /play.
# platformer has no browser game yet, and games/editors/ is an editor workflow, not a game.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/site/games"
SITE_URL="${SITE_URL:-https://levelai.vercel.app}"
# Where the games send player events and load ?level=<id> from: the platform's public API.
export PLATFORM_URL="${PLATFORM_URL:-https://br-broad-violet-bem8cpy5-platform.compute.c-9.us-east-2.aws.neon.tech}"

ALL_GAMES=(watersort racer lotescape)
GAMES=("${@:-${ALL_GAMES[@]}}")

mkdir -p "$OUT"
for id in "${GAMES[@]}"; do
  dir="$ROOT/games/$id"
  [ -f "$dir/build.mjs" ] || { echo "skip $id: no build.mjs" >&2; continue; }
  echo "== $id"
  (cd "$dir" && { [ -d node_modules ] || npm ci --no-audit --no-fund --silent; } && npm run --silent build)
  rm -rf "$OUT/$id"
  mkdir -p "$OUT/$id"
  cp -R "$dir/dist/." "$OUT/$id/"
  # Keep any license or credit files that ship with the game.
  for f in "$dir"/LICENSE* "$dir"/CREDITS* "$dir"/NOTICE*; do [ -f "$f" ] && cp "$f" "$OUT/$id/"; done
  node -e '
    const fs = require("fs");
    const [file, id] = process.argv.slice(1);
    let html = fs.readFileSync(file, "utf8");
    // The site icon too, so browsers do not ask for a missing /favicon.ico.
    const icon = `<link rel="icon" type="image/svg+xml" href="/logo.svg">`;
    if (!html.includes("<base ")) html = html.replace(/<head>/i, `<head>\n<base href="/games/${id}/">` + (html.includes('rel="icon"') ? "" : `\n${icon}`));
    fs.writeFileSync(file, html);
  ' "$OUT/$id/index.html" "$id"
done

# Which games the public level API serves (HTTP 200). Probe failures count as "not served".
node -e '
  const [site, out, ...ids] = process.argv.slice(1);
  (async () => {
    const result = {};
    for (const id of ["match3", ...ids]) {
      try {
        const r = await fetch(`${site}/levels-latest?game=${id}&limit=1`, { signal: AbortSignal.timeout(10000) });
        result[id] = r.ok;
      } catch { result[id] = false; }
    }
    require("fs").writeFileSync(`${out}/published.json`, JSON.stringify(result, null, 2) + "\n");
    console.log("published.json", JSON.stringify(result));
  })();
' "$SITE_URL" "$OUT" "${ALL_GAMES[@]}"

echo "done: $(cd "$OUT" && ls -d */ | tr -d / | tr "\n" " ")"
