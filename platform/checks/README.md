# Demo-readiness checks (Abhinav)

One command runs every demo-path check from `docs/master-plan.md` → "Demo readiness", prints a
table, and writes one row per check to the `checks` table (the dashboard shows the latest row per
check). Exit code 1 if anything is red.

```bash
cd platform/checks && npm install && cp .env.example .env   # fill it in
npm run check                      # before switch-on: infrastructure must be green
EXPECT_RUNNING=1 npm run check     # after 6 PM: the loop must be producing (levels, decisions, outreach)
npm run check -- --json            # for the dashboard
npm run check -- --only=ceo_decision,deployments
```

Run it at **6:00 PM, 10:00 PM, 1:30 AM, 8:00 AM, 10:30 AM** (the master plan's times). From 8 AM
nothing deploys unless it's all green.

## Checks

| Check | Owner | Protects |
|---|---|---|
| `platform_health` | Abhinav | the Neon Function answers |
| `mcp_tools` | Abhinav | the 20 tools list with the bearer |
| `solver_queue` | Pinara | no run queued > 10 min or running > 15 min |
| `levels_flow` | Pinara | a real-game level accepted in the last 3 h (after switch-on) |
| `publish_play` | Max | the newest pack's first level opens by URL |
| `player_events` | Max | games post to `/events` (after switch-on) |
| `ceo_decision` | Abhinav | a CEO decision in the last 2 h (after switch-on) |
| `deployments` | Abhinav | the three cron deployments are enabled and scheduled (after switch-on) |
| `kill_switch` | Abhinav | publishing isn't blocked |
| `business_health` | Noel | the business server's `/health` answers |
| `outreach` | Noel | ≤ 20 sends/day; some outreach since switch-on |
| `autonomy` | Abhinav | the agent-actions vs step-ins number, computed, never typed |

## Adding yours

One file in `src/checks/`, default-exporting a `Check` (see `src/types.ts`): read, fetch, query,
compare, return `{ ok, detail }`. Never change state. Under 60 s. The runner picks it up by filename
order. The phone-playtest, billing, dashboard, and live-phone-view checks are still owed by Noel
and Max.
