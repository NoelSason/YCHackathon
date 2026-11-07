# Autonomous level studio (working name)

An entry for the Naïve Autonomous Company Hackathon (YC, Nov 7–8, 2026).

**In one sentence:** an agent-run company that makes levels for puzzle games. Its agents design
each level, test it hundreds of times, tune its difficulty, playtest it on real phones, ship it,
and sell the same service to game studios.

**What a human does:** sets the goal, the budget, and the guardrails, and steps in when something
breaks. Every step-in is logged.

**Ground rule:** we build our **own original match-3 game**, with our own name, art, and rules.
Candy Crush and its peers are examples of the customer, not something we copy. Never reuse
another game's levels, art, or names.

## The company

We run two things at once, and each makes the other stronger.

1. **Our own puzzle game, run entirely by agents.** It's an original match-3 web game that plays
   well on phones. Agents ship a new level pack every few hours, then tune difficulty from real
   player data. Players can buy hint packs or level packs through Stripe.
2. **A level studio for game companies.** Agents find puzzle games whose players are asking for
   more levels or complaining about difficulty. They make sample levels for that game's genre
   *before* reaching out, and sell a pilot pack.

The pitch to a studio: "Our agents have run this game's levels since Saturday. Here's the data.
We'll do the same for yours."

## Why this can win

- **Checkable numbers.** Every level gets a measured win rate from hundreds of simulated plays.
  "Target 40%, measured 38%" is the kind of proof winners show.
- **A visible state change.** A level starts at a 3% win rate, so it's too hard. The agent retunes
  it to 41%, and a real phone plays it.
- **A plain business.** "We make game levels for puzzle studios" works for judges and for a YC
  interview.
- **A real job for phones.** Mobilerun lists testing apps as one of its own example uses.
- **Lower risk than our earlier streaming idea.** It needs no live video infrastructure.

Full research on judging and past winners: `docs/how-to-win.md`.

## How the company runs

```
            ┌────────────────── CEO (Naïve coordinator) ──────────────────┐
            │ goal: "Keep players at the target difficulty curve, ship a   │
            │ pack every 3 hours, and win studio pilots, under $X per day" │
            └───┬─────────────┬──────────────┬──────────────┬─────────────┘
                │ board cards │              │              │
                ▼             ▼              ▼              ▼
         Market Research   Designer ──► Solver ──► Tuner ──► Playtester
         (Monid, Apify,    (writes        (plays each  (adjusts    (Mobilerun iPhone
          Naïve Data,       level JSON)    level 500×,  until it    and Android: plays
          Mobilerun)                       measures     hits its    the shipped level,
                │                          win rate)    target)     catches bugs, records)
                │                                                         │
                ▼                                                         ▼
         Sales (AgentMail, HubSpot, Stripe)                   Publisher (game on Vercel,
         finds studios, sends sample packs,                    trailers, social posts)
         answers replies, closes pilots                                   │
                │                                                         ▼
                └────────────► CEO reads player data, sales, and spend, ◄─┘
                               changes the plan, and logs why
```

## Agents

| Agent | Job | Built on | Owner |
|---|---|---|---|
| **CEO** | Sets each pack's difficulty curve, schedules work, reallocates budget, and decides what to change from player data and sales results. Logs every decision with its reason. | Naïve Team coordinator, company board, cron | Teammate 4 |
| **Designer** | Writes new levels as JSON (grid, pieces, blockers, goal, move limit) for a requested difficulty and mechanic | Naïve agent, OpenAI or OpenRouter model | Abhinav |
| **Solver** | Plays each level hundreds of times with bot players. Reports the win rate, moves left, and attempts per win. | Code on a Naïve Computer (or a Render worker) | Abhinav |
| **Tuner** | Changes the move limit, colors, and blockers until the level hits its target. Rejects levels that never get there. | Naïve agent + Solver | Abhinav |
| **Playtester** | Plays shipped levels on real phones: checks that they load, that touch works, and that nothing breaks. Records the play. | Naïve agent driving Mobilerun phones over MCP | Noel |
| **Market Research** | Plays top puzzle games on phones to study their mechanics and difficulty. Mines app reviews for "need more levels" and "level too hard." Builds the studio target list. | Mobilerun, Monid, Apify, Naïve Data | Noel |
| **Sales** | Emails studios a sample pack made for their genre, answers replies, tracks the deal, and sends a payment link | AgentMail, HubSpot, Stripe | Teammate 4 |
| **Publisher** | Ships packs to the live game. Turns playtest recordings into trailers and posts them. | Vercel, Naïve Media, Naïve Social | Max |

