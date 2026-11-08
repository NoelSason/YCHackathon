# Master plan

**Locked in Sat Nov 7, 2:20 PM.** This file is the source of truth for who does what and when.
`docs/plan.md` explains the company and the technical design. `docs/agent-plan.md` details the
agents. If this file and another doc disagree, this file wins. Change it only with the team's
agreement, and log the change.

Based on the strengths files in `docs/strengths/` (Noel, Abhinav, Pinara), the team's decision
that Max owns game integration, and Noel's choice to own business ops.

## The two rules above everything else

1. **The company runs without us.** Judges score how much of it runs on its own. Every human
   step-in is logged with its reason.
2. **Everything in the demo really works.** No mocks shown as real, no "the agents did this"
   unless they did. Every demo path passes an automated check before judging (see "Demo
   readiness"). A pre-recorded backup is allowed only if we say it's a recording.

## Who owns what

| Person | Owns | Why them |
|---|---|---|
| **Max** | **Game integration:** the match-3 and platformer adapters and clients, the Geometry Dash editor workflow, hosting, and player events. Then the **heartbeat dashboard.** | Team decision. Integrating the games into our web platform leads straight into the dashboard. |
| **Pinara** | **Level quality:** the Solver harness, bot players and programmatic adapter solvers, the Designer and Tuner agents, the evals, and the CEO's "did that decision work?" check | Highest in solvers (4). Wants agents and solvers. Strong at evals and causal questions. |
| **Abhinav** | **The Naïve backbone:** Neon, the platform's MCP server, the Naïve Team setup (coordinator, roster, board, skills, budgets, permissions, cron, kill switch, the approval-rule test), the CEO agent's loop, and the demo-readiness checks | Agents 4, backend 4. Wants to learn to build an MCP server with per-tool permissions. |
| **Noel** | **Business ops (top priority), then mobile.** Outreach, finance, billing, and CRM as agents on the Naïve SDK. Mobilerun phones under agent control for playtests. The demo script. | Wants business ops and mobile. Business 3 with live Stripe experience, mobile 4, backend 5. |

**Workload** (S=1, M=2, L=3): Max 7, Noel 8, Abhinav 9, Pinara 10. Cut the Geometry Dash editor
workflow first if it stalls the two product adapters.

## Work packages

| # | Package | Size | Blocks others? | Owner | Backup |
|---|---|---|---|---|---|
| 1 | Match-3 and platformer adapters (schema, validate, simulate/solve, load by URL, events, `SKILL.md`) | L | **Yes**, the adapter contract is due at 3:00 PM | Max | Pinara |
| 2 | Geometry Dash official-editor workflow through Mobilerun; host any connected product games | M | No | Max | Pinara |
| 3 | Heartbeat dashboard | M | No | Max | Pinara |
| 4 | Neon schema, activity log, and step-in log | M | **Yes** | Abhinav | Noel |
| 5 | Platform MCP server | M | **Yes** | Abhinav | Noel |
| 6 | Naïve Team setup, approval-rule test, kill switch | L | **Yes** | Abhinav | Noel |
| 7 | CEO agent loop and decision record | M | No | Abhinav | Pinara |
| 8 | Solver harness and bot players (match-3, platformer) | L | **Yes** for difficulty numbers | Pinara | Abhinav |
| 10 | Designer and Tuner agents | M | No | Pinara | Abhinav |
| 11 | Evals and the CEO's expected-vs-result check | M | No | Pinara | Abhinav |
| 12 | **Business ops: outreach** (Research, Sales Sender, Sales Reader agents, CRM, inbound leads) | L | No, but it's the "selling" in the brief | Noel | Abhinav |
| 13 | **Business ops: finance and billing** (Finance agent, Stripe, fulfillment, receipts) | M | No, but it's the "earning" | Noel | Abhinav |
| 14 | Mobilerun phones under Naïve control, playtest tools, Playtest Lead agent | M | **Yes** for playtests | Noel | Abhinav |
| 15 | Demo script, demo checklist, and backup recording | S | No | Noel | Pinara |
| — | Plan runner (the Mobilerun agent works inside a studio's own app) | M | No | Stretch for Noel | Abhinav |

## Business ops (Noel, on the Naïve SDK)

Business ops runs as members of the Naïve Team's roster, coordinated by the CEO through board
cards like everything else. It's built on the Naïve SDK, not as side scripts.

### Outreach

1. **Research agent:** finds game companies to pitch, using Monid (App Store and Google Play reviews
   and charts, Hunter.io for public company contacts), Apify (the Google Play puzzle category,
   itch.io), and Naïve's Data and Social data. Each target gets a reason a person could check,
   such as "214 reviews in the last 30 days ask for more levels." Only public business contacts.
2. **Sample first:** for each target, it writes a `design` card for that studio's genre, so the
   pipeline makes a playable sample before anyone reaches out.
3. **Sales Sender:** a short, personal email with the playable sample link and a pilot offer. About
   20 emails a day at most. It states only numbers it got from a tool, and includes who we are and
   a way to opt out (US email law, CAN-SPAM).
4. **Sales Reader:** reads replies and writes a summary card for the Sender. Reading and sending
   stay in separate chats, because of Naïve's approval rule on chats that have read email.
5. **Inbound leads at the event:** a QR code at our table and on our site: "Get 10 free levels for
   your game." The form creates a CRM lead, and the agents take it from there. Founders in the room
   with puzzle games are the fastest path to a real customer. Talking to people at our table is
   fine. Once someone signs up, the agents do the rest.
6. **CRM stages:** found → sample made → emailed → replied → pilot paid → delivered.

### Finance and billing

1. **Billing:** Stripe payment links for pilot packs and in-game hint packs. A Stripe webhook
   records each payment in Neon and makes a `deliver` card. Delivery sends the pack and a receipt.
   Refunds always ask a human.
2. **Finance agent:** a roster member that reports to the CEO every few hours. It reads spend (the
   Naïve credit ledger, `monid balance`, Mobilerun minutes) and revenue (Stripe), works out cost
   per accepted level, margin per pilot, and spend against budget, and flags overruns to the CEO.
   It can propose a price change within limits the team sets, but never charges anyone itself.
3. **Live payments:** decide by 6:00 PM whether Stripe goes live. **Check now** whether the Stripe
   account can take live payments, because activation asks for business details and can take
   time. A real payment from a real customer is strong proof. A payment we make ourselves isn't, so
   never present one as revenue.

### Two choices to make in the first 30 minutes of business work

- **CRM:** Naïve's own CRM (`client.crm`), which the CEO can read directly, or HubSpot (a sponsor).
  Default to Naïve's CRM. Mirror to HubSpot only if time allows.
- **Email:** AgentMail (a sponsor), with its webhook starting the Reader, or Naïve's own email,
  which wakes the owning agent when a reply arrives. Default to AgentMail, and fall back to Naïve
  email if it's slow to wire up.

## Contracts due at 3:00 PM

Write each one in `log.md` when agreed.

| Contract | Between | What it defines |
|---|---|---|
| Game adapter | Max ↔ Abhinav, Pinara | `schema`, `validate`, `simulate`, `solve`, load by URL, events, `SKILL.md` (see `docs/plan.md`) |
| MCP tool list | Abhinav ↔ Pinara, Noel | Tool names, inputs, outputs, and each tool's permission (allow, ask, deny) |
| Activity log and step-in log | Abhinav ↔ everyone | The fields every agent writes, including the decision record in `docs/agent-plan.md` |
| Playtest tool | Noel ↔ Pinara, Abhinav | The input (level URL, device) and the result (loaded, touch OK, visual issues, outcome, recording link) |
| Business events | Noel ↔ Abhinav, Max | Lead, email sent, reply, payment, delivery: the Neon tables and what the dashboard shows |

## Timeline, per person

Hacking ends at **11:00 AM Sunday, the code freeze.**

| Time | Max | Pinara | Abhinav | Noel |
|---|---|---|---|---|
| **2:20–3:00** | Check adapter source candidates: license, copied art or music, levels as data, rules that run in Node | Solver harness skeleton and the bot interface | Neon tables, activity log, Naïve Team skeleton, **approval-rule test** | Mobilerun phone under Naïve control over MCP: open a game, tap, screenshot |
| **3:00** | **Contracts agreed (all four)** | | | |
| **3:00–4:00** | Match-3 adapter: rename, re-art, schema, validate | Match-3 bot players | MCP server v1 (`validate_level`, `solve_level`, `save_level`) | Playtest tool v1. **Check whether Stripe can take live payments.** Pick the CRM and email tool. |
| **4:00–6:00** | Match-3 adapter; platformer adapter and source audit. | Designer and Tuner for match-3. First 20 accepted levels. Eval set. | Roster on the board, budgets, cron, `publish_pack`, `get_player_stats`, kill switch | Research, Sales Sender and Reader, payment links, Stripe webhook to fulfillment, the inbound lead QR |
| **6:00** | **Switch on.** First packs ship on cron. First outreach emails go out. | | | |
| **6:00–8:00** | Platformer adapter integration. Geometry Dash local-editor Mobilerun workflow, if device/tool are available. | Platformer bot runs and difficulty numbers | CEO loop running on cron, with real decisions | Finance agent v1. A test payment end to end: link → pay → webhook → deliver → receipt. |
| **8:00 PM** | **Full loop on two games:** design → tune → solve → ship → phone playtest → player data → CEO decision → outreach → payment | | | |
| **8:00 PM–1:00 AM** | Heartbeat dashboard | Platformer solver and CEO expected-vs-result check by 10:00 PM. | Demo-readiness checks. LiveOps event (stretch) | Reply handling, CRM stages, finance numbers on the dashboard. Plan runner (stretch) |
| **1:00–2:00 AM** | **Pre-flight.** Every demo check green. Budgets set. Kill switch tested. Restart notes in `log.md`. | | | |
| **2:00–8:00 AM** | Off (restart notes left) | **On call:** agents, solvers, levels | Off unless confirmed (restart notes left) | **On call:** phones, outreach, payments |
| **8:00–10:00 AM** | **Feature freeze at breakfast.** Fix the worst overnight failure. Every demo check green. Record the backup. | | | |
| **10:00–11:00 AM** | **Rehearse twice.** | | | |
| **11:00 AM** | **Code freeze.** Judging begins. | | | |

Nobody sits idle waiting on a contract. If you're blocked, work against a stub of the contract
and swap in the real thing when it lands.

## Demo readiness: everything must work

Each owner writes an automated check for their path. Abhinav runs them all as one command and
shows the results on the dashboard. Run them at **6:00 PM, 10:00 PM, 1:30 AM, 8:00 AM, and
10:30 AM**, and fix anything red before moving on.

| Demo path | Check | Owner |
|---|---|---|
| Design → tune → solve | A new level for each live game reaches its target and is saved | Pinara |
| Publish → play | The level opens by URL and plays on a phone browser | Max |
| Phone playtest | A Mobilerun phone plays the level and returns a result and recording | Noel |
| CEO decision | The CEO's latest run logged at least one decision with a reason | Abhinav |
| Outreach | A test lead gets a sample link and an email, and the CRM stage changes | Noel |
| Billing | A Stripe test payment triggers delivery and a receipt | Noel |
| Dashboard | Every number on the heartbeat screen comes from Neon, with no hard-coded values | Max |
| Live phone view | The phone stream shows on the dashboard | Noel |

**From 8:00 AM, nothing deploys unless every check is green.** If a path can't be made reliable by
10:00 AM, cut it from the demo and say so. Don't fake it.

The **autonomy number** on the dashboard comes from the logs: agent actions vs. human step-ins.
Never type it in by hand.

## What we took from the research

From `docs/how-to-win.md` and three pasted research write-ups (Nov 7):

- **Keep:**
  - A real customer and a real payment beat any metric slide. Hence the inbound QR at our table
    and the live-payments check.
  - The QA-agency angle ("our agents playtest your app on real phones") is a second offer, built on
    the plan runner.
  - Show "agents did X, humans did Y" plainly, with numbers from the logs.
  - A small fallback demo: if all else fails, a Naïve agent drives a real phone through one level
    and reports back.
- **Reject:**
  - Guessed code (`mobilerun.run(device_id, …)`, `monid.discover(...)` and `monid.run(...)` as
    Python calls, `naive.agents.create({ model: "gpt-4" })`). Use the real docs.
  - A "Developer" agent that edits game code or compiles Unity. Our agents write level data, and
    the adapters load it.
    - Sudoku or crossword drift. Match-3, platformer, and the separate Geometry Dash editor workflow are set.
  - Saying a number like "92% autonomy" that we didn't measure.
  - Timelines that assume 24 or 48 hours.

## Cut order

If 8:00 PM arrives without the full loop on two games, cut in this order: Luxor, phone research on
other companies' games, the plan runner, Android playtests, the LiveOps event, the HubSpot mirror,
then the Geometry Dash editor workflow. **Never cut** design → tune → solve → ship → phone playtest → CEO decision
→ outreach → billing on at least two games.
