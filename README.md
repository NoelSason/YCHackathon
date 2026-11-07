# Autonomous level studio (working name)

An entry for the Naïve Autonomous Company Hackathon (YC, Nov 7–8, 2026).

**In one sentence:** an agent-run studio that makes levels for puzzle games. Plug in a game, and
its agents design new levels, test each one hundreds of times, tune the difficulty, playtest it
on real phones, ship it, and learn from how players do.

**What a human does:** sets the goal, the budget, and the guardrails, and steps in when something
breaks. Every step-in is logged.

## The company

- **The product is the platform, not a game.** Any casual game can plug in through a small
  adapter. We don't build a game.
- **Three open-source games as our first customers,** one per genre: a match-3 puzzle game, a
  rhythm runner, and a property-trading board game. We fork each one, connect it to the platform,
  and let the agents make and ship new content for all three. Three very different genres on one
  platform prove it works for any game, which is the B2B pitch.
- **What "levels" means depends on the genre:** puzzle levels for match-3, obstacle courses timed
  to music for the runner, and new boards and challenge scenarios for the board game. For the board
  game the real product is **balance**: no player strategy or seat should win too often.
- **Real studios as paying customers.** Agents find games whose players are asking for more levels
  or complaining about difficulty, make sample content for that genre *before* reaching out, and
  sell a pilot pack.

The pitch to a studio: "Our agents have been making and tuning content for three different games
since Saturday. Here's the data. Plug yours in."

## Our three games

The team found open-source versions of games like **Candy Crush, Geometry Dash, and Monopoly.**
Those names describe the genre of each game. **We use the genre and mechanics, not the original
game.**

**Rules for every fork (non-negotiable):**

- **License:** the repo's license must allow forking and modification, and we keep its credit and
  license file. No license file means we can't use it.
- **Not a copy of the original.** Candy Crush (King), Geometry Dash (RobTop), and Monopoly (Hasbro)
  are trademarks, and their art, music, characters, levels, and boards are copyrighted. In our
  product and demo, each game gets **its own name and its own art.** Our forks never use the
  original game's name, logo, look, music, levels, or board (such as Monopoly's street names,
  tokens, or card text). If a repo ships copied assets, replace them before anything is public.
  In conversation, "a Candy Crush–style game" is fine for describing the genre.
- **Music** for the rhythm runner must be royalty-free or CC0 with its license recorded. Many
  Geometry Dash clones bundle the original game's songs. Never use those.
- **Levels stored as data,** and **rules that run without the browser,** so the Solver can play
  them thousands of times in Node. Check this before committing to a repo.

### 1. Match-3 puzzle (Candy Crush–style)

- **A level:** grid layout, colors, blockers, a goal (collect N of a color, clear marked tiles),
  and a move limit.
- **How hard is it:** bot players (random, greedy, light tree search) play it hundreds of times.
  Measure the win rate, moves left, and attempts per win. Match-3 can't be solved exactly (Candy
  Crush is NP-hard), so simulation is the standard method.
- **Tuning:** the move limit, colors, and blockers, until the level is within a few points of its
  target win rate.
- **Phone playtest:** the Mobilerun agent plays it by tapping. Turn-based, so remote taps work.

### 2. Rhythm runner (Geometry Dash–style)

- **A level:** a timeline of obstacles (spikes, blocks, gaps, jump pads, speed or gravity changes)
  placed on the beats of a royalty-free song.
- **How hard is it:** the game runs frame by frame with fixed physics, so a **search solver** can
  find whether any sequence of jumps clears the level. That gives an exact answer: possible or
  impossible. Difficulty comes from **how many inputs it needs and how tight each timing window
  is** (a jump that must land within 2 frames is much harder than one with 12). Bots with
  human-like reaction delays then give a win rate.
- **Tuning:** widen or tighten the timing windows, spacing, and speed until the level hits its
  target. Every published level is proven possible.
- **Making levels:** detect the song's beats, then let the Designer place obstacles on them.
- **Phone playtest:** a cloud phone's taps arrive over the network, too late for frame-exact
  jumps. So the phone **doesn't** play it by hand. The game runs a replay of the solver's winning
  inputs on the phone, and the agent checks that it loads, renders, stays smooth, and matches what
  the solver expected. The recording also makes a good trailer.