## Sponsor tools: what each one does for us

Every tool has one clear job in the main loop. None of them is decoration.

| Tool | Its job | Why it matters for judging | Owner |
|---|---|---|---|
| **Naïve** | Runs the company. The CEO coordinator and its team, board cards as hand-offs, budgets on every agent, per-tool allow/ask/deny, cron for "new pack every 3 hours," a Computer for the Solver, Media for trailers and art, and Social for posting | Required, and competes for Best use of Naïve | Abhinav (setup), Teammate 4 (CEO) |
| **Mobilerun** | Cloud iPhones and Androids. Playtests our levels in a real mobile browser, researches top puzzle games, and records gameplay. A live phone view goes in the dashboard (`@mobilerun/react`). | Best Mobile Automation, and a live "the agent is playing right now" moment on stage | Noel |
| **Monid** | App Store and Google Play reviews and top charts. Finds games whose players want more levels. Hunter.io lookups for studio contacts. Video models for trailers. | Turns "find customers" into a measurable pipeline | Noel, Max |
| **Apify** | Bulk scraping: the full puzzle category on Google Play, studio websites, and itch.io puzzle games | Builds the target list at scale | Noel |
| **AgentMail** | The sales inbox: sends sample packs to studios, receives replies, and keeps threads | The "selling" in "making, selling, shipping, earning" | Teammate 4 |
| **HubSpot** | Studio pipeline: found → sample made → emailed → replied → pilot paid → delivered | Shows a company, not a script | Teammate 4 |
| **Stripe** | Payment links for studio pilot packs, and hint or level packs in our game. Test mode until the team agrees to go live. | The "earning." A real payment beats any dashboard number. | Teammate 4 |
| **OpenAI / OpenRouter** | Models. A strong model for level design and sales replies, cheap models for sorting thousands of reviews. Route through Naïve's model proxy where we can, so spend shows up in one ledger. | Unit economics: cost per level | Abhinav |
| **Vercel** | Hosts the game (phone-friendly web app) and the company heartbeat dashboard | Judges and the audience can play it from a QR code | Max (game), Teammate 4 (dashboard) |
| **Neon** | Postgres for levels, solver results, player sessions, the activity log, and sales state. $250 in credits. | The durable history the demo replays | Abhinav |
| **Render** | A worker that runs Solver batches if a Naïve Computer is too slow or costly for hundreds of plays per level. Pick one by 3:00 PM. | Throughput: levels tested per hour | Abhinav |
| **Luxor** | Stretch. Train a small model overnight that predicts difficulty from a level's layout, skipping most simulation. King's research found a learned model can beat simulation-only bots at predicting how hard a level feels to people. | A strong technical story if time allows. Skip it otherwise. | Abhinav |

### Our credits

| Provider | What we have | Use it for |
|---|---|---|
| Naïve | $250, Pro plan free through Nov 30 | Agent models, Computer time, media, data runs |
| Mobilerun | 1,500 credits, 30,240 minute units (Android 1/min, iOS 2/min), 10 GB proxy traffic. Access ends 72 hours after claiming. | **All phones.** Use Mobilerun, not Naïve's phones. |
| Neon | $250 | The database |
| Monid | $20 signup credit | Reviews, charts, contacts, video models |

