# Platformer Level Editor

Use this skill to plan and author original custom platformer levels with the level editor in
[Super-Mario-Bros.-Remastered-Public](https://github.com/JHDev2006/Super-Mario-Bros.-Remastered-Public).
This is an editor workflow skill only. It does not integrate the game into our platform or include
the game, its assets, or any ROM.

## Boundaries

- The game README identifies the source as GPL-3.0 and says playing requires an original SMB1 NES
  ROM. The user must provide any ROM separately. Never locate, download, copy, verify, or package a
  ROM.
- Create original level layouts and names. Do not recreate levels, maps, names, characters, art,
  music, or other expressive content from Nintendo games.
- Do not copy assets or level files from the game into this repository. Save only the custom level
  data the user explicitly asks to keep.
- Do not claim an authored level is playable or balanced until it has been loaded and playtested
  in the editor/game environment supplied by the user.

## Workflow

1. Confirm the user has the editor/game environment available. Ask them to provide or launch it if
   it is not already available; do not acquire the ROM or game build.
2. Ask for the level goal, intended difficulty, approximate length, and any mechanics or objects
   that should be included or avoided.
3. Use the editor's own controls and current in-app guidance to place geometry, hazards, and
   pickups. Prefer readable routes, safe landing zones, clear visual cues, and multiple recovery
   opportunities where the requested difficulty permits.
4. Save or export using the editor's own supported action. Do not guess the file format, internal
   IDs, folder paths, or serialization rules. Preserve the original saved file and work on a copy
   when editing existing user content.
5. Load the saved level in the supplied game and playtest the start, each major obstacle, and the
   finish. Record blockers, unintended deaths, unclear routes, and whether the requested challenge
   is met.
6. Revise only the relevant editor placements, save again through the editor, and replay the
   affected sections. Report the saved output location and actual playtest result.

## Completion report

Summarize the level's goal and major design choices, the editor save/export location, and the
playtest performed. State plainly if the editor, game, or ROM was unavailable and therefore the
level could not be tested. Do not invent a difficulty score or success result.
