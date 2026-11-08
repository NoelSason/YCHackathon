# Level AI: product audit

**As of Sat Nov 7, 2026, 7:00 PM PT**, at `main` c9128f2. Written by Abhinav (with Claude) from the
code, the tests, and the "State:" lines in `log.md`. "Verified" below means a log entry says it
ran for real and names the evidence; everything else is "built" (typechecks, tests pass) or
"designed" (docs only). Re-audit at 1:00 AM and 8:00 AM; the scoring is the master plan's
(autonomy, numbers, visible output, sponsor depth, demo reliability).

## 1. The one-paragraph verdict

The company exists end to end on paper and most of it exists in code with passing tests, but
**the production loop has never completed once**: no real Designer or Tuner session has run, there
are zero accepted levels for any real game, `/play` says "levels are on the way," and the CEO has
made no decision that wasn't a smoke test. The cause is a single platform behavior, Naïve's
`read_people` rule, which holds every MCP call after the first in a chat. Until that is resolved
(options A–D, decision due 8 PM), everything downstream of "agent reads, then acts" is blocked.
The business side is in far better shape than the production side: inbound signup → audit email
was verified at 30 s, a real cold email went out, and the money path (test card → webhook →
delivery → iPhone playtest → report) was proven end to end in Stripe test mode at 17:53.

## 2. Status by area

| Area | Owner | Built | Verified live | Blocked / missing |
|---|---|---|---|---|
| Platform (Neon schema, MCP server, 22 tools, adapter registry) | Abhinav | ✓ typechecks, smoke OK against the deployed function | ✓ 15:15 smoke against Neon; 17:28 redeploy with real games; 18:26 redeploy with metrics split | `get_spend` Naïve/Monid/Mobilerun ledgers not wired (nulls) |
| Naïve Team (9 agents, 5 crons, vault, kill switch, checks) | Abhinav | ✓ | ✓ agents created 15:21, approval probe 16:10, switch-on 16:45 | **`read_people` stalls every multi-step agent.** Designer cron created after switch-on is still disabled. |
| Solver harness + evals | Pinara | ✓ 19/19 + 10/10 tests | Local Postgres only (17:42: Splash Sort at 49% for 50% target). A worker runs on Noel's laptop since 17:58. | Not verified against Neon. Match-3 tunability was 0/5 with `move_limit` alone; `goal.target` rule added 18:02, untested live. |
| Games & adapters: match3, platformer, lotescape (Max); watersort, racer (Pinara) | Max / Pinara | ✓ adapters registered; hub live at `levelai.vercel.app/games` (18:35) | Hub verified in headless Chrome; `/play` verified locally 17:22 | Platformer has no browser UI; Lot Escape not in the registry and has render bugs; racer's `oil`/`shield` need a redeploy; no real-phone play verified. |
| Research + outreach + CRM | Noel | ✓ 140/140 tests | ✓ inbound signup → audit email 30 s (15:33); cold email to Hidden Folks 17:57; auto-replies 17:53 | Sender shows "AgentMail" and a forced footer; Naïve CRM calls never verified live; `/leads` path doesn't write the CRM. |
| Billing (Stripe, test mode) | Noel | ✓ | ✓ **17:53 end to end**: test card → `checkout.session.completed` → `payments` row → delivery → iPhone playtest → report email | Pilot and hint-pack delivery is manual ("left for a person"). `/thanks` success URL has no route (404 after paying a pilot link). Live charges need business verification + `BILLING_ALLOW_LIVE=1`. |
| Phone playtests (Mobilerun) | Noel | ✓ | ✓ 16:45 order → iPhone → report; 17:57 market study | App Store installs fail; order queue is in memory (a restart drops orders); iPhone showed iCloud addresses on the projector (17:24). |
| Marketing / social | Noel | ✓ | ✗ every X post fails ~4 s after scheduling (18:52); earlier "posted" lines were wrong | X account likely restricted; needs reconnect or verification. |
| Demo stage, console, site | Noel | ✓ | ✓ console 401/200 (17:40); site pages 200 | Everything routes through cloudflared tunnels on Noel's laptop; URL changes on restart; watchdogs re-run. The demo script claims "running since 2 AM" and CEO decisions that don't exist yet. |
| Player (`/play`) | Max | ✓ | ✓ local win 17:22 | Production empty: zero match-3 levels. |
| Readiness checks (17 files) | all | ✓ | 10/16 green at 17:58 | Red: `levels_flow`, `design_tune_solve`, `publish_play`, `player_events`, `ceo_decision` (all downstream of the stall). No check for "dashboard numbers come from Neon." |

## 3. Blockers, in order