**Phones: use Mobilerun directly, not Naïve's phones.** Naïve's phones bill $0.08 per iPhone-minute
to the $250 Naïve balance, so one iPhone running overnight costs about $38. Mobilerun's minute
units cover far more than 72 hours of iPhone time. Naïve agents still drive the phones: add
Mobilerun's MCP server (`https://cloud.mobilerun.ai/api/mcp`) to the agent as an MCP toolset.
Claim the Mobilerun credits when we're ready to use them, because the 72 hours start then.

## How level generation works

The research is clear on what works. Exact solving doesn't: Candy Crush is NP-hard. Studios and
researchers measure difficulty by **simulating play with bots** and comparing the results to real
player data.

1. **Simple, deterministic rules.** An 8×8 grid, 4–6 colors, a move limit, one goal per level
   (collect N of a color, or clear marked tiles), and a few blocker types. A seeded random number
   generator makes every result reproducible.
2. **One engine, used everywhere.** A single TypeScript rules package runs in the web game, the
   Solver, and the Playtester's checks, so they can never disagree about the rules.
3. **Designer.** A model proposes levels as JSON for a requested difficulty and mechanic. Code
   validates every level against the schema before anything else runs.
4. **Solver.** Bot players with different styles (random, greedy, and a light tree search) play
   each level hundreds of times. Output: win rate, average moves left, and attempts per win.
   Researchers use bot "personas" that imitate different human play styles for this.
5. **Tuner.** Adjusts the move limit and layout until the level lands within a few points of its
   target win rate. Levels that can't get there are thrown out and counted.
6. **Difficulty curve.** The CEO sets a target per level and mixes easier and harder levels.
   Studios flag long runs of levels at nearly the same difficulty as a design problem.
7. **Real player data closes the loop.** The game records attempts, wins, quits, and moves left.
   The CEO compares the planned curve with actual results and retunes. Playrix describes this
   practice, and one studio recommends "attempts per level" over pass rate as the measure.
8. **Keep the first few levels hand-checked.** Generated levels are often too easy, impossible, or
   dull, which is why studios hand-design the levels that teach the game. We hand-check our first
   five and let agents make the rest.

## Team plan

The Team and ownership section in `AGENTS.md` has the same split. Each person works in their own
directory.

### Abhinav: the game engine, the level pipeline, and the platform

1. **First 90 minutes:** the rules engine and the level JSON schema. Everyone else depends on
   them, so publish the schema in `log.md` as soon as it's stable.
2. The **Solver**, with bot players and win-rate measurement, on a Naïve Computer or Render.
3. The **Designer** and **Tuner** agents on the Naïve SDK.
4. The **platform:** Neon tables (levels, solver runs, player events, activity log, sales), the
   Naïve Team setup that the CEO coordinates, and budgets on every agent.
5. Stretch: the Luxor difficulty model.

### Max: the game players see, its look, and the video

1. **The playable web game** on Vercel, using Abhinav's engine. It must feel good on a phone,
   because judges and the audience will play it from a QR code.
2. **Art direction:** an original tile set, backgrounds, and a name and logo, using Naïve image
   generation. This competes for Best design.
3. **Telemetry:** the game sends attempt, win, quit, and moves-left events to Neon.
4. **Trailers:** turn Mobilerun playtest recordings into short "watch the agent play" clips with
   Naïve Media (clips and captions) or Monid's video models. Post them through Naïve Social.
5. A **level-pack page** for each new pack, so the Sales agent can link studios to a playable
   sample.

### Noel: phones and market research (Mobilerun, Monid, Apify)

1. **First hour:** get a Mobilerun iPhone that a Naïve agent controls over MCP. It opens our game
   in Safari, plays one move, and takes a screenshot.
2. **The Playtester agent:** plays each shipped level on an iPhone and an Android, checks that it
   loads and touch works, flags bugs, and saves a recording. On Android, Chrome can be driven
   directly, which lets the agent read the game's state for exact results.
3. **Competitor research:** the agent plays top puzzle games on phones and records their mechanics,
   move limits, and difficulty patterns for the Designer. Research only: never copy levels or art.
4. **Market research:** use Monid and Apify to pull App Store and Google Play reviews for puzzle
   games and find the ones whose players ask for more levels or complain about difficulty
   spikes. That's the Sales agent's target list, with a reason for each studio.
