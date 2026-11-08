# Platformer adapter

`adapter/index.ts` implements the studio's original grid-platformer contract: schema, validation,
seeded bots, a shortest-route solver, and a saved-level URL. Its mechanics are deliberately small
and data-driven. `SKILL.md` is the level designer's guide.

The adapter currently uses an independent grid-step model and is not connected to a forked browser
game. The previously referenced Super Mario Bros. remake is not used because it requires
third-party ROM content. No Mario code, trademarks, art, levels, or ROMs are included.

The [Systematic editor project](https://github.com/Lolo23450/systematic) is MIT licensed and has
JSON import/export, but its current implementation stores editor-specific multilayer tile IDs and
keeps movement rules inside a DOM-driven game loop. It does not expose the same headless rules for
the browser and solver. It was reviewed as a candidate and not integrated. Do not describe this
adapter as a fork or claim browser playability until a compatible source project and shared rules
implementation are connected.
