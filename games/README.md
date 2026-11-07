# Game integrations and candidates

The unified workflow is defined in [the routing plan](../docs/skill-routing-plan.md). Run
`python games/skill_router.py --game <id> --task create` to resolve a configured skill route.

## Integrated skill packs

- [Match-3](match3/README.md) — [level design skill](match3/SKILL.md).

## Editor-only skills

- [Platformer editor skill](platformer/SKILL.md) for an external editor; not a product integration.
- [Official Geometry Dash Editor skill](editors/geometry-dash/SKILL.md) using Mobilerun on an
  existing user-authorized device; not a product integration.

The current product plan is for three games. Editor-only skills do not approve additional game
integrations or add external editors as shipped dependencies.