### 3. Property-trading board game (Monopoly-style)

- **"Levels" here:** new boards (properties, prices, rents, tile order, a theme) and **challenge
  scenarios** ("start from this position, win within 15 turns").
- **How hard or balanced is it:** AI players with different strategies (buy everything, save cash,
  trade aggressively) play thousands of games. Measure the average game length, the share of
  games that end within the time limit, the first-seat advantage, and how often each strategy
  wins.
- **Tuning:** prices and rents until no strategy wins more than its fair share, games end within a
  target number of turns, and seat order doesn't matter much.
- **Phone playtest:** turn-based, so the Mobilerun agent can play a full game.
- **Why it matters for the pitch:** it shows the platform does game balance, not only puzzle
  levels. Balance is work every multiplayer and board-game studio pays for.

### The order to connect them

Start with **match-3** (closest to the research, and phone-friendly), then the **board game**
(simple turn-based simulation), then the **rhythm runner** (the physics solver is the most work, and
the most impressive result). Two games running end to end by 6:00 PM beat three half-connected
ones.

## Why this can win

- **Checkable numbers.** Every level gets a measured difficulty. "Target 40%, measured 38%" or
  "minimum 14 moves, as requested" is the kind of proof winners show.
- **A visible state change.** A level starts at a 3% win rate, so it's too hard. The agent retunes
  it to 41%, and a real phone plays it.
- **Generality.** Three very different genres run on one platform, all live.
- **A plain business.** "We make game levels for puzzle studios" works for judges and for a YC
  interview.
- **A real job for phones.** Mobilerun lists testing apps as one of its own example uses.

Research on judging and past winners: `docs/how-to-win.md`. The agent design: `docs/agent-plan.md`.

## How the company runs

```
             ┌──────────────── CEO (Naïve Team coordinator) ────────────────┐
             │ goal: keep each game on its difficulty curve, ship packs on   │
             │ schedule, win studio pilots, stay under budget                │
             └──┬───────────┬────────────┬──────────────┬──────────────┬─────┘
                │ board     │            │              │              │
                ▼ cards     ▼            ▼              ▼              ▼
          Research     Designer ──► Tuner ⇄ Solver ──► Playtest ──► Publish
          (reviews,    (writes a     (adjusts   (plays each   (Mobilerun     (pack goes
           charts,      level for     until it   level via     phones play    live in the
           phones)      game X)       hits the   the game's    it for real)   game)
                │                     target)    adapter)                       │
                ▼                                                               ▼
          Sales (AgentMail, HubSpot, Stripe)                       Players play; the game
          pitches studios with sample packs                        reports attempts, wins, quits
                │                                                               │
                └──────────► CEO reads player data, sales, and spend, ◄──────────┘
                             changes the plan, and logs why
```

## Who does what

| Person | Owns | Detail |
|---|---|---|
| **Max** | **Game integration** | Forks the three games, gives each its own name and art, writes each one's adapter, connects them to the platform, sends player events, and hosts them |
| **Noel** | **Mobile integration** | Mobilerun phones that Naïve agents control: playtesting, phone-based research, the live phone view, plus the demo script |
| **Abhinav** | **The platform** | The database, the API and agent tools, the Solver harness, payments and email plumbing, and the heartbeat dashboard |
| **Pinara** | **The agents** | The Naïve Team: CEO, Designer, Tuner, Playtest Lead, Research, and Sales, with their skills, budgets, permissions, schedules, and decision log. Full plan: `docs/agent-plan.md` |

### The shared contract: the game adapter

Everything depends on this, so Max and Abhinav agree on it by **3:00 PM** and write it in
`log.md`. Each game provides:

| Piece | What it does | Used by |
|---|---|---|
| `schema` | A JSON Schema for one level | Designer (structured output), validation |
| `validate(level)` | Says whether a level is well formed and gives the reason if not | API, Designer |
| `simulate(level, bot, seed)` | Plays one game in Node with no browser: won or lost, moves used | Solver |
| `solve(level)` *(search-solvable games only)* | Solvable or not, and the minimum number of moves | Solver |
| Load by URL | `?level=<id>` opens that level in the browser game | Players, Playtest |
| Events | Sends attempt, win, quit, and moves-used to our API | CEO, dashboard |
| `SKILL.md` | The rules and level format, written for an agent | Designer (as a Naïve skill) |

