# Demo plan: Level AI

Owner: **Noel**. Two deliverables: a **2-minute video due 11:00 AM Sunday** (the top 10 teams go to
live presentations), and a **3-minute live demo at 1:00 PM** if we make the cut. Everything shown is
real, live, or clearly labeled as a recording. Every number comes from the activity log or the
console. Rewritten Nov 7, 7:50 PM to match what is actually built.

## The idea in one line

> "Level AI is a puzzle-game level studio with no employees. Its agents read what players say about
> the top games, sell to the studios, build and bot-test levels, playtest on a real iPhone, and get
> paid. Here's what it did since we stopped touching it."

## What only we can show

1. **The judge becomes a customer in 30 seconds.** Scan the QR, enter any game, and an email
   arrives quoting that game's own players (verified at 30 s end to end).
2. **A real iPhone, live, playing App Store games.** It plays Candy Crush to study the genre leader,
   plays our own levels, and posts our marketing on X from Safari.
3. **A $49 level pack that builds itself.** A paid order makes the phone study the customer's
   game, then the agents build 20 levels one at a time (design → 50+ bot plays → tune → accept), and
   the console counts "level 7 of 20 accepted at 52% (target 50%)". The pack is emailed and the
   phone plays level 1.
4. **Real money and an honest step-in list.** Live Stripe checkout for $5 / $49 / $199 a month,
   and every human step-in listed with who and why.

## 2-minute video storyboard (record tonight and at 10:30 AM)

Screen-record the console (levelai-console.vercel.app, full screen with F) plus the phone, and
voice over. Use only real names from the log: the studios we emailed are Loop Games, Rotatelab,
GOODROID, ABI Games, Oakever Games, and Hidden Folks B.V. Don't invent studios, games, levels, or
step-ins.

| Time | On screen | Voiceover |
|---|---|---|
| 0:00–0:10 | A real review quote from the outreach board, e.g. Bus Traffic Fever: "levels are impossible to pass without power up". | "Puzzle games live or die on their levels. Players tell studios exactly what's wrong, in reviews nobody reads." |
| 0:10–0:20 | Console header: "Running on its own for …", agent actions, human step-ins. | "Level AI is a studio run by AI agents. This is the company's live log since we stopped touching it." |
| 0:20–0:35 | Market research card (reviews read), a "read N reviews of 30 top free puzzle games" feed row. | "Every 10 minutes the research agent reads a top chart: thirty games, the newest reviews of each. It's read [N] so far, and a model checks every quote." |
| 0:35–0:50 | Outreach board: a studio card with the evidence sentence, the quote, and the email subject. | "When three or more players describe the same problem, the sales agent writes to the studio's public address, quoting them. [N] studios so far, each with an opt-out." |
| 0:50–1:15 | The phone, live: a Candy Crush study, then our level. The console counts the pack: "level k of 20 accepted". | "A studio orders a level pack. The iPhone plays their game to measure its difficulty curve. Then the agents build twenty levels: design, fifty bot plays, tune, accept, one at a time." |
| 1:15–1:30 | Pack email arriving; the phone opens the pack's first level. | "The pack lands in their inbox with each level's target and measured difficulty, and the phone plays the first one." |
| 1:30–1:45 | /pricing, then a Stripe live payment (only if real), or the live checkout page. | "Three products, live payments: a five-dollar iPhone playtest, a forty-nine-dollar pack, and a subscription." |
| 1:45–2:00 | The "Where a person stepped in" list, then the logo. | "Here's every time a human stepped in, and why. Everything else, the agents did." |

Fill in each [N] from the console right before recording. If no real payment has happened, say
"live checkout" and show the checkout page, not a test receipt.

## Live demo (3:00)

| Time | Show | Say |
|---|---|---|
| 0:00–0:15 | Console header. | The one-line idea, plus the biggest real overnight number. |
| 0:15–0:25 | The QR on the console. | "Judges, scan this and enter any puzzle game. Then put your phone down." |
| 0:25–1:00 | Feed: reading reviews → audited → email sent. | Narrate the agents as they work. "Check your phone." |
| 1:00–1:40 | A pack run already in progress (start it before presenting with `POST /orders/demo-run`): the phone study row, then levels counting up. | "This order came in N minutes ago. The phone studied the game, and the agents are on level k of 20." |
| 1:40–2:10 | The phone, live, on our level or on Candy Crush. | "A real cloud iPhone, driven by our playtest agent. Paid orders get it first." |
| 2:10–2:40 | /pricing, then the step-in list. | "Live payments. And here's every human step-in." Read them honestly. |
| 2:40–3:00 | Numbers. | Studios found, emailed, reviews read, levels accepted, spend. "We set the goal and the budget; the agents run it." |

## Honest answers to likely questions

- **"Where did humans step in?"** Read the console list: the 6 PM switch-on, Pinara's level-pipeline
  fixes, logging in to X on the phone, signing in to the App Store phone, and anything since.
  Never invent or hide one.
- **"Do you put levels inside the customer's game?"** No. Packs are levels in our engine for their
  genre (match-3, sort, racer, parking), calibrated to how their game plays, delivered as playable
  previews plus JSON in a documented format (/developers).
- **"Is the cold email spam?"** Role-based addresses only, real quotes, at most 40 a day, an opt-out
  line, and auto-replies only to clear yeses.
- **"How does it scale?"** Costs are compute, not people: about $0.0015 per game read, one small
  model call per qualifying game, cloud-phone minutes per playtest, and solver CPU per level. More
  phones and more solver workers scale it linearly.
- **"Why Naïve?"** The team, its crons, budgets, and the Marketing, Research, CEO, and Designer
  agents run on Naïve. Naïve pauses tool calls after an agent reads data from an MCP server, so the
  tuner is a deterministic program and that rule shows up in our step-in story. Say so.

## The night before (checklist)

- [ ] The business server, console, solver worker, and keepalive scripts are running on Noel's laptop (they keep it awake). `curl https://levelai.vercel.app/health` is ok.
- [ ] The readiness check is green where it can be: `cd platform/checks && PLATFORM_URL=… EXPECT_RUNNING=1 npm run check`.
- [ ] At least one level is accepted and plays at /play (the tuner fix is in).
- [ ] One pack run completes end to end with `POST /orders/demo-run`. Note its wall time.
- [ ] X on the phone is still logged in (the last phone post succeeded).
- [ ] Record the 2-minute video once tonight as a backup. Re-record at 10:30 AM with fresh numbers and submit before 11:00.
- [ ] Don't touch the system after midnight unless something is broken. Each step-in shows on the console.

## If something breaks on stage

| Break | Do |
|---|---|
| The email takes longer than 45 s | Keep narrating the feed. Past 90 s, show the email from the 10:30 AM test and say it's from the rehearsal. |
| Phone view frozen | Open the Mobilerun dashboard's live view, or say the phone is between jobs and show the last playtest row. |
| The public site or console is down | The watchdogs restart a dead tunnel within about a minute. Meanwhile, show localhost:4545. |
| The pack run is slow | Show how far it got ("level k of 20") and the levels already accepted. Don't pretend it finished. |

Never claim a step that didn't happen, and never present rehearsal data as live.
