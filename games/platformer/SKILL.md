# Mosslight Trails Platformer Levels

Use this skill to design original levels for the studio's platformer adapter. The adapter schema
and rules are authoritative; do not invent tile symbols, fields, or movement rules.

## Rules and workflow

- Use only original names and layouts. Do not recreate Mario levels, characters, art, music, or
  other Nintendo content.
- Allowed map symbols are `#` (solid), `.` (empty), `^` (hazard), `C` (collectible), `S` (start),
  and `G` (goal). Rows must have equal width.
- Set `jump_height` and `fall_limit` to control reachable vertical changes.
- Produce a complete level object matching the active schema. Call `validate_level`, then
  `solve_level`; a reachable route does not establish that hazards are fair or difficulty is
  calibrated.
- Use configured bot simulations to measure difficulty. Make small, explainable changes, then
  validate and simulate again. Save only a valid level.

## Completion report

Report the level ID, validation and solver output, bot metrics, and any playtest performed. Do not
infer a human difficulty score from route length alone. The browser client now shares `src/engine.ts`
with the adapter, at `/games/platformer/`; distinguish local checks from verified live deployment.
The greedy bot is an exact-route reference and wins whenever `move_limit` allows the shortest route. The `human` bot is the difficulty reference: it follows the shortest route but sometimes lands on a wrong ledge at a fork and re-plans, so its win rate rises smoothly with `move_limit` (an optional step budget; running out loses the trail).