1. **`read_people` (P0).** Reading any MCP output sets the flag; every later MCP call in the chat
   pauses for approval even at `allow`. Reproduced on `ses_vmxkc2…` (16:45) and `ses_dgf2ak…`
   (18:26, after the metrics split). `npm run approval-test` reproduces it in a minute. Options
   in `log.md` 18:40: (A) Naïve exemption, (B) auto-approver for our own servers, logged and
   disclosed, (C) humans approve per run, logged as step-ins, (D) one-read-batch agents. Nothing
   in §4 matters until this is picked.
2. **Zero real levels (P0, consequence of 1).** Without a Designer run there is no pack, no `/play`,
   no player events, no "free levels" link in the welcome email, and no CEO decision with data
   behind it. The Designer cron (`dep_pf9e3h9p…`) is also still disabled: `npm run kill -- on`.
3. **Solver never run against Neon (P1).** The worker on Noel's laptop knows all games, but no log
   entry shows a real match-3 level measured in production. Pinara's 18:02 numbers are local.
4. **Tunnel dependency (P1).** `levelai.vercel.app/mcp`, `/leads`, `/webhooks/*` all forward to a
   quick tunnel on one laptop. A sleep, a restart, or a Wi-Fi change changes the URL; the agents'
   vault entry survives (the site URL is stable) but the forwarder must be re-pointed.
5. **Demo claims ahead of reality (P1).** `docs/demo-script.md` opens with "running on its own
   since 2 AM" and a CEO decision record. If 1–2 aren't fixed by ~1 AM, that script is false and
   must be rewritten around what did run (inbound signup, phone playtest, test payment).

## 4. Risks and gaps (not blockers)

- **Autonomy number.** If option C is taken, every approval is a step-in and the number judges see
  drops with each cron run. If B, say it on stage in one sentence.
- **Pilot delivery is manual.** A paid pilot creates a pending delivery and a log line; a person
  must deliver. Fine for the demo if said plainly; not fine if the demo implies otherwise.
- **`/thanks` 404** after a pilot payment. One route in `business/src/app.ts`.
- **Platform `create_payment_link`** used to return a fake `example.invalid` link; now returns an
  error pointing at `business.create_payment_link` (this audit's commit).
- **Spend numbers.** `get_spend` returns nulls for Naïve, Monid, Mobilerun; only Monid's per-run
  cost reaches `activity_log.cost_usd` (18:18). "Total spend $X" on stage will undercount.
- **In-memory state** in the business server (playtest queue, research targets, drafts) is lost
  on restart; the watchdog restarts it.
- **Email identity.** Sender shows "AgentMail", not "Level AI"; the inbox key can't change it.
- **Privacy on stage.** The iPhone feed showed iCloud addresses once; use a clean device profile.
- **Lot Escape** is on the hub but not in the adapter registry, so no levels can be made for it.
- **Platformer** has an adapter but no playable UI, so it can't appear on a phone.
- **Secrets.** Noel's full `.env` was pasted into chats today; rotate anything that matters after
  the event, and never `git add` a `.env` (the hook won't catch it).

## 5. What is verified and can be shown on stage tonight, stall or no stall

- A judge scans the QR, enters a game, and gets the audit email in ~30 s (15:33, 17:53).
- A real iPhone plays a level from a written plan and emails a report (16:45, 17:57).
- A test-mode Stripe payment moves a lead to `pilot_paid`, queues delivery, and triggers a
  playtest (17:53).
- The console and site are live behind a password, with a replay snapshot path.
- The platform answers 22 MCP tools from a public URL, and the readiness checks run as one command.

## 6. Recommended order for the next three hours

1. **Decide A/B/C/D** (team, by 8 PM). Then `npm run kill -- on` so the Designer cron is enabled.
2. **Get one real match-3 level accepted in Neon** (Pinara + Abhinav): run `npm run ceo-now` or
   trigger the Designer directly, approve by hand once if needed, watch the Solver measure it,
   accept, `publish_pack`. That single event turns five red checks green and fills `/play` and
   the welcome email's "free levels" link.
3. **Rehearse `docs/demo-inbound.md`** (Noel): one test lead, one reply, one test payment, confirm
   `npm run check -- --only=billing,billing_payment`.
4. **Fix the small things that touch the demo:** `/thanks` route; Designer cron enabled; clean
   phone profile; one sentence in the script about test mode and about manual pilot delivery.
5. **Rewrite the demo opening** at 1 AM from the logs, not the plan.
6. **Restart notes** in `log.md` at 1 AM: how to restart `live.sh`, the solver worker, the
   console; where `team.json` and the kill switch are; who's on call.