### Max: game integration

1. **By 2:45 PM:** check each of the three repos against the rules above: license, copied art or
   music, levels as data, and rules that run in Node. Replace any copied assets.
2. **The adapter for game 1**, end to end: schema, validate, simulate (or solve), load by URL,
   events, and `SKILL.md`. This is the pattern for the other five.
3. **Games 2 and 3** on the same pattern, in the order above. Host them all on Vercel under our domain.
4. **Phone check:** each game loads and plays in mobile Safari and Chrome. Noel's playtests depend
   on it.
5. Keep each game's original credit and license in its folder.

### Two ways a game connects

1. **Adapter (deep integration).** The game's code plugs into the platform, as above. Used for our
   three open-source games. It gives the fastest testing and exact numbers.
2. **Phone integration (no code from the studio).** Our agents write a **plan**, and the
   **Mobilerun agent carries it out inside the studio's own app** on a cloud phone. It installs the
   game, opens each level (by deep link, a debug level loader, or the game's own level editor),
   plays it, and reports back. The studio doesn't have to write any code for us, which makes the
   first sale much easier.

```
Pinara's Naïve agents                            Noel's Mobilerun integration
┌──────────────────────────┐   plan (JSON)      ┌─────────────────────────────────────┐
│ CEO / Playtest Lead      │ ─────────────────► │ Mobilerun Agent (Tasks API) on an    │
│ "play levels 31–40 of    │                    │ iPhone or Android with the studio's  │
│  Studio X's app, 3 tries │ ◄───────────────── │ app installed: opens each level,     │
│  each, note blockers"    │   results (JSON)   │ plays, screenshots, records          │
└──────────────────────────┘   + recording      └─────────────────────────────────────┘
```

A plan is structured, so the Mobilerun agent can follow it and its results can be checked:

```json
{
  "plan_id": "pt-2026-11-08-0214",
  "app": { "platform": "android", "package": "com.example.puzzle", "build": "1.4.2" },
  "goal": "Play levels 31-40 three times each and report results",
  "steps": [
    { "level": 31, "open": "deep link puzzle://level/31", "attempts": 3 },
    { "level": 32, "open": "deep link puzzle://level/32", "attempts": 3 }
  ],
  "report": ["won", "moves_used", "time_seconds", "stuck_reason", "visual_bugs", "screenshot"],
  "limits": { "max_minutes": 30, "never": ["purchases", "sign-ins", "sharing", "ads clicks"] }
}
```

Mobilerun has two ways to run this, and Noel picks per step. The **Agent** (Tasks API) takes a goal
in plain words and decides the taps itself, which suits a studio app we've never seen. The
**Phone** API (tap, swipe, screenshot) gives exact control, which suits our own three games. Default
to the Agent for studio apps.

**Check early:** how to install a studio's build on a cloud phone. Android can install an APK file.
On iPhone, installing an App Store or TestFlight build may need an Apple ID on the device. Confirm
with the Mobilerun docs or the Mobilerun team before promising this to a studio.

### Noel: mobile integration

1. **First hour:** a Mobilerun iPhone that a Naïve agent controls through Mobilerun's MCP server.
   It opens one of our games in Safari, plays a move, and takes a screenshot.
2. **Playtest tools for Pinara's Playtest Lead agent:** open a level by URL, play it, and report
   whether it loaded, whether touch works, whether it looks right, and the result, with a saved
   recording. On Android, Chrome can be driven directly, so the agent can read the game's state.
3. **The plan runner (phone integration):** take a plan in the JSON shape above, send it to the
   Mobilerun Agent on a phone with the target app installed, and return structured results and the
   recording. Prove it on one of our three games installed as an app or a home-screen web app, then
   on any free puzzle app as a stand-in for a studio's game. Agree on the plan and result shapes
   with Pinara by 3:00 PM.
4. **Phone research:** the agent plays top puzzle games on a phone and records mechanics and
   difficulty patterns for the Designer. Research only: never copy levels or art.
5. **The live phone view** for the dashboard (`@mobilerun/react`), so the stage shows a phone
   playing a level the agents just made.
6. **The demo script and the backup recording.**

### Abhinav: the platform

1. **Neon tables:** games, levels, solver runs, packs, player events, the activity log (every agent
   decision and action), human step-ins, studios, and payments.
2. **The API, offered to agents as one MCP server.** It covers `list_games`, `validate_level`,
   `solve_level`, `save_level`, `publish_pack`, `get_player_stats`, `get_company_metrics`,
   `log_decision`, `create_payment_link`, and `crm_update`. Pinara's agents use these tools, and
   Naïve gates each one with allow, ask, or deny.
3. **The Solver harness:** runs any game's adapter hundreds of times per level, in parallel, on a
   Naïve Computer or a Render worker. Pick one by 3:00 PM based on speed and cost.
4. **Business plumbing:** Stripe payment links (test mode until the team agrees to go live),
   AgentMail inboxes and webhooks, and HubSpot.
5. **The heartbeat dashboard** on Vercel: levels made per game, the share that passed, target vs.
   measured difficulty, players, studios emailed, replies, payments, spend, cost per level, and
   step-ins, with the activity log and Noel's live phone view underneath. This competes for Best
   design.

### Pinara: the agents

The full plan is in `docs/agent-plan.md`. In short:

1. Stand up the Naïve Team: a CEO coordinator with Designer, Tuner, Playtest Lead, Research, and
   Sales on its roster, handing work to each other through cards on the company board.
2. One Naïve skill per game, made from Max's `SKILL.md` files.
3. Budgets on every agent, permissions on every tool, and cron schedules.
4. **Test Naïve's approval rules in the first hour**, so the overnight run needs no clicks.
5. The decision log: every CEO decision records what it saw, what it chose, and why, and the next
   run checks whether it worked.

### If we're behind, cut in this order

If 8:00 PM Saturday arrives without a full loop, cut in this order: Luxor, phone research on other
games, Android playtests, in-game purchases, then the rhythm runner. Always keep at least two games
running Design → Tune → Solve → Ship → Phone playtest → Player data → CEO
decision → Sales email.

**Each adapter is real work,** especially the headless `simulate` and the rhythm runner's
solver. Get two games working end to end before starting the third.

## Sponsor tools: what each one does for us

| Tool | Its job | Owner |
|---|---|---|
| **Naïve** | Runs the company: the Team (CEO + roster), board cards, budgets, per-tool permissions, cron, skills per game, structured outputs for level JSON, and a Computer for Solver runs | Pinara (agents), Abhinav (Computer, MCP) |
| **Mobilerun** | Cloud iPhones and Androids for playtests, phone research, recordings, and the live view on stage | Noel |
| **Monid** | App Store and Google Play reviews and charts to find games whose players want more levels, and contact lookups for studios | Pinara (Research agent) |
| **Apify** | Bulk scraping: the Google Play puzzle category, itch.io puzzle games, and studio websites | Pinara (Research agent) |
| **AgentMail** | The sales inbox: sends sample packs to studios, receives replies, keeps threads | Abhinav (setup), Pinara (Sales agent) |
| **HubSpot** | Studio pipeline: found → sample made → emailed → replied → pilot paid → delivered | Abhinav (setup), Pinara (Sales agent) |
| **Stripe** | Studio pilot-pack payment links, and hint packs in the games. Test mode until the team agrees to go live. | Abhinav |
| **OpenAI / OpenRouter** | Models. A strong model for design and sales replies, a cheap one for sorting reviews. Route through Naïve's model proxy where possible, so all spend sits in one ledger. | Pinara |
| **Vercel** | Hosts the three games and the dashboard | Max (games), Abhinav (dashboard) |
| **Neon** | Postgres for everything the demo replays | Abhinav |
| **Render** | Solver worker, if a Naïve Computer is too slow or costly | Abhinav |
| **Luxor** | Stretch: train a small model that predicts difficulty from a level's layout. King's research found a learned model can beat simulation-only bots at predicting how hard a level feels to people. | Abhinav |

**Naïve's marketplace.** Naïve lists ready-made companies (templates). Two are worth checking in the
first 20 minutes: **AI Automation Agency** (CRM, a public site, and a workspace per client) as a
possible starting point for our studio, and **Security Testing Agency**, whose testers use each
client's product like a customer, which is close to our playtesting. Templates make every send ask
for approval by default, so loosen those rules on purpose. Stretch goal: list our company on the
marketplace. Naïve pays a commission each time someone deploys it, which is one more way to earn.

### Our credits

| Provider | What we have | Use it for |
|---|---|---|
| Naïve | $250, Pro plan free through Nov 30 | Agent models, Computer time, data runs |
| Mobilerun | 1,500 credits, 30,240 minute units (Android 1/min, iOS 2/min), 10 GB proxy traffic. Access ends 72 hours after claiming. | **All phones.** Use Mobilerun, not Naïve's phones. |
| Neon | $250 | The database |
| Monid | $20 signup credit | Reviews, charts, contacts |

**Phones: use Mobilerun directly, not Naïve's phones.** Naïve's phones bill $0.08 per iPhone-minute
to the $250 Naïve balance, so one iPhone running overnight costs about $38. Mobilerun's minute
units cover far more than 72 hours of iPhone time. Naïve agents still drive the phones through
Mobilerun's MCP server (`https://cloud.mobilerun.ai/api/mcp`). Claim the Mobilerun credits when
we're ready to use them, because the 72 hours start then.

## How difficulty is measured

Studios and researchers measure difficulty by **simulating play with bots** and comparing the
results with real player data. Candy Crush is NP-hard, so exact solving isn't an option for
match-3.

1. **Search-solvable games** (pushing, sliding, paths, nonograms): an exact solver says whether the
   level can be solved and in how few moves. Difficulty means the minimum moves, how many dead
   ends there are, and how many solutions exist.
2. **Match-3 games:** bot players with different styles (random, greedy, and a light tree search)
   play each level hundreds of times. Difficulty means the win rate, the moves left, and the
   attempts per win. Researchers use bot "personas" that imitate human play styles in the same way.
3. **Tuning:** the Tuner changes the move limit and layout until the level lands within a few
   points of its target. Levels that can't get there are thrown out and counted.
4. **The curve:** the CEO sets a target for each level and mixes easier and harder ones. Studios
   treat long runs of levels at nearly the same difficulty as a design problem.
5. **Real players close the loop.** The CEO compares the planned curve with actual attempts, wins,
   and quits, then retunes. One studio recommends attempts per level over pass rate as the measure.
6. **Check the first levels by hand.** Generated levels are often too easy, impossible, or dull,
   which is why studios hand-design the levels that teach a game. We check the first few levels of
   each game ourselves.

## Timeline

Hacking runs from 1:00 PM Saturday to **11:00 AM Sunday, the code freeze**.

| When | Milestone |
|---|---|
| Sat now–3:00 PM | **Spikes.** Max: three repos checked and the match-3 adapter started. Noel: a phone a Naïve agent controls. Abhinav: Neon tables and the first MCP tools. Pinara: the Naïve Team skeleton, approval rules tested, marketplace templates checked. |
| Sat 3:00 PM | **Contracts.** The adapter interface, the MCP tool list, player events, the activity log, and environment variable names, all written in `log.md`. Naïve Computer or Render for the Solver. |
| Sat 3:00–6:00 PM | Two games connected. Their first levels designed, solved, tuned, and playable on phones. |
| **Sat 6:00 PM** | **Switch the company on.** The CEO ships the first packs on cron, and Sales sends its first personal emails. |
| **Sat 8:00 PM** | **Full loop on two games:** design → tune → solve → ship → phone playtest → player data → CEO decision → sales. |
| Sat 8:00 PM–2:00 AM | The third game (rhythm runner). Budget caps and kill switches. Get real people playing (the room, our posts). |
| **Sun 2:00–8:00 AM** | **Hands off.** Packs ship on schedule, the CEO retunes from player data, and Sales answers replies. Log every step-in. |
| Sun 8:00–10:00 AM | **Feature freeze at breakfast.** Read the overnight log, fix the worst failure, check every demo path, and record a backup. |
| Sun 10:00–11:00 AM | Rehearse. |
| **Sun 11:00 AM** | **Code freeze.** Judging begins. |

## The demo (3 minutes)

Open with the result, not the architecture.

1. **0:00–0:20: the result.** "At 2:00 AM we stopped touching this company. Since then its agents
   designed N levels across three games, tested each one hundreds of times, shipped N packs, retuned N
   levels from what N players did, emailed N studios, and spent $N. We stepped in N times." Real
   numbers only.
2. **0:20–1:10: one level's life.** The Designer's draft → the Solver says 3%, too hard → the Tuner
   gets it to 41% → a phone plays it → players' real results → the CEO's retune.
3. **1:10–1:40: one decision we didn't make.** The CEO's log entry that changed the plan, and the
   numbers behind it.
4. **1:40–2:20: the live part.** A QR code on screen. The audience plays a level the agents made a
   minute ago, while a Mobilerun iPhone plays it on the big screen.
5. **2:20–3:00: the business.** Three genres on one platform, the studio pipeline, and any replies or
   payments. Bottom-up math: studios × levels per month × price per level, with a source for every
   number. Then the list of step-ins, honestly.

## Risks

1. **Naïve's approval rules can stop the overnight run.** Sending email, `mobile`, `data_run`,
   `generate_video`, and `social.post` ask a human by default. A person's API key can set most of
   them to `allow`. But once a chat reads people's data (such as an inbound email), every send,
   phone action, and MCP call in that chat asks *each time, even at `allow`.* Pinara tests this in
   the first hour. Every approval clicked overnight is a step-in judges count.
2. **Three adapters, one of them hard.** The rhythm runner's solver is the riskiest piece. See the cut order above.
3. **Headless play.** Some open-source games mix rules with drawing code, so their rules won't run
   in Node. Check this before choosing a game.
4. **Licenses and art.** Check every license. Skip any repo with art copied from a commercial game.
5. **Level quality.** A solver measures difficulty, not fun. Check the first levels by hand, and let
   player data catch dull ones.
6. **Players by Sunday.** Use the hackathon room, our own posts, and a QR code at our table.
7. **Studios buy slowly.** Expect replies or a letter of intent, not payment, in 22 hours.
8. **Research limits.** Phones play other companies' games only to study them. Follow each game's
   terms, and never copy levels or art.
9. **Spend.** Cap every Naïve agent's budget, and set a daily limit in Monid.
10. **Trademarks and copied assets.** Our forks must have their own names, art, and music. Check every repo before anything goes public.

## Sources for the difficulty approach

- [Gudmundsson et al., Human-Like Playtesting with Deep Learning (King, 2018)](https://gwern.net/doc/reinforcement-learning/imitation-learning/2018-gudmundsson.pdf)
- [Predicting Game Difficulty and Engagement Using AI Players (2021)](https://arxiv.org/pdf/2107.12061)
- [Automated Playtesting of Matching Tile Games (2019)](https://arxiv.org/pdf/1907.06570)
- [Difficulty Modelling in Mobile Puzzle Games (2024)](https://arxiv.org/pdf/2401.17436)
- [Improving Conditional Level Generation using Automated Validation (2024)](https://arxiv.org/pdf/2409.06349)
- [Walsh, Candy Crush is NP-hard](https://www.semanticscholar.org/paper/Candy-Crush-is-NP-hard-Walsh/9affceb3e2f5fc492106ea0065039be67a720dac)
- [Playrix: creating levels and elements for match-3 games](https://gameworldobserver.com/2019/09/27/playrix-levels-elements-match-3)
- [Room 8 Studio: the state of tile-puzzle level design](https://room8studio.com/news/smart-casual-the-state-of-tile-puzzle-games-level-design-part-1/)
- Naïve docs: [Mobile device](https://usenaive.ai/docs/computer/mobile.md),
  [Tools and permissions](https://usenaive.ai/docs/capabilities/tools.md),
  [Team](https://usenaive.ai/docs/team/overview.md)
- [Mobilerun docs](https://docs.mobilerun.ai/llms.txt)

## Docs

- Agent instructions and rules: `AGENTS.md` (Claude Code reads it through `CLAUDE.md`)
- The agent plan: `docs/agent-plan.md`
- How to win: `docs/how-to-win.md`
- What each push did: `log.md`
- Naïve SDK: https://vetta.sh/docs/llms.txt
- Mobilerun: https://docs.mobilerun.ai/llms.txt
