# Demo stage

One screen for the projector that shows the company's agents working, live from the real
activity log. Owner: Noel.

```bash
./demo.sh                  # live, from the activity log in Neon. Opens a full-screen window.
./demo.sh --replay <file>  # play back a saved run (the backup if the network or database fails)
./demo.sh --sample         # invented events for rehearsing the layout, with a big "SAMPLE DATA" banner
./demo.sh --check          # check the stage's setup and exit 0 when it's ready
npm --prefix demo run snapshot   # save the current log to demo/data/run-<time>.jsonl for --replay
```

Keys on the stage: **F** full screen, **D** setup details (only you see them).

## What's on screen

| Panel | Where the number comes from |
|---|---|
| Running on its own for | Time since the newest human step-in in the log (or since the first logged action if there are none) |
| Agent actions, Decisions, Human step-ins, Spent | Counted from the log rows: `human` rows are step-ins; rows with `saw`/`chose` are decisions; `cost_usd` is summed |
| The team | Each agent's count and latest action. A dot pulses while an agent acted in the last 45 s. |
| What the agents are doing | The log, newest first. Decisions show Saw / Why / Expected / Result. Step-ins are amber. |
| Phone playtest | A screenshot of the Mobilerun phone about once a second, fetched by the server |
| Become a customer | A QR code for `DEMO_JOIN_URL`: the signup page. Someone enters their game, and the agents audit its reviews and email them live. |
| Play it yourself | A QR code for `DEMO_PLAY_URL` |
| Studios | `studios` counts by stage, plus paid `payments` (test and live shown separately) |

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
3. Never present `--sample`. It's for checking the layout only.
