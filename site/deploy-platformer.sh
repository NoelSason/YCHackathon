#!/usr/bin/env bash
# Run from the teammate's existing logged-in clone. Never creates/relinks the production project.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
command -v vercel >/dev/null || { echo 'Vercel CLI is required on the account that owns levelai.vercel.app.' >&2; exit 1; }
[ -d "$ROOT/site/.vercel" ] || { echo 'Existing site/.vercel project link is missing; deployment was not attempted.' >&2; exit 1; }
[ -f "$ROOT/site/vercel.json" ] || { echo 'Existing production API rewrite config is missing; deployment was not attempted.' >&2; exit 1; }
# Preserve the deployment owner’s untracked live API rewrites.
bash "$ROOT/site/build-games.sh" platformer
(cd "$ROOT/site" && vercel deploy --prod --yes)
[ -d "$ROOT/solver/node_modules" ] || (cd "$ROOT/solver" && npm ci --no-audit --no-fund)
launch_env=()
for env_file in "$ROOT/solver/.env" "$ROOT/.env"; do
  [ ! -f "$env_file" ] || launch_env+=("--env-file=$env_file")
done
node "${launch_env[@]}" --import "$ROOT/solver/node_modules/tsx/dist/loader.mjs" "$ROOT/solver/src/production/bootstrap-platformer.ts" --publish
printf '\nMosslight Trails deployed and opening pack published: https://levelai.vercel.app/games/platformer/\n'
