# Splash Sort level design

Use this skill to create, review, or tune a level for Splash Sort (`game_id: "watersort"`), our
water-sort puzzle. The adapter (`games/watersort/adapter/index.ts`) is the source of truth; this
page explains it for an agent.

## The rules

- A level is a row of tubes. Each tube holds up to `capacity` units of colored liquid, listed
  **bottom to top**.
- A pour takes the top run of one color from a tube and puts as much of it as fits onto another
  tube that is **empty** or whose **top color matches**.
- A tube full of one color is finished and sealed. Nothing pours out of it.
- The level is solved when every tube is empty or full of one color.
- The player has `move_limit` pours. Running out is a loss, and so is a board with no legal pour
  left. Players get 3 undos and 3 hints, but bot win rates measure play without them.
- Full rules and sources: `games/watersort/RULES.md`.

## Level JSON

```json
{
  "title": "Three Tides",
  "capacity": 4,
  "move_limit": 20,
  "tubes": [
    ["yellow", "teal", "pink", "teal"],
    ["pink", "yellow", "teal", "yellow"],
    ["teal", "pink", "yellow", "pink"],
    [],
    []
  ]
}
```

- `capacity`: 2 to 5 (4 is standard).
- Colors: `red, orange, yellow, lime, green, teal, sky, blue, purple, pink, brown, gray`. Use 2 to 9
  of them.
- **Every color appears exactly `capacity` times.**
- Tubes: one or two more than the number of colors. The extra tubes are usually empty.
- `move_limit`: 1 to 300.
- `title`: optional, up to 40 characters.
- No other fields. The level must not start solved.

## How difficulty works

The Tuner measures difficulty; never guess it from the layout. The solver harness reports:

- **Bot win rates.** `human` is the reference bot: it plans one pour ahead, but wastes about 3
  pours in 10, as people do, and sometimes gets stuck. `greedy` and `random` run too, each played
  200+ times.
- **`solvable` and `min_moves`.** An exact search proves whether the level can be solved within
  `move_limit`, and the fewest pours needed.

Knobs, strongest first. These were measured on our generated levels:

1. **`move_limit` relative to `min_moves`.** On "Deep End" (7 colors, minimum 23 pours), the
   human bot's win rate was:

   | `move_limit` | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 |
   |---|---|---|---|---|---|---|---|---|---|
   | Human win rate | 1% | 4% | 13% | 27% | 46% | 60% | 74% | 82% | 87% |

   **Each extra pour moves the win rate about 15 to 19 points,** so tune `move_limit` one pour at a
   time. If the target falls between two pours, accept the closer one only if it's within 5
   points; otherwise change the layout (below) and tune again.
2. **Number of colors.** More colors mean more pours:

   | Colors | 5 | 7 | 9 |
   |---|---|---|---|
   | `min_moves` | about 14 | about 23 | 27 to 31 |

3. **Spare tubes.** With one spare tube, most random deals are unsolvable. Use two unless you're
   checking a one-spare level with the solver.
4. **Mixing.** Tubes with many color changes, and colors buried at the bottom, are harder than
   tubes that are already nearly sorted.

## Workflow

1. Write the level JSON. Shuffle colors across tubes. Keep each color's count exactly `capacity`.
2. Call `validate_level` with `game_id: "watersort"`, and fix every error it reports.
3. Call `save_level` with the target win rate.
4. The Tuner calls `solve_level`, then reads `get_solver_run`.
   - If `solvable` is false, the move limit is below `min_moves`, or the deal can't be solved at all.
     Raise `move_limit` to at least `min_moves`, or add a spare tube.
   - Otherwise, adjust `move_limit` toward the target.

## Rules for originality

Every level is new. Never copy another game's levels, names, art, or text. The colors are plain
names; the game draws them in its own style.
