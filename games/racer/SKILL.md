# Turbo Lanes level design

Use this skill to create, review, or tune a track for Turbo Lanes (`game_id: "racer"`), our lane
racer. The adapter (`games/racer/adapter/index.ts`) is the source of truth; this page explains it
for an agent.

## The rules

- The track is a grid: `lanes` across (3 to 5) and `length` rows long.
- The car starts at row 0, in the middle lane unless `start_lane` is set.
- **Movement:** the car moves one row per tick, or two rows per tick while boosted.
- **Steering:** each tick the driver may steer one lane left or right. After steering, they must
  wait `lane_change_cooldown` ticks before steering again.
- **Objects:**
  - `car` or `cone`: driving into one is a **crash**, and the car stops for `crash_penalty` ticks.
  - `boost`: double speed for 4 ticks.
  - `coin`: points only.
- **Winning:** cross row `length` within `time_limit` ticks. On screen, one tick lasts
  `1 / speed` seconds.

## Level JSON

```json
{
  "title": "Rush Hour",
  "lanes": 3,
  "length": 90,
  "speed": 8,
  "time_limit": 96,
  "crash_penalty": 3,
  "lane_change_cooldown": 0,
  "objects": [
    { "row": 6, "lane": 0, "kind": "car" },
    { "row": 6, "lane": 2, "kind": "cone" },
    { "row": 9, "lane": 1, "kind": "boost" },
    { "row": 14, "lane": 2, "kind": "coin" }
  ]
}
```

| Field | Range |
|---|---|
| `lanes` | 3 to 5 |
| `length` | 20 to 400 rows |
| `speed` | 4 to 16 rows per second (how fast it feels) |
| `time_limit` | 1 to 1000 ticks |
| `crash_penalty` | 1 to 10 |
| `lane_change_cooldown` | 0 to 3 |
| Objects | Up to 600 |

- Objects: `row` from 1 to `length - 1`, `lane` from 0 to `lanes - 1`, and `kind` one of `car`,
  `cone`, `boost`, `coin`. No two objects share a cell.
- Fields: `start_lane` and `title` are optional. No other fields.

## How difficulty works

The Tuner measures difficulty; never guess it from the layout. The solver harness reports:

- **Bot win rates.**
  - `human` is the reference bot. It looks fewer rows ahead and reacts later as `speed` rises, and
    sometimes misses an obstacle.
  - `greedy` looks only 2 rows ahead but never makes mistakes.
  - `random` steers at random.
- **`solvable` and `min_moves`.** An exact search finds the fastest possible finish in ticks
  (`min_moves`). The track is `solvable` if that finish beats `time_limit`.

Knobs, strongest first. These were measured on our sample tracks:

1. **`time_limit` relative to `min_moves`.** On "Rush Hour" (minimum 82 ticks), the human bot's win
   rate was:

   | `time_limit` | 82 | 87 | 92 | 97 | 102 |
   |---|---|---|---|---|---|
   | Human win rate | about 2% | about 9% | about 47% | about 80% | about 97% |

2. **`speed`.** At the same slack (minimum + 10 ticks), the human bot's win rate was:

   | `speed` | 5 | 8 | 11 | 14 |
   |---|---|---|---|---|
   | Human win rate | about 71% | about 47% | about 26% | about 13% |

3. **Obstacle density and patterns.** Rows where only one lane is open, and walls a few rows apart
   that need quick double steers, are hard. Cooldown 1 or more makes double steers much harder.
4. **Boosts.** They cut the fastest time. A boost right before an obstacle tempts a crash.

Always leave at least one open lane in a row unless a forced crash is the point (the solver counts
crashes). A full wall costs `crash_penalty` ticks for everyone.

## Workflow

1. Write the track JSON. Space obstacles so a person can read them: at higher `speed`, use bigger
   gaps between walls.
2. Call `validate_level` with `game_id: "racer"`, and fix every error it reports.
3. Call `save_level` with the target win rate.
4. The Tuner calls `solve_level` and reads `get_solver_run`.
   - If `solvable` is false, raise `time_limit` to at least `min_moves`.
   - Otherwise, adjust `time_limit` first, then `speed`.

## Rules for originality

Every track is new. Never copy another game's tracks, names, cars, or art.
