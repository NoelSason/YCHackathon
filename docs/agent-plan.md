# Agent plan

This doc covers the agents that run the company: who they are, what each one does, how they hand
work to each other, and how we keep them running overnight without a human.

**Owners** (see `docs/master-plan.md`):

- **Abhinav:** the Naïve Team setup (coordinator, roster, board, skills, budgets, permissions, cron,
  kill switch), the approval-rule test, and the CEO agent
- **Pinara:** the Designer and Tuner agents, the evals, and the CEO's expected-vs-result check
- **Noel:** the business agents (Research, Sales Sender, Sales Reader, Finance) and the Playtest
  Lead

The games and their skills come from Max. Changes to any contract go in `log.md`.

Every Naïve feature named here comes from the Naïve docs index (https://vetta.sh/docs/llms.txt).
Read the page before using a feature. Field names and limits can change.

## Goal

The company's goal, written once in the CEO's instructions:

> Keep every game's levels on its target difficulty curve. Ship a new pack for each game on
> schedule. Win studio pilots. Stay under the daily budget. Log every decision with its reason.

Every agent serves that goal, and every action ends up in the activity log.

## Step 0: check the marketplace (first 20 minutes)

Naïve's marketplace has ready-made companies. Two may save hours:

- **AI Automation Agency:** a CRM, a public site, and a workspace per client, with a team that
  works the pipeline. It could be our base, with each game as a client.
- **Security Testing Agency:** testers use a client's product the way a customer would. That's
  close to our playtesting.

Deploy one in a scratch company, read its team and tools, and decide: start from it, borrow
parts, or start from scratch. Templates make every send ask for approval by default ("every
session waits for your yes"), so change those settings on purpose.

## Step 1: test the approval rules (first hour)

This decides whether the overnight run needs us. From the Naïve Tools docs:

- `email.send`, `mobile`, `data_run`, `generate_video`, `social.post`, and other tools that send,
  spend, or publish **ask by default.** A per-tool `configs` entry set from a person's key can
  change most of them to `allow`. An agent can't set `generate_video` to `allow` itself.
- **Once a chat has read people's data** (contacts, mail, messages, a connected app), every send,
  `mobile`, `data_run`, `web_fetch`, and MCP or connected-app call in that chat **asks each time,
  even at `allow`.** The flag also passes to any chat it hands work to.

Test it:

1. Give a test agent our MCP tools and Mobilerun's MCP tools at `allow`. Run it. Confirm nothing
   asks.
2. Have it read one inbound email, then call a tool. Confirm whether the call asks.
3. If it does, split the work. A **Reader** chat reads the reply and writes a short summary card
   to the board. A fresh **Sender** chat, which never read the mail, acts on the card. Check
   whether reading the card flags the Sender too.
4. Write what you find in `log.md`. Anything that still asks overnight is a step-in on the demo.

## The team

A Naïve **Team** is a coordinator agent plus a version-pinned roster of specialists. They hand
work over in two ways: direct delegation, and **cards on a shared company board**, where
assigning a card starts the teammate on it. We use board cards for every hand-off, because the
board is durable and the dashboard can show it.

| Agent | Starts when | Reads | Tools | Produces |
|---|---|---|---|---|
| **CEO** (coordinator) | Cron, every 60 minutes | `get_company_metrics`, `get_player_stats`, the last run's decisions | Board, `log_decision` | Decisions with reasons, and new cards for the team |
| **Designer** | A `design` card | The game's skill, the target difficulty, notes from Research | `validate_level`, `save_level` | Levels as JSON (structured output against the game's schema) |
| **Tuner** | A `tune` card | A saved level and its target | `solve_level`, `save_level` | An accepted level with measured difficulty, or a rejection with the reason |
| **Playtest Lead** | A `playtest` card | A pack's level URLs, or a studio app's details | Noel's Mobilerun tools (over MCP), including the plan runner | A **plan** (JSON, see `README.md` → "Two ways a game connects"), then pass or fail per level, notes, and a recording link |
| **Research** | Cron, every 4 hours, plus `research` cards | Monid, Apify, and Naïve Data (reviews, charts, social posts) | `crm_update` | A studio target list with a reason for each, and genre notes for the Designer |
| **Sales Reader** | An inbound email | One reply | Board | A summary card: who, what they asked, and the suggested next step |
| **Sales Sender** | An `outreach` or `reply` card | The card only | AgentMail send, `create_payment_link`, `crm_update` | A sent email and a CRM stage change |
| **Finance** | Cron, every 3 hours | Naïve credit ledger, Monid balance, Mobilerun minutes, Stripe revenue | `get_company_metrics`, board | Spend vs. budget, cost per level, margin per pilot, and overrun flags for the CEO. Never charges anyone. |

Keep the roster this size. More agents mean more hand-offs to debug.

### The CEO's loop

Each run:

1. **Look:** per-game difficulty (target vs. measured vs. real players), packs shipped, pipeline
   stages, spend against budget, and failed cards.
2. **Check last time:** for each earlier decision, did it work? Example: "Eased levels 30–40 in
   game 2. Quits fell from 60% to 35%." Record the result.
3. **Decide:** at most three changes per run, each with a reason. Examples: change a game's curve,
   order a new pack, retune levels that players find too hard, move budget between games, change
   which studios to pitch.
4. **Assign:** write the cards.
5. **Log:** call `log_decision` for each decision.

### Decision record

Every decision goes to the activity log in this shape. The dashboard and the demo read it.

```json
{
  "time": "2026-11-08T02:14:00-08:00",
  "agent": "ceo",
  "saw": "Game 2, levels 30–40: target win rate 45%, players' real win rate 18%, 60% quit at level 34",
  "options": ["retune levels 30–40", "add a hint at level 34", "do nothing and collect more data"],
  "chose": "retune levels 30–40 toward 45%",
  "why": "Quits are concentrated at level 34, and its solver win rate (41%) is far above the players' rate, so the bots are better than people on this layout",
  "expected": "Quits at level 34 below 35% within 3 hours",
  "cost_estimate_usd": 0.9,
  "cards": ["tune:g2:l30-40"]
}
```

The next CEO run fills in `"result"`. "Expected" vs. "result" is the strongest evidence that the
agents make real decisions.

## Card types

| Card | Made by | Done by | Done when |
|---|---|---|---|
| `design` (game, count, target curve, notes) | CEO | Designer | Levels saved and valid |
| `tune` (level ids, targets) | CEO, Designer | Tuner | Each level accepted or rejected |
| `playtest` (pack id) | CEO | Playtest Lead | Every level marked pass or fail |
| `publish` (pack id) | CEO | Platform tool `publish_pack` (no agent needed) | Pack live |
| `research` (question) | CEO | Research | Targets and notes saved |
| `outreach` (studio) | CEO, Research | Sales Sender | Email sent, CRM updated |
| `deliver` (payment id) | Stripe webhook | Platform tool (no agent needed) | Pack delivered and receipt sent |
| `reply` (thread summary) | Sales Reader | Sales Sender | Reply sent or a deal step taken |

**Playtests run as plans.** The Playtest Lead never taps a screen itself. It writes a plan (which
app, which levels, how many tries, what to report, what never to touch), and the Mobilerun agent
carries it out inside the app on a cloud phone. The same plan format works for our three games and
for a studio's own app, so studios need no code to start. Validate the results against the plan:
every planned level has a result, or a reason it's missing.

Flow for one pack: `design` → `tune` → `playtest` → `publish`. A level that fails a playtest goes
back to `tune` once. If it fails again, it's dropped and counted.

## Skills: one per game

A Naïve skill is a versioned `SKILL.md` attached to an agent and loaded only when needed. Max
writes a `SKILL.md` for each game: the rules, the level format, what makes a level hard, and two
example levels.

The three skills differ in what a "level" is and how the Tuner judges it:

| Game | A "level" | The Tuner's target |
|---|---|---|
| Match-3 | Grid, colors, blockers, goal, move limit | Win rate from bot plays, within a few points of target |
| Rhythm runner | Obstacles timed to a song's beats | Proven possible by the solver, plus a target timing tightness and bot win rate |
| Board game | A board (prices, rents, tile order, theme) or a challenge scenario | Balance: no strategy or seat wins far more than its share, and games end within a target number of turns | Push each one as a Naïve skill (`naive skill push --slug game-<name> --file ...`)
and attach all three to the Designer and the Tuner. Pin versions (`game-<name>@3`) once a game is
stable, so a skill edit can't change overnight behavior by surprise.

## Structured outputs

The Designer's result must be a level that validates. Set the session's structured output to the
game's JSON Schema, which comes from Max's adapter. Then call `validate_level` anyway, because a
schema can't check game rules (for example, "the goal is reachable").

## Budgets

Set a cap on every agent (`cap_micro_usd`, `max_task_micro_usd`, `period`). These numbers are a
starting point to adjust after the first real runs. They keep most of the $250 Naïve balance in
reserve.

| Agent | Daily cap | Per-task cap |
|---|---|---|
| CEO | $10 | $0.50 |
| Designer | $35 | $0.50 |
| Tuner | $25 | $0.40 |
| Playtest Lead | $10 | $0.40 |
| Research | $10 | $1.00 |
| Sales Reader + Sender | $10 | $0.30 |
| Finance | $3 | $0.20 |
| **Total** | **$103** | |

Phone minutes run on Mobilerun's credits, not Naïve's. Monid runs use Monid's $20. Solver compute
runs on a Naïve Computer (billed to Naïve) or Render.

## Models

- **Designer, Tuner, CEO, Sales Sender:** a strong model. These are the judgment calls.
- **Research sorting** (thousands of reviews): a cheap, fast model through OpenRouter.
- Route through Naïve's model proxy where we can, so all spend sits in one ledger. Use
  OpenRouter directly only for bulk work outside a Naïve session.

## Is it working? Checks to run every few hours

| Check | Good sign |
|---|---|
| Designer: share of levels valid on the first try | Over 80% |
| Tuner: share of levels that hit their target within 4 rounds | Over 60% |
| Cost per accepted level | Falling, or steady |
| Playtest failure rate | Under 10% |
| CEO: share of decisions whose result matched what it expected | Recorded honestly. A low number is still data. |
| Sales: reply rate | Recorded. Twenty personal emails, not hundreds. |

Before switching on at 6:00 PM, build a small test set: five target difficulties per connected
game. Run it after every prompt change to the Designer or Tuner, and keep a change only if the
numbers hold or improve.

## Milestones

| When | Done |
|---|---|
| 2:15 PM | Marketplace templates checked. Base chosen. |
| 2:45 PM | Approval rules tested and written in `log.md` |
| 3:00 PM | Contracts agreed: the MCP tool list with Abhinav, the skill format with Max, and the playtest tool with Noel |
| 4:30 PM | Designer and Tuner make one accepted level for the match-3 game, end to end |
| 5:30 PM | The CEO runs on cron and writes its first real decision |
| **6:00 PM** | **Switched on.** Packs on schedule, and Research and Sales running |
| 8:00 PM | Full loop on two games, playtests included |
| 2:00 AM | Hands off. Budgets set, kill switch tested |

## Kill switch and failures

- **Kill switch:** one platform setting that pauses all cron jobs and makes every send tool
  `deny`. Test it before 2:00 AM.
- **Retries:** a failed card is retried once. A second failure marks it failed, and the CEO sees it
  in its next run.
- **Loops:** a level can't go through `tune` more than twice, and a pack can't be re-ordered more
  than once an hour.
- **Budget hit:** when an agent reaches its cap, its cards wait. The CEO logs it and may move
  budget, but never above the total.
- **Honesty:** the Sales Sender never states a number it didn't get from a tool, and never promises
  something the platform can't deliver.

## Docs to read

- Team: https://usenaive.ai/docs/team/overview.md
- Coordinator: https://usenaive.ai/docs/team/coordinator.md
- Company board: https://usenaive.ai/docs/team/board.md
- Context and budgets: https://usenaive.ai/docs/team/context-and-budgets.md
- Policies: https://usenaive.ai/docs/concepts/policies.md
- Tools, permissions, and MCP connectors: https://usenaive.ai/docs/capabilities/tools.md
- Skills: https://usenaive.ai/docs/capabilities/skills.md
- Structured outputs: https://usenaive.ai/docs/capabilities/structured-outputs.md
- Deployments and cron: https://usenaive.ai/docs/capabilities/deployments.md
- Email and inbound events: https://usenaive.ai/docs/identity/email.md,
  https://usenaive.ai/docs/identity/inbound.md