5. Keep one logged-in device per account, and don't reset devices.

### Teammate 4 (_name TBD_): the CEO, sales, money, and the demo

1. **The CEO agent:** a Naïve Team coordinator with the other agents as its roster. Each run, it
   reads player data, solver results, sales, and spend, then decides the next pack's curve, which
   studios to pitch, and where the budget goes. It logs every decision with its reason.
2. **Sales loop:** the target list from Noel → a sample pack in the studio's genre → a personal
   AgentMail message with a playable link and a Stripe pilot link → replies → HubSpot stages.
   Keep it small: twenty real, personal emails, no spam.
3. **Stripe:** pilot-pack payment links and in-game hint packs. Test mode until the team agrees to
   go live.
4. **Heartbeat dashboard:** levels made, the share that passed the solver, target vs. measured
   difficulty, players, sessions, studios emailed, replies, payments, spend, cost per level, and
   human step-ins, with a live phone view and the activity log underneath.
5. **The demo script and the backup recording.**

### If we're behind, cut in this order

If 8:00 PM Saturday arrives without a full loop, cut in this order: Luxor, trailers and social
posts, Android playtesting, in-game purchases, then competitor research on phones. Always keep
Design → Solve → Tune → Ship → Playtest on a phone → CEO decision → Sales email.

## Timeline

Hacking runs from 1:00 PM Saturday to **11:00 AM Sunday, the code freeze**.

| When | Milestone |
|---|---|
| Sat now–3:00 PM | **Spikes.** Engine and schema (Abhinav). A phone a Naïve agent controls (Noel). First tile set and game shell (Max). The Naïve Team skeleton and a first review scan (Teammate 4). |
| Sat 3:00 PM | **Contracts.** Agree on the level JSON, solver results, player events, the activity log, and environment variable names. Write them in `log.md`. Choose Naïve Computer or Render for the Solver. |
| Sat 3:00–6:00 PM | First 20 levels generated, solved, and tuned. The game is playable on phones at a public URL. |
| **Sat 6:00 PM** | **Switch the company on.** The CEO ships the first pack on cron, and Sales sends its first personal emails. |
| **Sat 8:00 PM** | **Full loop:** design → solve → tune → ship → phone playtest → player data → CEO decision → sales. |
| Sat 8:00 PM–2:00 AM | Fix what broke. Add budget caps and kill switches. Get real people playing (the room, our posts). |
| **Sun 2:00–8:00 AM** | **Hands off.** Packs ship every 3 hours, the CEO retunes from player data, and Sales answers replies. Log every step-in. |
| Sun 8:00–10:00 AM | **Feature freeze at breakfast.** Read the overnight log, fix the worst failure, check every demo path, and record a backup. |
| Sun 10:00–11:00 AM | Rehearse. |
| **Sun 11:00 AM** | **Code freeze.** Judging begins. |

## The demo (3 minutes)

Open with the result, not the architecture.

1. **0:00–0:20: the result.** "At 2:00 AM we stopped touching this company. Since then its agents
   designed N levels, tested each 500 times, shipped N packs, retuned N levels from what N players
   did, emailed N studios, and spent $N. We stepped in N times." Real numbers only.
2. **0:20–1:10: one level's life.** The Designer's draft → the Solver says 3%, too hard → the Tuner
   gets it to 41% → a phone plays it → players' real win rate → the CEO's retune.
3. **1:10–1:40: one decision we didn't make.** The CEO's log entry that changed the plan, and the
   numbers behind it. For example: "Levels 30–40 lost 60% of players. Eased the curve and moved the
   hard level from 34 to 38."
4. **1:40–2:20: the live part.** A QR code on screen. The audience plays a level the agents made a
   minute ago, while a Mobilerun iPhone plays it on the big screen. The CEO retunes it from the
   room's results.
5. **2:20–3:00: the business.** The studio pipeline and any replies or payments. Bottom-up math:
   studios × levels per month × price per level, with a source for every number. "If we leave it
   running, tomorrow it will have shipped more levels, learned from more players, and pitched more
   studios. We set the goal and the budget." Then the list of step-ins, honestly.

