# Game integrations and candidates

The unified workflow is defined in [the routing plan](../docs/skill-routing-plan.md). Run
`python games/skill_router.py --game <id> --task create` to resolve a configured skill route.

## Programmatic adapter skills

- [Match-3](match3/README.md) — [level design skill](match3/SKILL.md).
- [Platformer](platformer/README.md) — [level design skill](platformer/SKILL.md).
- [Splash Sort](watersort/README.md) — [level design skill](watersort/SKILL.md).
- [Turbo Lanes](racer/README.md) — [level design skill](racer/SKILL.md).
- [Crate Grove](crategrove/README.md) — [level design skill](crategrove/SKILL.md).

The local match-3 browser demo and its small server live in `match3/demo/`. Each of the other
games has its own build and local server instructions in its README.

## Editor-only workflow

- [Official Geometry Dash Editor skill](editors/geometry-dash/SKILL.md) uses Mobilerun on an
  existing user-authorized device. It does not ship a Geometry Dash fork or provide headless
  simulation.

The product adapters cover match-3, platformer, water sort, lane racing, and crate pushing. The
Geometry Dash editor route is a separate workflow and does not ship a game client.
