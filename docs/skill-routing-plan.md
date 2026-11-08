# Unified skill routing

## Goal

Give the agent one predictable workflow across game skills: choose a high-level route first, read
the selected game's skill for concrete design and solving guidance, then use a separate
implementation skill to create the level through the game's declared interface.

## Workflow

1. **Route:** `games/router/SKILL.md` selects a configured game and summarizes its domain skill,
   evaluation method, implementation interface, and evidence limits. It makes no tool calls.
2. **Design:** the agent reads the selected game skill and turns the request into a level brief.
3. **Evaluate/solve:** the agent follows that skill's solver guidance and the interface declaration
   in `games/skill-routing.json`. Programmatic tools provide measured results; mobile/editor flows
   provide only the checks they can actually perform.
4. **Implement:** `games/implementation/SKILL.md` applies the accepted design through the configured
   adapter or editor instructions. It saves a local artifact and does not publish by default.
5. **Verify:** use the same adapter for validation/simulation, or the declared editor/Mobilerun
   visual check. Report metrics only when returned by the relevant tool.

The agent owns the reasoning between stages. The interpreter only resolves configuration into an
ordered execution packet; it does not substitute for the Naïve agent runtime or execute MCP tools.

## Config and interpreter

- `games/skill-routing.json` maps task types to stage order, skills, game IDs, interface modes,
  operations, and verification limits.
- `games/skill_router.py` checks route and skill paths, resolves the selected game, and emits a
  JSON packet for the host agent. Run it from the repository root, for example:
  `python games/skill_router.py --game match3 --task create`.
- A programmatic interface lists operation names in config. The host agent must confirm those
  tools are present before calling them. An interface marked unavailable is a hard stop for
  validation, solving, or saving; the agent may still produce an explicitly unverified design.
- Editor interfaces never fall back to guessed file formats. The Geometry Dash route requires an
  attached Mobilerun MCP Agent and limits verification to local save and visual/loading checks.
- Add a new game by adding one config entry and its skills, then run the interpreter for each task
  type. Do not copy a second implementation of a game's mechanics into the router.

## Routes included

- `match3`: registered programmatic adapter route. Designer fetches the authoritative schema and
  validates/saves through MCP; the separate solver harness measures seeded bot results.
- `platformer-editor`: user-provided editor workflow; no programmatic solver is declared.
- `geometry-dash-editor`: official editor workflow via Mobilerun MCP; visual checks do not prove
  frame-exact solvability.

## Acceptance criteria

- Create/revise routes emit ordered route, design, evaluation, implementation, and verification
  stages; playtest routes omit design and implementation. All returned skill paths must exist.
- Unknown game IDs, task types, malformed config, missing skills, and paths outside the repository
  fail with a clear error.
- Programmatic operations remain data-driven and are not called by the interpreter itself.
- Missing adapters, unavailable MCP tools, and missing editor environments are reported as
  blockers; the agent never claims a save or solve result without evidence.
