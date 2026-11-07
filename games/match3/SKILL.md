# Match-3 Level Design

Use this skill when creating, reviewing, or tuning a level for the studio's match-3 game.
The level JSON Schema and adapter tools supplied with the task are authoritative. Produce only
level data accepted by that schema; do not invent fields, mechanics, colors, or tool calls.

## Goal

Make an original, playable level that meets the requested objective and target difficulty. The
game's adapter owns the rules. The same adapter must validate and simulate levels used by the
solver and by the browser game.

## Workflow

1. Read the requested objective, target difficulty, constraints, and the active level schema.
2. Design a compact board whose layout supports the objective. Use only tiles, colors, blockers,
   goals, and limits present in the schema.
3. Return one complete level object matching the schema. Keep the design new; do not reproduce a
   commercial game's level, board, name, art, characters, or text.
4. Call `validate_level` on the level. If it fails, fix the reported issue and validate again.
5. Call `solve_level` to run the configured bot simulations. Match the requested target using the
   measured win rate and other metrics returned by the tool. Do not claim a level is tuned based
   on visual inspection or an unrun simulation.
6. If the level misses its target, make a small, explainable change to the move limit or layout,
   then validate and simulate again. Follow the task's retry limit; do not keep tuning indefinitely.
7. Save only a validated level with its measured result and a short rationale. Report failure
   honestly if the target cannot be reached within the allowed attempts.

## Design guidance

- Make the objective understandable from the board and goal definition.
- Use blockers to shape routes and choices, not to make the goal unreachable.
- Preserve enough legal moves for the player to make progress. Avoid layouts that depend on one
  lucky opening unless the task explicitly requests high variance.
- Difficulty is empirical. Use the adapter's bot results, seed information, and requested target;
  do not label a level easy or hard from blocker count alone.
- Keep tuning interpretable: change one meaningful factor at a time when possible, so the result
  can be attributed to that change.
- Do not import editor-specific element IDs or mechanics unless the active game schema explicitly
  supports an equivalent mechanic.

## Example design briefs

These are intent examples, not level JSON. The active schema determines the exact output shape.

### Clear a marked area

Create a small, open board with the requested clear-area objective. Place a modest blocker band
near—but not across—the useful routes, leaving multiple ways to form matches. Simulate it and
adjust the requested move limit or blocker placement until the measured win rate reaches the
task's target.

### Collect a color under a move limit

Create a board with the requested color-collection goal and a move limit supplied by the task.
Keep the collection color available in reachable columns, while using a few blockers to make
players choose between immediate matches and progress toward the goal. Validate reachability and
use simulation results to tune difficulty.

## Completion report

Return the saved level identifier, validation result, requested target, measured simulation
metrics (including run count and seed details when provided), tuning changes, and any unresolved
limitations. Never fabricate metrics or state that a level passed if the adapter did not confirm it.
