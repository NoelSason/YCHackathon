# Turbo Lanes (`racer`)

Owner: **Pinara** (game 5). It's a lane racer with our own name and look. You steer between lanes
to dodge traffic and cones, hit boost pads, and beat the clock. The rules run in **fixed ticks**,
so an **exact solver** can find the fastest possible finish, and the browser only animates between
ticks.

## Run it

```bash
cd games/racer
npm install
npm run dev        # builds and serves at http://localhost:5173/?sample=1
npm test           # rules, solver, bots, the adapter contract, and a run through solver/src/run.ts
npm run typecheck
npm run build      # static site in dist/
```

### URL options

| Option | What it does |
|---|---|
| `?level=<id>` | Plays a platform level and sends events. Needs `GET /levels/:id`; see below. |
| `?sample=1..4` | Practice tracks. No events. |
| `?data=<base64url JSON>` | Plays an inline track. No events. |
| `?autoplay=1` | Drives the solver's fastest run. |
| `?api=<url>` | Overrides the platform URL. |

**Controls:** the ◀ ▶ buttons, a swipe or tap on the road, or the arrow keys or A/D.

## What's inside

| File | What it is |
|---|---|
| `src/engine.ts` | `step()` (one tick of the rules), the level JSON Schema, and `validateLevel` |
| `src/solver.ts` | Breadth-first search over car states, one tick per layer, for the fastest finish. It runs in about 1 ms on the samples. |
| `src/bots.ts` | `human`, the reference bot: its lookahead shrinks and its reactions get later as speed rises, and it sometimes misses an obstacle. Also `greedy` (2 rows ahead, no mistakes) and `random`. The bots plan with memoized dynamic programming. |
| `src/levels.ts` | 4 practice tracks and a seeded generator |
| `adapter/index.ts` | The platform adapter (`platform/CONTRACTS.md` §1) |
| `ui/main.ts`, `public/` | The phone game |
| `SKILL.md` | The Naïve skill for the Designer and Tuner |

## What the solver harness gets

- **Per bot:** `wins`, `win_rate`, and `avg_moves` (ticks used). Crashes and coins are in each
  run's `detail`.
- **From `solve`:**
  - `solvable`: whether the fastest finish is within `time_limit`.
  - `min_moves`: the fastest finish in ticks.
  - `inputs`: the steering for that run.

Measured on "Rush Hour" (fastest finish 82 ticks), the human bot's win rate by `time_limit`:

| `time_limit` | 82 | 87 | 92 | 97 | 102 |
|---|---|---|---|---|---|
| Human win rate | 2% | 9% | 47% | 80% | 97% |

At a fixed slack, raising `speed` from 5 to 14 dropped it from 71% to 13%. 200 games for each of
the 3 bots take under half a second.

## Connecting it to the platform (not done yet: Abhinav's and Max's areas)

1. **Register the adapter** in `platform/mcp/src/adapters.ts`:
   ```ts
   import racer from "../../../games/racer/adapter/index.js";
   registry.set(racer.game_id, racer);
   ```
2. **Add the game row:**
   ```sql
   insert into games(game_id, name, bots, default_win_rate)
   values ('racer', 'Turbo Lanes', '["human","greedy","random"]', 0.40)
   on conflict do nothing;
   ```
3. **Add the public `GET /levels/:id` route,** returning `{ level_id, game_id, level }`. It's the
   same route Splash Sort needs.
4. **Push the skill** (`naive skill push --slug game-racer`) and attach it to the Designer and
   Tuner.
5. **Host `dist/`** at `${GAMES_BASE_URL}/racer/`.

## Phone playtests

- **Use autoplay or a CDP replay.** Network taps from a cloud phone arrive too late for a real-time
  racer. Use `?autoplay=1`, or the `window.turboLanes` hooks (`state()`, `start()`, `steer(dir)`,
  `restart()`, `autoplay()`) over Chrome DevTools, and check that the track loads, renders, and
  finishes the way the solver expects.
- **Events:** only `?level=<uuid>` plays send `attempt`, `win`, `loss`, and `quit`.
