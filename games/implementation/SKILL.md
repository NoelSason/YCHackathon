# Level Implementation

Use this skill after the game-specific design and evaluation stages have produced a concrete level
specification. This skill creates or revises the level in the selected game; it does not invent the
game's rules or replace its domain skill.

## Procedure

1. Read the route packet's configured implementation skill and interface. Confirm the required
   adapter tools or user-provided editor environment are available.
2. For a programmatic interface, use only its configured operations and the game's adapter as the
   source of truth. Validate before saving. Stop if the adapter or a required operation is absent.
3. For an editor interface, follow the game-specific skill and use its save workflow. Use only a
   user-authorized environment/device and create a new local draft unless the user requested a
   specific revision.
4. Do not duplicate game rules, guess undocumented formats, modify unrelated levels, or upload,
   share, publish, or otherwise create external side effects unless separately requested.
5. Return the artifact ID/location, implementation method, validation evidence, and any action
   that could not be completed.
