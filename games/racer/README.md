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

**Controls:** the ◀ ▶ buttons, a swipe or tap on the road, or the arrow keys or A/D. One lane per
press or gesture.

**Rules and sizes:** `RULES.md` lists the genre conventions the game follows, with sources. Every
vehicle is 2 rows long and the same size on screen; sprite sizes come from `GEOMETRY` in
`src/engine.ts`, so what you see is what collides.

## What's inside

| File | What it is |
|---|---|
| `src/engine.ts` | `step()` (one tick of the rules), the shared sprite geometry, the level JSON Schema, and `validateLevel` |
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

Historical baseline before oil/shields changed the generated samples; remeasure current content.
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

## Visuals and LevelOps mechanics

The mobile and desktop client uses original CSS vehicles and midnight motorsport scenery.
The mission panel shows the finish distance and clock limit; the HUD shows route progress,
active boost, shield, coins, and crashes. Arrow keys, touch buttons, and swipes steer.

LevelOps uses the existing registered adapter and JSON Schema, with two additive object kinds:
- `oil`: a hazard with the same crash penalty as a cone.
- `shield`: collect to absorb one hazard without a crash or boost loss. Does not stack.

Existing level JSON remains valid. The exact solver includes shield state; bots use the same
engine as the browser. Coins remain optional score, not a hidden win requirement.
The generated practice tracks now include oil and shields; prior difficulty figures require
remeasurement. `SKILL.md` documents the authoring rules.

Hosting and the platform runtime must be redeployed by Max and Abhinav to expose these changes
on a live LevelOps deployment. Local builds alone do not update the hosted service.
