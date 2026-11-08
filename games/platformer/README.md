# Mosslight Trails (`platformer`)

An original grid-step trail game, now with a mobile/desktop browser client. It uses the original
adapter's exact movement model; it is not a physics simulation or a fork of a commercial game.
No ROMs, Nintendo assets, copied levels, music, or third-party character art are used. Forest
scenery and the guide character are original CSS.

- `src/engine.ts`: the existing schema, validation, legal landings and exact route search, extracted
  without changing their semantics from `adapter/index.ts`. Browser, bots and adapter import it.
- `src/levels.ts`: five authored practice trails and a deterministic terrain builder.
- `ui/main.ts`, `public/`: keyboard/touch client, live levels/packs, player events and solver replay.
- `adapter/index.ts`: existing bots and platform contract, now linked to `/games/platformer/`.
- `/platformer/` remains a query-preserving redirect for older adapter links.

## Play and build

```sh
npm ci
npm run dev       # localhost:5190
npm run typecheck
npm test
npm run build     # dist/; serve at /games/platformer/
```

`?level=<uuid>` loads live level JSON from the platform. `?pack=<uuid>` loads the published pack
from the site's `/api/packs` endpoint. With no options it tries the live playlist, then explicitly
labels a practice fallback if the service is unavailable. `?sample=1..5` chooses authored practice.
`?autoplay=1` replays the exact route for QA; it is an engine demonstration, not a human playtest.

## Rules and controls

Each move advances one column left or right, onto a legal landing supported by `#`. The rise and
drop obey `jump_height` and `fall_limit`. The existing model checks landing cells, not a continuous
jump arc or head collision; thorns (`^`) are blocked landings. Tap a glowing landing for precise
branch selection; arrows/left-right buttons choose the closest landing in that direction. Up/down
cycles targets; Enter confirms. A guide hint reveals one safe step. Restart is R or the button.
Reach G to win; fireflies C are optional and are only counted once on revisits. Practice does not
send player telemetry. Live first moves send attempts, wins send results, and leaving open runs
sends quits with the existing event contract.

## Quality limits

The greedy bot follows the exact route and wins whenever `move_limit` allows it; its rate is a
reference-route check, not a calibrated human difficulty claim. Tuned difficulty uses the `human` bot
(see "Level production" below), and it is still a bot model, not measured human play. The random bot also uses the shared
legal-landings function. Route length and jump/drop limits can describe a trail, but must not be
presented as measured human difficulty. Production publication needs actual bot/solver evidence;
no level is labeled agent-authored if a human integration run created it.

## Production rollout

The hosting bundle is checked in at `site/games/platformer/`; the games hub includes the fifth
card. The existing site's deployment owner can finish the rollout from their authenticated clone:

```sh
bash site/deploy-platformer.sh
```

This uses the existing Vercel project link and untracked live API rewrite config, builds the game,
deploys the site, verifies that the actual production route/client are present, then publishes the
five verified opening levels. It refuses to create/relink a project or deploy without the existing
rewrite config. Runtime `.env` keys stay server-side and are never copied into the browser bundle.

`cd solver && npm run publish:platformer` stages the five levels as **drafts**, with 200 games each
of `greedy` and `random` plus exact proof. `npm run publish:platformer -- --publish` refuses to
publish if `/games/platformer/` or its real JS client is not live. Until deployment is verified,
the new client must be described as ready for deployment, not already playable in production.

## Level production (added Nov 7, 23:45)

- **`move_limit`** (optional, 1–500, never below the shortest route): running out of steps before
  the gate loses the trail. Trails without it, like the five practice trails, can't be lost, as
  before.
- **`human` bot** (the reference for tuning): it follows the shortest route from wherever it
  stands, but at a fork it sometimes lands on a wrong ledge (12–18%, more with lower jumps), then
  re-plans. A wrong one-way drop can cost a long detour. Its win rate rises smoothly with
  `move_limit`. `greedy` and `random` now respect `move_limit`.
- **`src/generate.ts`**: seeded `generateTrail({ seed, difficulty })`. Notch 1 is the easiest, 12
  the top: longer and rougher trails, lower jumps, more ledges and forks, one-way drops, and thorns
  that force the ledge route. Every trail is checked with the shared rules before it's returned.
- **Production:** `solver/src/production` makes the verified series `Trail 0001` … with the tuned
  `move_limit`. The page plays it in order after the practice trails, with a level badge
  ("LEVEL 12 · VERIFIED · YOU", or "· ENGINE" in autoplay).

