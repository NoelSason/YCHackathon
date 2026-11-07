# Game Skill Router

Use this skill before designing or editing a level. Start with the user's requested game and goal,
then read the route packet produced by `games/skill_router.py` using `games/skill-routing.json`.

## Routing procedure

1. Select a configured game ID that matches the user's game. If none matches, stop and identify
   the missing adapter/skill instead of borrowing another game's rules.
2. Read the route packet's stages in order. Present the high-level route first: design approach,
   evaluation method, implementation interface, and verification limits.
3. Read the domain skill listed for the design stage. Use it to turn the goal into a concrete level
   specification and constraints.
4. Read the evaluation skill and interface entry. Use only declared operations that are actually
   available in the current agent runtime. Do not treat a planned interface as a working tool.
5. Read the common implementation skill and the game-specific implementation skill. Apply the
   resulting level design through the configured programmatic adapter or editor workflow.
6. Verify through the configured method. Report what was measured, what was only visually checked,
   and what remains unverified. Publishing is a separate action and is never implied by this route.

The config interpreter prepares a skill and capability packet; it does not execute tools, call
Mobilerun, or claim that a level has been saved.