The main screen is the **heartbeat** dashboard. Agent activity goes underneath, expandable.

## Risks

1. **Naïve's approval rules can stop the overnight run.** Sending email, `mobile`, `data_run`,
   `generate_video`, and `social.post` all **ask a human by default.** A person's API key can set
   most of them to `allow`, but an agent can't set `generate_video` to `allow` itself. Worse: once
   a chat reads people's data (such as an inbound email), every send, phone action, and MCP call in
   that chat asks *each time, even at `allow`.* **Abhinav and Teammate 4 test this in the first
   hours.** A likely fix is to keep reading replies and sending actions in separate chats. Every
   approval we click overnight is a step-in judges count. Source: Naïve docs, Tools → Permission
   policies.
2. **Level quality.** A solver measures difficulty, not fun. Keep the rules simple, hand-check the
   first levels, and let player data catch dull ones.
3. **Players by Sunday.** The game needs real players for the data loop. Use the hackathon room,
   our own posts, and a QR code at our table.
4. **Studios buy slowly.** Expect replies or a letter of intent, not a payment, in 22 hours. The
   in-game purchase is our faster path to a real dollar.
5. **Format mismatch.** Every studio stores levels differently. Deliver our documented JSON plus
   playable previews, and offer conversion as part of a pilot.
6. **Research limits.** Phones play other companies' games only to study them. Follow each game's
   terms, and never copy levels or art.
7. **Spend.** Cap every Naïve agent's budget and set a daily limit in Monid. Phone minutes bill the
   Naïve balance directly if we ever use Naïve's phones, so we don't.

## Sources for the level-generation approach

- [Gudmundsson et al., Human-Like Playtesting with Deep Learning (King, 2018)](https://gwern.net/doc/reinforcement-learning/imitation-learning/2018-gudmundsson.pdf):
  learned models vs. MCTS bots for predicting Candy Crush level difficulty
- [Predicting Game Difficulty and Engagement Using AI Players (2021)](https://arxiv.org/pdf/2107.12061):
  reinforcement learning combined with tree-search bots
- [Automated Playtesting of Matching Tile Games (2019)](https://arxiv.org/pdf/1907.06570):
  bot personas that imitate human play styles
- [Difficulty Modelling in Mobile Puzzle Games (2024)](https://arxiv.org/pdf/2401.17436):
  combining player analytics with simulated data
- [Improving Conditional Level Generation using Automated Validation (2024)](https://arxiv.org/pdf/2409.06349):
  difficulty-conditioned match-3 generation checked by bot playthroughs
- [Walsh, Candy Crush is NP-hard](https://www.semanticscholar.org/paper/Candy-Crush-is-NP-hard-Walsh/9affceb3e2f5fc492106ea0065039be67a720dac)
- [Playrix: creating levels and elements for match-3 games](https://gameworldobserver.com/2019/09/27/playrix-levels-elements-match-3):
  planned vs. actual difficulty curves
- [Room 8 Studio: the state of tile-puzzle level design](https://room8studio.com/news/smart-casual-the-state-of-tile-puzzle-games-level-design-part-1/):
  attempts per level, 40–80 levels a month in live ops (one vendor's figure), and why studios
  hand-design teaching levels
- Naïve docs: [Mobile device](https://usenaive.ai/docs/computer/mobile.md),
  [Tools and permissions](https://usenaive.ai/docs/capabilities/tools.md),
  [Team](https://usenaive.ai/docs/team/overview.md)
- Mobilerun docs: [index](https://docs.mobilerun.ai/llms.txt), including Browser Automation and
  Embed a device stream

## Docs

- Agent instructions and rules: `AGENTS.md` (Claude Code reads it through `CLAUDE.md`)
- How to win: `docs/how-to-win.md`
- What each push did: `log.md`
- Naïve SDK: https://vetta.sh/docs/llms.txt
- Mobilerun: https://docs.mobilerun.ai/llms.txt
