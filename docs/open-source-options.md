# Open-source options: games, art, music, and phones

_Researched Sat Nov 7, 2:45–3:10 PM, by Pinara with Claude Code and five research agents._

- Every license here was read from the repo's LICENSE file or the official page.
- The main repo claims (files, exports, data fields) were spot-checked with `gh`.
- **Nothing was cloned or run,** so speed and test results are unverified.
- Hour estimates are rough.

This doc proposes. `docs/master-plan.md` decides, and changing a game in the plan needs the team's
agreement and a `log.md` entry.

## The picks

| Need | Pick | License | Next step | Owner |
|---|---|---|---|---|
| Match-3 | houseki's Gem Swap engine | MIT | 1-hour spike | Max |
| Board game | Parkway's `engine` and `bot` packages | MIT | 1-hour spike | Max |
| Third game | **Proposal:** PuzzleScript with an exact BFS solver, instead of the rhythm runner | MIT | Team decision | Team. Then Max (adapter) and Pinara (solver) |
| Rhythm runner, if kept | Our own ~250-line core. No clone is worth forking. | n/a | n/a | Max, Pinara |
| Art | Kenney packs | CC0 | Pick tiles and board art | Max |
| Music, if the runner is kept | incompetech or OpenGameArt CC0 tracks | CC BY 4.0 or CC0 | Record each track's license | Max |
| Phones | The Mobilerun plan in section 5 | n/a | Fix the MCP URL, claim phones | Noel |

Both repo picks are new and have one author each. Run the spike before building on one, and keep
the fallback ready.

## 1. Match-3: houseki Gem Swap

### What's in the repo

- **Repo:** https://github.com/johnmorrisdotca/houseki (MIT). Four original puzzle games with seeded
  engines, in TypeScript with no dependencies. Created Oct 2026 by one author. The npm package is
  `@johnmorrisdotca/houseki` and needs Node 22 or newer.
- **Engine:** `src/gem-swap/engine.ts` exports `createGame`, `legalActions`, `applyAction`,
  `statusOf`, `hintGame`, and `advanceTicks` / `advanceTime`. Moves resolve over ticks.
- **Levels as data:** `src/gem-swap/content.data.ts` has 50 levels. Each has a seed, `moveLimit`,
  goals (score, collect, chain, seals), a `mask` for holes, and `seededPlayoutSuccessRate`.

### How it maps to our adapter (`platform/CONTRACTS.md` §1)

- **`simulate(level, bot, seed)`:**
  1. Call `createGame` with the seed.
  2. Get `legalActions`.
  3. The bot picks one action, and we call `applyAction`.
  4. Advance ticks until `statusOf` says won or lost.
- **`bots`:**
  - `random`: picks any legal move.
  - `greedy`: picks the move with the most goal progress.
  - `search`: a short lookahead.
  - `hintGame` might work as a ready-made greedy bot. Check it.

### Spike checklist (1 hour)

- Run one level headless in Node.
- Time 1,000 games.
- Confirm `statusOf` gives the result and the moves used.
- Check colors and blockers. The research agent reported a 4–6 color limit.

### Other notes

- **Check the harness:** each level's `seededPlayoutSuccessRate` is a measured success rate. On the
  same levels, our harness should land close to it before we trust its numbers.
- **Phone:** the Mobilerun agent reads a canvas poorly. Draw tiles as DOM elements with
  `aria-label`s, or turn on the agent's `vision`, which costs more credits. The repo has demo pages
  for some of its games. Check whether Gem Swap has one, and if not, build a simple DOM renderer.
- **Fallback:** our own ~300-line core, starting from `@ymir-js/match3` (MIT, v0.14.0, Oct 2026). It
  has an injectable `random`, `getPossibleMoves()`, and a `swap()` that returns the cascade steps.
  It has no holes, blockers, or goals, so we'd add those. Keep its license notice.
