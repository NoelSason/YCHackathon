# Match-3 integration

This directory contains the match-3 agent skill and the integration contract notes for the
platform. It does not contain a game implementation yet.

## Adapter contract

The game adapter is the single source of truth for the level schema and game rules. The browser
game and the headless solver must use the same rule implementation. The platform's shared adapter
contract, described in the root `README.md`, requires:

- A JSON Schema for a level, used for structured generation and validation.
- `validate(level)` returning validity and a useful reason on failure.
- `simulate(level, bot, seed)` running without a browser and returning the outcome and moves used.
- Loading a saved level by URL and emitting attempt, win, quit, and moves-used events.
- This directory's `SKILL.md`, attached to the Designer and Tuner as the match-3 Naïve skill.

The skill consumes the schema and tool interfaces provided by the running integration; it does
not define a parallel wire format. Implement the schema and game-specific rules alongside the
game adapter, then update the skill examples and contract notes to match that implementation.

## Editor reference

The requested [CandyCrushLevelEditor](https://github.com/metrokitten/CandyCrushLevelEditor) is
archived. Its README describes JSON import/export, but its play workflow requires a separate
Candy Crush Web Player and Flash. It is reference material only: do not ship its editor, Flash
dependency, game assets, branding, or levels. Do not copy its editor-specific IDs into our schema.

## Naïve skill publishing

After the active schema and tools are available, publish this skill using the team-approved Naïve
CLI workflow and attach the pinned skill version to the Designer and Tuner. The repository docs
specify the slug pattern `game-<name>`; use `game-match3` for this game. Pin a version after the
adapter contract and examples are stable.
