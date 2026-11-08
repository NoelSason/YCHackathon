# Splash Sort (`watersort`)

Owner: **Pinara** (game 4). It's a water-sort puzzle with our own name and look. You pour colored
liquid between tubes until each tube holds one color. It's turn-based, so a cloud phone can play
it by tapping, and it has an **exact solver**, so every published level can be proven solvable
with a known minimum number of pours.

## Run it

```bash
cd games/watersort
npm install
npm run dev        # builds and serves at http://localhost:5173/?sample=1
npm test           # rules, solver, bots, the adapter contract, and a run through solver/src/run.ts
npm run typecheck
npm run build      # static site in dist/ (index.html, style.css, app.js)
```

### URL options

| Option | What it does |
|---|---|
| `?level=<id>` | Plays a platform level and sends player events. Needs the `GET /levels/:id` route below. |
| `?sample=1..4` | Built-in practice levels. No events. |
| `?data=<base64url JSON>` | Plays an inline level. No events. |
| `?autoplay=1` | Pours the solver's shortest solution, for demos and phone playtests. |
| `?api=<url>` | Overrides the platform URL. The default is set at build time with `PLATFORM_URL`. |

## What's inside

| File | What it is |
|---|---|
| `src/engine.ts` | The rules, the level JSON Schema, and `validateLevel`. Pure, so Node and the browser share it. |
| `src/solver.ts` | Breadth-first search, which gives the fewest pours. Validation bounds (up to 9 colors, up to 2 spare tubes) keep it under a second. |
| `src/bots.ts` | `human`, the reference bot: one pour of lookahead and short memory, but it wastes about 3 pours in 10 on a random legal pour, as people do. Also `greedy` and `random`. All seeded. |
| `src/levels.ts` | 4 practice levels and a seeded generator |
| `adapter/index.ts` | The platform adapter (`platform/CONTRACTS.md` §1) |
| `ui/main.ts`, `public/` | The phone game |
| `SKILL.md` | The Naïve skill for the Designer and Tuner |

## What the solver harness gets

- **Per bot:** `wins`, `win_rate`, and `avg_moves` (pours used).
- **From `solve`:**
  - `solvable`: whether it can be solved within `move_limit`.
  - `min_moves`: the fewest pours.
  - `inputs`: one shortest solution.

Measured on "Deep End" (minimum 23 pours, 400 games each), the human bot's win rate by
`move_limit`:

| `move_limit` | 23 | 25 | 27 | 29 | 31 |
|---|---|---|---|---|---|
| Human win rate | 1% | 13% | 46% | 74% | 87% |

**Each extra pour moves it about 15 to 19 points.** The first human bot played almost perfectly,
which made the curve a staircase: about 30 to 50 points per pour. The tunability eval
(`evals/`) caught that, and the ideal tuner's hits went from 4 to 8 out of 10. 200 games for each
of the 3 bots take about 0.3 s.

## Connecting it to the platform (not done yet: Abhinav's and Max's areas)

1. **Register the adapter** in `platform/mcp/src/adapters.ts`, so both the MCP server and the
   solver harness see it:
   ```ts
   import watersort from "../../../games/watersort/adapter/index.js";
   registry.set(watersort.game_id, watersort);
   ```
2. **Add the game row.** Levels reference `games(game_id)`:
   ```sql
   insert into games(game_id, name, bots, default_win_rate)
   values ('watersort', 'Splash Sort', '["human","greedy","random"]', 0.40)
   on conflict do nothing;
   ```
3. **Add a public read route** so the browser game can open `?level=<id>`:
   `GET /levels/:id` returning `{ level_id, game_id, level }`. Until it exists, the game shows a
   notice and falls back to practice levels.
4. **Push the skill** (`naive skill push --slug game-watersort`, from this `SKILL.md`) and attach it
   to the Designer and Tuner.
5. **Host `dist/`** at `${GAMES_BASE_URL}/watersort/`, which is where `level_url` points:
   `PLATFORM_URL=<platform url> npm run build`.

## Phone playtests

- **Tubes are buttons with labels,** for example "Tube 2: red, blue from bottom to top, blue on
  top, 2 free". The Mobilerun agent can read them and tap them.
- **`window.splashSort` hooks** for Playwright/CDP checks: `state()`, `pour(from, to)`, `restart()`,
  and `autoplay()`.
- **Events:** only levels opened with `?level=<uuid>` send `attempt`, `win`, `loss`, and `quit`.
  Practice play is never reported.
