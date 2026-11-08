# Demo stage

One screen for the projector that shows the company's agents working, live from the real
activity log. Owner: Noel.

```bash
./demo.sh                  # live, from the activity log in Neon. Opens a full-screen window.
./demo.sh --replay <file>  # play back a saved run (the backup if the network or database fails)
./demo.sh --rehearsal      # an invented 3-minute story for practicing, under a big "REHEARSAL DATA" banner (--sample still works)
./demo.sh --check          # check the stage's setup and exit 0 when it's ready
npm --prefix demo run snapshot   # save the current log to demo/data/run-<time>.jsonl for --replay
```

Keys on the stage (press **?** to see them on screen):

| Key | What it does |
|---|---|
| **F** | Full screen |
| **O** | Switch between the company and the outreach board, in place (its "← Back to the company" button, Esc, or the logo also go back) |
| **Q** | Show the "Become a customer" QR code full screen for the room to scan |
| **P** | Spotlight the phone (also: click the phone) |
| **D** | Setup details (only you see them) |
| **?** | Show or hide the keys |
| **Esc** | Close whatever is open |

Clicks: an agent card filters the feed to that agent; a feed row expands to its full text, exact
time, and cost; a number (actions, decisions, step-ins, spent) opens a drawer with the rows behind
it; a studio stage opens a drawer with the studios in it; the phone enlarges with the latest
playtest steps. While a drawer is open, only **Esc** works.

The page fits one screen when the window is at least about 850 px tall (1920x1080 and 1440x900 on
a projector). In a shorter window it scrolls, and the team, feed, and step-ins scroll inside their
panels.

## Moments

When certain rows arrive, the stage celebrates them for a few seconds: a banner over the team and
feed, and a burst of tiles for the big ones. Sound is off. They're matched from the row's action
text exactly as the business server writes it (`src/moments.ts`, tested in `test/moments.test.ts`):

| Row | Moment |
|---|---|
| `outreach sent to <studio>` | Email sent (big) |
| `reply from <studio>` / `read reply from <studio>` | Reply (big / small) |
| `new inbound lead: <studio>` | "Someone just signed up" (big) |
| `playtest ordered by <team>` | New playtest order (small) |
| `playtesting <team>'s app on the iPhone` | "Now testing" (big), and the phone panel is spotlit |
| `playtested <team>'s app` | Playtest finished (small) |
| `emailed the playtest report to <team>` | Playtest report sent (big) |
| `payment received: <product>` | Payment (big). A row whose result says "test mode" is labeled a test payment everywhere. |
| `audited <game>`, `found a public contact for <studio>` | Research (small) |
| Any decision row | Decision (big) |

Only rows that arrive while the page is open are celebrated, at most three per batch. No row, no
moment.

## What the stage leaves out

- Studios with `source = 'internal_test'` (the team's own test orders) and smoke-test studios, from
  the pipeline, the payments, the outreach board, and the stage drawers.
- Setup checks: rows from the `probe` agent or whose action starts with `approval_test`. Human
  step-ins are always shown.
- Plumbing in results (message ids, lead ids). Hosted app addresses are shown by app name
  (`levelai.vercel.app` reads as "levelai").

## What's on screen

| Panel | Where the number comes from |
|---|---|
| Running on its own for | Time since the newest human step-in in the log (or since the first logged action if there are none) |
| Agent actions, Decisions, Human step-ins, Spent | Counted from the log rows: `human` rows are step-ins; rows with `saw`/`chose` are decisions; `cost_usd` is summed |
| Running on its own for | Also shows the agent actions logged since that step-in, and a 6x6 board of the last 36 actions, one tile per action in the agent's color (a striped tile is a human step-in) |
| The team | Each agent's count and latest action, latest first. A card lights up while its agent acted in the last 45 s. |
| What the agents are doing | The log, newest first. Decisions show Saw / Why / Expected / Result. Step-ins are amber. |
| Phone playtest | A screenshot of the Mobilerun phone about once a second, fetched by the server |
| Become a customer | A QR code for `DEMO_JOIN_URL`: the signup page. Someone enters their game, and the agents audit its reviews and email them live. |
| Play it yourself | A QR code for `DEMO_PLAY_URL` |
| Studios | `studios` counts by stage, plus paid `payments` (real earnings and test payments shown separately; test is always labeled "not real") |
| Market research (under the team) | `biz_market_research`: every store-chart pass the Research agent logged, totalled (reviews read, and how many reviews say the levels are too hard, too easy, need more levels, or repetitive). Click it for each pass with its strongest example. Rehearsal shows invented passes; a replay says research isn't part of it |
| Outreach board (O, or `/outreach`) | Every studio with the evidence sentence, the player quote, the email subject and time, reply status, and stage, refreshed every 5 s, with totals on top |

Nothing is typed in. Without a log the stage says so and shows the setup details.

## Setup (all in the repo's `.env`)

| Variable | Needed for | Default |
|---|---|---|
| `DATABASE_URL` | Live mode | (none) |
| `DEMO_ACTIVITY_TABLES` | Which log tables to read, as `table:time_column`, comma-separated | `activity_log:ts,decisions:ts` |
| `DEMO_STEPIN_TABLES` | Tables where every row is a human step-in | `interventions:ts` |
| `MOBILERUN_API_KEY`, `MOBILERUN_DEVICE_ID` | The phone panel. It only reads screenshots; it never provisions or resets a device. | (none) |
| `DEMO_PLAY_URL` | The "Play it yourself" QR code | (none) |
| `DEMO_JOIN_URL` | The "Become a customer" QR code. `business/live.sh` sets it. | (none) |
| `DEMO_REPLAY_SECONDS` | How long a replay takes to play its newest 40 events | `90` |
| `DEMO_PORT` | Port | `4545` |

The defaults read the shared tables in `platform/db/schema.sql`. Tables that don't exist yet are skipped. The reader accepts
`at`/`ts`/`time`/`created_at`, `agent`, `action` or the decision-record fields, `human`, `cost_usd`, and
details nested in a `payload` or `data` JSON column.

## Before judging

1. `./demo.sh --check` is green.
2. `npm --prefix demo run snapshot` after the overnight run and again at 10:30 AM. Keep the newest
   file ready for `--replay`. A replay shows a purple "Replay of the recorded run" banner, so it's
   never passed off as live.
3. Never present `--rehearsal`. It's for practice only: every studio, game, and number in it is
   invented, and the banner says so the whole time.

## Rehearsal

`./demo.sh --rehearsal` plays an invented story on a loop, about three minutes long, with a moment
every 10 to 25 seconds: Research scans the charts and audits games with review evidence, finds a
public contact, Sales emails the studio, a studio signs up at the table, a playtest starts ("Now
testing"), the report goes out, the studio replies, a test payment arrives, and the CEO makes a
decision with Saw / Why / Expected / Result. Two human step-ins sit early in the invented night.
Names are made up and addresses use the reserved `.example` domain. The outreach board and studio
drawers show matching invented studios.

Screenshot helpers (rehearsal or live, they only open views): `?view=help|qr|phone|outreach|details`,
`?agent=<agent>`, `?drawer=actions|decisions|stepins|spend|research`, `?stage=<stage>`, `?expand=1`,
`?still=1` (polls instead of streaming, for headless Chrome). `?show=<moment kind>` replays a moment
from history, and only in rehearsal mode.
