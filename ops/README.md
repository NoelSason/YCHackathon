# ops

Overnight reliability for Level AI on Noel's laptop: a health monitor that watches the public
site, the console, the activity log, the solver, and both cloud iPhones, and recovers what it can.

## What runs

| Process | Started by | Log |
|---|---|---|
| `ops/monitor.sh` (every 5 min) | `ops/keepalive.sh` | `/tmp/levelai-monitor.log` |
| `business/keepalive.sh` (every 15 s) | you, or the monitor if it died | `/tmp/levelai-biz-keepalive.log` |
| `demo/keepalive.sh` (every 10 s) | you, or the monitor if it died | `/tmp/levelai-keepalive.log` |
| `solver-keepalive.sh` | you, or the monitor if it died | `/tmp/levelai-solver-keepalive.log`, worker output in `$TMPDIR/levelai-solver.log` |
| Business server `:8787` | `business/live.sh` or its keepalive | `$TMPDIR/levelai-business.log` |
| Console `:4545` | `./demo.sh` or its keepalive | `$TMPDIR/levelai-demo.log` |

Start the monitor once:

```sh
(nohup ops/keepalive.sh >> /tmp/levelai-monitor-keepalive.log 2>&1 &)
```

One dry-run pass (no recoveries, prints the result): `ops/monitor.sh --once`.

## Reading the log

One line per pass:

```
2026-11-07 20:07:04 OK health=200 console=401 agent_row_age=0s solver_heartbeat_age=23s playtest_row_age=239s phones=ready/ready kill_switch=false
```

| Field | Healthy when |
|---|---|
| `health` | `levelai.vercel.app/health` returns `{"ok":true}` |
| `console` | `levelai-console.vercel.app` returns 401 without the password |
| `agent_row_age` | an agent wrote to `activity_log` within 30 min. The level compiler's bulk `production.*` rows and the watchdog's own rows don't count, so a flood of compiler output can't hide dead business loops |
| `solver_heartbeat_age` | a running solver worker's heartbeat (`settings.solver_worker:*`) is under 3 min old |
| `playtest_row_age` | shown for information; the phone loop runs every 30 min |
| `phones` | both Mobilerun devices report `ready` (read-only API call) |

A red check shows how long it has been red, for example `health=502(red 10m)`. `RED` at the start of
the line means at least one check is red.

Once an hour it also writes `balances: monid=$… naive_team=$… vercel_cli=ok|SIGNED-OUT`, plus a
`WARN` line for a signed-out Vercel CLI or a recent deploy failure (`$TMPDIR/levelai-deploy-failures.log`).
The hourly `vercel whoami` also refreshes the CLI's short-lived token.

`grep -E 'RED|RECOVERY|WARN' /tmp/levelai-monitor.log` shows only what needs a look.

## Recoveries

After a check has been red for 15 minutes, the monitor runs its recovery, at most once every
20 minutes per check, and writes one row to `activity_log` as agent `watchdog`, for example
"restarted the public site's connection", with the reason and what it did. Nothing is written to
`activity_log` unless a recovery ran.

| Check | Recovery |
|---|---|
| Public site | If the current tunnel still answers, redeploy `site/` only (a Vercel rewrite problem). Otherwise kill the `:8787` tunnel and listener and rerun `business/live.sh` |
| Public console | Rerun `demo/console.sh` (new tunnel, console redeployed). If `:4545` is down locally, its keepalive restarts `./demo.sh` |
| Activity log | Restart the business server by its port; `business/keepalive.sh` brings it back. Skipped while the kill switch is on |
| Solver heartbeat | Send the worker SIGTERM through `solver-keepalive.sh`'s process tree; the keepalive starts a new one in 10 s |
| Phones | None. It logs the state; a person checks the Mobilerun dashboard. It never resets or releases a device |

A dead keepalive is restarted on the next pass, without the 15-minute wait, and logged as a
watchdog row.

## Rules it follows

- Restarts only through ports (`lsof -ti tcp:PORT -sTCP:LISTEN`), the existing scripts, or the
  keepalives. It never kills `tsx` by name.
- It never prints a secret: keys are read from `.env` inside subshells and only status codes and
  balances are logged.
- It holds `caffeinate -ims` while it runs, so the Mac doesn't idle-sleep. That doesn't stop sleep
  when the lid closes or on battery: keep the laptop plugged in and open.
- Logs it knows about are trimmed to their last 2,000 lines once they pass 50 MB.

## Tuning

Environment variables: `MONITOR_INTERVAL_S` (300), `MONITOR_RED_AFTER_S` (900),
`MONITOR_RETRY_AFTER_S` (1200), `MONITOR_LOG` (`/tmp/levelai-monitor.log`).

To stop it: `pkill -f ops/keepalive.sh; pkill -f ops/monitor.sh`.
