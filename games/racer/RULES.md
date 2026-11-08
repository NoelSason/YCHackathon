# Turbo Lanes: reference rules

Turbo Lanes is a lane-based dodge racer with fixed, designed tracks. This page lists the genre
conventions it follows, where each one comes from, and where the code enforces it. We copy
mechanics only. No commercial game's name, art, levels, or assets are used (see `AGENTS.md`).

All rules live in `src/engine.ts`. The browser game (`ui/main.ts`), the bots (`src/bots.ts`), the
exact solver (`src/solver.ts`), and the platform adapter (`adapter/index.ts`) call the same `step()`
and the same geometry, so there is no second copy of the rules.

## Sources

The genre has no single standard, so these rules come from common practice across several kinds
of source:

1. Game Bootcamp, "Endless Runner" module: speed ramps with distance up to a cap, and every
   generated course is checked for solvability.
   <https://seanking11.github.io/gamebootcamp/modules/04-endless-runner>
2. Game Developer, "Studying gameplay progression on runners" (2016): speed rises over time,
   warm-up and rest sections, and readable first obstacles.
   <https://www.gamedeveloper.com/design/studying-gameplay-progression-on-runners>
3. Lane runner game pages and templates: three fixed lanes, arrow keys on desktop and a tap on the
   left or right side of the screen on phones, obstacles you dodge by changing lanes, and speed that
   rises the longer you last. <https://classydev.itch.io/lane-runner>,
   <https://randomindiedev.itch.io/lane-dash>
4. Clipping the side of an obstacle while changing lanes is a recoverable hit (a "stumble") that
   costs time, not a free pass. Community guides for a popular three-lane runner:
   <https://www.supercheats.com/subway-surfers/questions/285438/what-does-stumble-upon-barr>,
   <https://causalzap-astro.pages.dev/en/games/subway-surfers/>
5. Single-use shields: one pickup takes one hit, then it's gone.
   <https://tvtropes.org/pmwiki/pmwiki.php/Main/SingleUseShield>,
   <https://jonathanpirone.itch.io/rush-runner>, <https://maxmini0214.itch.io/pixel-runner>
6. Car racers in the style of the classic handheld "brick game": a fixed set of lanes (5 in one
   version), opponent cars to dodge, and speed that rises by level or over time.
   <https://jpralves.net/post/2017/08/26/phpoc-web-based-car-race-brick-game.html>,
   <https://www.nintendolife.com/reviews/new-3ds/brick_race>,
   <https://www.gamebrew.org/wiki/Brick_Game_DS>
7. Hitboxes: a car racer's players complained when "the collision box was larger than the actual
   sprite", and the developer agreed it should be "a tiny bit smaller". Hitboxes should match the
   drawn sprite or sit slightly inside it. <https://itch.io/post/2424331>

## The rules we follow

| # | Convention | Turbo Lanes rule | Where |
|---|---|---|---|
| 1 | A fixed number of lanes, often 3 to 5 [3, 6] | `lanes` is 3 to 5 for the whole track. | `LIMITS`, `validateLevel` |
| 2 | One lane per input [3] | Each tick the car moves at most one lane. A held key doesn't auto-repeat, and one swipe or tap is one lane. `lane_change_cooldown` can add a wait after each change. | `step`, `ui/main.ts` `bindInput` |
| 3 | Smooth lane changes | The car eases across the lane in the first 40% of a tick and tilts while it moves. | `ui/main.ts` `draw` |
| 4 | Vehicles the same size, scaled to the lane | Every vehicle, the player's and the traffic's, is 2 rows long and 58% of a lane wide, centered in its lane. On screen a lane is always 1.76 rows wide, so a car keeps the same shape on every screen and lane count. The road gets narrower instead, and the space at its sides is roadside. | `VEHICLE_ROWS`, `GEOMETRY`, `spriteBox`, `playerBox`, `ui/main.ts` `layout` |
| 5 | Obstacles occupy one lane [3] | Cones, oil, and pickups cover one cell. A traffic car covers its cell and the next one ahead. | `footprintRows`, `objectsAt` |
| 6 | Collision on overlap [3, 7] | Two things collide exactly when their cells overlap in the same lane. Each sprite sits inside its cells, inset a little from each end, so the sprites overlap on screen exactly when the rules say they collide. | `step`, `boxesOverlap`, tests |
| 7 | Side hits cost time [4] | Steering into a lane where a hazard is beside the car is a side crash. The car bounces back to its own lane and stops for `crash_penalty` ticks. | `step` (sideways phase) |
| 8 | Front hits cost time | Driving into a hazard stops the car for `crash_penalty` ticks and ends any boost. The car then drives on through the wreck. Crashes never end the run, so the clock is what you race. | `step` (forward phase) |
| 9 | Clear pickup effects [5] | Boost: double speed for 4 ticks (the pad stays). Shield: absorbs the next hazard, front or side, with no stop and no lost boost. Shields don't stack. Coin: score only. | `step`, `BOOST_TICKS` |
| 10 | Readable hazards and pickups [2] | Hazards are warm-colored with hard edges (orange cones, oil with an orange rim, traffic with red tail lights). Pickups glow teal or gold. The legend under the controls says what each one does. | `public/style.css`, `public/index.html` |
| 11 | Speed rises [1, 2, 6] | Each level has a fixed `speed`. Speed rises from level to level (the practice tracks go 6, 8, 10, 12) and within a level through boost pads. This matches the level-based grid racers in [6]. An in-run ramp would make one level's clock depend on how far a player got, which the solver can't price. | `levels.ts` `SAMPLES` |
| 12 | A level is a set track with a goal [6] | A track has a fixed `length`, an obstacle layout, and a `time_limit`. You win by crossing the finish line within the limit. | `Level`, `finished` |
| 13 | Every track must be beatable [1] | The exact solver finds the fastest finish. A track is `solvable` only if that finish beats `time_limit`. Generated tracks always leave one lane open in each wall and never hide an object under a car. | `solveLevel`, `generateTrack` |
| 14 | Enough warning to react [2] | The road always shows at least 12 rows, which is 9.4 rows ahead of the car's front bumper. That's at least as far as the reference `human` bot plans at any speed. | `GEOMETRY.minVisibleRows`, tests |

## Controls

- **Phone:** swipe left or right anywhere on the road, tap the left or right half of the road, or use
  the ◀ ▶ buttons.
- **Desktop:** the arrow keys or A and D. Space or Enter starts and restarts. An arrow key also
  starts a race from the start screen.

## Backward compatibility

The level JSON format didn't change: the same fields, ranges, and object kinds, so every saved
level still validates. Two rules changed what some tracks play like:

- A traffic car now covers two rows, so an object placed in the row just ahead of a car is under
  it. That object can only be reached by crashing through the car. The validator still accepts this
  (older levels may have it), but `SKILL.md` tells designers not to do it, and the generator never
  does.
- Steering into a hazard beside the car is now a crash. Before, the car slid through it.

Difficulty figures measured before this change are out of date. Re-run the solver harness before
you report a win rate. The practice tracks were re-tuned to keep their old difficulty order:
Night Sprint's walls went from every 3 rows to every 4, and Neon Highway's limit went from 127 to
132 ticks. Human-bot win rates over 200 seeds after the change: Warm-Up Loop 96%, Rush Hour 97%,
Neon Highway 60%, Night Sprint 18%.
