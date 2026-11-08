# Lot Escape (`lotescape`)

An original lane-sliding parking puzzle. Each vehicle has a marked exit. Slide it along its fixed lane; if another car blocks the route, clear that car first. Evacuate every vehicle within the move limit. The browser and the level adapter use the same engine, and the exact solver reports the fewest car-step moves. The genre rules followed, with sources, are in [RULES.md](RULES.md).

## Play locally

```sh
cd games/lotescape
npm install
npm run dev
npm run typecheck
npm test
```

Open `http://localhost:5179/`. Drag a car along its lane, or tap it and use the arrow buttons or keyboard arrows. Each cell travelled is one move. `?demo=1` opens the second built-in lot. A saved platform level uses `?level=<uuid>`.

## Levels and endless mode

- **Built-in set:** six original lots in `src/levels.ts`, on a ramp from 26 to 53 best moves. They were made with the generator below, then checked by hand. `BUILT_IN_BEST` records each lot's solver-proven best; the tests check it, and each `move_limit` is that best plus about 20%.

  | # | Lot | Best | Limit | Back-steps | Blocking depth | Vehicles (trucks) |
  |---|---|---|---|---|---|---|
  | 1 | Maple Row | 26 | 31 | 0 | 3 | 9 (4) |
  | 2 | Juniper Wharf | 35 | 42 | 1 | 6 | 10 (4) |
  | 3 | Saffron Terrace | 38 | 46 | 2 | 5 | 10 (4) |
  | 4 | Cobalt Yard | 43 | 52 | 3 | 6 | 12 (3) |
  | 5 | Marigold Mews | 47 | 56 | 5 | 7 | 11 (6) |
  | 6 | Lantern Court | 53 | 64 | 7 | 10 | 11 (6) |

- **Endless mode:** the "Endless: generated levels" switch at the top right. Level *n* is generated in the browser at difficulty notch *n*, in a Web Worker (`ui/worker.ts`), while the previous lot is being played. The switch, the endless run, and the built-in position are kept in `localStorage` (guarded; the game works without it). Switching off returns to the built-in lot you left.

## Level generator (`src/generate.ts`)

Seeded and deterministic. It makes random lots, then hill-climbs on them (move, nudge, flip, add, or swap a vehicle), and checks every candidate with the exact solver. It returns a lot only after the solver clears it. The output is the standard level JSON, unchanged. **This export is a stable API**: other services (level packs) import it, so keep these signatures backward compatible.

```ts
import { generateLevel, rateLevel, difficultyProfile, moveLimitFor } from "games/lotescape/src/generate.js";
// also re-exported from games/lotescape/adapter/index.ts, plus generateValidLevel (generate + adapter validate)

const made = generateLevel({ seed: "pack-7", difficulty: 5 });
made.level;   // { title, size, vehicles, move_limit }: valid, solvable, move_limit = moveLimitFor(best)
made.rating;  // { min_moves, free_moves, backups, blocking_depth, blocked, vehicles, trucks, score }
made.inputs;  // the solver's shortest solution, using the level's vehicle ids
made.stopped; // "target" (landed in the notch's score band) | "budget" | "time" (closest lot found)
```

- `GenerateOptions`: `seed` (number or string), `difficulty` (integer notch, 1 and up), optional `title`, `maxAttempts` (default 4000, deterministic), `timeLimitMs` (default 8000, a wall-clock backstop). The same seed and difficulty give the same level unless the time backstop fires; `stopped: "time"` says when it did.
- Difficulty: `rating.score = 8 × backups + 2 × min(blocking depth, 6) + vehicles + trucks`. `backups` counts the steps a vehicle must take away from its exit in any best solution, which is `(min_moves - free_moves) / 2`. `blocking_depth` is the longest chain where each vehicle sits on the next one's route (A waits on B waits on C is 2). Notch *d* asks for a score in `[14 + 5(d-1), 21 + 5(d-1)]`, with more vehicles and trucks as *d* rises. Notches above 12 hold the top band (score 69 and up, about 5 back-steps on 12 vehicles).
- Speed (Node, M-series Mac): notches 1–8 take milliseconds to well under a second; 9–12 usually 0.5–3 s, at most about 7 s.
- `rateLevel(level, solution?)` rates any lot (undefined if unsolvable). `moveLimitFor(best)` is best + max(2, round(20%)).

## Adapter

`adapter/index.ts` exports the platform `Adapter`: schema, overlap and solvability validation, exact solve, seeded simulation, and URL loading. The game ID is `lotescape`. Browser events use the standard `/events` contract when `PLATFORM_URL` is configured.

## Files

- `src/engine.ts`: shared movement rules and state, plus `slideLimit`/`slide` used by the drag and arrow controls.
- `src/solver.ts`: exact shortest-move solver (a 0-1 breadth-first search over back-steps; see RULES.md).
- `src/generate.ts`: seeded level generator and difficulty rating (stable API above).
- `src/levels.ts`: the six built-in lots and their solver-proven best move counts.
- `src/bots.ts`: seeded bots. `human` (the reference bot for tuning) follows a shortest solution but sometimes backs a car up one cell and undoes it (2 moves per mistake, more mistakes on crowded lots), so its win rate falls smoothly as `move_limit` tightens. `search` is the exact solver (always 0% or 100%), `random` slides random cars.
- `adapter/index.ts`: platform schema, validate, solve, simulate, and URL.
- `ui/worker.ts`, `ui/jobs.ts`: the Web Worker that builds endless lots and checks saved ones off the main thread.
- `ui/main.ts`, `public/`: responsive playable game, endless switch and level indicator, with original SVG car art that fills each vehicle's cells, per-vehicle exit gates, and system fonts (no web-font download).
- `SKILL.md`: Designer/Tuner level authoring guidance.
- `RULES.md`: the reference rules and where Lot Escape departs from them.
- `test/lotescape.test.ts`: rule, solver, and adapter tests. `test/generate.test.ts`: solver vs. a plain breadth-first search, the built-in ramp, and generator determinism, validity, and difficulty (`npm test`).
