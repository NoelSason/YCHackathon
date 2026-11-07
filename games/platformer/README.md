# Platformer editor skill

**Source:** [JHDev2006/Super-Mario-Bros.-Remastered-Public](https://github.com/JHDev2006/Super-Mario-Bros.-Remastered-Public)

The repository describes itself as a remake/celebration of Super Mario Bros. games, includes a
custom level editor, and is marked GPL-3.0. Its README also says the game requires an original
SMB1 NES ROM. See the [repository README](https://github.com/JHDev2006/Super-Mario-Bros.-Remastered-Public#readme)
and [license](https://github.com/JHDev2006/Super-Mario-Bros.-Remastered-Public/blob/main/LICENSE).

## Scope

This is an editor workflow skill only; it does not add this game as a product integration. The
current product plan remains limited to match-3, rhythm-runner, and board-game integrations. The
repository's GPL license does not grant rights to Nintendo trademarks, ROMs, or other third-party
materials. Do not fork, ship, or demonstrate this game or its assets as part of our product. The
project instructions prohibit using Mario names, characters, art, levels, or music in our product.

## Integration readiness

The repository advertises an in-game custom level editor/system, but its level-data schema and
headless rules have not been audited. No platform adapter is being built. The editor skill tells
agents to use the editor's own save/export actions instead of guessing its format. The README says
the game needs an original SMB1 ROM to play; that remains separate and user-supplied, and must not
be copied into this project.

See [SKILL.md](SKILL.md) for the editor-only workflow. Any future product integration requires a
separate scope decision and a rights-safe game with distributable assets and levels stored as data.