- **Art:**
  - [Kenney Puzzle Pack 2](https://kenney.nl/assets/puzzle-pack-2) (CC0): gems and blocks in 8
    colors, plus match-3 back tiles.
  - [Rotating gems for match3](https://opengameart.org/content/rotating-gems-for-match3) (CC0).

## 2. Board game: Parkway

### What's in the repo

- **Repo:** https://github.com/rayhankhilji/parkway (MIT). Created Jul 2026 by one author, 3 stars. A
  Next.js app with a dependency-free engine.
- **Engine:**
  - `packages/engine/src/reduce.ts`: a pure reducer.
  - `legalActions.ts`.
  - Seeded dice in `rng/mulberry32.ts`.
  - `tests/purity.test.ts` bans `Math.random` and `Date.now`.
- **Board as data:** the `BoardPack` type in `packages/engine/src/board/types.ts`.
- **Bots:**
  - Four levels, gentle to ruthless, in `packages/bot/src/valuation.ts`.
  - Landing odds for any board in `packages/bot/src/landing.ts`.
  - A bot-vs-bot loop, `playMatch`, in `packages/bot/tests/strength.test.ts`.

### Work to adapt (about 4–8 hours)

1. Add `registerBoardPack()`. The registry in `board/registry.ts` is a fixed `Map` with one board.
2. Generate the level JSON Schema from `BoardPack`.
3. Write our strategy bots as decision functions (see "Strategies" below).
4. Turn `playMatch` into `simulate`. There's no turn counter, so count `END_TURN` actions.
5. Give every level its own board id, because bot landing odds are cached by id.
6. Drop the `supabase/` folder. The packages ship TypeScript source, so run them with `tsx`.

### Other notes

- **IP:** the names and card text are original, but the default board copies the standard game's
  prices, rents, and tile order. **Don't ship the default board.** Our agents make our boards.
- **Strategies:** borrow the settings from
  [kalebhoffer/monopoly-strategy-sim](https://github.com/kalebhoffer/monopoly-strategy-sim) (MIT,
  Python):
  - buy: all, none, or by color group
  - bid as a share of the price
  - build level
  - cash reserve
  - jail
  - trade: fair, aggressive, defensive, pushover, or none
- **Fallback:** our own ~400-line engine. Skip boardgame.io:
  - It's MIT, but the last release was 0.50.2 in Nov 2022.
  - Its `Simulate` only asks the first active player, which is awkward for auctions and trades.
  - It has no strategy bots.
- **Art:**
  - [Kenney Boardgame Pack](https://kenney.nl/assets/boardgame-pack) and
    [Board Game Icons](https://kenney.nl/assets/board-game-icons) (CC0).
  - game-icons.net is CC BY 3.0, so it needs a credit line.

## 3. Proposal: PuzzleScript instead of the rhythm runner

**Why:** the rhythm runner's physics solver is the riskiest package in the plan (package 9, size L).
PuzzleScript costs about 6–9 hours in total, gives exact answers, and backs a stronger "works for
any game" claim. It needs the team's agreement, because the master plan lists the rhythm runner.
The master plan also disagrees with itself here: its package table says the rhythm runner is cut
first, but its cut order lists it last.

### The pieces

- **Engine:** https://github.com/increpare/PuzzleScript (MIT, about 1.1k stars, updated Nov 4 2026).
  - It already runs in Node: `src/tests/run_tests_node.js` loads the engine files into Node's `vm`.
  - Calls: `compile(["loadLevel", n], source, seed)`, `processInput(0–4)` (the four directions and
    action), `backupLevel()` / `restoreLevel()`, and the `winning` flag.
- **Levels:** ASCII grids with a legend, inside a plain-text game file. Agents write these easily.
- **Solver:** https://github.com/smearle/script-doctor (MIT). The folder `puzzlescript_nodejs/` has
  BFS, A*, and MCTS that run on the original engine.

### Fix these before trusting the solver

- It skips repeated states using a hash modulo 1,000,000,003. A collision can make the minimum-move
  count or an "unsolvable" result wrong. Use exact state keys.
- `main.js` calls `solveBFS(engine)` without `maxIters`, so the search never runs. Pass a limit.
- `engine.js` expects a PuzzleScript checkout next to it. Pin one upstream commit.
- With `unitTesting=true`, a win moves to the next level instead of setting `winning`. Detect wins
  another way, or patch it.

### What we measure

- Solvable or not.
- Minimum moves.
- Dead ends.
- Number of solutions.

BFS is all-or-nothing, so keep levels small and always set a step limit.

### Which games

Only games we have rights to:

- 1–2 small games we write ourselves.
- The example games in the engine's editor dropdown. Its `src/demo/README` says these "can be
  assumed" MIT. Examples are *Kettle* and *Constellation Z*, and script-doctor's BFS solved 11/11
  and 5/5 of their levels.

Don't use community games. Each one belongs to its author, and most have no license. Skip any game
with `random` rules or real-time play.

### Cost and demo claim

- **Phone:** the MIT engine can serve one level per `?level=<id>` page.
- **Hours:**
  - about 2 for the wrapper and `validate`
  - 2–3 for exact BFS and its stats
  - 1.5–2 for the phone page
  - about 1 per game we write
- **Demo claim:** "One adapter runs any deterministic PuzzleScript game. Our agents designed N
  levels across 3 games, and a full search proved each one solvable and measured its minimum moves."

## 4. If we keep the rhythm runner

### Write our own core, don't fork

None of the five clones we checked has fixed-timestep physics that runs without the DOM, and many
Geometry Dash clones ship RobTop's songs or game files.

- **Core:** a ~250-line TypeScript `step(state, jumpHeld)` with integer frames, box hitboxes, and
  JSON levels. The canvas renderer drives it from an accumulator.
- **Same results on every device:** use only `+ − * /` and `Math.sqrt` in the physics. JavaScript
  engines may compute `Math.pow`, `sin`, `cos`, `exp`, and `**` slightly differently, so Node and
  iPhone Safari could disagree.

### Music

Record each track's license in the game's folder.

| Track | License | BPM | Link |
|---|---|---|---|
| Kevin MacLeod: *Voxel Revolution*, *Bit Shift*, *Ouroboros*, *Cyborg Ninja* | CC BY 4.0. The credit line is required, including in clips we post. | 122, 130, 130, 160 | https://incompetech.com. Its `pieces.json` lists the BPM and length of all 1,443 tracks. |
| Fupi: *Espelhar* | CC0 | 140 (uploader's tag) | https://opengameart.org/content/espelhar-loud-melodic-edm |
| Centurion_of_war: *Pushing Yourself* | CC0 | 130 (tag) | https://opengameart.org/content/pushing-yourself-complete |
| zesona: *Shine Blitz* | CC0 | 140 (tag) | https://opengameart.org/content/shine-blitz |

### Beats and testing

- **Beats without detection:** beat k falls at `offset + k × 60 / BPM` seconds, rounded to physics
  frames.
  - Get `offset` from `music-tempo` (MIT) `beats[0]`, or set it by ear.
  - Check by ear that the tempo stays steady.
- **Avoid:**
  - FreePD, because the site has closed.
  - Free Music Archive and ccMixter tracks marked NC (non-commercial) or ND (no derivatives).
  - `essentia.js` (AGPL).
  - `aubiojs`, which compiles in GPL code.
- **Phone tests:** network taps can't hit frame-exact jumps. Replay the solver's inputs with
  JavaScript inside the page (section 5, use 2).

## 5. Mobilerun plan (Noel)

### Facts from docs.mobilerun.ai

- **Credits pay for the Mobilerun agent's AI steps,** at about 0.5 credits per step (1 credit =
  $0.01). Our 1,500 credits cover about 3,000 steps.
  - Minutes pay for phone time.
  - Direct taps and browser scripting use minutes only.
- **MCP with an API key:** use `https://api.mobilerun.ai/v1/mcp` with the header
  `Authorization: Bearer dr_sk_…`. The URL in `CLAUDE.md`, `https://cloud.mobilerun.ai/api/mcp`, is
  the OAuth sign-in version.
- **Agent tasks** take these options:
  - `outputSchema`: a structured result.
  - `recordingEnabled`: a video of the run.
  - `maxSteps`: default 100.
  - `vision`: off by default.

  A phone runs one task at a time.
- **Browser scripting:** Playwright or Puppeteer connect to Chrome on the phone at
  `wss://api.mobilerun.ai/v1/devices/{deviceId}/browser/cdp`. This is Chrome for Android only.
- **Installing apps:**
  - Android installs an APK we upload, by `packageName`.
  - iPhone installs only from the App Store, by `bundleId`.
- **Live view:** `@mobilerun/react`'s `DeviceStream`, given a `streamUrl` and a `streamToken`.
- **The prize:** no rubric is published. Mobilerun's post asks for "a working end-to-end workflow,
  not just an agent that explains what it would do" and says to "bring the result back to Naïve so
  your agent can continue with the next step."

### Uses, ranked

| # | Use | How | Device | Cost | Why |
|---|---|---|---|---|---|
| 1 | **AI playtest:** plays a new level and returns a structured result and a recording, which go back to the Designer | Agent task, `maxSteps` ≤ 25, `recordingEnabled`, `outputSchema` | Android | about 10 credits per level | Exactly the prize's "bring the result back to Naïve" loop |
| 2 | **Overnight browser checks:** open each new level, replay the solver's winning moves in the page, check load time, errors, and layout | Playwright over CDP | Android | phone minutes only | Real-device numbers at scale. Also how the rhythm runner gets tested. |
| 3 | **Live phone on the stage dashboard** | `DeviceStream` | iPhone | minutes | The visual moment |
| 4 | **Post the Midnight Challenge clip** | Agent task | Android | about 20 credits per post | "Publish content" is the sponsor's first example. Needs the team's OK, an AI-content label, and an account login. |
| 5 | **QA for a studio:** install their Android app and run a JSON test plan | Agent task | Android | about 10 credits per level | A second product to sell |

### Budget

- One Android phone runs browser checks all night.
- A second Android phone runs about 70 capped AI playtests, which is about 800 credits.
- Keep about 300 credits for the demo.
- Use the iPhone only on stage.
- Claim the phones soon. iPhones are first come, first served, and the 72 hours start at claim.
- Our notes' minute figures (30,240 units, iOS at 2 a minute) aren't in the public docs. Check them
  in the Mobilerun dashboard.

### Traps

- **Naïve permissions:** set each Mobilerun tool to `allow` in the agent's Naïve `tools.configs`,
  or every tap waits for a human. Deny the tools that buy things, because the MCP server can create
  paid devices, phone numbers, and proxies.
- **The key:** store the Mobilerun key in Naïve's credential vault, not in the MCP config.
- **Canvas games:** the agent reads them poorly. Use DOM tiles with labels, or turn on `vision`.
- **Busy phones:** an agent task fails if the phone is still busy after a 30-second wait, so queue
  the playtests.
- **Secrets:** stream tokens and recording URLs are secrets. Copy recordings to our own storage, and
  never log the URLs.

## 6. Helper libraries (npm, checked Nov 7)

| Need | Package | License |
|---|---|---|
| Seeded random numbers | `pure-rand` or `seedrandom` | MIT |
| Running games in parallel | `piscina` or `tinypool` | MIT |
| Confidence intervals and tests | `simple-statistics` | ISC |
| QR codes for the table and posters | `qrcode` | MIT |
| Charts (predicted vs. real win rate) | `chart.js` or `uplot` | MIT |
| Checking level JSON | `zod` (already in the platform) or `ajv` | MIT |

## 7. Don't use

- **Geometry Dash clones that ship RobTop's music or game files:**
  - OLIVER427/GD-LevelLoaderJS
  - marshallb78/geometrydash-full
  - web-ports/geometry-dash
  - Stellite-Games/geometry-dash-webport
  - Axo04/VoidDash

  Also don't copy the physics constants in camila314/gdp. They're decompiled and have no license.
- **Repos with no license,** for example:
  - francois-roseberry/monopoly-js
  - jotitan/monopoly
  - the boardgame.io Monopoly clones
  - SCOOP007/match3-game
  - m-ler/candy-tiles
- **GPL or AGPL code inside our product:**
  - FatPaper-1874/mine-monopoly
  - lamarios/monopoly
  - GD.JS
  - opendash
  - boardzilla-core
  - `essentia.js`
  - `aubiojs`
- **pixijs/open-games "Puzzling Potions":** Spine needs a paid editor license, GSAP isn't open
  source, and its Figma assets can't be reused.
- **Simon Tatham's puzzles** (MIT, with good solvers): there's no Node build, only C with a GTK
  build. Not worth it in 20 hours.

## 8. Next steps

- **Team (now):** decide PuzzleScript vs. the rhythm runner, and fix the cut-order conflict in the
  master plan.
- **Max:**
  - Run 1-hour spikes on houseki and Parkway.
  - Draw match-3 tiles as DOM elements with labels.
  - Use the Kenney art.
  - Put a license file in each game folder.
- **Noel:**
  - Use the API-key MCP URL.
  - Add the Mobilerun MCP server to `playtest` in `platform/naive/src/roster.ts`, with the key in
    the vault, tools at `allow`, and purchase tools at `deny`.
  - Claim phones before the 6 PM switch-on.
  - Set up the overnight browser checks.
- **Pinara:**
  - Check the harness against houseki's `seededPlayoutSuccessRate`.
  - Write the board-game strategy bots.
  - Build the PuzzleScript BFS solver if the team picks it.

## Sources

- **Mobilerun docs:**
  - [credits](https://docs.mobilerun.ai/credits.md)
  - [MCP server](https://docs.mobilerun.ai/mcp-server.md)
  - [agent](https://docs.mobilerun.ai/agent.md)
  - [browser automation](https://docs.mobilerun.ai/browser-automation.md)
  - [install app](https://docs.mobilerun.ai/api-reference/apps/install-app.md)
  - [embed device stream](https://docs.mobilerun.ai/guides/embed-device-stream.md)
- [Mobilerun hackathon post](https://mobilerun.ai/blog/posts/autonomous-company-hackathon-naive-mobilerun)
- [PuzzleJAX paper (script-doctor)](https://arxiv.org/abs/2508.16821)
- [Kenney license (CC0)](https://kenney.nl/support)
- [incompetech](https://incompetech.com)
