# Crate Grove Level Design

Design original compact warehouse puzzles for `crategrove`. The adapter schema and the shared
engine in `src/engine.ts` define the rules; never invent a tile or movement rule.

## Level data

Each level has a title, a rectangular `map`, and a `move_limit`. Tiles are `#` wall, `.` floor,
`S` player, `B` crate, `G` lantern goal, `*` crate already on a goal, and `+` player on a goal.
Maps are 5-16 cells in each dimension, with 1-3 crates and the same number of goals.

## Design and verification

- Make every map original. Use a readable route and at least one meaningful crate push.
- Call `validate_level` before saving. Validation checks reachability and enforces that the
  shortest solution fits inside `move_limit`.
- Use `solve_level` for the minimum move count. This proves a route exists; it does not measure
  human difficulty.
- Run seeded simulations with the listed bots. The `human` bot follows a shortest path but can
  make seeded wrong moves; `solver` is exact and `random` wanders. Report each separately and never
  present the exact solver's success rate as a human win rate.
- Save drafts only after validation. A saved level is not accepted until the Tuner reviews the
  measured outcomes.
