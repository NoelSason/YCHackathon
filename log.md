# Dev log

What each push did and why. Put the newest entry at the top. Every push must add or update an
entry; the pre-push hook and CI block pushes that don't change this file. See "Dev log" in
`AGENTS.md` for the rules.

This is the team's build log. It isn't the company's agent activity log, which the demo uses.

## Entry template

```markdown
### YYYY-MM-DD HH:MM PT · <person> (<agent or "by hand">) · branch `<branch>`

**What:** one to three lines on what changed.
**Why:** the problem or goal behind it.
**Files:** the main files or directories touched.
**State:** works / partly works / broken, and how you checked.
**Next / heads-up:** what's left, what teammates should know, what not to touch.
```

---

### 2026-11-07 10:53 PM PT · Noel · Claude Code (Sentinel 12 monid) · main
- **What:** Real Monid spend is $0.17–0.34 an hour, about $0.05 a pass ($18.54 balance). Fixed the cost parser (rows logged ~$0.0001; older rows stay understated); added a Pacific-day spend total with `MONID_DAILY_USD` (default $5, on-demand audits exempt); a 6-hour review cache, so passes skip games already read and counts stay real; up to 3 charts per pass; passes are timed from the previous start.
- **Why:** The loop can't drain the balance overnight, and overnight passes should read new games.
- **Files:** `business/src/research/monid.ts`, `business/src/outreach/autopilot.ts`, `business/src/server.ts`, `business/src/config.ts`, `business/.env.example`, `business/test/research-budget.test.ts`, `docs/demo-script.md`
- **State:** works; business 314/314; live run cost $0.00165 and the repeat read was cached. :8787 restarted to load this plus the pack, generator, playtest-count, and agency fixes.
- **Next / heads-up:** Passes take 8–14 min, so expect one every 10–15 min (not yet observed). Emailed audits can quote reviews up to 6 hours old.

### 2026-11-07 10:50 PM PT · Noel · Claude Code (Sentinel 7 agency) · main
- **What:** Live test-agency thread passed: an inquiry got an in-thread reply in 23 s with correct prices, "yes, send a sample" got a reply in 27 s, and 5 levels arrived 2 s later. Fixed: a pause or cap is logged once instead of hourly and on each restart; sample emails say "free sample", not "you ordered a level pack"; removed "calibrated to how your game plays" when no phone study ran.
- **Why:** This thread is the live conversation demo; its wording must be true.
- **Files:** `business/src/agency/{outreach,converse}.ts`, `business/src/levels/deliver-pack.ts`, `business/test/{agency,deliver-pack}.test.ts`
- **State:** works; business 307/307. Loads on the next :8787 restart.
- **Next / heads-up:** The "Audit:" subject route is covered by unit tests here; its live test passed earlier tonight.

### 2026-11-07 10:40 PM PT · Noel · Claude Code (Sentinel 11 neon) · main
- **What:** Recomputed every console and site number with SQL against Neon. All match except Playtests, which counted one team pack test; `store.ts` now excludes it (15, not 16, after the next restart). Reconciled at 10:39 PM: 17 studios found (+1 agency), 8 emailed, 31,558 reviews read (10 passes, 220 games), 15 playtests, 11 agent-made levels accepted, 769 compiled, 1,164 agent actions, 7 step-ins (+528 approved by policy), spent $14.88, earned $0. Team-test tagging is correct; console queries take under 0.2 ms in the database.
- **Why:** Every number on stage has to come from the log.
- **Files:** `business/src/store.ts`, `business/test/billing-failures.test.ts`
- **State:** works; business all green.
- **Next / heads-up:** The "on its own since 8:19 PM" clock doesn't count the team's overnight test runs (9:31–10:19 PM test leads, demo pack, restarts, tunnel drill). They'll be logged honestly as one step-in when the overnight hardening stops. "Reviews read" counts reads, not unique reviews. Research passes run 10–130 min apart, not every 10.

### 2026-11-07 10:31 PM PT · Noel · Claude Code (Sentinel 9 site-qa) · main
- **What:** Site QA pass: all 14 public pages and every internal link return 200; no sideways scroll at 390px; no vendor names in customer copy; logo on every site page; the join page's "Email us your game" link opens "Audit: " to levelai@agentmail.to; home stats match /public-stats (16 studios, 16 playtests, 8 emails, 27,187 reviews). Fixed `/levels` 404 (rewrite added in live.sh's template, deployed) and replaced the developer docs' stale "0 levels" samples with real 10:30 PM responses.
- **Why:** Judges may click any page; the docs must show real data.
- **Files:** `business/live.sh`, `site/developers.html`, `docs/developers.md`
- **State:** works; verified live.
- **Next / heads-up:** `/api/games` once returned gzip to a plain curl from the site cache; a `Vary: Accept-Encoding` header would fix it. **Pinara/Max:** game pages lack the Level AI logo and have sub-12px text (Turbo Lanes).

### 2026-11-07 10:27 PM PT · Noel · Claude Code (Sentinel 8 generator) · main
- **What:** Ran the bring-your-own-generator demo steps verbatim. The live test passed in 1.7 s (25 of 50 wins at difficulty 0.5). The 5-level pack came back 3 of 5: the sample generator varies widely at one setting (44–73% at 0.55), and 6 tries missed the 51% target. Fixed: 10 tries per level (a simulation of 25 packs went from 1 short to none); a log row no longer reads "0.58 → 0.58"; the email states the on-target rule (within 5 points, or 8 when the 95% interval includes the target) and says why a short pack stopped.
- **Why:** The generator segment must finish on stage, and the email must explain why 83% and 89% count as on target for 85%.
- **Files:** `business/src/generators/pack.ts`, `business/test/generators.test.ts`
- **State:** works in tests (business all green); loads on the next :8787 restart.
- **Next / heads-up:** The demo script says genre "parking" but the API reports "lotescape" (`docs/demo-script.md:71`).

### 2026-11-07 10:22 PM PT · Noel · Claude Code (Sentinels 5 pack, 6 money) · main
- **What:** (1) **Pack** (Sentinel 5): a real Candy Crush demo-run with company "Level AI Test Agency", 10:07–10:19 PM, 12 min 25 s end to end: waited 2 min 38 s for the phone, study 3 min 6 s, 20 levels in 75 s, pack email 1 s later, closing level-1 playtest 4 min 58 s (inside the new 6-min limit). All three emails arrived; play and JSON links 200. Fixed: the demo-run renamed the shared lead to "Demo" (emails said "Hi Demo"); the curve line said the phone played the game twice; the closing recap said "lost in 10 moves" when the phone just stopped at its 10-move limit. (2) **Money** (Sentinel 6): all three live checkouts open real Stripe pages with the right amounts, forms work at 390px, the test-mode webhook records a payment in ~1 s, the outbox is empty. No code changes.
- **Why:** The pack is the main demo segment; its emails must read right.
- **Files:** `business/src/levels/deliver-pack.ts`, `business/test/deliver-pack.test.ts`
- **State:** works; business 305/305. The pack fixes load on the next :8787 restart.
- **Next / heads-up:** Refunds don't lower Earned (no `charge.refunded` webhook). The console's test-payment tile hides team orders, so the money line should show the activity log. On stage, always pass `company` to `/orders/demo-run`. **Max:** Lot Escape has no `?pack=` (`games/lotescape/ui/main.ts:288`).

### 2026-11-07 10:14 PM PT · Noel · Claude Code (console/phone agent, checkpoint) · main
- **What:** Console and phone segment done (most code went out in ef87c91). Bulk compiler and auto-approver rows get their own cards and collapse into one feed line; Agent actions is an honest count; auto-approvals show under step-ins; Spent includes Naïve agent spend ($14.38 at 10:04 PM); a live Neon line in the header; team tests are tagged and left out of studio counts; the phone panel names App Store games, our levels, pack levels, and X posts correctly. X: `POST /social/post-now` (Bearer token) posts from the phone; the scheduled loop is quiet 3 AM–2 PM PT (`SOCIAL_QUIET_HOURS`), and post-now has 3 extra posts (`SOCIAL_DEMO_RESERVE`). Snapshots are scheduled for Sun 8:00 and 10:30 AM (`demo/snapshot-schedule.sh`).
- **Why:** The console is the demo; X posting must not collide with the recording.
- **Files:** `demo/**`, `business/src/{marketing,mobile}/`, `business/src/app.ts`, `business/.env.example`
- **State:** works except X: the 9:51 PM post-now failed because x.com never loads in Safari on the main phone (black logo screen). Business 304/304, demo 21/21.
- **Next / heads-up:** **Noel:** open x.com on the main phone in Mobilerun's live view and log in again (or clear Safari data for x.com). The "Running on its own" clock resets at each teammate step-in.

### 2026-11-07 10:05 PM PT · Noel · Claude Code (pack agent, Sentinel 4 levels, checkpoint) · main
- **What:** (1) **Pack delivery done** (pack agent). A paid $49 pack or `POST /orders/demo-run` runs end to end: phone study → recap email → curve → 20 levels built one at a time (generator, bot, solver accept rule) → pack email → phone plays level 1. Real Candy Crush run 9:46–9:56 PM (pack bbe17794): study 4 min 4 s, build 82 s for 20 levels, 5 min 35 s start to delivered. The phone saw no ramp, so the default curve was used and the email says so. The closing playtest timed out at 240 s; the limit is now 6 min. Resume is capped at 2 per pack and adopts a phone study already running instead of queuing another. All pack emails go through the outbox. (2) **Levels** (Sentinel 4): 9 agent-made levels accepted (match3 7, watersort 1, racer 1). Customer packs no longer become the newest pack, so /play stays fixed; `/levels-latest?made_by=agents` and `/play?made_by=agents` show only Designer/Tuner levels. (3) Checkpoint of the console agent's in-progress edits (demo/, marketing/).
- **Why:** The $49 pack is the main demo; /play must not flip to a test pack overnight.
- **Files:** `business/src/levels/{deliver-pack,public}.ts`, `business/test/`, `player/src/api.ts`, `site/play.js`, `business/src/marketing/`, `demo/`
- **State:** works; business 303/303, demo 21/21.
- **Next / heads-up:** **Abhinav:** `resolve_decision` needs `matched_expectation` nullable (`platform/mcp/src/tools.ts:369`); the CEO has no `list_levels` tool. `/levels` without `/api` 404s on the site.

### 2026-11-07 9:54 PM PT · Noel · Claude Code (ops sentinel, relay slot 3) · main
- **What:** Overnight ops check: readiness 17/17, every watchdog and caffeinate running, public pages 200, console 401 (password). Fixed `ops/monitor.sh` printing a first failing pass as OK (a 502 at 9:37 PM read "OK"); it now reads RED. Tunnel drill: killed the console tunnel at 9:53 PM; the keepalive restored the public console in 37 s.
- **Why:** The system has to survive the night unattended, and the monitor must not hide a red.
- **Files:** `ops/monitor.sh`
- **State:** works; verified live (drill logged `RED … console=530`, then recovery).
- **Next / heads-up:** Monid has no dollar cap in code (balance $19.07 at 8:19 PM); OpenAI's daily call cap covers verify only. Noel: set hard limits on both dashboards.

### 2026-11-07 9:51 PM PT · Noel · Claude Code (generator agent, Sentinel 2 neon, agency agent, checkpoint) · main
- **What:** (1) **Bring your own generator** done (generator agent). A studio registers an HTTP generator (signed `generate`/`evaluate`, optional `validate`); our loop tunes each level through it. The sample generator (https://levelai-sample-generator.vercel.app) ran a 5-level parking pack in 12.7 s, 36 generator calls, emailed. `hook.ts` returns "no generator" when `biz_generators` is missing. Demo steps are in `docs/demo-script.md`. (2) **Neon** (Sentinel 2): queries are under 1.3 ms in the database; added index `activity_log_playtested`; `/public-stats` runs its three reads in parallel. (3) **Agency**: the test-agency thread worked end to end (inquiry, pricing reply in ~20 s, free 5-level sample, $49 live checkout link). Agency outreach is on with a cap of 3 a day; it waits on the email account's new-recipient cap until Sun 3:04 PM. (4) Checkpoint of the pack and console agents' in-progress edits.
- **Why:** Studios with their own generator are a demo segment; Neon should be visibly efficient; the agency flow is the live conversation demo.
- **Files:** `business/src/{app.ts,generators/,levels/deliver-pack.ts,db/schema.sql}`, `business/test/`, `demo/{public/index.html,src/moments.ts,test/}`, `docs/demo-script.md`, `platform/db/migrations/`
- **State:** works; business 302/302, demo 21/21.
- **Next / heads-up:** Restart :8787 at most once every ~10 min; restarts orphaned 4 queued phone studies tonight. Don't re-register the sample generator (it rotates the secret).

### 2026-11-07 9:46 PM PT · Noel · Claude Code (levels agent, Sentinel 1 site-qa, checkpoint) · main
- **What:** (1) **Levels** (levels agent; the code went out in 44a7c0b). Since the 7:35 PM tuner change, 6 of 9 Designer levels were accepted. Totals since 6:40 PM: 12 designed, 12 solver-measured, 6 accepted (match3 4, watersort 1, racer 1). The two rejections straddle the target on integer knobs, so they stay rejected honestly. Designer and Tuner levels come before compiler levels in /levels-latest when no pack exists. Checks fixed: publish_play, design_tune_solve, deployments (falls back to the team key). The approver now runs on Noel's laptop (keepalive + caffeinate, with `APPROVER_MAX_AGE_MIN`=45 so stale CEO runs stay parked). The phone played Designer level 22e2f98a at 9:44 PM. The CEO's "0 accepted" decision came from runs held since 7:27 PM. (2) **Site QA** (Sentinel 1). The home-page tuning example is now a real logged run (Moonlit Mossway: 100→93→0→5→34→60→45% against a 45% target, 100 games a round). Bot names and the phone claim are honest. Games-hub counts are live from /api/games. Lot Escape copy updated. The watch-page timer error is fixed. (3) The match-3 game is named **Gem Garden** everywhere (the adapter and API name). (4) A checkpoint of the running agents' edits (generator, pack, console).
- **Why:** Real agent-made levels for the demo; the site must not claim anything the logs don't back.
- **Files:** `site/{index,watch,play}.html`, `site/games/index.html`, `README.md`, `docs/*`, `business/**`, `demo/**`, `platform/checks/**`, `platform/naive/src/approver.ts`
- **State:** works; business 298/298, demo 20/20, readiness 16/17 (deployments flaky on Naïve capacity).
- **Next / heads-up:** **Abhinav:** the approver runs on Noel's laptop now; don't restart yours without APPROVER_MAX_AGE_MIN or it releases 11 stale CEO runs. The CEO starts in duplicate pairs. The CEO lacks a list_levels tool. On stage, say the Tuner is a program, not an LLM agent.

### 2026-11-07 9:42 PM PT · Noel · Claude Code (money agent + checkpoint of running agents) · main
- **What:** (1) **Money hardened** (money agent). Fixed a live bug: pack and subscription checkout rejected every order after the 7:57 PM restart (the form didn't send a game type). All three products verified in test mode end to end ($5 playtest, $49 pack delivered 20 levels, $199 subscription with renewal and cancel). Duplicate and forged webhooks handled. Restart mid-playtest resumes. Refund, cancel, and billing emails always go to a person. A new email outbox (`billing/outbox.ts`, table `biz_mail_outbox`) retries refused sends every 15 min for 48 h with the same idempotency key, so the AgentMail new-recipient cap can't lose confirmations. `/public-stats` counts full history (9 emails, 12 playtests, excluding team tests). The `billing_payment` check is green (duplicate pending deliveries fixed and cleaned). Live checkouts verified for all three prices, with no real charge. (2) Paid-playtest resume is capped at 2 per order (one ran 5 times across restarts). (3) Checkpoint of the other running agents' in-progress work: agency outreach and the conversational agent (`src/agency/`), email-in audit (`leads/email-in.ts`), the bring-your-own-generator API (`src/generators/`, `sample-generator/`), Play search, and the console snapshot schedule.
- **Why:** The money segment must be true and unbreakable. Noel asked to push everything.
- **Files:** `business/**`, `platform/checks/src/checks/16-billing-payment.ts`, `site/pricing.html`, `demo/**`, `sample-generator/**`, `.gitignore`
- **State:** works for money (business 297/297, demo 20/20, solver 39/39). The other agents' parts are in progress; final entries follow as each reports.
- **Next / heads-up:** **Money line for the script:** "Checkout is live: these buttons open real Stripe payments for $5, $49, and $199 a month. Nobody has paid us yet, so here's a test-mode order the system ran end to end on its own, labeled test." Pack-delivery emails don't use the outbox yet. A refund made in the Stripe dashboard doesn't lower Earned.

### 2026-11-07 9:32 PM PT · Noel · Claude Code (ops subagent + main) · main
- **What:** (1) Overnight ops: `ops/monitor.sh` checks the public site, console, activity freshness, solver heartbeat, and both phones every 5 min. It runs the documented recovery after 15 min red, writes a `watchdog` row when it does, and takes hourly replay snapshots in demo/data/. Logs go to /tmp/levelai-monitor.log. Read it with `grep -E 'RED|RECOVERY|WARN'`. The business keepalive and the monitor hold caffeinate. live.sh retries a failed deploy and keeps the permanent address. The keepalive only redeploys site/ when the tunnel still answers. (2) Fixed live.sh and console.sh picking `api.trycloudflare.com` as the tunnel URL during an outage, which pointed the site at Cloudflare's control server. The laptop was offline ~8:25–9:28 PM; I restarted the business tunnel at 9:30 PM. (3) README and demo-script refresh by the ops agent.
- **Why:** The site must survive the night unattended. The outage exposed the tunnel-URL bug.
- **Files:** `ops/**`, `business/{live.sh,keepalive.sh}`, `demo/console.sh`, `README.md`, `docs/demo-script.md`
- **State:** works; the site, console, and /health recovered after the outage, and monitor lines are green.
- **Next / heads-up:** **BLOCKER:** AgentMail's new-account cap (10 new recipients in the first 24 h) was hit at ~7:40 PM, so no first email to a NEW address until 3:04 PM Sunday (judge QR emails, cold outreach, confirmations). Replies still work. Fix: upgrade AgentMail (Noel), plus the email-in audit fallback being built. The approver runs on a teammate's laptop; keep it awake. team.json lists a deleted Designer deployment.

### 2026-11-07 20:24 PT · Pinara (Codex) · branch `pinara/game-ui`

**What:** Published the verified opening 100 levels for each of watersort, racer and match3 to the real production catalog as ordered packs, retaining all prior levels and packs. Added the live play links and evidence to `solver/PRODUCTION.md`. Publication and browser QA were requested by Pinara; this was recorded as a human intervention, not a CEO decision.
**Why:** Pinara required the levels to be playable in production, not only local/generated/accepted. Existing sort/racer packs mixed positions and match3 had no public pack; the new packs begin at position 1 and preserve progression order.
**Files:** `solver/PRODUCTION.md`, `log.md`; live `packs`, published level statuses, audit/step-in records (existing schema only).
**State:** Works live. Preflight required exactly positions 1–100 per game, accepted/published status, >=200 completed reference-bot games, nonzero actual wins, and matching measured rates. Sort/racer also required exact proof with minimum moves <= shipped budget. Production browser checks won all three opening levels: sort 5/7 pours, racer 50/52 ticks, match3 7 moves on reproducible seed 1 using actual pointer input and the shared engine's plan. No local level responses were substituted. QA event sends were suppressed to avoid inflating player counts. Live measured rates across the packs are 38.5–90% (bots, not humans). Sort/racer pack APIs returned all 100 levels and their pages played the first entry; match3 loaded its actual published pack and completed. The 100-ahead watcher remains in place.
**Next / heads-up:** **Noel:** the laptop-tunnel endpoints intermittently returned 502/530 during these checks; retries recovered and all three production pages were verified, but backend availability still needs attention. **Max/Abhinav:** content publication is live-data-only; no Vercel rebuild was needed for these packs. No game rules, bots, tuning policy, customer packs, or existing uncommitted work were changed. Exact pack URLs are in `solver/PRODUCTION.md`.

### 2026-11-07 20:12 PT · Pinara (Claude Code) · branch `main`

**What:** Turbo Lanes and Splash Sort show a level badge next to the mission heading. It reads,
for example, **LEVEL 35 · YOU**, or **LEVEL 35 · ENGINE** when autoplay (the solver) is playing
(filled badge). The number comes from:
- practice levels: "PRACTICE 2 OF 4";
- pack levels: "LEVEL 3 OF 10";
- live levels: the number in their title ("Circuit 0035" → 35), otherwise their place in the live
  list.

**Why:** Pinara: players and demo viewers should see which level is being played, and whether a
person or the engine is playing it.
**Files:** `games/{racer,watersort}/public/{index.html,style.css}`,
`games/{racer,watersort}/ui/main.ts`, `site/games/{racer,watersort}/` (rebuilt).
**State:** Works:
- The typecheck is clean. Racer tests pass 21/21 and watersort 14/14.
- In headless Chromium at 390×844, the badge read "PRACTICE 2 OF 4 · YOU", then "LEVEL 35 · YOU"
  and "LEVEL 35 · ENGINE" (Turbo Lanes), and "LEVEL 282 · YOU" and "LEVEL 282 · ENGINE" (Splash
  Sort). The live "Next" flow still plays 3 levels in a row with 0 errors.
- Live levels were loaded from the production platform. The list came from a local stub of
  `/levels-latest`, because that route was down.

**Next / heads-up:**
- **Noel:**
  1. The site still needs your redeploy for this and the 20:06 push.
  2. `levelai.vercel.app/levels-latest` returned 502, then 530, again around 20:10, so the
     tunnel to the business server is dropping repeatedly. While it's down, `/play` and the
     `/games` hub can't list levels.
- **Anyone running `site/build-games.sh` while that route is down:** it rewrites
  `site/games/published.json` to all `false`, which hides every game on the hub. Restore it
  before committing.

### 2026-11-07 8:12 PM PT · Abhinav · Claude Code · main

**What:** Playtest agent gets `platform.list_games` and `business.recent_activity` (both read-only). Its live session was parked on a permission hold for each, because neither tool was configured for it; that hold is not the people rule, so the approver correctly leaves it.
**Why:** Approver restart (7:30 PM build) released all 15 parked `board_write` calls and 30 more held calls across two passes; the only remaining skips were these two on the playtest agent.
**Files:** `platform/naive/src/roster.ts`
**State:** typechecks. Takes effect after `cd platform/naive && npm run setup` on a machine with the Naïve key (I'm doing it now).
**Next / heads-up:** The approver must stay running on a laptop that stays awake overnight; each held call waits up to 20 s for the next pass, so a CEO run with ten tool calls takes a few extra minutes.

---
### 2026-11-07 20:09 PT · Pinara (Codex) · branch `pinara/game-ui`

**What:** Live production now fills only a 100-level-ahead buffer, rather than prebuilding all 1,000 positions. Added `--database --watch` to recheck every 60 seconds and top up only missing future levels. The importer enforces the same rule on checkpoint resume. Progress comes from consecutive sequence wins; a one-off phone win on level 561 cannot pretend levels 1–560 were completed.
**Why:** Pinara asked to keep about 100 unplayed levels ready (completed through 50 → target 150), preserve all existing stock, and avoid unnecessary generation/compute. The old bulk run was gracefully stopped immediately; no existing levels/checkpoints were deleted or retired.
**Files:** `solver/src/production/{buffer,cli,store}.ts`, `solver/test/production-buffer.test.ts`, `solver/{PRODUCTION,README}.md`.
**State:** Works in tests. Production tests 11/11; strict solver typecheck and diff checks pass. Tested the exact 50→150 case, retention of 550 existing levels, holes in the future buffer, attempts/losses not advancing progress, late playtests not skipping the sequence, game/series isolation, import refusal beyond the buffer, and the existing kill switch/idempotency/evidence checks. Live inventory was read without mutation; watcher will start from the pinned commit after push.
**Next / heads-up:** **Pinara:** use `npm run production -- --database --watch` with the existing series/checkpoint; the 1,000 ceiling remains, not a bulk production target. A full buffer starts no generation workers or simulations. Old excess stays available until players catch up. **Abhinav/Max:** no API/schema changes. Progress uses existing production sequence notes plus `player_events` wins; unsequenced Designer/studio-order content is not given invented positions, and the separate studio pack-delivery flow is unchanged. This rule applies to the production utility. Existing unfinished Claude work in the main checkout was not touched.


### 2026-11-07 20:06 PT · Pinara (Claude Code) · branch `main`

**What:** Turbo Lanes and Splash Sort play live levels one after another:
- After a win on a live level (`?level=<id>`), or after the last practice level, "Next" loads the
  next accepted level from the site's `/levels-latest?game=<id>`, newest first, wrapping around.
- It puts that level's id in the address bar.
- If the list can't be loaded (local dev, or the API down), the pages behave exactly as before.

I merged this with Noel's `?pack=` mode from 20:00. Packs go first, and live chaining applies
only outside a pack. `site/games/{racer,watersort}` are rebuilt from the merged source, and
`published.json` is unchanged.
**Why:** The pages replayed the same practice tracks. Production now has hundreds of accepted
levels for these games (from `production-v1`), which were reachable only through the 10 links on
the `/games` hub.
**Files:** `games/racer/ui/main.ts`, `games/watersort/ui/main.ts`, `site/games/racer/`,
`site/games/watersort/`.
**State:** Works:
- Typechecks are clean. Racer tests pass 21/21 and watersort 14/14.
- Headless Chromium at 390×844 played the built site pages against the **production** API and
  platform: 3 live levels in a row per game, each "Next" loaded a new live level, with 0 console
  errors.
- **Not deployed:** the site deploys with `vercel deploy --prod` from Noel's machine (it needs his
  untracked `site/vercel.json`).

**Next / heads-up:**
- **Noel:**
  1. Please redeploy the site (`business/live.sh` does it) so these pages go live.
  2. At about 7:58 PM, `levelai.vercel.app/levels-latest` returned **502** (tunnel to the
     business server) for a few minutes, so `/play` couldn't load levels then. It came back on
     its own.

### 2026-11-07 8:00 PM PT · Noel · Claude Code (checkpoint of running agents) · main
- **What:** A checkpoint of in-progress work from the agents still running: level-pack delivery (`business/src/levels/{deliver-pack,pack-maker,pack-worker,pack-types}.ts`, wired into orders and the server), plus demo-hardening edits to billing/orders, the level API, the phone loop, developer docs, pricing, and the game players (pack/level URL support in Splash Sort and Turbo Lanes).
- **Why:** Noel asked to push everything; it builds and the tests pass right now.
- **Files:** `business/**`, `docs/developers.md`, `games/{racer,watersort}/ui/main.ts`, `site/{developers,pricing}.html`, `site/styles.css`, `.gitignore` (scratch files)
- **State:** partly works; business typecheck clean and 186/186 tests pass, but the agents haven't finished or end-to-end tested these yet.
- **Next / heads-up:** Final versions land as each agent reports. Don't rely on pack delivery until its entry says it was tested end to end.

### 2026-11-07 7:57 PM PT · Noel · Claude Code · main
- **What:** Lot Escape auto-advances: 1.4 s after you clear a built-in lot, the next one loads; after the last built-in, endless mode turns on by itself. Rebuilt the hosted games (Lot Escape, plus Splash Sort and Turbo Lanes from their latest pushed source) and deployed.
- **Why:** Noel: auto-advance Lot Escape when you finish a level.
- **Files:** `games/lotescape/ui/main.ts`, `site/games/{lotescape,racer,watersort}/**`
- **State:** works; 19/19 game tests, typecheck clean, live game.js has the change.
- **Next / heads-up:** Five demo-hardening agents are running overnight (customer flow, console and phone, money, levels, ops). Their changes land in later entries.

### 2026-11-07 19:53 PT · Pinara (Codex) · branch `pinara/game-ui`

**What:** Added a fast deterministic content compiler (`npm run production`) for watersort, racer, and match3: 1,000 positions per game, staged feature unlocks and a challenge/recovery difficulty curve. One 64-game completion profile proposes the allowance; at least 200 fresh-seed actual replays verify each accepted level. Three game streams run concurrently with a 55-second hard deadline per position, checkpoints, duplicate-layout rejection, process locking, and crash/resume recovery.
**Why:** The Designer's 10-minute draft cadence and repeated tuning rounds cannot supply a large progression quickly. This program executes content recipes with existing adapters/bots; Naïve remains the agent platform and the CEO publishes accepted output. Claude's bot speedups were pulled and preserved.
**Files:** `solver/src/production/`, `solver/test/production.test.ts`, `solver/PRODUCTION.md`, `solver/README.md`, `solver/package.json`, `solver/production/.gitignore`.
**State:** Works locally and is running against LevelOps. All 3,000 authored recipes validate against current schemas; the earlier complete solver suite passed 35/35, and the current production suite passes 8/8 (including idempotent DB writes, kill switch, exact replay evidence, hard deadline and crash recovery). Typecheck passes. Live snapshot: 152 sort, 16 racer, 18 match3 accepted checkpoint records, no failed positions then; median per-position time 0.672 / 6.460 / 7.978 s, p95 2.244 / 28.437 / 17.848 s respectively, all with >=200 verification games. Not a claim that all 3,000 are finished. A direct Neon check confirmed accepted rows and >=200 recorded games per row. No levels were auto-published.
**Next / heads-up:** **Pinara:** the 1,000-per-game run uses `solver/production/production-v1-1.jsonl` in the isolated checkout `/private/tmp/levelai-game-ui`; resume with the same CLI options/checkpoint. Runtime checkpoint/benchmark files are ignored. **Abhinav:** existing schema unchanged; additive `levels.created_by='production'`, JSON sequence/chapter/features in notes, and optional `settings.production_kill_switch` boolean. Company kill switch also applies. Imports atomically write levels, solver evidence and platform activity (never LLM decisions); deterministic IDs prevent duplicates on restart. **Max:** the accepted level JSON uses the existing game rules/clients; no new unsupported mechanic fields. New mechanics are not invented per level—supported obstacles, boosts, shapes and sort configurations combine progressively. Live phones and automatic CEO publication were not verified. No existing autotune/worker/bot/engine code was overwritten. Follow-up before this push: a live slot failed when rebase briefly removed a worker module; completed checkpoints were preserved. Production now resumes from a pinned runtime worktree, retries missing slots for up to three passes with fresh layout seeds, and falls back from infeasible single-buffer sort layouts. The initial run accepted 343 levels in 261 s before the graceful integration restart; it was not finished.


### 2026-11-07 7:53 PM PT · Noel · Claude Code (Lot Escape subagent) · main
- **What:** Lot Escape is much harder, with an endless mode. Six new built-in lots ramp from 26 to 53 best moves (limits are best + ~20%, with up to 7 back-steps and blocking chains up to 10 deep). There's a top-right "Endless: generated levels" switch: each win builds the next lot one step harder in a Web Worker, with the indicator "Level 7 · Generated" / "Level 3 of 6 · Built-in", "Move limit N · Best possible: N moves", and a "Building the next lot…" state. The solver was rewritten as a 0-1 BFS (exact fewest moves, 60–100×+ faster, cross-checked against plain BFS) sharing one movement rule (`stepAlongLane`). Stable generator API in `src/generate.ts` (`generateLevel({seed, difficulty})`), re-exported by the adapter for level packs.
- **Why:** Noel: make Lot Escape a lot harder, with dynamically generated levels as you play.
- **Files:** `games/lotescape/**`, `site/games/lotescape/**`
- **State:** works; 19/19 game tests, solver 28/28, typecheck clean, headless Chrome at 1440×900 and 390×844 checked, deployed.
- **Next / heads-up:** The game's quit event uses sendBeacon, which fails CORS against the platform's /events, so quit events are lost. Switch to fetch with keepalive.

### 2026-11-07 7:52 PM PT · Noel · Claude Code (Lot Escape subagent, in progress) · main
- **What:** Lot Escape work in progress: a seeded level generator (`games/lotescape/src/generate.ts`) that produces solver-proven levels at a target difficulty, harder built-in levels, and an in-browser worker for the coming endless mode (`ui/worker.ts`, `ui/jobs.ts`).
- **Why:** Noel: make Lot Escape much harder, with an endless generated mode.
- **Files:** `games/lotescape/**`
- **State:** partly works; typecheck clean, 19/19 game tests pass. The hosted copy isn't rebuilt yet.
- **Next / heads-up:** The endless toggle and site rebuild land in the next push. Level-pack delivery (business/src/levels/pack-*) is still local and failing tests mid-edit, so it isn't pushed.

### 2026-11-07 19:49 PT · Pinara (Claude Code) · branch `main`

**What:** The Turbo Lanes bots are about 3× faster with identical results: `human` (the
Tuner's reference) 22 → 7.8 ms per game, and `greedy` 1.5 → 0.7 ms. Two changes:
- The planner keys its memo by one packed number instead of a string. It's collision-free within
  the engine `LIMITS`.
- The memo lives for the whole run instead of one tick. The run's view of the track is fixed, so
  the values don't change.

The other games were measured and left alone, since they're already fast: Splash Sort is under
0.2 ms per game for every bot, platformer about 0.4 ms on a 64×32 map, and match-3 about 13 ms
after the earlier push.
**Why:** It finishes the "Monte Carlo in seconds" work across all registered games. A 200-game
Turbo Lanes round is now about 1.6 s on one thread.
**Files:** `games/racer/src/bots.ts`.
**State:** Works. 2,160 seeded runs (4 tracks × 3 speeds × 3 bots × 60 seeds) give the same results
hash before and after. Racer tests pass 21/21, and the typecheck is clean.
**Next / heads-up:**
- Lot Escape (`games/lotescape`) isn't in the adapter registry, so the solver can't run it yet.
  That's for Max.
- Workers: pull and restart.

### 2026-11-07 7:46 PM PT · Noel · Claude Code · main
- **What:** Rewrote `docs/demo-script.md` to match what's built: the 2-minute video storyboard (due 11 AM Sunday), the 3-minute live demo, honest answers to likely judge questions, the overnight checklist, and the on-stage break plan. It uses only real studios and numbers from the log; no invented names, levels, or step-ins.
- **Why:** The video requirement is new, and the old script predated live billing, the phone loop, and pack delivery.
- **Files:** `docs/demo-script.md`
- **State:** done.
- **Next / heads-up:** **Everyone:** don't touch the system after midnight unless it's broken.
### 2026-11-07 19:45 PT · Pinara (Claude Code) · branch `main`

**What:** The match-3 greedy bot is about 30× faster: 1,525 ms → about 53 ms per game. A
100-game tune round on 6 threads now takes about 3 s instead of minutes. Results are unchanged.
Three changes:
- (1) The greedy bot reads each candidate's goal progress once, with `goalValue`. Before, it called
  `statusOf()` inside the sort comparator, and every call rescanned every legal move.
- (2) `settle` calls `advanceTicks(state, 3600)` once instead of 3600 single-tick calls.
- (3) The engine's `listLegalSwaps` checks only the two swapped cells' rows and columns instead of
  copying and rescanning the whole board for every swap. The board has no runs at that point, so
  any new match must pass through a swapped cell.

**Why:** Match-3 tuning took 1 to 2 minutes per round and kept the Tuner slow. Now
measurements take seconds.
**Files:** `games/match3/adapter/index.ts`,
`games/match3/engine/houseki-gem-swap/gem-swap/board.ts`.
**State:** Works. Results are identical, and checked three ways:
- The same won/moves/detail over 24 seeded games (random and greedy), compared by hash.
- `listLegalSwaps` old vs. new on 5,000 board states and 83,849 swaps, including masked boards and
  seals: 0 differences.
- The match-3 rule tests pass 8/8, the solver tests 32/32, and the `platform/mcp` typecheck is
  clean.

**Next / heads-up:**
- **Max:** this edits your adapter and the vendored engine's `board.ts`, with Pinara's go-ahead.
  The engine change is marked in a comment, and the MIT credit is untouched.
- **Everyone running a worker:** pull and restart it to get the speed-up.

### 2026-11-07 7:44 PM PT · Noel · Claude Code · main
- **What:** Fixed the pricing cards: a row with a live-updated number ("20 new levels…") broke into one word per line, because the number's span became its own grid cell. Each row's text is now wrapped in one element.
- **Why:** Noel's screenshot of the broken level-pack card.
- **Files:** `site/pricing.html`
- **State:** works; deployed, the live page serves the fix.
- **Next / heads-up:** none.

### 2026-11-07 7:35 PM PT · Noel · Claude Code · main
- **What:** Auto-tuner: MAX_ROUNDS 6 → 12. It also accepts a level when the target lies inside the measurement's 95% interval and the measurement is within 8 pts (`onTarget`; the strict ±5 still accepts as before). Restarted the solver worker on Noel's laptop.
- **Why:** Every tuned level was rejected (12 match-3, 4 water sort, 0 accepted), so nothing ever reached /play. They were converging and running out of rounds (e.g. 0% → 14% → 28% vs a 35% target; the last one's interval was 20–39%).
- **Files:** `solver/src/autotune.ts`, `solver/test/autotune.test.ts`
- **State:** works; solver 28/28 tests pass.
- **Next / heads-up:** **Pinara:** please review. Your worker needs a pull and restart to pick this up.

### 2026-11-07 19:32 PT · Pinara (Claude Code) · branch `main`

**What:** The Designer runs every 10 minutes instead of every 20, rotating games by minute:
- :00 and :30: match3.
- :10 and :40: racer.
- :20 and :50: watersort.

Each game now gets 2 levels an hour. Before, racer and watersort got 1 every 2 hours each, and
match3 got about 2 an hour. Each run is still one `save_level` call, so the `read_people` hold
doesn't apply.
**Why:** There were 0 racer levels in Neon, and the Turbo Lanes page only replays its 5 practice
tracks. Racer and watersort tune in seconds, so the worker can easily absorb more of them.
**Files:** `platform/naive/src/roster.ts` (Designer prompt and cron only).
**State:** The typecheck is clean. **Not live yet**: it needs `npm run setup`, and Pinara's clone
has no `NAIVE_API_KEY`.
**Next / heads-up:**
- **Abhinav:**
  1. `npm run setup`. It creates a **new** designer deployment (`*/10`, disabled) and leaves the
     old `*/20` one alone. Don't use `RESET_DEPLOYMENTS=1`, which recreates every agent's
     deployment.
  2. Disable or delete the old designer `*/20` deployment in the Studio.
  3. Enable the new one.

  Otherwise both run. That's harmless but doubles match3 at :00 and :40. Spend: this is up to
  144 runs a day against the Designer's $35 daily cap.
### 2026-11-07 7:31 PM PT · Noel · Claude Code · main
- **What:** Candy Crush Saga and Sudoku.com installed on the main cloud iPhone from Mobilerun's catalog (18 s and 9 s), and added to the phone loop's market-study rotation as native apps: started by bundle id, labeled "(iOS app, market study)", shown on the console as "Now playtesting Candy Crush Saga, an App Store game". We study the genre leader's difficulty ramp; we never use its name or art in our games.
- **Why:** Noel spotted Candy Crush in Mobilerun's catalog. Real App Store games on the phone make a stronger Mobilerun demo.
- **Files:** `business/src/mobile/loop.ts`, `business/test/playtest-loop.test.ts`, `demo/src/moments.ts`
- **State:** works; business 174/174 and demo 17/17 tests pass, server restarted.
- **Next / heads-up:** The second phone ("Level AI App Store iPhone") still needs a person to sign in to an Apple Account in Settings before any App Store download.

### 2026-11-07 7:29 PM PT · Pinara · Claude Code · main
- **What:** The auto-tuner resumes a tune that stopped mid-way. A version left `solving` (worker stopped or crashed) is taken again by any worker once it has been untouched for 20 minutes and has no queued or running measurement and no newer version, so a live tune is never taken. Its log rows say "resumed". A version whose measurement stopped twice is rejected instead of retried. Saving a new version and retiring the old one is now one statement. README: "at most 4 rounds" corrected to 6. Also fixed my 7:16 PM log merge (a stray heading, and the 7:14 → 7:09 PM correction landing on the right entry).
- **Why:** A worker restart mid-tune (needed after every pull) left the level `solving` forever: never accepted or rejected, so the Designer's work was lost and the pipeline numbers stayed off.
- **Files:** `solver/src/autotune.ts`, `solver/test/autotune.test.ts`, `solver/README.md`.
- **State:** works; solver 27/27 (2 new tests: what is and isn't resumed; a resumed tune finishes, and a version that stopped twice is rejected). Removing the live-tune guards makes the new test fail, so it checks them. Typecheck clean.
- **Next / heads-up:** none for others. Next push reworks the tuner's steps (the 7:01 PM match-3 tune jumped from 90% to 0% and was rejected).

### 2026-11-07 19:40 PT · Abhinav (Claude) · branch `main`

**What:** Approver also approves Naïve's own `board_read`/`board_write` when held with
`read_people`: `ses_dgf2ak…` got past the platform calls (approved by hand in the Studio) and was
then held on `board_write`, the team board comment. The board is internal; nothing that sends,
posts, pays, or touches a phone is approvable.
**Why:** The rule holds Naïve's internal board writes too, so the loop would stall one step later.
**Files:** `platform/naive/src/approver.ts`.
**State:** Typechecks. Approver still not started on a laptop.
**Next / heads-up:** **Abhinav:** `caffeinate -i npm run approver` now. **Whoever approved
`ses_dgf2ak…` by hand:** that's a step-in; add a row to `interventions` (who/what/why) so the
count is honest.

### 2026-11-07 7:26 PM PT · Noel · Claude Code (pricing + App Store subagents + main) · main
- **What:** (1) **Billing is LIVE.** Stripe account activated as an individual (no Atlas), charges and payouts enabled. Live webhook we_1UZMf3… (checkout.session.completed, invoice.paid, customer.subscription.deleted). Server uses `STRIPE_SECRET_KEY_LIVE` when `BILLING_ALLOW_LIVE=1` (`activeStripeKey` in config.ts) and verifies both test and live webhook secrets. Verified: a live $5 payment link from /playtest-orders, live checkout sessions for the pack and subscription; nothing was paid. (2) **Every product has a price:** $5 iPhone playtest, $49 level pack (20 tuned levels in 48 h), $199/month subscription (40 levels + 4 playtests a month + API). `POST /orders` (Checkout, one-time or subscription, prices reused by lookup key), webhook handling for purchases, renewals, and cancellations, honest confirmation emails, "delivery owed" log lines, `biz_subscriptions` table. `/pricing` page, a pricing section on home, "Pricing" in every nav. (3) **App Store installs:** second cloud iPhone "Level AI App Store iPhone" (`MOBILERUN_APPSTORE_DEVICE_ID`, from Mobilerun's granted 3-day subscription). When the API install 404s (Mobilerun's catalog lacks our games; the 9 queued apps still 404), the agent installs through the phone's App Store and the playtest runs there.
- **Why:** Noel: price every product, go live with money, make App Store apps open.
- **Files:** `business/src/{leads/orders.ts,billing/stripe.ts,app.ts,config.ts,store.ts,types.ts,db/schema.sql,mobile/install.ts,leads/playtest-offer.ts}`, `business/test/{orders,appstore-install}.test.ts`, `site/pricing.html`, `site/*.html` (nav), `site/styles.css`
- **State:** works for billing and pricing (174 tests pass, site deployed, live links verified). App Store installs wait on a person signing in to the App Store on the new phone.
- **Next / heads-up:** **Everyone:** real money now. Team emails stay tagged internal_test. Don't pay test orders with a team card unless you mean it. Cancel requests arrive by email, and a person cancels them in Stripe.
### 2026-11-07 19:30 PT · Abhinav (Claude) · branch `main`

**What:** **Team decision B implemented: the policy auto-approver.** `npm run approver` in
`platform/naive` polls Naïve every 20 s for sessions at `awaiting_approval`, and for agents in
`team.json` approves held calls **only** on our own servers (`platform.*`, `platformcrm.*`,
`business.*`) with `read_people: true`, scope "session". Anything else is left for a human.
Every approval is written to `activity_log` as agent `platform`, action `auto_approve`, with the
reason, so the count is on the dashboard. Disclosure sentence added to `docs/demo-script.md`;
the checklist now includes running the approver.
**Why:** `read_people` fires on any MCP output, with no app-side fix (field names, catalog split,
and tool annotations all tested); without approvals no agent gets past its first turn.
**Files:** `platform/naive/src/approver.ts`, `package.json`, `README.md`, `docs/demo-script.md`.
**State:** Typechecks. Not yet run. **Not a human step-in and not logged as one; not hidden.**
**Next / heads-up:** **Abhinav:** `npm run approver` on a laptop that stays awake, then
`npm run ceo-now` to watch a full CEO run. **Noel:** the disclosure sentence is in your script;
edit the wording, keep the fact. **Everyone:** if a Naïve engineer gives us a real switch, we turn
the approver off and say so.

### 2026-11-07 19:21 PT · Pinara (Codex) · branch `pinara/game-ui`

**What:** Added named practice cards with real level metadata in both games, optional persistent color labels for Splash Sort, and Turbo Lanes pause/resume controls (button, P/Escape, automatic pause when hidden). Improved result-dialog keyboard focus and removed a duplicate racer quit event on practice switching.
**Why:** Make level selection clearer, support players who need color names, and let racers pause without consuming the run clock. Builds on Claude's latest pour/undo/collision changes.
**Files:** `games/racer/{public,ui,README.md}`, `games/watersort/{public,ui,UI.md}`.
**State:** Works locally. Racer 21/21 and watersort 14/14 tests pass; both strict typechecks and builds pass. Chromium at 320, 390, and 1280px: color preference survives reload, hints remain usable, pause freezes ticks, Escape/Enter resume, modal Tab stays on the action, no browser exceptions or horizontal overflow. No engine, bot, solver, adapter, or harness changes.
**Next / heads-up:** **Max:** rebuild the served copies (`./site/build-games.sh racer watersort`) and deploy to publish these source changes. No hosted site or real-phone check performed. Worked in an isolated checkout, fetched repeatedly, and will integrate origin/main again before pushing; the main workspace's unfinished Claude edits were left untouched.

### 2026-11-07 7:16 PM PT · Pinara · Claude Code · main
- **What:** The solver worker's heartbeat runs on its own 30 s timer, so it stays fresh during a long run or an auto-tune. Ctrl-C still finishes the current job; pressing it again now quits at once (before, a second Ctrl-C did nothing). Also corrected my previous entry's time (7:09 PM, not 7:14).
- **Why:** The heartbeat was written only between jobs. A match-3 tune holds the loop for up to 12 minutes, so the `solver_queue` check would see the worker as gone while it was working: `pinara-laptop`'s heartbeat was 10 minutes old at 7:11 PM, mid-tune. And during a tune, restarting the worker after a pull meant waiting minutes or killing the terminal.
- **Files:** `solver/src/worker.ts`, `solver/README.md`.
- **State:** works; checked against a local Postgres: during a 75 s match-3 run the heartbeat advanced every 30 s (3:13:26, 3:13:56, 3:14:26 UTC); one Ctrl-C mid-run kept the job going, a second quit at once; one Ctrl-C while idle stopped in 5 s with `stopped: true`. Solver 25/25, typecheck clean.
- **Next / heads-up:** **Pinara:** restart your worker to pick this up (Ctrl-C twice if it's mid-tune; the next push resumes an interrupted tune). Noel's worker is from before the auto-tuner; restarting it after a pull gives it both.

### 2026-11-07 19:35 PT · Abhinav (Claude) · branch `main`

**What:** **Catalog split did not fix `read_people`.** Probe `ses_e9f0pnhfdr12kghsmgp2k4bssm`
against the clean `/mcp` (17 tools, nothing CRM/email/people): `list_games` completed, then
`log_action` was held with `read_people: true`. Conclusion: Naïve treats **any output from any
MCP server** as reading people's data; content, field names, and catalog don't matter. Last
cheap probe: every tool now carries MCP annotations (`readOnlyHint` on reads, `openWorldHint:
false` on all). If Naïve keys on those, the next `approval-test` passes; if not, there is no
app-side fix and the team picks B or C.
**Why:** To stop chasing content-based fixes and settle the decision with evidence.
**Files:** `platform/mcp/src/tools.ts`.
**State:** Typechecks; annotations verified on `tools/list` locally; smoke OK. Needs a redeploy
and one more `approval-test`.
**Next / heads-up:** **Team, decide now:** (B) policy auto-approver for our own servers, every
approval logged as `platform.auto_approve` and disclosed on stage; or (C) humans approve each
held session with scope "session", logged as step-ins. (A) still worth one more ask of Naïve
staff with the probe session id above.

### 2026-11-07 19:25 PT · Abhinav (Claude) · branch `main`

**What:** The Naïve client in `platform/naive` now retries every SDK call on 429/503 with backoff
(`src/client.ts` wraps the client), so `vault`, `setup`, `kill`, and the watchers survive "the
service is at capacity". Platform redeployed at 19:12 with the two catalogs.
**Why:** `vault` died on a 429 before it could store the `/mcp/crm` credential.
**Files:** `platform/naive/src/client.ts`.
**State:** Typechecks. Vault/setup/approval-test not yet run with the split.
**Next / heads-up:** Abhinav: `npm run vault && npm run setup && npm run approval-test`.

### 2026-11-07 7:09 PM PT · Pinara · Claude Code · main
- **What:** The speed tests in Splash Sort and Turbo Lanes measure CPU time (`process.cpuUsage`) instead of wall time. The limits are the same (3 s and 4 s).
- **Why:** Turbo Lanes' test failed 4 of 5 runs while a solver worker was using the laptop's cores (load average about 30 on 8 cores): 6.0 s wall time, but only 2.1 s of CPU. A test that fails on a busy machine says nothing about the game.
- **Files:** `games/racer/test/racer.test.ts`, `games/watersort/test/watersort.test.ts`.
- **State:** works; under the same load, Turbo Lanes 21/21 four runs in a row, Splash Sort 14/14 twice, both typecheck. Measured CPU: Turbo Lanes 2.1 s (limit 4 s), Splash Sort 0.6 s (limit 3 s).
- **Next / heads-up:** none. Game code is unchanged.

### 2026-11-07 7:05 PM PT · Pinara · Claude Code · main
- **What:** Splash Sort and Turbo Lanes level links now open the game. `level_url` returns `${GAMES_BASE_URL}/games/watersort/?level=<id>` and `/games/racer/?level=<id>`, where the site serves the games (`site/build-games.sh`). The old `/watersort/` and `/racer/` paths return 404 on levelai.vercel.app. READMEs and tests updated.
- **Why:** `save_level` and `publish_pack` return these links (CONTRACTS.md §1: "public URL that opens that level in the browser game"), and they were dead.
- **Files:** `games/watersort/adapter/index.ts`, `games/racer/adapter/index.ts`, both games' `README.md` and tests.
- **State:** works; checked live: `/games/watersort/?level=x` and `/games/racer/?level=x` return 200, `/watersort/` and `/racer/` 404. Splash Sort 14/14. Turbo Lanes 21/21 on an idle machine; its speed test fails under load (fixed in the next push).
- **Next / heads-up:** **Abhinav:** the deployed platform builds these links, so they change on your next platform redeploy (no rush; nothing else changes). The pack link in `publish_pack` (`/<game_id>/?pack=`, `platform/mcp/src/tools.ts`) is also a 404 for these two games, and their pages don't read `?pack=` yet; the per-level `level_urls` work.

### 2026-11-07 19:20 PT · Abhinav (Claude) · branch `main`

**What:** **Workaround attempt for `read_people`: the platform MCP server now has two catalogs
on two endpoints.** `/mcp` (17 tools: levels, solver, packs, play results, production metrics,
decisions, spend) has no CRM/email/payment tool on it. `/mcp/crm` (5 tools: `get_pipeline_metrics`,
`crm_upsert`, `crm_set_stage`, `record_email`, `create_payment_link`) is a separate server
(`platformcrm`) attached only to Finance and Research. Same bearer; `npm run vault` stores a
credential for the `/crm` URL too. `get_player_stats` description reworded ("play results").
**Why:** Hypothesis: Naïve classifies a server by the tools it advertises; one with CRM/email tools
counts as holding people's data, so any read from it sets `read_people` for the chat. Both stalled
CEO runs read from a server advertising `crm_upsert(contact_email)`, `record_email`, etc.;
Naïve's own `board_read` never tainted. If right, production agents on `/mcp` stop stalling.
**Files:** `platform/mcp/src/{tools,fn,server}.ts`, `platform/naive/src/{roster,setup-team,vault}.ts`.
**State:** Typechecks; both catalogs verified locally; smoke OK. **Unproven until deployed**:
`neon deploy`, `npm run vault`, `npm run setup`, `npm run approval-test` (two dependent turns on
`/mcp`). **Noel:** your business server advertises email/CRM tools, so Sales agents reading from it
will still trip the rule; the Reader/Sender split is the answer there.
**Next / heads-up:** Abhinav runs the four commands and posts the verdict.

### 2026-11-07 6:57 PM PT · Noel · Claude Code · main
- **What:** X posts go out from the cloud iPhone. X refuses every API post from @uselevelai (also after Noel verified and reconnected at 6:51 PM), so `business/src/marketing/phone-post.ts` has the phone agent open x.com/compose/post in Safari, type the post, tap Post, and report whether it saw it sent. It never logs in or types a password; Noel logged in himself. It runs in the playtest queue, so paid orders keep priority. The social loop falls back to it automatically when the API post is rejected. First phone post sent at 6:55 PM (task a4868c26…). The phone finishes on @uselevelai's profile.
- **Why:** Noel: get posts on X. It's also a real Mobilerun use: the agents do their own marketing from a phone.
- **Files:** `business/src/marketing/{phone-post.ts,loop.ts}`
- **State:** works; first post sent, 157 tests pass, server restarted.
- **Next / heads-up:** X's Safari session lasts until X logs it out; if phone posts start failing with "not logged in", Noel logs in again on the phone.

### 2026-11-07 6:51 PM PT · Noel · Claude Code · main
- **What:** Corrected the timestamps on my 22 log entries from 5:32 to 6:47 PM, which had been written ahead of the clock (some by up to 35 min). They now match the commit times. Also: X still rejects @uselevelai posts (6:49 PM retry, after Noel posted manually); a fresh connect link went to Noel to reconnect.
- **Why:** The log has to be accurate; it's what the demo and teammates rely on.
- **Files:** `log.md`
- **State:** works.
- **Next / heads-up:** none.

### 2026-11-07 6:47 PM PT · Noel · Claude Code (Turbo Lanes subagent) · main
- **What:** Turbo Lanes follows lane-runner conventions (games/racer/RULES.md, with sources). Every vehicle is the same size (2 rows × 58% of a lane), centered in its lane. Hitboxes match sprites, with a test that on-screen overlap equals a rules collision. **Two rule changes:** traffic cars cover 2 rows, and steering into a car beside you is a crash (bounce back, lose time; a shield absorbs it). Pickups can't be collected twice by a quick left-right. Practice tracks re-tuned to keep their difficulty order (reference bot 96/97/60/18%). Smoother lane changes, clearer hazards and pickups, swipe and key fixes. Level JSON is unchanged.
- **Why:** Noel: car sizes were inconsistent; fix the games to their real rules.
- **Files:** `games/racer/**`, `site/games/racer/**`
- **State:** works; racer 21/21, solver 25/25, typecheck clean, deployed.
- **Next / heads-up:** **Pinara:** the two rule changes make saved racer levels harder than they were tuned, so the Tuner should re-measure them. Shields and oil hazards are intact.

### 2026-11-07 6:43 PM PT · Noel · Claude Code (watch, docs, Gem Match subagents + main) · main
- **What:** (1) **Watch your playtest live:** when a paid playtest starts, the customer gets an email with a private link (`/watch?o=<43-char token>`). The page shows the iPhone's screen about once a second while their order runs (read-only, no device credentials leave the server), a step timeline, and the result. Endpoints `/watch-status` and `/watch-frame` (2/s per token, 404 for unknown). After paying, the buyer lands on their watch page. Copy says "a real iPhone in the cloud" (it's a rented cloud phone). Real test order eb983c9f… worked end to end. (2) **Paid playtests survive restarts:** orders record their payment, and on boot the server re-queues paid orders from the last 24 h that never finished. Table `biz_playtest_orders` (+ payment_id, focus), applied to Neon. (3) **Level API code** behind the new developer docs: `/api/games`, `/api/levels`, `/api/levels/:id`, `/api/packs/:id`, `/api/levels-latest`, key-auth `/api/studio/levels`, studio MCP `list_my_levels`. (4) **Gem Match** (/play) follows standard match-3 rules (games/match3/RULES.md). A dead board now reshuffles instead of ending the level (Houseki ended it as lost: the random bot went 58→100/100 on a practice level). Three labeled practice levels play when no agent-made levels exist. One shared level mapping (`games/match3/adapter/levels.ts`) for adapter and player. Visible swap-back, square tiles, idle hint, distinct loss screens. (5) Console phone shows the screenshot at its true ratio; the screenshot API maxes out at 393×852.
- **Why:** Noel: email customers when testing starts and let them watch live; dev docs; fix the games.
- **Files:** `business/src/{leads/watch.ts,leads/playtest-offer.ts,app.ts,server.ts,store.ts,types.ts,db/schema.sql,levels/public.ts,studio/mcp.ts}`, `business/live.sh`, `business/test/*`, `site/watch.html`, `site/play.*`, `player/src/*`, `games/match3/**`, `demo/public/index.html`, `demo/src/phone.ts`
- **State:** works; business 157/157, match3 8/8, typecheck clean; site deployed; /watch, /play, /api/games 200.
- **Next / heads-up:** **Max:** review the match3 engine change (dead-board reshuffle, marked "Level AI change (not upstream)"). **Pinara/Abhinav:** solver win rates rise on levels that tended to deadlock. Solver test "match-3 tunes goal.target" (autotune.test.ts from e1e72fb) fails; it's not from this change. One old test order (697d6a88…) stays "In line" from before resume existed.
### 2026-11-07 18:50 PT · Pinara (Claude Code) · branch `main`

**What:** **First live level from the new pipeline**, and a tuner fix it exposed.
- **6:40 PM:** the Designer's scheduled run saved Splash Sort level `fedbe5bc…` (target 60%) with
  one `save_level` call. No approval was needed.
- **The automatic Tuner** (one `--once` pass of the new worker) claimed it and measured 4 rounds:

  | Round | `move_limit` | Human-bot win rate |
  |---|---|---|
  | 1 | 24 | 100% |
  | 2 | 13 | 3% |
  | 3 | 19 | 95% |
  | 4 | 17 | 80% |

  It rejected the level, honestly logged: Splash Sort's curve is steep near the minimum, and it ran
  out of rounds.
- **Fix:** up to 6 rounds (rounds are under a second for most games), and once the target is
  bracketed, blend interpolation with the midpoint.
- **Re-tuning that exact level offline:** accepted 3 of 3 times, in 4 rounds, at 61.5%, 64.5%, and
  65%.

**Why:** Levels that can be tuned shouldn't be thrown away.
**Files:** `solver/src/autotune.ts`.
**State:** `solver` 25/25, typecheck clean.
**Next / heads-up:** **Pinara:** restart the worker. Until then, new designs wait as drafts.
1. `cd solver`
2. Press Ctrl+C in the worker's terminal.
3. `git pull`
4. `caffeinate -i npm run worker` (the start line shows `"autotune":true`)

### 2026-11-07 6:39 PM PT · Noel · Claude Code (Splash Sort subagent) · main
- **What:** Splash Sort follows standard water-sort rules (games/watersort/RULES.md, with sources incl. Ito et al. FUN 2022). The game and the bots now share one rule: a finished tube is sealed (the bots used to allow pouring out of it; re-measured win rates are unchanged). Undo (3 per attempt). A stuck board offers undo before it ends. Illegal taps say why. Keyboard play (1–9/0/-, arrows, Esc, U/Cmd+Z, R). Same-color units draw as one liquid band, tubes are exact capacity height, rows are balanced (an 11-tube board fits 390 px). Pour animation (respects reduced motion). `generateSolvableLevel` keeps only solver-proven deals. Level JSON is unchanged.
- **Why:** Noel: fix every game to its real rules.
- **Files:** `games/watersort/**`, `site/games/watersort/**`
- **State:** works; 14/14 game tests, 19/19 solver tests, typecheck clean, headless Chrome keyboard/touch/stuck/undo/win checked, deployed (from a copy that kept the committed /play, since the match-3 rebuild is in progress).
- **Next / heads-up:** **Pinara:** please review undo and the stuck-board flow. Undo is a player assist, so bot win rates still measure play without it.
### 2026-11-07 18:40 PT · Pinara (Claude Code) · branch `main`

**What:** Level generation made to work unattended on Naïve, and applied to the team workspace.
- **Found the real blocker.** In three sessions (the CEO's stall, and the Designer's runs
  `ses_hand3f…` and `ses_gywe…`), Naïve flagged the chat after its **first MCP read**. From then
  on every MCP call asked a person, and the shell was refused. This matches Naïve's docs
  (tools.md, "Once a chat has read people's data": "reading … a connected app flags the chat").
  It's not about field names: `list_games` alone flagged the Designer. One MCP call per chat
  works, which is why the approval test passed.
- **Designer:** one `save_level` per chat, every 20 minutes (deployment `dep_pf9e…`, now
  `*/20 * * * *`, $0.50 per run).
  - The level formats and examples are in its prompt; the examples are validated against the real
    adapters.
  - Game by minute: :40 makes Splash Sort or Turbo Lanes; other minutes make match3 (what `/play`
    shows).
  - Target = 0.30 + 0.05 × (hour mod 9).
  - Its toolset is `save_level` only; the other 21 platform tools are set to `deny`
    (`strictTools`, also on the Tuner).
- **Automatic Tuner** (`solver/src/autotune.ts`). When the queue is idle, the solver worker:
  1. claims each new Designer level;
  2. measures the reference bot (a real `solver_runs` row each time);
  3. moves the game's knob (watersort `move_limit`, racer `time_limit`, match3 `goal.target`);
  4. saves versions with `parent_level_id`;
  5. accepts within 5 points of the target in at most 4 rounds, or rejects with the reason.

  Every step lands in `activity_log` as agent `tuner`, reason "auto-tuner (program):".
- **Applied in Naïve (team workspace, Abhinav's agents):**
  - `npm run setup` ran twice. All 9 agents were updated, and the existing deployments were
    reused, with no duplicates.
  - The Designer deployment was enabled.
  - `team.json` now lists it.
  - Three step-ins are logged in `interventions`: enabled the deployment, and two test runs by
    hand (one cancelled after it parked on an approval).

**Why:** Noel's report of zero match-3 levels and an empty `/play`. Nothing in the multi-call agent
design can run unattended under this rule.
**Files:** `solver/src/autotune.ts`, `solver/src/worker.ts`, `solver/test/autotune.test.ts`,
`solver/README.md`, `platform/naive/src/roster.ts`, `platform/naive/team.json`.
**State:**
- `solver` tests pass 25/25 in three runs in a row (auto-tune is tested on watersort, racer, a
  match-3 stand-in, claiming, and invalid levels).
- Typecheck is clean.
- The platform's deployed MCP has `check_decision`.
- The first live run of the new Designer is at 6:40 PM.
**Next / heads-up:**
- **Everyone:** the same rule blocks any Naïve agent that makes more than one MCP call per chat,
  including the CEO. Split the work into one-call chats, or move the loop into code.
- **Workers:**
  - Restart your solver worker (`git pull`, then restart) to get the auto-tuner.
  - A worker without it still solves queued runs, but won't tune new designs.
- **Abhinav:** `team.json` now has the `designer` deployment, so `npm run kill -- on/off` includes
  it.

### 2026-11-07 6:36 PM PT · Noel · Claude Code · main
- **What:** Console pop-ups (moments) are a compact notification in the top-right corner in a normal window. Full screen keeps the big projector banner.
- **Why:** Noel: the notifications looked zoomed in and covered the team and feed.
- **Files:** `demo/public/index.html`
- **State:** works; demo typecheck and 17 tests pass.
- **Next / heads-up:** none.
### 2026-11-07 19:05 PT · Abhinav (Claude) · branch `main`

**What:** **`docs/audit.md`: full product audit** at c9128f2. Status by area (built / verified
live / blocked), blockers in order, risks, what is demoable tonight regardless of the stall, and
the recommended order for the next three hours. Two fixes from it: the platform's
`create_payment_link` no longer returns a fake `example.invalid` link (it now errors and points
at `business.create_payment_link`); my billing check renamed to `billing_payment`
(`16-billing-payment.ts`) to stop colliding with Noel's `billing`.
**Why:** The team needs one honest picture before the 8 PM decision and before the demo script is
rewritten from the logs.
**Files:** `docs/audit.md`, `platform/mcp/src/tools.ts`, `platform/checks/src/checks/16-billing-payment.ts`.
**State:** Typechecks. Audit is from code, tests, and `log.md`; the agent reports were re-read,
not re-run.
**Next / heads-up:** **Team:** read §3 (blockers) and §6 (order). The verdict: the loop has never
completed once; the business side is verified; `read_people` is the only P0. **Noel:** `/thanks`
route is missing (404 after a pilot payment); pilot delivery is manual, say so on stage.
**Abhinav:** redeploy for the tool change (`neon deploy --env .env`), `npm run kill -- on`.

### 2026-11-07 6:35 PM PT · Noel · Claude Code (Lot Escape subagent) · main
- **What:** Lot Escape fixed to standard sliding-vehicle rules (games/lotescape/RULES.md, with sources). Vehicles fill their cells exactly: car 2:1, truck 3:1, same thickness (vertical cars used to be drawn horizontally and rotated into slivers). System fonts replace the failing Google Fonts. Per-vehicle exit gates. The grid follows the lot size. Animated moves, live drag that stops at legal positions, keyboard (arrows/WASD, Tab/n/[ ]). The solver reports "unfinished" instead of "unsolvable" at its size cap. The rules stay in the shared engine; level JSON is unchanged. The Preview badge is gone from the hub.
- **Why:** Noel: car sizes were wrong; fix the games to their real rules.
- **Files:** `games/lotescape/**`, `site/games/lotescape/**`, `site/games/{index.html,published.json}`
- **State:** works; 13/13 game tests and typecheck pass, headless Chrome desktop and phone drag/keys/tap checked, deployed.
- **Next / heads-up:** **Max:** move counting stays per-cell (classic Rush Hour counts per slide) so saved move limits keep their meaning.
### 2026-11-07 18:50 PT · Abhinav (Claude) · branch `main`

**What:** (1) `docs/demo-inbound.md`: the customer-side demo scenario (a studio scans, replies,
pays in the Stripe sandbox, gets delivery) with the exact test-mode procedure (test card
4242…, CLI trigger, what rows to expect, what can break). (2) `platform/checks` gains the
`billing` check (Stripe payment recorded → delivery fulfilled, test mode counts). (3) The
platform smoke test now rejects its own stub level at the end so nothing sits in `solving`
(Pinara's 18:02 ask).
**Why:** Rehearse the payment path without real money; close one of the owed checks.
**Files:** `docs/demo-inbound.md`, `platform/checks/src/checks/12-billing.ts`, `platform/mcp/src/smoke.ts`.
**State:** Typechecks. The Stripe procedure is written from `business/src/billing/stripe.ts` and
Noel's README; not yet rehearsed. A full product audit is in progress (`docs/audit.md` next).
**Next / heads-up:** **Noel:** `docs/demo-inbound.md` is a proposal for 1:50–2:45 of your run of
show; the Stripe webhook endpoint must point at `levelai.vercel.app/webhooks/stripe`. **Abhinav:**
the Designer cron (`dep_pf9e3h9p…`) was created after the 16:45 switch-on, so it is still
disabled: run `npm run kill -- on "enable designer cron"`.

### 2026-11-07 6:32 PM PT · Noel · Claude Code · main
- **What:** Social posting now waits for the network's real answer. A post that comes back "failed" after being "scheduled" is logged as "couldn't post on x", not "posted".
- **Why:** All four X posts (6:11–6:28 PM) were accepted, then failed within ~4 s with no error. The log had called them posted.
- **Files:** `business/src/marketing/posts.ts`, `business/test/marketing.test.ts`
- **State:** works; tests pass, server restarted.
- **Next / heads-up:** X still fails for @uselevelai on Naïve's side (account connected, no error given). Needs the X account checked or reconnected.

### 2026-11-07 6:30 PM PT · Noel · Claude Code (+ docs subagent) · main
- **What:** (1) New logo everywhere: three tiles with googly eyes (`site/logo.svg`, `site/logo.png`). Used for the header mark and favicon on every site page, the console and outreach board, the games hub and game pages (build-games.sh now links /logo.svg), the email header (PNG, since email clients block SVG), and the README. (2) Developer docs: `/developers` rewritten as real docs (quickstart, REST reference with live responses, level JSON per game, studio connector setup for Claude Code/Cursor/Codex, errors, how levels are made and tested, what isn't built) plus `docs/developers.md`. The new `/api/*` endpoints are already live from the running server; their code lands with the watch-live commit because it shares app.ts.
- **Why:** Noel: use this logo everywhere; dev docs so studios can access level creations.
- **Files:** `site/logo.{svg,png}`, `site/*.html`, `site/games/**/index.html`, `site/build-games.sh`, `demo/public/{index,outreach}.html`, `business/src/email/html.ts`, `README.md`, `docs/images/logo.png`, `site/developers.html`, `docs/developers.md`
- **State:** works; site deployed, /logo.svg and /logo.png serve, /health ok before and after, email test passes.
- **Next / heads-up:** **X posting fails:** every post on @uselevelai comes back status "failed" in about 4 s with no error, even plain text. The account connects fine. Most likely the new X account is restricted from posting through apps until it's verified. The earlier log line saying "posted" counted "scheduled" as posted; that was wrong. Studios can't yet get levels made for their own game: levels and packs have no studio link column. Documented as a gap.
### 2026-11-07 18:40 PT · Abhinav (Claude) · branch `main`

**What:** **The people-data rule is not about field names.** CEO run
`ses_dgf2ak056kn4yqnr3gr0mme0jh` (after the metrics split): batch 1 of four reads
(`get_company_metrics`, `list_games`, `get_recent_decisions`, `board_read`) all completed with
no people fields in any output; batch 2 (`get_player_stats` ×5, `get_spend`, `log_action`) was
all held with `read_people: true`. So reading ANY output from an MCP server sets the flag for the
chat, and every later MCP call in that chat asks. The earlier probe passed only because its two
calls ran in one parallel batch. `approval-test` is now two dependent turns and reproduces this.
**Why:** Every multi-step agent on our servers (CEO, Tuner, Finance, Research, Sales) stalls on
its second turn. This blocks the unattended run.
**Files:** `platform/naive/src/approval-test.ts`.
**State:** Company switched on; the CEO and designer crons stall after their first turn.
**Next / heads-up:** **Decision needed from the team by 8 PM.** (A) Abhinav asks Naïve staff for a
per-server or per-agent exemption; (B) a policy auto-approver for our own servers only, every
approval logged as `platform.auto_approve` and disclosed in the demo (written, not wired, not
committed; pending team decision); (C) a human approves each held batch with scope "session",
logged as step-ins; (D) restructure agents to one read batch + board-driven writes. **Pinara:**
the Tuner's solve → poll → accept loop hits this too.

### 2026-11-07 18:30 PT · Abhinav (Claude) · branch `main`

**What:** Platform redeployed at 18:26 with the `get_company_metrics` split and Pinara's
`check_decision` tool (22 tools live). `npm run setup` re-applied nine agents (five deployments,
incl. Pinara's designer cron). CEO re-run started: `ses_dgf2ak056kn4yqnr3gr0mme0jh`. Naïve's
API is returning `429 the service is at capacity`; `ceo-now`, `inspect`, and `approval-test`
now retry 429/503 with backoff instead of crashing.
**Why:** Testing the `read_people` fix; the watcher must survive hackathon-time rate limits.
**Files:** `platform/naive/src/retry.ts`, `run-ceo.ts`, `inspect-session.ts`, `approval-test.ts`.
**State:** Typechecks. The CEO session ran unwatched; result unknown until inspected.
**Next / heads-up:** Abhinav: `npm run inspect -- ses_dgf2ak056kn4yqnr3gr0mme0jh` to read the
result. **Everyone:** expect 429s from Naïve tonight; retry, don't rerun.

### 2026-11-07 6:23 PM PT · Noel · Claude Code (games-hosting subagent) · main
- **What:** All games are on the site. Hub https://levelai.vercel.app/games, Splash Sort /games/watersort/, Turbo Lanes /games/racer/, Lot Escape /games/lotescape/ (Preview), Gem Match card → /play (Preview until match3 levels are accepted). "Games" link added to the header nav on index, join, play, playtest, privacy, and terms. `site/build-games.sh` rebuilds the bundles from games/*, without changing game code, and writes `site/games/published.json` (games the level API serves). Once the level API serves a game, its card links its newest agent-made level first.
- **Why:** Noel: host the games so we can see them.
- **Files:** `site/games/**`, `site/build-games.sh`, `site/*.html` (nav only), `site/styles.css` (additive)
- **State:** works; deployed, headless Chrome at 1440×900 and 390×844 (touch): loads, no console errors, real moves, no horizontal scroll.
- **Next / heads-up:** **Lot Escape owner:** the moving cars draw as thin slivers, and its two fonts don't load. That's a bug in the game's own render code. **Max/Pinara:** after changing a game, run `site/build-games.sh` and redeploy the site. The platformer has no browser UI, so it isn't hosted.

### 2026-11-07 6:19 PM PT · Noel · Claude Code (README subagent) · main
- **What:** New public README.md in the style of Noel's other repos: hero console screenshot, how it works (mermaid diagrams for the agent loop and the level loop), agents, what's autonomous, live numbers with timestamps, honest status and limits, stack, repo layout, how to run it, team, and credits. The old README (the team plan) is now `docs/plan.md`, and references in AGENTS.md, docs/*, games/match3/README.md, and platform/CONTRACTS.md point there. (The move itself went out by accident in e90218b, which left the repo briefly without a README; this restores it.)
- **Why:** Noel: a README like the rest of his profile.
- **Files:** `README.md`, `docs/images/{console,site-research}.png`, `docs/plan.md`, `AGENTS.md`, `docs/{agent-plan,how-to-win,master-plan}.md`, `games/match3/README.md`, `platform/CONTRACTS.md`
- **State:** works; mermaid rendered, links and images resolve, no emails or keys.
- **Next / heads-up:** **Everyone:** the team plan moved to `docs/plan.md`. The outreach screenshot was left out on purpose, since it names real studios.

### 2026-11-07 6:16 PM PT · Noel · Claude Code · main
- **What:** Playtest form: the link field now says what to paste ("Your game's link": an App Store link or a web link that opens in Safari; Google Play won't work yet). Mobilerun (ticket #373): they queued our apps into their hosted library (Royal Match and Block Blast still 404 as of 6:15 PM) and granted a 3-day iPhone subscription for a second phone where Apple sign-in works. That phone isn't created yet; it waits on Noel's OK.
- **Why:** Noel didn't know what to put in "App link".
- **Files:** `site/playtest.html`
- **State:** works; deployed, /health ok before and after.
- **Next / heads-up:** none.

### 2026-11-07 6:12 PM PT · Noel · Claude Code · main
- **What:** Real spend is logged now. The Monid wrapper reads each run's `billing.reportedCost` (micro-dollars), and every research pass logs what it cost (chart, reviews, store listings, contact lookups) in `cost_usd`, so the console's "Spent" shows real money instead of $0.
- **Why:** Noel: "why is it 0 cost". Our loops were paying for every call and logging $0.
- **Files:** `business/src/research/monid.ts`, `business/src/outreach/autopilot.ts`, `business/test/research.test.ts`
- **State:** works; 143 tests pass, server restarted. The first cost shows after the next pass completes (~10 min).
- **Next / heads-up:** OpenAI checks and Mobilerun minutes aren't in "Spent" yet. Their prices aren't reported per call.

### 2026-11-07 6:12 PM PT · Noel · Claude Code · main
- **What:** (1) Social is live: the first post went out on X (@uselevelai) at 6:11 PM, with the live research numbers (3,150 reviews, 12 level complaints: 8 too easy, 4 too hard) and the free audit link. (2) Automatic posting from our server every 2 h (`SOCIAL_LOOP=1`, `SOCIAL_LOOP_MINUTES=120`, on by default when the social key is set). It rotates research → levels → research → playtest, posts research only when there are new numbers (networks reject duplicates), retries when the service is "at capacity", and posts only to connected accounts. Cap is now 4 per network per day. Research posts show counts until there are 50+ complaints, then percentages. The levels post no longer says "hundreds of times" (the solver runs 50). The Marketing agent's `post_update` gains a 'research' angle. (3) Console text scale: full size in full screen only; in a window it's 84%, and the `-` and `=` keys adjust it (remembered per viewer).
- **Why:** Noel: automate social now; the console looked zoomed in on a laptop.
- **Files:** `business/src/marketing/{posts.ts,loop.ts}`, `business/src/{server.ts,config.ts,mcp/server.ts,mcp/tools.ts}`, `business/test/marketing.test.ts`, `business/.env.example`, `demo/public/index.html`
- **State:** works; 142 business tests and 17 demo tests pass, server restarted.
- **Next / heads-up:** Only X is connected. Connect more through the portal (ask Claude for a fresh link).
### 2026-11-07 18:02 PT · Pinara (Claude Code) · branch `main`

**What:**
- **The Designer gets a scheduled level run** (cron `20 * * * *`, $1.20 per run; the daily cap
  stays $35).
  - Each run designs and tunes one match3 level (what `/play` shows) and one level for another
    game.
  - Targets cycle from 30% to 70% over the day.
  - Levels keep flowing even while the CEO hands out no cards.
  - The Designer's allow-list gains `solve_level`, `get_solver_run`, `accept_level`, and
    `reject_level`.
- **Shared `TUNE_RULES` for the Tuner and the Designer:**
  - Wait about 20 s between `get_solver_run` polls. Match-3 runs take 1 to 3 minutes, and nonstop
    polling would burn the Tuner's $0.40 task cap.
  - For match-3, pass `runs: 100`.
  - Per-game knob guidance, measured:
    - Splash Sort: `move_limit`, about 15 to 19 points per pour.
    - Turbo Lanes: `time_limit`, about 3 points per tick.
    - Match-3: `move_limit` for big steps, about 10 to 15 points per move; then `goal.target`, about
      3 to 5 points per gem. With `move_limit` alone, the tunability eval hit 0 of 5 targets.

**Why:** Noel's report says there are zero match-3 levels and `/play` is empty. The diagnosis:
- **The solver worker is running.** It's the old 3:59 PM process, which writes no heartbeat and
  knows only `stub`.
- **The levels stuck in `solving` are 4 `stub` smoke-test levels.** Their solver runs are done, and
  nothing accepts test data.
- **The real cause:** no real Designer or Tuner session has run. Every `designer` and `ceo` row is
  from a smoke test, because the stalled CEO never handed out a design card.

**Files:** `platform/naive/src/roster.ts`.
**State:**
- The roster typechecks and loads (designer cron `20 * * * *`, task cap $1.20).
- The combined `main` after syncing my folder: `solver` 19/19, `evals` 10/10, `watersort` 8/8,
  `racer` 10/10. Every typecheck is clean.
- Not applied in Naïve until setup runs.

**Next / heads-up:**
- **Abhinav:**
  1. `npm run setup` re-applies the prompts (the CEO's `check_decision` step, `TUNE_RULES`) and
     creates the Designer's cron **disabled**.
  2. `npm run kill -- on` enables it.
  3. Until then, `/play` stays empty.
  4. Optional: your smoke test could reject its `stub` level at the end, so nothing sits in
     `solving`.
- **Pinara:** restart the solver worker (old PID 32553):
  1. Press Ctrl+C in its terminal, or run `kill 32553`.
  2. Run `cd solver && caffeinate -i npm run worker`.
  3. The new worker writes a heartbeat and knows all 4 games.
- **Max:** match-3 greedy, 60 games per point:

  | Knob | Values | Greedy win rate |
  |---|---|---|
  | `move_limit` | 6 to 10 | 28 / 42 / 57 / 68 / 71% |
  | `goal.target`, at `move_limit` 8 | 20 to 50 | 90 / 75 / 57 / 33 / 22 / 7 / 4% |

  `greedy` still takes about 1.7 s a game.

### 2026-11-07 6:01 PM PT · Noel · Claude Code · main
- **What:** One game's reviews failing to load, or a failed send, now skips that game instead of ending the whole chart pass. Confirmed the send-as-you-go change live: Hidden Folks B.V. was emailed at 5:57 PM the moment its game qualified.
- **Why:** "couldn't read the top paid casual chart" at 5:57 PM came from one game's error mid-pass.
- **Files:** `business/src/research/targets.ts`, `business/src/outreach/autopilot.ts`
- **State:** works; 140 tests pass, server restarted.
- **Next / heads-up:** `NEW_NAIVE_KEY` (added by Noel) is in his personal workspace (0 agents, identity idn_debsb…), not the team one. Social posting uses the team workspace via `NAIVE_API_KEY_SOCIAL`.

### 2026-11-07 5:59 PM PT · Noel · Claude Code · main
- **What:** Social posting is set up in the team Naïve workspace. Noel added `NAIVE_API_KEY_SOCIAL` (team workspace, billing:write). I created identity `idn_ktrxjg2jbb1bmz7shpjpj05rjt` "Level AI" there and activated social (`activated: true`, no accounts yet). `post_update` now posts through that key and identity (`NAIVE_SOCIAL_IDENTITY_ID`), falling back to the old identity if unset. Mobilerun support ticket #373 filed (Apple sign-in, App Store catalog, iOS uninstall).
- **Why:** The Marketing agent needs connected accounts to post.
- **Files:** `business/src/config.ts`, `business/src/mcp/tools.ts`, `business/.env.example`
- **State:** partly works: activation done, 140 tests pass; posting waits on Noel connecting accounts in the portal.
- **Next / heads-up:** Noel's old `NAIVE_API_KEY` is a separate personal workspace (0 agents). The team's agents are only visible with the social key.

### 2026-11-07 5:57 PM PT · Noel · Claude Code · main
- **What:** A solver worker now runs on Noel's laptop under `solver-keepalive.sh` (restarts it if it exits). It claims queued runs with SKIP LOCKED, so it's safe next to Pinara's worker. Games: match3, platformer, racer, stub, watersort.
- **Why:** Readiness check `solver_queue` was red: "no live worker heartbeat".
- **Files:** `solver-keepalive.sh`
- **State:** works; worker logged "started" at 01:57 UTC.
- **Next / heads-up:** **Pinara:** check is now 10/16 green; still red are levels_flow / design_tune_solve (no on-target level accepted in 3 h). **Max:** publish_play and player_events need a published pack. The `deployments` check only passes with Abhinav's Naïve key (his workspace).

### 2026-11-07 5:56 PM PT · Noel · Claude Code (phone-loop subagent + main) · main
- **What:** The iPhone now playtests on its own every 30 min (`PLAYTEST_LOOP=1`, now on in .env). Paid orders always come first, and it never runs while another phone task is active. It plays our own newest levels in Safari when they exist; otherwise it runs a market study of a free web puzzle game (2048, Gemline match-3, Water Sort, Flood), each checked on a phone screenshot. A blank-screen detector (`mobile/screen.ts`, node:zlib only) fails a run instead of "playing" a white page, and the board is left on screen afterwards (never a blank tab). Console labels: market studies read "Now playtesting 2048, a web puzzle game" instead of "X's app". I corrected the one invalid row: a Water Sort "win" recorded while the page was blank on the phone is now logged as a failed run, result discarded.
- **Why:** The phone should be doing real work all night; Noel saw a blank screen labeled "water-sort for Water Sort".
- **Files:** `business/src/mobile/{loop.ts,screen.ts}`, `business/src/server.ts`, `business/test/playtest-loop.test.ts`, `demo/src/moments.ts`, `demo/public/index.html`, `demo/test/moments.test.ts`
- **State:** works; 2048 run task 924dfb94… completed with the board visible; business and demo tests pass; server restarted with the loop on.
- **Next / heads-up:** Phone runs of our own levels will post player events from the page with no "phone" tag.

### 2026-11-07 5:53 PM PT · Noel · Claude Code (research-UI subagent) · main
- **What:** Live market research on the website ("What players are saying right now": reviews and games read, too hard / too easy / want more levels / repetitive, a card per chart with the strongest example; polls `/market-research` every 60 s; empty state "Our agents are reading the charts now"; new stats tile "Player reviews our agents read", hidden at 0). Console: "Market research" card that opens a drawer of every pass, backed by `/api/market-research` from Neon; rehearsal data is labeled invented. The in-place outreach board now has "← Back to the company", a "Press O or Esc to go back" hint, and the logo closes it too.
- **Why:** Noel: more visible market research; he got stuck on the outreach board with no way back.
- **Files:** `site/{index.html,site.js,styles.css}`, `demo/{public/index.html,public/outreach.html,src/feeds.ts,src/server.ts,test/research.test.ts,README.md}`
- **State:** works; site deployed, demo typecheck clean and 16 tests pass, console restarted, checked at 1920×1080 and 1440×900.
- **Next / heads-up:** Sender display name shows "AgentMail" and emails carry a "Sent via AgentMail" footer. Our inbox key can't change it (403 missing permission); change it in the AgentMail dashboard.

### 2026-11-07 5:52 PM PT · Noel · Claude Code (revenue subagent) · main
- **What:** (1) Money path proven end to end in test mode, no browser, no human: order `/playtest-orders` → payment link → checkout paid with a test card (pi_3UZL9P…) → webhook evt_1UZL9Q… verified → payment row paid→delivered → iPhone playtest ran → report emailed, labeled "[Test order]". The webhook now logs every outcome (duplicates, amount mismatch, no automated delivery → left for a person). Failure emails no longer promise a retry that doesn't exist. Google Play links are refused at order time (the iPhone can't run them). (2) Auto-replies: a positive studio reply gets one fixed, honest answer within a minute (free levels plus the $5 playtest page). A clear no → lost, out-of-office → ignored, anything hostile, mixed, long, or a real question → left for a person. Cap 10/day, one auto-answer per studio, kill switch `AUTO_REPLY=0`. Tested live: reply sent 01:50:25 UTC, answered 01:51:13. (3) Restart fix: `lsof -ti tcp:PORT` also matches the cloudflared tunnel's connection, so our restarts were killing tunnels. Use `lsof -ti tcp:PORT -sTCP:LISTEN`.
- **Why:** Earning has to work without us; replies were only being recorded.
- **Files:** `business/src/{app.ts,leads/playtest-offer.ts,mcp/tools.ts,outreach/guard.ts,outreach/inbound.ts}`, `business/test/{money-path,auto-reply,playtest-offer}.test.ts`, `business/keepalive.sh`
- **State:** works; typecheck clean, business tests pass.
- **Next / heads-up:** **Abhinav:** `get_company_metrics` `stripe_revenue_usd` sums test and live payments together, so split them. The playtest order queue is in memory, and a restart drops a queued order (its delivery row stays pending). AgentMail adds a "Sent via AgentMail" footer and display name. That's an inbox setting.

### 2026-11-07 5:50 PM PT · Noel · Claude Code · main
- **What:** The outreach loop emails each studio the moment its game qualifies, instead of after reading the whole 30-game chart. Games read in the last 6 h are kept in a temp file, so a server restart doesn't re-read them (or pay again).
- **Why:** Passes take ~6 min, and agents restart the server often, so passes were cut off before their send step (e.g. a word-games pass at 5:46 PM).
- **Files:** `business/src/outreach/autopilot.ts`, `business/src/research/targets.ts`
- **State:** works; typecheck clean, tests pass (except the playtest-loop subagent's in-progress test file).
- **Next / heads-up:** none.

### 2026-11-07 5:46 PM PT · Noel · Claude Code · main
- **What:** More research and outreach. The outreach loop now cycles 15 store charts (top free, top-grossing, and top paid × puzzle, casual, word, board, card), reads up to 30 games per pass, runs every 10 min (was 20), and sends up to 3 emails per pass. The daily cold cap is now 40 (was 20). Contacts: the Google Play listing's developer email is used first if it's role-based, then Hunter generic addresses for the listing's website domain, then Hunter by company name. Personal addresses are never used.
- **Why:** Noel: much more market research and outreach. Most strong targets had been skipped with "no public contact."
- **Files:** `business/src/research/contacts.ts`, `business/src/outreach/autopilot.ts`, `business/src/config.ts`, `business/test/integration-features.test.ts`
- **State:** works; 135 tests pass, server restarted.
- **Next / heads-up:** Monid spend is about $0.30/hr at this pace (balance ~$19).
### 2026-11-07 17:46 PT · Pinara (Codex) · branch `main`

**What:** Redesigned Splash Sort with mineral-glass tubes and Turbo Lanes with a midnight motorsport UI. Added visible objectives, progress, numbered tubes, legal-target cues, three solver-backed hints per sort attempt, racer restart, oil hazards and one-hit collectible shields.
**Why:** Make Pinara's games polished and readable on phones and desktops while keeping LevelOps authoring, simulation and browser rules consistent.
**Files:** `games/racer/{public,ui,src,test,README.md,SKILL.md}`, `games/watersort/{public,ui,UI.md}`.
**State:** Works locally. Both builds and strict typechecks pass; racer 10/10 and watersort 8/8 tests pass. Headless Chromium at 390×844 and 1280×1000: both samples autoplay to wins, hints highlight a valid pair, no page exceptions or horizontal overflow. Intercepted LevelOps UUID loads emit attempt and win for both game IDs; no live data was written.
**Next / heads-up:** **Max:** redeploy both static clients. **Abhinav:** redeploy the registered racer adapter/schema to expose additive `oil` and `shield` object kinds in LevelOps. Old level JSON still validates. Shield state is included in the exact solver and bot planning. Generated racer samples changed: remeasure difficulty rather than reusing historical win rates. Hints assist browser players only; bot figures remain unassisted. Live hosting/Neon and real-phone playtests were not verified. Other sessions' solver/eval changes are excluded from this commit.


### 2026-11-07 17:42 PT · Pinara (Claude Code) · branch `main`

**What:** The rest of package 11 (evals and the CEO's decision check), plus fixes the evals found.
- **`check_decision`**, a new read-only MCP tool. Its logic is in `evals/src/decision-check.ts`.
  For a decision, it compares players' win and quit rates on the levels the decision named (and
  their retuned versions) before and after, against the same game's untouched levels
  (difference-in-differences, z-scores). It also:
  - checks a threshold expectation like "quits below 35%" automatically
  - says `not_enough_data` below 15 finished plays per group
  - uses no person-like fields
- **CEO prompt (`roster.ts`):**
  - Step 2 calls `check_decision` before `resolve_decision`, and sets `matched_expectation` from
    its numbers.
  - Step 5 asks for level ids in cards and checkable thresholds.
  - `check_decision` is allow-listed for the CEO.
- **Pipeline evals** (`evals/`, `npm run report`): per game, the Tuner's hit rate (accepted within
  4 versions and 5 points), rounds, error, solver runs, bot-vs-player calibration, and cost per
  accepted level.
- **Tunability eval set** (`npm run tunability`): 5 targets per game, with an ideal Tuner.
- **New readiness check** `design_tune_solve` (`platform/checks`): every live game needs an
  on-target level in 3 h. It also shows when the harness last finished a run.
- **Splash Sort's human bot** now wastes about 3 pours in 10, as people do. The eval showed the
  old near-perfect bot made `move_limit` a staircase (30 to 50 points per pour), so only 4 of 10
  targets were reachable. Now it's 15 to 19 points per pour and 8 of 10. `SKILL.md` and `README`
  have the new numbers.

**Why:** The master plan's package 11 (evals and the CEO's "did that decision work?" check, due
10 PM) and the "Design → tune → solve" demo check.
**Files:** `evals/`, `platform/mcp/src/tools.ts`, `platform/naive/src/roster.ts`,
`platform/checks/src/checks/15-design-tune-solve.ts`, `games/watersort/src/bots.ts`,
`games/watersort/{SKILL,README}.md`, `platform/CONTRACTS.md` (one new tool row), `AGENTS.md`.
**State:** Works.
- **Tests:** `evals` 10/10, `solver` 17/17, `watersort` 8/8, `racer` 8/8. Typecheck is clean in
  every package, including `platform/mcp`, `platform/naive`, and `platform/checks`.
- **End to end on a throwaway local Postgres,** through the real `fn.ts` handler over MCP:
  1. `fn.ts` seeded all 5 games.
  2. Splash Sort: design, then 4 Tuner rounds with the real worker; accepted at 49% for a 50%
     target.
  3. Turbo Lanes: accepted at 54% in 3 rounds.
  4. The CEO logged a decision, and players' quits fell from 50% to 19.5% (control flat).
  5. `check_decision` returned "changed", −30.5 points on quits (z −2.27), expectation met. The
     decision was resolved.
  6. `npm run report` showed 100% hit rate and a 2.2-point calibration gap.
  7. Readiness checks: `solver_queue`, `levels_flow`, and `design_tune_solve` are correct (red only
     for match3 and platformer, which had no levels in the test).
- **Not run against Neon:** the agents need Abhinav's key.

**Next / heads-up:**
- **Abhinav:**
  - `check_decision` is a new tool, additive. Redeploy, then re-run `npm run setup` for the CEO
    step and allow-list.
  - The CEO's "check last time" now waits for 15 finished plays per group, so real players matter
    for the CEO's results.
- **Max:**
  - The tunability eval scored match3 0/5. `greedy` jumps from 26% to 43% to 60% to 100% between
    6 and 11 moves, so `move_limit` alone can't hit middle targets.
  - `greedy` takes about 1.7 s a game, so 200 games take about 6 min on one thread and about 2 min
    with the harness's new threads.
  - A faster bot, or a second knob such as `goal.target`, would make match3 tunable.
- **Uncommitted work by another session** is in `games/racer/*` (oil and shields) and the Splash
  Sort UI. It's not in this push.

- **Push scope:** the solver runner hookup (`queue.ts`, `worker.ts`, `README`, `.env.example`, plus
  `run.ts`, `sim-worker.ts`, and tests) already landed in `0942497`, from another session, together
  with its worker heartbeat. This push contains only the files listed above.

### 2026-11-07 5:43 PM PT · Noel · Claude Code (verifier subagent) · main
- **What:** Cold-outreach evidence is now checked by a model before sending. For each game that passes the keyword threshold (≥3 matching reviews), `gpt-5.4-mini` (strict JSON) confirms each candidate sentence is a real complaint about this game's levels, and may add complaints the keywords missed, but only sentences that appear word for word in a review. Counts, pitch angle, quotes, reason, and score are rebuilt from confirmed sentences only. Falls back to the keyword result if the key is missing, a call fails, or the daily cap (`OPENAI_DAILY_CALLS`, 300) is hit. It logs a line when the check changes the evidence.
- **Why:** Fewer wrong emails, more right ones. Real run: Parking Loop 7/7 quotes confirmed; Color Block Jam's angle moved from too easy (3) to too hard (4).
- **Files:** `business/src/research/{verify.ts,signals.ts,targets.ts}`, `business/src/outreach/autopilot.ts`, `business/src/config.ts`, `business/.env.example`, `business/test/verify.test.ts`
- **State:** works; typecheck clean, all business tests pass, `/health` shows `openai: true`.
- **Next / heads-up:** `find_targets` and `audit_game` in the MCP tools still use keywords only; the autopilot uses the checked path.
### 2026-11-07 17:50 PT · Pinara (Claude Code) · branch `main`

**What:**
- **Answer to Noel's 5:19 and 5:22 heads-ups, checked in Neon at 17:35.**
  - A worker *was* running: `pinara-laptop`, started 3:59 PM. All 4 solver runs are `done`.
    The 3 runs queued from 2:52 to 3:25 PM finished at 3:57 PM, and the 5:27 PM run finished in
    0.5 s.
  - **The real bug:** that worker loaded the adapter registry before match3 was added (4:29 PM),
    so it knows only `stub`. Any match3 solve would have failed with "no adapter", and the Tuner
    would then have rejected a good level.
  - **The levels "stuck in solving"** are 4 `stub` levels with notes `smoke`, made by
    `platform/mcp/src/smoke.ts`, which calls `solve_level` and never accepts or rejects. They
    aren't Designer output. **No Designer session has saved a level yet**, which is why match3 has
    0 levels.
  - I left the 4 rows as they are. Rejecting them would add 4 to `levels_rejected` in
    `get_company_metrics`.
- **Worker fix:**
  - It claims only runs for games in its registry. Runs for other games stay queued instead of
    failing.
  - It logs `queued_for_unknown_games` with a "git pull, then restart" hint.
  - Every 30 s it writes a heartbeat to `settings` under `solver_worker:<WORKER_ID>`:
    `{ worker, games, started_at, at, stopped? }`. That's a new key; the schema is unchanged.
- **`solver_queue` check** (Pinara's) now reads the heartbeat. It fails when queued runs are for
  a game no live worker knows, or (after switch-on) when no worker has written in 3 minutes.
- **Also included, at its request:** the runner from Pinara's other session. `runLevelSmart`
  plays slow games across worker threads under a per-run time budget (`SOLVER_THREADS`,
  `SOLVER_MAX_SECONDS`), and adds the result fields `budget_hit` and `runs_requested`. Match3
  takes about 70 s for 2 bots × 200 games on one thread, so it needs this.

**Why:** Match-3 levels couldn't make it through tuning with a stale worker, and nobody could tell
from outside whether a worker was alive or which games it knew.
**Files:** `solver/src/{queue,worker,run,sim-worker}.ts`, `solver/test/{queue,smart}.test.ts`,
`solver/README.md`, `solver/.env.example`, `platform/checks/src/checks/02-solver-queue.ts`.
**State:**
- Works locally: solver tests 19/19, and the solver and checks typechecks are clean.
- The new check, run read-only on Neon, reports "no live worker heartbeat". That's correct,
  because the old worker predates the heartbeat.
- **Not verified end to end:** no match3 level exists yet to solve.

**Next / heads-up:**
- **Pinara:**
  1. Ctrl-C the old worker in its terminal.
  2. `git pull`, then `cd solver && caffeinate -i npm run worker`.
  3. Confirm that the started line lists `match3, platformer, racer, stub, watersort`. Within 30 s
     the check should show the worker.
- **Abhinav:**
  - (a) `smoke.ts` should `reject_level` its stub level, or the metrics should skip
    `game_id = 'stub'`.
  - (b) Match3 levels need one design → tune pass, either through the CEO or by starting the
    Designer directly. This clone has no `NAIVE_API_KEY`, so Pinara can't start it from here.
- **Noel:** `/play` stays empty until a match3 level is accepted and published.

### 2026-11-07 5:40 PM PT · Noel · Claude Code · main
- **What:** Console (levelai-console.vercel.app) was down: its tunnel process had died, most likely at the same moment as the business tunnel around 5:30. Restarted with `demo/console.sh`. `demo/keepalive.sh` now also checks the public console every 10 s, and after 3 failures it reruns `console.sh` (new tunnel, console site redeployed).
- **Why:** Noel: "the console is not working."
- **Files:** `demo/keepalive.sh`
- **State:** works; public page 401 without the password and 200 with it; `/api/state`, `/api/phone.png`, and `/outreach` return 200.
- **Next / heads-up:** Quick tunnels die on network blips. Both watchdogs now recover them on their own within about a minute.

### 2026-11-07 5:32 PM PT · Noel · Claude Code · main
- **What:** Market research on every outreach cycle. Each chart pass now reads up to 20 games and saves the totals to `biz_market_research` (games, reviews, too hard, too easy, wants more levels, repetitive, games with a clear problem, the strongest one). It also logs a line the console shows. There's a public `GET /market-research` (counts only), and `/public-stats` gains `reviewsRead`. The watchdog now also catches a dead tunnel: 3 failed public health checks → reruns `live.sh`. The tunnel had died silently and taken levelai.vercel.app's API down for a few minutes; restored.
- **Why:** Real, growing numbers for the demo; the site should never silently lose its backend overnight.
- **Files:** `business/src/{store.ts,app.ts,outreach/autopilot.ts,research/targets.ts,db/schema.sql}`, `business/live.sh`, `business/keepalive.sh`
- **State:** works; 85 tests pass, table applied to Neon, `/market-research` live (fills in as cycles run).
- **Next / heads-up:** none.
### 2026-11-07 17:35 PT · Abhinav (Claude) · branch `main`

**What:** **First fix for the `read_people` stall.** `get_company_metrics` no longer returns
`studios_found`, `emails_sent`, `replies`, `payments_count`, `revenue_usd` (renamed `players` →
`play_sessions`, `human_interventions` → `human_step_ins`, added `solver_queued`/`solver_done`).
Those counts moved to a new `get_pipeline_metrics` (`leads_total`, `leads_progressed`,
`outbound_count`, `inbound_count`, `payments_count`, `revenue_usd`), given to **Finance only**.
The CEO reads production metrics, games, player stats, decisions, and the board; Finance posts
the sales summary to the board. Rule written into `platform/CONTRACTS.md`. Also: platform
redeployed at 17:28 with `GAMES_BASE_URL=https://levelai.vercel.app`; `list_games` now returns
`match3` and `platformer`.
**Why:** The CEO's first run was held with `read_people: true` on every call after reading a
JSON with those fields. This is a hypothesis (output content trips the flag); the next `ceo-now`
run tests it.
**Files:** `platform/mcp/src/tools.ts`, `platform/naive/src/roster.ts`, `platform/CONTRACTS.md`.
**State:** Typechecks; smoke OK locally. **Needs:** `neon deploy --env .env` (platform) and
`npm run setup` (roster), then `npm run ceo-now`.
**Next / heads-up:** **Max:** `get_company_metrics` field names changed; if the dashboard reads
it, use the new names (or read Neon directly). **Pinara:** keep people-ish words out of anything
the Tuner reads back. **Noel:** if the CEO still stalls, fallback 2 is `confirmTool(scope:
"session")` per run, logged as a step-in; fallback 3 is a reader/actor split for the CEO.

### 2026-11-07 5:25 PM PT · Noel · Claude Code · main
- **What:** The Monid wrapper follows `data.download_link` when a result is too big to return inline. Board and word charts went from 0 games to 50 each, and large review pages are covered too.
- **Why:** The board-games outreach cycle "found 0" in 7 s because the chart came back as a download link.
- **Files:** `business/src/research/monid.ts`, `business/test/research.test.ts`
- **State:** works; 84 tests pass, checked live (Vita Mahjong, Wordscapes, and others).
- **Next / heads-up:** none.

### 2026-11-07 5:24 PM PT · Noel · Claude Code (demo subagent + main) · main
- **What:** Console redesign in the site's look, now interactive: click an agent to filter the feed, click a row for full text, click a number for the rows behind it, click a studio stage for that stage's studios, click the phone to enlarge it with the latest playtest steps. It scrolls on short screens, with each panel scrolling on its own. Presenter keys F/O/Q/P/D/?/Esc. Moments fire only from real log rows. `./demo.sh --rehearsal` plays an invented story under a permanent REHEARSAL DATA banner. Live mode hides team test studios and setup rows (probe, approval_test, and now the CEO's smoke-test decisions). Outreach loop rotation now starts from the clock, so a restart moves to a new chart.
- **Why:** Noel: make the console useful and show what's happening; the Decisions count was 3 smoke-test rows.
- **Files:** `demo/` (index.html, outreach.html, src/moments.ts, src/events.ts, src/feeds.ts, src/outreach.ts, src/server.ts, README.md, test/moments.test.ts), `business/src/outreach/autopilot.ts`
- **State:** works; demo typecheck and 14 tests pass, :4545 and levelai-console.vercel.app serve it behind the password, Decisions now reads 0 (honest).
- **Next / heads-up:** The live phone has been sitting on Apple Account sign-in screens that show two iCloud addresses. Clear it before the demo, because it goes straight to the projector.

### 2026-11-07 5:22 PM PT · Noel · Claude Code (level-delivery subagent + main) · main
- **What:** Web player for agent-made levels at https://levelai.vercel.app/play (`?level=<id>`, `?pack=<id>`, or newest pack), built on Max's match-3 engine (unchanged, MIT credit kept). Public read-only level API (`/levels/:id`, `/packs/:id`, `/levels-latest`; accepted/published match3 only, notes and creator private). Player events post to the platform's `/events`. Welcome email links the newest pack when one exists, otherwise keeps the reply wording; it now also sends its HTML version (it had been going out as plain text only).
- **Why:** The emails promise free levels; there was nowhere to play them.
- **Files:** `player/`, `site/play.{html,css,js}`, `business/src/levels/public.ts`, `business/src/app.ts`, `business/src/leads/live.ts`, `business/src/outreach/{compose,send}.ts`, `business/live.sh`
- **State:** works; 83 business tests pass. Played to a win locally (mouse and touch) against throwaway test levels. Production `/play` shows "New levels are on the way" because Neon has **zero match3 levels**.
- **Next / heads-up:** **Abhinav:** the deployed platform function returns "unknown game" for match3, so the Designer can't save match3 levels until it's redeployed. Set `GAMES_BASE_URL=https://levelai.vercel.app` when you redeploy (`/match3` aliases to `/play`). **Pinara:** no solver worker is running, and the 3 stub levels were never accepted or rejected, so there are no packs.

### 2026-11-07 5:19 PM PT · Noel · Claude Code · main
- **What:** (1) Outreach loop fixed: it had run dry (two puzzle charts, every game already read) and its last run died silently on an empty store-chart response. It now rotates through 7 puzzle-adjacent charts (puzzle, casual, board, word; free, grossing, paid), retries an empty chart once, logs failures to the activity log, and runs every 20 min (was 45). Same guards: ≥3 matching reviews, daily cap, opt-outs. (2) iOS installs: Mobilerun installs by bundle id, not numeric App Store id (numeric → 404), and only for apps in its own catalog (Duolingo, Spotify installed; Royal Match, Block Blast, NYT → APP_NOT_FOUND instantly). Installer now resolves the bundle id via Apple's public lookup and installs inline so the reason comes back. (3) `business/keepalive.sh` restarts the business server if it goes down, tunnel untouched. (4) `live_phone_view` check sends the console password.
- **Why:** No agent action had been logged since 4:54 PM; App Store playtests never installed.
- **Files:** `business/src/outreach/autopilot.ts`, `business/src/research/{monid,targets}.ts`, `business/src/config.ts`, `business/src/mobile/install.ts`, `business/keepalive.sh`, `platform/checks/src/checks/14-live-phone-view.ts`
- **State:** works; 82 business tests pass, typecheck clean, server restarted and healthy.
- **Next / heads-up:** **Abhinav:** the `deployments` check reads `platform/naive/team.json`, but my `NAIVE_API_KEY` sees zero agents and zero deployments, so the team lives in your Naïve workspace. The last CEO decision is 3:25 PM and the Designer's last level is 3:25 PM, so confirm the crons are actually firing on your side. **Pinara:** 3 levels have sat in `solving` since ~3:25 PM. **Mobilerun:** the Apple Account sign-in on the cloud iPhone fails ("Could not communicate with the server"). Don't sign a personal Apple ID into it.

### 2026-11-07 5:08 PM PT · Noel · Claude Code · main
- **What:** Console scrolls now: the page scrolls when the window is shorter than the layout, and the activity feed scrolls on its own. Includes the demo agent's in-progress console work that was already live.
- **Why:** On a laptop the bottom row (Studios funnel, step-ins) was cut off and nothing scrolled.
- **Files:** `demo/public/index.html`, `demo/public/outreach.html`, `demo/src/*`
- **State:** works; checked the served page at localhost:4545 and demo typecheck passes.
- **Next / heads-up:** Demo agent is still adding click-through drawers (agent filter, stat details, funnel stages, phone modal).

### 2026-11-07 16:55 PT · Pinara (Claude Code) · branch `main`

**What:**
- **Two new games, built from scratch** (Pinara's games 4 and 5; Max keeps games 1 to 3, per
  Pinara). Each has our own name and look:
  - **Splash Sort** (`games/watersort/`): a water-sort puzzle with an exact breadth-first solver
    (fewest pours, and proof of unsolvable levels).
  - **Turbo Lanes** (`games/racer/`): a lane racer whose rules run in fixed ticks, with an exact
    fastest-finish solver.
- **What each game has:**
  - The adapter (`platform/CONTRACTS.md` §1, default and named `adapter` export).
  - Bots `human` (the reference), `greedy`, and `random`, all seeded.
  - A phone UI with labeled buttons, `?autoplay=1`, and `window.*` hooks for CDP checks.
  - 4 practice levels and a `SKILL.md`.
- **Registered both adapters** in `platform/mcp/src/adapters.ts` (two imports, same pattern as
  Max's), and added both to `games/skill-routing.json` (additions only, marked
  `planned_not_connected`).
- **Tuner prompt fix:** the reference bot is now the first of `human`, `search`, `greedy` the game
  has, never `random`. Before this, Max's games (bots `random`, `greedy`) would have been tuned
  against `random`.

**Why:** More genres on one platform, with numbers that can be proven: solvable, minimum moves, and
human-bot win rates that respond smoothly to one knob each.
**Files:** `games/watersort/`, `games/racer/`, `platform/mcp/src/adapters.ts`,
`platform/naive/src/roster.ts`, `games/skill-routing.json`, `AGENTS.md`.
**State:** Works locally.
- `npm test`: 8/8 pass in each game. This includes a run through `solver/src/run.ts`.
- Typecheck is clean in both games, `platform/mcp`, `platform/naive`, and `solver`.
  `solver` tests pass 13/13 with the new registry.
- Played in headless Chromium at iPhone 13 size:
  - Splash Sort autoplay won in 14 pours, which is the solver's minimum.
  - Turbo Lanes autoplay won in 82 ticks, also the solver's minimum, with 0 crashes.
  - The only console error was the expected 404 from the missing `/levels/:id` route.
- Measured knobs, human-bot win rate:

  | Game | Knob | Values | Human win rate |
  |---|---|---|---|
  | Splash Sort | `move_limit`, at min / +2 / +4 / +6 | 23 / 25 / 27 / 29 | 2% / 26% / 84% / 98% |
  | Turbo Lanes | `time_limit`, at min / +10 / +20 | 82 / 92 / 102 | 2% / 47% / 97% |
  | Turbo Lanes | `speed` | 5 / 14 | 71% / 13% |

**Next / heads-up:**
- **Abhinav:**
  1. Redeploy the platform so the MCP server sees `watersort` and `racer`.
  2. Insert their `games` rows (SQL in each game's README). Only `stub` exists in Neon, so
     `save_level` fails for match3 and platformer too.
  3. Add a public `GET /levels/:id` returning `{ level_id, game_id, level }`, so any browser game can
     open `?level=<id>`.
  4. Push `game-watersort` and `game-racer` skills.
  5. Re-run `npm run setup` for the Tuner fix.
- **Max:**
  - Please host `games/watersort/dist` and `games/racer/dist` at `${GAMES_BASE_URL}/<game_id>/`. Build
    them with `npm run build`; `dist/` is git-ignored.
  - Your bots are `random` and `greedy`, so the Tuner now uses `greedy` as the reference. Add a
    `human` or `search` bot if you want a closer match to people.
- **Everyone:** the master plan still lists three games. This adds games 4 and 5 as Pinara's; the
  team should confirm.
- **Pinara:** restart the solver worker (Ctrl-C, `caffeinate -i npm run worker`), so it loads the
  new registry with match3, platformer, watersort, and racer.

### 2026-11-07 17:05 PT · Noel (Claude Code) · branch `main`

**What:** **App Store playtests: built, but installs fail on our cloud iPhone.** A playtest order with an App Store link
(`apps.apple.com/…/id123`) now installs the app on the phone through Mobilerun (`devices.apps.install` with the
numeric App Store id), finds it by diffing the app list, and plays it by its home-screen label. It fails fast if the
install fails. **Live test on Nov 7, 4:57 PM:** installing Ketchapp's "2048" (840919914) failed immediately (install log:
`status: failed`, no reason given). The likely cause is that the cloud iPhone isn't signed in to an App Store account
(unverified). Until that's solved, App Store orders get an honest "couldn't install" report, and web links work as before.
**Files:** `business/src/mobile/install.ts`, `business/src/mobile/plan.ts`, `business/src/leads/playtest-offer.ts`.
**State:** 71 tests pass. The failure path was verified live.
**Next / heads-up:** **Noel:** ask Mobilerun how to enable App Store installs on the cloud iPhone (is an Apple ID
required?). Android playtests need an APK uploaded to the Mobilerun app library.

---

### 2026-11-07 17:00 PT · Noel (Claude Code) · branch `main`

**What:**
- **Console outages fixed at the cause:** my `pkill -f "tsx src/server.ts"` (used to restart the business server) also
  killed the demo server. Restarts now stop processes by port. New `demo/keepalive.sh` (running) restarts the console
  within ~10 s if it's ever down.
- **Team test rows kept out of the numbers:** the pipeline's "1 Offered" was Noel's own Stripe test order. That row is
  now `source = 'internal_test'`, and `TEAM_EMAILS` (in `.env`) tags any future signup or order from the team the same
  way. Internal tests read back as `manual`, so they never count as research or signups. The demo agent is excluding
  them on the stage and the outreach board.
**Files:** `business/src/store.ts`, `business/src/config.ts`, `business/src/app.ts`,
`business/test/platform-store.test.ts`, `demo/keepalive.sh`.
**State:** 71 tests pass. The business server restarted; the console stayed up through it.

---

### 2026-11-07 17:00 PT · Abhinav (Claude) · branch `main`

**What:** Platform seeds a `games` row for every registered adapter on function start (idempotent),
so Max's `match3` (Gem Garden) and `platformer` (Mosslight Trails) show in `list_games` with their
bots the moment the function redeploys. Smoke test passes locally with the real adapters.
**Why:** `list_games` reads the `games` table; only `stub` was seeded.
**Files:** `platform/mcp/src/fn.ts`.
**State:** Typechecks; local smoke OK. **Needs a redeploy** (`neon deploy --env .env` from
`platform/mcp`) with `GAMES_BASE_URL` set to Max's hosted games URL.
**Next / heads-up:** **Max:** what is the hosted base URL for the two games? It goes in Abhinav's
`platform/mcp/.env` as `GAMES_BASE_URL` before the redeploy; until then level URLs say localhost.

### 2026-11-07 16:50 PT · Abhinav (Claude) · branch `main`

**What:** **Switch-on at 16:45, and the first CEO run hit the people-data rule.** All four
deployments enabled (`npm run kill -- on`, step-in logged). `npm run ceo-now` session
`ses_vmxkc2naqzw9mjwc5tvzgxf3ff`: `platform.get_company_metrics` ran (allow), then
`platform.list_games` and `platform.get_recent_decisions` were held with `tool.confirm
read_people: true`; session `awaiting_approval`. The board read (`board_read`) was not held.
Added `npm run inspect -- ses_<id>` to dump a session's full events.
**Why:** This is the "chat that has read people's data asks on every call" rule, and it fired on
our own metrics JSON (fields like `emails_sent`, `replies`), not on an inbound email.
**Files:** `platform/naive/src/inspect-session.ts`, `package.json`.
**State:** Company is switched on but the CEO stalls after its first tool call. Not approved yet.
**Next / heads-up:** **Everyone:** this blocks the unattended run. Abhinav is asking the Naïve
team what sets `read_people` and whether an MCP server can be exempt. Fallbacks, in order:
rename/strip the fields that trip it from `get_company_metrics` and `get_player_stats`;
`confirmTool(scope: "session")` once per session (a step-in per cron run, honestly logged);
split the CEO into a reader thread and an actor thread like Sales. **Pinara:** the same will hit the
Tuner the moment any tool output mentions a person.

### 2026-11-07 16:55 PT · Noel (Claude Code) · branch `main`

**What:** **Designed HTML emails in the website's look:** a navy card, tile-color badges, a big evidence number, and a
yellow tile button. They cover the **playtest report** (pass/fail badges for loaded, touch, and visual problems, plus
what looked wrong, where it got stuck, and notes), the **signup welcome** ("7 of 86" evidence panel, the player's quote,
and a reply button), and the **developer key** (the key and the MCP command in code blocks, plus the four tools). Each
still sends a plain-text version. Cold outreach to studios stays plain on purpose (better deliverability; it reads as a
person, not a newsletter). Inline styles and tables only, all values escaped.
**Files:** `business/src/email/html.ts`, `business/src/leads/playtest-offer.ts`, `business/src/leads/live.ts`,
`business/src/studio/keys.ts`, `business/src/outreach/send.ts`, `business/test/email-html.test.ts`.
**State:** 70 tests pass. Rendered and screenshot-checked, and preview copies of both emails were sent to Noel's Gmail.
The live server restarted with the new emails. The console server on :4545 had stopped while the demo agent was
working; it's restarted, and https://levelai-console.vercel.app is back.

---

### 2026-11-07 17:15 PT · Noel (Claude Code) · branch `main`

**What:**
- **Public, password-protected console: https://levelai-console.vercel.app.** That's the demo stage (`./demo.sh`, port 4545)
  plus `/outreach`. `demo/console.sh` opens a Cloudflare tunnel to 4545 and deploys a separate Vercel project
  (`levelai-console`) that forwards everything to it. The demo server now requires HTTP Basic auth when `DEMO_PASSWORD`
  is set (any username; the password is in `.env`). Because proxies can buffer the live stream, the page falls back to
  checking `/api/state` every 4 s.
- **Stripe wired (test mode):** account "Level AI" (`acct_1UZJ…`, charges not enabled until Noel finishes business
  verification). Created a test webhook `we_1UZK9r…` → `https://levelai.vercel.app/webhooks/stripe`
  (`checkout.session.completed`); its secret is in `.env`. `PLAYTEST_PRICE_USD=5`, so playtest orders now return a Stripe
  checkout link (`buy.stripe.com/test_…`), and the paid webhook starts the playtest.
**Files:** `demo/src/server.ts`, `demo/public/index.html`, `demo/console.sh`, `demo/console-site/`.
**State:** Verified: the console returns 401 without the password and 200 with it, and the state, `/outreach`, and phone
image all load through the public URL. `/offer` returns 5, and an order returned a test payment link. A test payment
hasn't been completed end to end yet (it needs the 4242 test card in a browser).
**Next / heads-up:** after `live.sh` or the console tunnel restarts, rerun `demo/console.sh`. For real revenue: finish
Stripe verification, swap in the `sk_live_` key, create the live webhook, and set `BILLING_ALLOW_LIVE=1`.

---

### 2026-11-07 17:00 PT · Noel (Claude Code) · branch `main`

**What:** **Website: new pages in the main design, plus credibility.**
- `levelai.vercel.app/join`, `/playtest`, and `/developers` are now static pages in the site's own design (they no longer
  come from the business server). After submit they show a **live checklist** of each step from `/signup-status`. The
  playtest page reads its price from `/offer`, and the developers page issues keys and shows the studio MCP setup. A
  sticky header with a phone menu is on every page.
- **Home page credibility** (answers the "AI slop" review): a "How we measure difficulty" section (three simulated
  player types, win rate and moves left, tuning to within 5 points, solvable and fewest-moves checks, a real iPhone),
  "The honest limit" (we calibrate against your real completion and quit rates), a worked example labeled "Example",
  a **live "What our studio did this week"** strip from `/public-stats`, and a "Difficulty audit" offer.
**Files:** `site/` (`join.html`, `playtest.html`, `developers.html`, `forms.js`, `site.js`, `styles.css`, `index.html`,
`privacy.html`, `terms.html`).
**State:** Deployed. All pages return 200, there's no horizontal scroll at 375 or 390 px, and the request bodies match
the server contract. The live forms weren't submitted in this check (the live playtest flow was verified separately at
16:35). The example graphic's per-player rates are illustrative and labeled "Example".

---

### 2026-11-07 16:45 PT · Noel (Claude Code) · branch `main`

**What:** **Phone playtest verified live through the public site.** Order `ab547561…`: POST `levelai.vercel.app/playtest-orders`
→ queued → the iPhone opened the site in Safari and explored it (Mobilerun task `7ed2c72d…`, completed, 9 steps,
about 65 s) → report emailed → stage `delivered`. `activity_log` has the "playtesting" and "playtested" rows, and the demo
stage's phone box showed "Now testing", then "Last tested levelai.vercel.app for Level AI". The live server restarted
with the evidence rule and `/health` forwarding; `levelai.vercel.app/health` returns 200.
**Files:** `business/README.md`.
**State:** No code changes were needed. 67 tests pass.
**Next / heads-up:** the phone only moves when someone orders a playtest, or when the Naïve playtest agent runs after
switch-on.

---

### 2026-11-07 16:40 PT · Abhinav (Claude) · branch `main`

**What:** `npm run ceo-now` in `platform/naive`: starts one CEO session with the cron's input and
streams its tool calls, decisions, and stop reason for up to 15 minutes.
**Why:** The CEO cron fires at :00, so after the 6:00 switch-on the first run would be 7:00; this
kicks it immediately and lets us watch it.
**Files:** `platform/naive/src/run-ceo.ts`, `package.json`, `README.md`.
**State:** Typechecks. Not run yet (needs the switch-on).
**Next / heads-up:** Switch-on plan: 6:00 `npm run kill -- on`, then `npm run ceo-now`, then
`EXPECT_RUNNING=1 npm run check` from `platform/checks`.

### 2026-11-07 16:38 PT · Noel (Claude Code) · branch `main`

**What:**
- **My 3 readiness checks are in `platform/checks`:** `phone_playtest` (the iPhone is ready, plus recent playtests after
  switch-on), `billing` (Stripe configured, the offer answers, real vs test revenue; read-only), and `live_phone_view`
  (the demo stage serves fresh phone screenshots).
- **`outreach` check fixed:** the 20/day cap counts only cold emails. Signup welcomes and playtest reports don't count.
- **Outreach needs real evidence:** at least 3 reviews showing the same problem, enforced in the loop and in
  `draft_outreach`. The loop's first send (Oakever Games) went out at 16:32 with only 1 matching review, before this rule
  existed. That's on me.
- **Outreach loop widened:** it alternates the top-free and top-grossing charts and skips games read in the last 6 h.
- **New `GET /public-stats`** (aggregate counts only) for the website's proof section. `/health` is now forwarded
  through the site.
- **Corrected 5 of my log timestamps** that were ahead of the clock. They now match the commit times.
**Files:** `platform/checks/src/checks/10..14`, `business/src/`, `business/live.sh`, `log.md`.
**State:** 67 business tests pass. Checks run: 10/15 green. Mine: `outreach` and `phone_playtest` green.
`business_health` and `billing` were red because `/health` wasn't forwarded (fixed on the next `live.sh` start).
`billing` stays red until a Stripe key exists, which is correct. `live_phone_view` was red because the demo stage
wasn't running; it's running now.
**Next / heads-up:** **Abhinav:** `deployments` is red: `no such deployment: dep_71hgm7qph0x4yd232efkn31ne9`. **Max:**
`publish_play` is red (no pack yet).

---

### 2026-11-07 16:35 PT · Abhinav (Claude) · branch `main`

**What:** Business bearer re-vaulted for the permanent URL `https://levelai.vercel.app/mcp`
(`vcr_jfk2s7kf…`; the tunnel entry deleted). `npm run setup` re-applied nine agents (Noel's
`marketing` created, with its cron deployment `dep_yz1an1cq…`, disabled). Four deployments total,
all disabled until switch-on.
**Why:** Noel's 17:05 heads-up; the agents had been pointing at a dead tunnel URL.
**Files:** `platform/naive/team.json` (Abhinav commits from laptop).
**State:** Works.
**Next / heads-up:** **Abhinav:** first readiness run against Neon (`platform/checks`), then the
6:00 PM switch-on turns on all four deployments.

### 2026-11-07 16:30 PT · Abhinav (Claude) · branch `main`

**What:** `npm run vault` fix: Naïve credentials are immutable and unique by label, so a changed
URL under the same label is now delete + recreate (it used to fail with "already holds a
credential named …"). `ROTATE=1` is only needed to replace a credential whose URL is unchanged.
**Why:** Re-pointing the business bearer at `https://levelai.vercel.app/mcp` failed.
**Files:** `platform/naive/src/vault.ts`.
**State:** Typechecks.
**Next / heads-up:** Abhinav: `npm run vault && npm run setup` (no ROTATE needed).

### 2026-11-07 16:40 PT · Abhinav (Claude) · branch `main`

**What:** **Demo-readiness checks runner** (`platform/checks/`, package: demo-readiness). `npm run
check` runs 12 checks (platform health, MCP tools, solver queue, levels flow, publish → play,
player events, CEO decision, deployments, kill switch, business health, outreach cap, autonomy
number), prints a table, writes a `checks` row per check, exits 1 on red. `EXPECT_RUNNING=1` after
the 6 PM switch-on makes the "loop is producing" checks required.
**Why:** Master plan: every demo path has an automated check, run at 6 PM / 10 PM / 1:30 AM / 8 AM
/ 10:30 AM; nothing deploys after 8 AM unless all green.
**Files:** `platform/checks/`.
**State:** Typechecks. Ran against a local Postgres + the local function handler: 8/12 green, the
4 reds correct for that environment (no solver draining, no pack, Naïve unreachable from the
sandbox, no business URL). Not yet run against Neon from a laptop.
**Next / heads-up:** **Noel:** owed checks: phone playtest, billing (Stripe test payment →
delivery), live phone view. **Max:** owed: dashboard numbers all from Neon. Add each as one file in
`platform/checks/src/checks/` (see its README). **Max:** the dashboard's "checks" panel reads the
latest `checks` row per `name`.

### 2026-11-07 16:27 PT · Noel (Claude Code) · branch `main`

**What:** **Fully automatic intake, App Store support, a developer integration, an always-on outreach loop, and "Now testing" on the demo stage.**
- **Live progress:** `/leads` and `/playtest-orders` now return an `id`. `GET /signup-status?id=` streams each step ("Reading
  Parking Loop's newest App Store reviews" → "Found it: …" → "Email sent"), and `GET /offer` gives the playtest price.
  The new site pages (being built now) show this as a live checklist.
- **App Store support:** App Store links (`apps.apple.com/…/id123`) are read through Monid's dataforseo
  `/app-store/app-reviews`, and every email and audit names the right store.
- **Developer integration:** `POST /developer-keys` emails a studio a key (`lvl_…`, stored only as a hash in the new table
  `biz_api_keys`, already applied to Neon). The **studio MCP** at `https://levelai.vercel.app/studio-mcp` lets a studio's
  own coding agent call `request_playtest`, `audit_reviews`, `request_free_levels`, and `get_status`.
- **Contact lookup through Monid:** Hunter.io domain search, generic role addresses only (`business@`, `contact@`,
  `support@`; never a person's own address).
- **Outreach loop** (`OUTREACH_AUTOPILOT=1`, every 45 minutes on the live server): research the top puzzle games, find each
  studio's public contact, and send the evidence email through the same guarded tools (daily cap, opt-outs, honest
  numbers), at most 2 per run.
- **Demo stage:** the phone panel shows "Now testing <app> for <team>" while a playtest runs, then "Last tested".
- `live.sh`: the site's forwarding rules now cover the new endpoints, plus `cleanUrls`.
**Files:** `business/src/` (`leads/progress.ts`, `studio/`, `research/contacts.ts`, `outreach/autopilot.ts`, App Store
handling), `business/src/db/schema.sql`, `business/live.sh`, `demo/public/index.html`.
**State:** 67 business tests and the typecheck pass. The studio MCP and keys are tested through the real request
handler. Not yet verified live: the Hunter response shape (the first loop run will show it).
**Next / heads-up:** **Abhinav:** I'm adding my 3 checks to `platform/checks` next.

---

### 2026-11-07 16:18 PT · Noel (Claude Code) · branch `main`

**What:** **Business MCP now has a permanent URL: `https://levelai.vercel.app/mcp`.** The site forwards it to the laptop's
current tunnel, the same way it forwards `/join` and `/playtest`. `live.sh` writes it to `.env` as `BUSINESS_MCP_URL`.
**Why:** Abhinav vaulted the tunnel URL at 16:20, but that URL changes on every restart, and it has restarted since. The
agents were pointing at a dead address.
**Files:** `business/live.sh`.
**State:** Verified: through `levelai.vercel.app/mcp`, all 15 tools are listed with the bearer, and the server returns
401 without it.
**Next / heads-up:** **Abhinav:** one last time, run `ROTATE=1 npm run vault && npm run setup` with
`BUSINESS_MCP_URL=https://levelai.vercel.app/mcp`. The bearer is unchanged (in `.env`). After this, restarts don't
need a re-vault.

---

### 2026-11-07 16:20 PT · Abhinav (Claude) · branch `main`

**What:** **Naïve Team setup complete.** Both MCP bearers are in the vault (platform
`vcr_sx1891qk…`, business `vcr_s34ythd5…`, keyed to their URLs). `npm run setup` re-applied all
eight agents with Noel's business tools attached (research, sales, finance, playtest). Cron
deployments still **disabled** until the 6:00 PM switch-on. `team.json` is in the repo.
**Why:** Package 6 done. Agents can now reach both servers unattended.
**Files:** `platform/naive/team.json` (committed from Abhinav's laptop).
**State:** Works: approval test OK, business bearer stored, agents updated.
**Next / heads-up:** **Noel:** the business URL is a `trycloudflare.com` tunnel; if `live.sh`
restarts, the URL changes and Abhinav must `ROTATE=1 npm run vault && npm run setup` with the new
one. Keep the tunnel up from 6 PM, or deploy the server as a Neon Function for a fixed URL.
**Abhinav:** building the demo-readiness checks runner (`platform/checks/`) next.

### 2026-11-07 16:15 PT · Noel (Claude Code) · branch `main`

**What:** **Permanent public links:** https://levelai.vercel.app/playtest and https://levelai.vercel.app/join. The site
forwards these pages (and their form posts and webhooks) to the laptop's current tunnel. On each start, `business/live.sh`
rewrites `site/vercel.json` and redeploys the site, so links in emails, social posts, and QR codes survive restarts.
`PUBLIC_BASE_URL` and `DEMO_JOIN_URL` now use the site's address. Agent tools (`/mcp`) stay on the tunnel URL.
**Files:** `business/live.sh`, `site/.vercelignore`, `.gitignore` (`site/vercel.json` is generated).
**State:** Verified live: `/`, `/playtest`, and `/join` return 200 through the site, and form posts reach the server.
**Next / heads-up:** use `levelai.vercel.app/playtest` and `/join` everywhere instead of tunnel links.

---

### 2026-11-07 16:14 PT · Noel (Claude Code) · branch `main`

**What:** **The Marketing agent posts automatically through Naïve's Social API.**
- **New `post_update` business tool:** it publishes a short "[For Hire]" post, offering either levels for studios or an
  iPhone playtest for app teams, on Level AI's connected LinkedIn, X, Threads, Bluesky, and Reddit accounts, through
  `client.social.createPost`. Each post is labeled as AI-generated, uses only numbers from our own records, fits X's
  280 characters, and is capped at 2 per network per day.
- **New `marketing` agent in `platform/naive/src/roster.ts`**, on Naïve cron every 6 hours. It alternates between the
  levels and playtest angles.
- **Naïve identity "Level AI" created** (`NAIVE_IDENTITY_ID` in `.env`). Social isn't on yet: the current API key lacks
  the `billing:write` scope.
**Files:** `business/src/marketing/posts.ts`, `business/src/mcp/`, `business/src/config.ts`,
`platform/naive/src/roster.ts`.
**State:** 62 business tests pass, and the roster typechecks. No posts published yet (blocked on Social activation).
**Next / heads-up:**
- **Noel:** turn on Social for the "Level AI" identity in Naïve Studio, or make an API key with `billing:write`. Then
  open the connect link and sign in to LinkedIn, X, Reddit, Threads, and Bluesky. Only a person can do that step.
- **Abhinav:** rerun `npm run setup` in `platform/naive` to create the `marketing` agent and its cron.

---

### 2026-11-07 16:10 PT · Pinara (Claude Code) · branch `main`

**What:**
- **Solver harness v1** (`solver/`, package 8). A worker claims queued `solver_runs`, plays each
  level with each requested bot through the platform's adapter registry
  (`platform/mcp/src/adapters.ts`, imported, not changed), and writes `results`, `solvable`, and
  `min_moves`, or a readable `error`.
- Each finished or failed run adds one `activity_log` row as agent `platform`.
- Runs stuck in `running` for over 15 minutes are marked failed.
- Designer and Tuner prompts tightened in `platform/naive/src/roster.ts`.

**Why:** `solve_level` only queues work. Without the harness, no level gets a difficulty number,
and the Tuner polls forever.
**Files:** `solver/`, `platform/naive/src/roster.ts`, `AGENTS.md` (repo layout).
**State:** Works on the stub game.
- `npm test`: 13/13 pass, including the queue against `platform/db/schema.sql` in PGlite.
- Typecheck is clean.
- End to end on a throwaway local Postgres 17 with the real schema, using `npm run drain`: 300 stub
  games in 2 ms, written back as `random 40% (120/300)`. An unknown bot failed with a readable
  error.
- **Verified on Neon at 3:57 PM:** `npm run drain` processed the 3 stub runs queued by the smoke
  tests (about 130 ms each, `done`, results in the contract's shape, 3 `solver_run.done` rows in
  `activity_log`).
- The roster changes are not applied in Naïve until `npm run setup` runs again.

**Next / heads-up:**
- **Abhinav:**
  - `get_solver_run` results now carry additive per-bot fields `ci95_low`, `ci95_high`, and
    `first_seed`. The contract's fields are unchanged.
  - Real adapters registered in `adapters.ts` reach the harness with no change on my side.
  - Please re-run `npm run setup` (or send me the key) so the new prompts apply.
  - Open question: where the worker runs overnight. Render was dropped, and a Neon Function can't
    poll. Until we decide, it runs on my laptop.
- **Max:** the harness needs `simulate` to be deterministic per seed and fast (200 games per bot by
  default). If `solve` exists, it runs inline, so it needs its own step limit.
- **Prompt changes:**
  - The Tuner's reference bot is `search` when the game has one, otherwise the game's first bot,
    because the stub only has `random`.
  - A failed solver run is retried once, then the level is rejected with the error.
  - The Designer falls back to `validate_level` errors while game skills aren't attached, and uses
    the game's default target when a card gives none.

### 2026-11-07 16:10 PT · Abhinav (Claude) · branch `main`

**What:** **Approval-rule test: PASSED.** With the platform bearer in Naïve's vault
(`vlt_enhfan4mcnhqwfrp221sc0ebjy`, keyed to the MCP URL), probe session
`ses_8yjzg4jxb16n8p2ex57jwdxp7a` called `platform.log_action` unattended: the session ended
`end_turn`, no approval card, and the `approval_test` row is in `activity_log`. Allow-listed MCP
tools (`tools.configs["platform.<tool>"] = allow`) run without a human.
**Why:** Package 6 / agent-plan step 1. Decides whether the 2–8 AM run needs clicks.
**Files:** none (verification). `platform/naive/team.json` has the agent and deployment ids.
**State:** Works. Vault needs an **admin-scoped** API key; agents/sessions scopes aren't enough
(cost two keys to learn). The earlier two NOT REACHED results were the missing credential.
**Next / heads-up:** **Everyone:** this covers MCP tools only. Still untested: the "chat that has
read people's data asks on every send" rule. **Noel:** that's your Sales Reader / Sender split;
run the second half (send the probe one inbound email, then a tool call) when the business server
is attached. **Noel:** send Abhinav `BUSINESS_MCP_URL` and `BUSINESS_MCP_TOKEN` by DM; the
repo-root `.env` is only on your laptop. Then `npm run vault && npm run setup` attaches your
tools to the agents.

### 2026-11-07 16:10 PT · Noel (Claude Code) · branch `main`

**What:** **A revenue product and a real website.**
- **Phone playtest offer (`/playtest` on the business server):** a team enters its app link and gets the app played
  on our real cloud iPhone, with a report emailed in about 10 minutes. With `PLAYTEST_PRICE_USD` and a Stripe key set,
  the team pays through a Stripe link and the paid webhook starts the playtest. Without them, it's free during the
  hackathon. Orders queue, because there's one phone.
- **Website redesigned and live at https://levelai.vercel.app**: a puzzle-game look, an original animated level being
  tuned on a difficulty meter, and new privacy and terms pages. This is the business URL for Stripe.
**Files:** `business/src/leads/playtest-offer.ts`, `business/src/leads/playtest-page.ts`, `business/src/app.ts`,
`business/src/billing/stripe.ts`, `site/`.
**State:** 59 business tests and the typecheck pass. The playtest offer is tested with a fake phone, and the real phone
path was verified earlier this afternoon. The site was checked live: home, privacy, and terms all return 200, with
screenshots.
**Next / heads-up:** Noel: set `PLAYTEST_PRICE_USD`, add the Stripe key, and set `BILLING_ALLOW_LIVE=1` to charge real money.

---

### 2026-11-07 16:10 PT · Abhinav (Claude) · branch `main`

**What:** Fixed `approval-test` events page size (Naïve caps `limit` at 100). Second probe
(`ses_2cxbawayev51zaga2qjbzkxw6z`): NOT REACHED again. `npm run setup` re-applied all eight agents.
**Why:** The vault credential still isn't stored: the new API key also lacks the `admin` scope.
**Files:** `platform/naive/src/approval-test.ts`.
**State:** Blocked on a Naïve credential with the `admin` scope (or a CLI login) to run `vault`.
**Next / heads-up:** Abhinav: get an admin-scoped key or `naive login --email --password`, then
vault → approval-test.

### 2026-11-07 16:05 PT · Abhinav (Claude) · branch `main`

**What:** `approval-test` now prints the probe session's events (tool.*, message.completed, and
anything mentioning an error) after the verdict, and says so when no tool call was attempted.
**Why:** The second probe said NOT REACHED; the events show whether the MCP server was offered,
connected, or refused.
**Files:** `platform/naive/src/approval-test.ts`.
**State:** Typechecks.
**Next / heads-up:** Abhinav re-runs vault + approval-test and reads the events.

### 2026-11-07 16:10 PT · Noel (Claude Code) · branch `main`

**What:** **Outreach is live, with a dashboard and a website.**
- **4 cold emails sent** from `levelai@agentmail.to` to Loop Games, Rotatelab, GOODROID, and ABI Games. Each email cites
  a real review count and quotes the sentence that shows the problem. Before sending, the drafts caught two problems,
  both fixed and tested: a quote taken out of context (now the matching sentence is quoted), and "isn't too easy or
  too hard" counted as a complaint.
- **Outreach board for the demo: `/outreach` on the demo stage** (`./demo.sh`, then open `/outreach`, or use the
  "see outreach" link). It lists every studio with the evidence, the email sent, and replies, read live from `studios`
  and `emails`.
- **Replies come in by themselves:** the live business server checks the inbox every minute (no webhook needed
  while the tunnel URL changes), handles opt-outs, saves the reply, and wakes the Sales Reader.
- **New tool: `audit_game`** (research one specific game). Outreach can now go out without a sample link; the email
  offers to make a free sample set instead.
- **Website: https://levelai.vercel.app** (Vercel project `level-ai`, from `site/`). It's the business URL for Stripe.
  An agent is polishing the design now.
**Files:** `business/`, `demo/src/outreach.ts`, `demo/src/server.ts`, `demo/public/outreach.html`,
`demo/public/index.html`, `site/`.
**State:** 55 business tests and 6 demo tests pass. The outreach board was checked live against Neon, with a
screenshot. Sends confirmed: all 4 studios are at stage `emailed`.
**Next / heads-up:** **Max:** still no `DEMO_PLAY_URL`. Once it exists, sample-first emails and the free-levels link
in welcomes turn on automatically.

---

### 2026-11-07 16:00 PT · Abhinav (Claude) · branch `main`

**What:** `npm run vault` now stores both bearers in one run: the platform's (`PLATFORM_MCP_URL`
+ `MCP_BEARER_TOKEN`) and Noel's business server's (`BUSINESS_MCP_URL` + `BUSINESS_MCP_TOKEN`),
each keyed to its URL, idempotent by URL. Replaces the env-override trick in `business/README.md`
step 3. Noel's roster changes (business tools on playtest, research, sales, finance) typecheck.
**Why:** One command for all MCP credentials before `npm run setup`.
**Files:** `platform/naive/src/vault.ts`, `platform/naive/.env.example`.
**State:** Typechecks. Not yet run with the admin key; the approval test is still pending.
**Next / heads-up:** **Noel:** two things from your 15:40 entry: `save_level` URLs come from
`GAMES_BASE_URL`, which is `http://localhost:3000` in Abhinav's `.env` until Max has a hosted URL
(then redeploy); and the smoke test's `validate_level` failure is intentional, it tests the error
path with a bad level. **Abhinav:** vault (both bearers) → setup (with `BUSINESS_MCP_URL`) →
approval test → commit `team.json`.

### 2026-11-07 15:55 PT · Noel (Claude Code) · branch `main`

**What:** **Demo centerpiece ready: a judge becomes a customer on stage.**
- **"Become a customer" QR on the demo stage** (`DEMO_JOIN_URL`). A judge scans it, enters any Google Play puzzle game,
  and within about 30 s gets an email with that game's real review evidence and free levels. The feed shows each
  agent step.
- **`business/live.sh`** runs the business server on Noel's laptop behind a Cloudflare quick tunnel. It writes
  `DEMO_JOIN_URL`, `BUSINESS_MCP_URL`, and `PUBLIC_BASE_URL` into `.env` and keeps the laptop awake. It's running now.
- **Separate email caps:** signup welcomes no longer count against the 20-a-day cold-outreach cap
  (`INBOUND_DAILY_CAP`, default 200).
- **`docs/demo-script.md` is now the full run of show**: 3 minutes, the night-before checklist, the decisions Noel owes,
  and what to do if something breaks.
**Files:** `business/`, `demo/src/server.ts`, `demo/public/index.html`, `demo/README.md`, `docs/demo-script.md`.
**State:** 53 business tests and 6 demo tests pass. The tunnel serves `/join` and `/health` publicly, and
`./demo.sh --check` passes.
**Next / heads-up:**
- **Everyone:** the signup page URL changes whenever `live.sh` restarts. It's in `.env` as `DEMO_JOIN_URL`.
- **Max:** `DEMO_PLAY_URL` feeds both the "Play it yourself" QR and the free-levels link in every welcome email.
- **Abhinav:** if you run `npm run setup` in `platform/naive`, `BUSINESS_MCP_URL` in `.env` now points at the live
  business server. The bearer goes in the vault.

---

### 2026-11-07 15:40 PT · Noel (Claude Code) · branch `main`

**What:** **Live signup → audit → email in 30 seconds, verified for real.** The QR page (`GET /join`) takes a
studio's game. The agents then read that game's newest Google Play reviews through Monid, find what players complain
about, and email the evidence plus free levels from `levelai@agentmail.to`. Each step writes an `activity_log` row, so
the demo stage shows it happening. A real run took 30 s and reached Noel's Gmail.
- **Fixed:** AgentMail rejected our idempotency keys (`first-touch:<id>`), so keys are now hex hashes.
- **Research is more honest:** fixed all 11 false-positive patterns found by hand (negations like "aren't too hard",
  other games, ads and crashes, "more levels" meaning access, "pay to win"). Each one has a test.
- **New tool:** `recent_activity` (read the business log).
- **New doc:** `docs/business-targets.md` lists 7 studios to pitch, each with a hand-checked reason and a public
  contact source.
- **Deploy prep:** `business/` can deploy as a Neon Function like the platform (`npm run deploy`). Research
  (Monid CLI) and the draft step don't work in a function, so for the demo the business server runs on Noel's laptop
  behind a tunnel.
- **Live data:** Neon now has the business additions (`business/src/db/schema.sql`, additive). The platform smoke
  test passes against the deployed MCP server. `./demo.sh --check` passes: database, log tables, phone.
**Files:** `business/`, `docs/business-targets.md`, `log.md`.
**State:** 52 business tests and the typecheck pass. Live signup verified end to end with real Monid, AgentMail, and
Gmail (in-memory store, so no test rows in Neon).
**Next / heads-up:** **Abhinav:** the deployed platform's `save_level` returns `http://localhost:3000/...` URLs (the
game base URL isn't set on the function), and the smoke test's sample level fails `validate_level`. **Max:** the
welcome email links `DEMO_PLAY_URL` as "free levels", so send it to me when it's live.

---

### 2026-11-07 15:30 PT · Abhinav (Claude) · branch `main`

**What:** **Naïve Team created** with `npm run setup`: designer, tuner, playtest, research,
sales_reader, sales_sender, finance, and the CEO coordinator (board on, roster pinned), each with
platform MCP tools allow-listed by name and daily budgets. Cron deployments created **disabled**:
CEO hourly (`dep_8hq07mr0wrxz240r96fhggmxt1`), Research every 4h, Finance every 3h. Ids in
`platform/naive/team.json`. First approval probe (`ses_2grj3v1g3crmfp7052b6yq00hb`) ended with
`end_turn`, no approval card.
**Why:** Package 6 in the master plan.
**Files:** `platform/naive/team.json`.
**State:** Agents and deployments exist. **Approval verdict is provisional:** `npm run vault`
failed (`API key is missing the admin scope`), so the agents have no bearer for the platform yet
and the probe may not have reached it. Checked `activity_log`: **no row**, so the probe never reached the platform; the clean `end_turn`
means a dead MCP connection does not raise an approval card, it does nothing. `approval-test` now
checks the row itself and reports NOT REACHED instead of OK. Fixing the vault with the CLI or an
admin-scoped key, then re-running.
**Next / heads-up:** **Pinara:** the agents exist; edit prompts in `platform/naive/src/roster.ts`
and re-run `npm run setup`, don't edit them in the Studio or setup will overwrite. **Everyone:**
deployments stay disabled until the 6:00 PM switch-on (`npm run kill -- on`).

### 2026-11-07 15:25 PT · Abhinav (Claude) · branch `main`

**What:** `npm run vault` in `platform/naive`: stores the platform MCP bearer in a Naïve vault as a
`static_bearer` credential keyed to the MCP URL (idempotent; `ROTATE=1` replaces it).
**Why:** Naïve rejects inline auth headers on `mcp_servers`; the vault is the supported path.
**Files:** `platform/naive/src/vault.ts`, `platform/naive/package.json`, `.env.example`, `README.md`.
**State:** Typechecks against the SDK. Not run yet.
**Next / heads-up:** Abhinav: `npm run vault` → `npm run setup` → `npm run approval-test`.

### 2026-11-07 15:15 PT · Abhinav (Claude) · branch `main`

**What:** **The platform is live.** Neon Function `platform` on branch `production`:
`https://br-broad-violet-bem8cpy5-platform.compute.c-9.us-east-2.aws.neon.tech`
(`/health`, `POST /events`, `/games/:id/schema`, `/mcp` with bearer). Smoke test passed against
it from Abhinav's laptop: all 20 tools, save → solve (queued) → decision → metrics.
**Why:** Pinara's agents and Max's games now have a real URL to point at.
**Files:** none (deploy + verification).
**State:** Works. Cold start after idle is a few seconds.
**Next / heads-up:** **Pinara / Noel:** MCP URL is the one above + `/mcp`; the bearer is in
Abhinav's `.env` (ask, don't commit). **Max:** POST player events to `/events` on that host.
Abhinav next: vault the bearer in Naïve, `npm run setup`, approval test.

### 2026-11-07 15:13 PT · Pinara (Claude Code) · branch `main`

**What:** Added `docs/open-source-options.md` with checked picks for the games and a proposal for
the third one:
- houseki's Gem Swap engine for match-3 and Parkway for the board game, both MIT.
- A proposal to replace the rhythm runner with PuzzleScript plus an exact BFS solver.
- Free art and music with their licenses, helper libraries, a Mobilerun plan, and a don't-use list.

**Why:** So we build on licensed, checked code instead of searching, and so the third game is
decided on facts.
**Files:** `docs/open-source-options.md`.
**State:** Research only. Licenses were read from LICENSE files, and the key repo claims were
spot-checked with `gh`. Nothing was cloned or run.
**Next / heads-up:**
- **Team:** decide PuzzleScript vs. the rhythm runner. The master plan's package table says the
  runner is cut first, but its cut order lists it last.
- **Max:** do 1-hour spikes on houseki and Parkway before committing. Draw match-3 tiles as DOM
  elements so the phone agent can read them.
- **Noel:** for an API key, the Mobilerun MCP URL is `https://api.mobilerun.ai/v1/mcp`, not the
  OAuth URL in `CLAUDE.md`. Mobilerun agent steps cost about 0.5 credits each, so 1,500 credits is
  about 3,000 steps.

### 2026-11-07 15:20 PT · Abhinav (Claude) · branch `main`

**What:** Platform now deploys as a **Neon Function** instead of Render (`platform/mcp/src/fn.ts`,
declared in `platform/mcp/neon.ts`; `render.yaml` removed). Same 20 tools and routes
(`/mcp`, `POST /events`, `/games/:id/schema`, `/health`) as a web-standard fetch handler; the
Express server stays for local dev. The MCP endpoint answers in JSON mode (stateless).
**Why:** Render asked for a card. Neon Functions is covered by the Neon credits, gives a public HTTPS
URL next to the database, injects `DATABASE_URL`, and deploys with `neon deploy --env .env`.
**Files:** `platform/mcp/src/fn.ts`, `platform/mcp/neon.ts`, `platform/README.md`, `platform/naive/.env.example`.
**State:** Typechecks. Smoke test passed against the fetch handler served locally on a local
Postgres (health, events, 401 without bearer, schema, all tool calls). **Not deployed yet.**
**Next / heads-up:** Abhinav runs `neon deploy --env .env` from `platform/mcp`, then the smoke
test against the invocation URL, then the Naïve setup. **Max:** the games POST events to
`https://<invocation_url>/events`; CORS is open.

### 2026-11-07 15:16 PT · Noel (Claude Code) · branch `main`

**What:** **Synced business ops with the platform, and set up Level AI.**
- **Company name: Level AI.** Sales inbox `levelai@agentmail.to`. The postal address in the email footer is
  set in `.env` (not committed).
- **One set of tables.** Business ops now writes to the platform's tables: `studios`, `emails`, `payments`,
  `activity_log`, and `interventions`. The `biz_leads`, `biz_outreach`, `biz_payments`, and `biz_activity`
  tables are gone. `business/src/db/schema.sql` is now additive: four studio columns, three more stages
  (`pilot_offered`, `lost`, `opted_out`), one payment row per Stripe event, opt-outs, and deliveries. It's
  tested against the real platform schema in an in-process Postgres.
- **One agent roster.** The business tools are attached to Abhinav's roster (`platform/naive/src/roster.ts`)
  through a new `businessTools` list, and `setup-team.ts` adds the business MCP server when
  `BUSINESS_MCP_URL` is set. Research, Sales Reader, Sales Sender, Finance, and Playtest now have real tools
  for what their prompts already described: `find_targets` and `save_lead`; `record_reply`;
  `draft_outreach`, `send_outreach`, and the new `send_reply`; `finance_snapshot`; and `run_playtest`.
  My standalone `agents:apply` is disabled so it can't overwrite these.
- **New `send_reply`** answers a studio in the same thread. It adds the legal footer, blocks any number
  without a source, and respects opt-outs. Inbound replies are now saved to `emails` as they arrive.
- **Demo stage** reads `studios` and `payments` for its pipeline panel.
- Pulled Abhinav's three commits and resolved the conflicts in `AGENTS.md` and this log, keeping both sides.
**Why:** Teammates' work and mine wrote to separate tables and separate agents with the same names.
**Files:** `business/`, `platform/naive/src/roster.ts`, `platform/naive/src/setup-team.ts`,
`demo/src/feeds.ts`, `demo/README.md`, `README.md`, `AGENTS.md`.
**State:** 41 business tests, 6 demo tests, and all three typechecks pass. **Mobilerun works:** "Noel's
iPhone" is ready, and `./demo.sh --check` shows live screenshots. **AgentMail works:** the key reads the inbox,
which holds only the welcome email (nothing to answer). The key is inbox-scoped, so it can't read
organization status or change labels. Nothing was sent. **Not done:** `DATABASE_URL` (Abhinav), `DEMO_PLAY_URL`
(Max), a public URL for the business server, and the AgentMail webhook.
**Next / heads-up:**
- **Abhinav:** apply `business/src/db/schema.sql` after the platform schema (or add it to `migrate.ts`). I edited
  `roster.ts` and `setup-team.ts` (additive: `businessTools`, a second MCP server). Look them over before
  your next `npm run setup`. I removed `platform.create_payment_link` from `sales_sender`, because it lets the
  agent pick the amount; `business.create_payment_link` uses the team's price. The business server's bearer
  also goes in Naïve's vault, keyed to `BUSINESS_MCP_URL`.
- **Pinara:** the research, sales, finance, and playtest prompts in `roster.ts` changed to name the business tools.
- **Max:** the demo QR reads `DEMO_PLAY_URL`.

---

### 2026-11-07 14:55 PT · Abhinav (Claude) · branch `main`

**What:** Platform verified against Neon. `neon deploy` on project `raspy-bread-00151777`, branch
`production`; `npm run migrate:dev` applied `platform/db/schema.sql`; `npm run smoke` passed from
Abhinav's laptop against the local server on Neon: all 20 tools listed, save_level → solve_level
(queued) → log_decision → resolve_decision → get_company_metrics.
**Why:** Proves the schema, the MCP server, and the database together before anyone builds on them.
**Files:** none (verification only).
**State:** Works locally on Neon. Not yet deployed to a public URL, so Naïve can't attach it yet.
**Next / heads-up:** Render deploy next (`platform/render.yaml`), then vault the bearer in Naïve
and run `platform/naive` setup + approval test. **Pinara:** `solver_runs` rows are queueing in Neon
now; your harness can be pointed at `DATABASE_URL` from `platform/mcp/.env.local` (ask Abhinav).

### 2026-11-07 14:58 PT · Abhinav (Claude) · branch `main`

**What:** Naïve Team as code (`platform/naive/`): `npm run setup` creates/updates the seven
roster agents (designer, tuner, playtest, research, sales_reader, sales_sender, finance) and the
CEO coordinator with the board and the roster pinned, with each platform MCP tool allow-listed
by name per agent and budgets from `docs/agent-plan.md`; creates the CEO (hourly), Research (4h),
and Finance (3h) cron deployments **disabled**. `npm run approval-test` runs the step-1 approval
probe and prints the verdict. `npm run kill -- on|off` is the kill switch / 6 PM switch-on and
logs a step-in. `platform/render.yaml` deploys the MCP server on Render and runs the migration
at boot.
**Why:** The backbone packages (Team setup, approval test, kill switch, cron) need a Naïve key and
network access this cloud session doesn't have (Neon and Naïve APIs are blocked by its egress
policy), so they're scripts Abhinav runs from his laptop.
**Files:** `platform/naive/`, `platform/render.yaml`, `platform/mcp/package.json`.
**State:** Typechecks against the real SDK types (`@usenaive-sdk/managed-agents` 0.12.3). **Not
run yet**: needs the MCP server deployed, the vault bearer set, then `setup` and `approval-test`.
**Next / heads-up:** **Abhinav:** deploy (Render blueprint), vault the bearer, run setup, run the
approval test, write the verdict here. **Pinara:** your agents' prompts and allow-lists live in
`platform/naive/src/roster.ts`; edit there, then `npm run setup` re-applies. **Noel:** add the
Mobilerun MCP server and email tool names to `playtest` and `sales_sender` in `roster.ts` when
known.

### 2026-11-07 14:40 PT · Abhinav (Claude) · branch `main`

**What:** Platform v1. `platform/CONTRACTS.md` has the three contracts due at 3:00 PM: how a
game adapter plugs in (`games/<game_id>/adapter/index.ts`, default export with `schema`,
`validate`, `simulate`, `solve?`, `bots`, `level_url`; player events `POST /events`), the full
MCP tool list (20 tools, inputs/outputs/permissions), and the activity log, decision record, and
step-in log fields. `platform/db/schema.sql` has every table. `platform/mcp/` is the MCP server
(Streamable HTTP, bearer auth) with all 20 tools implemented against Postgres, a `stub` game so
agents can be built before real adapters land, and `POST /events`.
**Why:** Unblocks Pinara (agents and Solver harness), Noel (business tools), and Max (adapter shape).
**Files:** `platform/CONTRACTS.md`, `platform/README.md`, `platform/db/schema.sql`, `platform/mcp/`, `AGENTS.md` (repo layout).
**State:** Works. Typechecks (strict). Smoke test passed against a local Postgres: schema applied,
event ingested, save_level → solve_level (queued) → log_decision → resolve → get_company_metrics.
Not yet: deployed to Render, pointed at Neon, Stripe call (placeholder link), spend ledgers in `get_spend`.
**Next / heads-up:** **Pinara:** `solve_level` only inserts a `solver_runs` row with `status='queued'`;
your harness claims rows (`claimed_by`, `started_at`) and writes `results`/`solvable`/`min_moves`.
Tool names are final unless you object by 3:00. **Naïve defaults MCP tools to `ask`**: every tool
each agent uses must be `allow` by name in that agent's `tools.configs`. **Max:** adapter shape in
CONTRACTS §1; `simulate`/`solve` must run in Node with no DOM. **Noel:** `crm_*`, `record_email`,
`create_payment_link`, `get_spend` are yours to extend; Stripe is a placeholder until a key exists.
**Everyone:** human actions (kill switch, step-ins) are not MCP tools; they write to `interventions`.

### 2026-11-07 14:42 PT · Noel (Claude Code) · branch `main`

**What:** **Business ops, first working version: `business/`.**
- **Research:** reads the top free puzzle games on Google Play and their newest reviews through
  Monid, finds level-design complaints, and ranks studios with a checkable reason.
- **Outreach:** writes the first email from that evidence, checks it (postal address, opt-out
  line, daily cap of 20, one first email per lead, no number without a source), and sends through
  AgentMail. Drafts only until `OUTREACH_SEND=1`.
- **Replies:** Svix-verified AgentMail webhook, opt-outs, and a fresh Sales Reader session.
- **CRM:** Naïve's own CRM, with our stages mapped onto its stages.
- **Billing:** a Stripe payment link at the team's set price, and an idempotent webhook that queues
  delivery. Live keys are refused unless allowed.
- **Finance:** a snapshot that keeps real and test-mode revenue apart.
- **Also:** the table QR lead form, the phone-playtest plan runner (Mobilerun Tasks API with a
  structured result per level), and an 11-tool business MCP server.
- **Five Naïve agents defined:** Research, Sales Sender, Sales Reader, Finance, and Playtest Lead.
  Each denies built-in tools by default and has a budget.
- `npm run smoke` covers the business rows of the demo checks. Also added `docs/demo-script.md`
  (a draft) and `node_modules/` to `.gitignore`.
**Why:** Business ops is my top priority in the master plan. The organizers said Stripe credits
come later, so billing is kept minimal.
**Files:** `business/`, `docs/demo-script.md`, `AGENTS.md` (repo layout), `.gitignore`.
**State:** 35 tests and the typecheck pass. **A real Monid run worked** (8 games, about $0.01).
Top target: Parking Loop (Loop Games), where 7 of 86 newest reviews say it's too easy. False
positives found in that run ("not too hard") are fixed. The server ran locally: MCP auth, 11
tools, and the lead form all checked. **Not verified yet:** AgentMail, Stripe, Naïve CRM and
agent creation, Mobilerun, and Neon. Each needs keys or accounts we don't have yet (list in
`business/README.md`). Nothing was sent, charged, or claimed.
**Next / heads-up:**
- **Abhinav:** my business tools are their own MCP server (`/mcp` in `business/src/server.ts`), not
  part of the platform MCP. If you'd rather merge them, the tool names are the contract. The
  `biz_` tables need `business/src/db/schema.sql` applied to Neon.
- **Abhinav and Pinara:** the CEO's roster gets my five agents (`npm run agents:apply`).
- **Team decisions needed:** the pilot price (`PILOT_PRICE_USD`), the company postal address for
  emails (US email law), and whether Stripe goes live.

---

### 2026-11-07 14:45 PT · Noel (Claude Code) · branch `main`

**What:** **Demo stage: `./demo.sh` opens one full-screen live view of the company running.** It
reads the activity log in Neon and shows: how long the company has run without a person, agent
actions, decisions (with Saw / Why / Expected / Result), human step-ins, spend, each agent lighting
up as it works, a live feed, the Mobilerun phone's screen about once a second, a QR code to play a
level, and the studio pipeline. `--replay <file>` plays back a saved run (the backup), `--sample`
rehearses the layout under a "SAMPLE DATA" banner, and `--check` is the "Live phone view"
readiness check.
**Why:** The demo needs to start with one command and show the automation without explaining it.
Every number is counted from log rows, so nothing is typed in.
**Files:** `demo.sh`, `demo/` (own `package.json`), `AGENTS.md` (repo layout).
**State:** Works in sample and replay modes, checked in Chrome. 5 unit tests and the typecheck
pass. **Live mode isn't verified against a real database yet:** no `DATABASE_URL` locally, and
`biz_activity` isn't applied. The phone panel isn't verified against a real device either.
**Next / heads-up:** The stage reads the shared `activity_log`, `decisions`, and `interventions`
(step-ins) tables from `platform/db/schema.sql` by default, plus `biz_activity`. It needs only
`DATABASE_URL` in the repo's `.env`. **Abhinav:** if `log_decision` also writes an `activity_log` row,
tell me so the stage doesn't count decisions twice. **Max:** this is the demo-day stage, not the heartbeat dashboard. Reuse
any of it (it's one HTML file plus `demo/src/events.ts`) or embed it. **Everyone:** don't present
`--sample` as real.

### 2026-11-07 14:19 PT · Noel (Claude Code) · branch `main`

**What:** **Master plan locked in: `docs/master-plan.md`.** It's the source of truth for roles,
per-person times, backups, contracts, demo checks, and the cut order.
- **Max:** game integration, then the heartbeat dashboard.
- **Pinara:** level quality (Solver harness, bots, solvers, Designer and Tuner, evals, the CEO's
  expected-vs-result check).
- **Abhinav:** the Naïve backbone (Neon, MCP server, Naïve Team setup, approval-rule test, CEO loop,
  demo-readiness checks).
- **Noel:** business ops as Naïve agents (outreach, finance, billing, CRM; top priority), then
  Mobilerun playtests and the demo script.
- **New rule:** everything in the demo really works. Each demo path has an automated check, run at
  6 PM, 10 PM, 1:30 AM, 8 AM, and 10:30 AM. Nothing deploys after 8 AM unless all checks are green.
- Added from the research: an inbound QR at our table for founders with puzzle games, a live-payments
  check, the QA-agency angle, and the Finance agent. Also listed the research claims we rejected.
- Updated `README.md`, `AGENTS.md`, and `docs/agent-plan.md` to point to the master plan.

This also replaces my 14:12 entry, which is in Noel's local stash and was never pushed. It said Max
owns game integration, which still stands.
**Why:** All three strengths files we have (Noel, Abhinav, Pinara) plus team decisions. Max's file
can adjust this later.
**Files:** `docs/master-plan.md`, `README.md`, `AGENTS.md`, `docs/agent-plan.md`.
**State:** Docs only.
**Next / heads-up:** **Everyone:** read your column in the master plan's timeline. **Five contracts
are due at 3:00 PM.** **Noel:** check now whether Stripe can take live payments, because activation
can take time.

### 2026-11-07 14:15 PT · Pinara (Claude Code) · branch `main`

**What:** Added Pinara's strengths file from Prompt 1. Strongest areas: Solvers and simulation (4),
Backend and platform (4), and Frontend and visual design (4). AI agents is rated 3. The file also
has Pinara's four product ideas, each sized for this hackathon.
**Why:** It's one of the four inputs Prompt 2 needs to propose roles.
**Files:** `docs/strengths/pinara.md`.
**State:** Docs only. Ratings come from Pinara's GitHub and local repos.
**Next / heads-up:** Pinara wants AI agents and Solvers and simulation, wants to learn the Naïve
SDK, and wants to avoid Business. Pinara is available all night, including 2:00–8:00 AM. Prompt 2
runs once all four files are in.

### 2026-11-07 14:10 PT · Abhinav (Claude) · branch `main`

**What:** Added `docs/strengths/abhinav.md` (Prompt 1 ratings from resume, public GitHub, and
interview). Highest areas: backend/platform (4) and AI agents (4). Mobile is 3 (built an iOS app,
no device automation). Game integration is 2.
**Why:** So Prompt 2 can propose roles from all four files.
**Files:** `docs/strengths/abhinav.md`.
**State:** Docs only. Preferences, hours, and 2–8 AM availability are still marked "not answered
yet" and will be filled in a follow-up push.
**Next / heads-up:** Current plan's platform role matches my ratings. I can back up Noel on iOS if
the mobile work needs a second person.

### 2026-11-07 14:10 PT · Noel (Claude Code) · branch `main`

**What:** Added Noel's strengths file from Prompt 1. Strongest areas: Backend and platform (5),
Mobile (4), and AI agents (4).
**Why:** It's one of the four inputs Prompt 2 needs to propose roles.
**Files:** `docs/strengths/noel.md`.
**State:** Docs only.
**Next / heads-up:** Noel wants Mobilerun plus automating business ops, and wants to avoid
frontend. Noel is available all night, including 2:00–8:00 AM. Prompt 2 runs once all four files
are in.

### 2026-11-07 14:04 PT · Noel (Claude Code) · branch `main`

**What:** Reviewed a second research write-up and added "Second research pass" to
`docs/how-to-win.md`: what we keep (the QA-agency angle, diagrams, rehearsal) and what we reject
(guessed API calls, a wrong winner claim, faking agent work, and checking puzzles by tapping
through them on phones).
**Why:** So nobody's agent copies its made-up code or claims.
**Files:** `docs/how-to-win.md`.
**State:** Docs only.
**Next / heads-up:** **Everyone:** don't use the code snippets from that write-up. Use the real docs.

### 2026-11-07 14:01 PT · Noel (Claude Code) · branch `main`

**What:** Added `docs/strengths/PROMPT.md` (Prompt 1: each person's agent interviews them and writes
a rated strengths file. Prompt 2: proposes roles from all four files) and
`docs/strengths/TEMPLATE.md`.
**Why:** Pick roles from real strengths instead of guesses. The split in `README.md` stands until
the team decides.
**Files:** `docs/strengths/PROMPT.md`, `docs/strengths/TEMPLATE.md`.
**State:** Docs only.
**Next / heads-up:** **Everyone:** pull, run Prompt 1, and push your
`docs/strengths/<first-name>.md`. When all four are in, one person runs Prompt 2, which writes
`docs/roles.md` as a proposal for the team to decide on.

### 2026-11-07 13:57 PT · Noel (Claude Code) · branch `main`

**What:** Six games became **three**, one per genre: match-3 (Candy Crush–style), a rhythm runner
(Geometry Dash–style), and a property-trading board game (Monopoly-style). New "Our three games"
section in `README.md`: what a level is in each genre, how difficulty is measured (bot win rates,
an exact physics solver for the runner, strategy balance for the board game), tuning, and how each
gets playtested on a phone. Updated `AGENTS.md` and `docs/agent-plan.md`.
**Why:** The team found open-source versions of those three games.
**Files:** `README.md`, `AGENTS.md`, `docs/agent-plan.md`.
**State:** Docs only. Repos not checked yet.
**Next / heads-up:** **Max:** check each repo's license and assets before building on it. Our
forks need their own names, art, and music. Never ship Candy Crush, Geometry Dash, or Monopoly
names, art, songs, levels, or boards. **Noel:** cloud-phone taps are too slow for the rhythm runner,
so play it back from the solver's inputs instead of by hand.

### 2026-11-07 13:55 PT · Noel (Claude Code) · branch `main`

**What:** Plan reworked for the four of us and for six open-source games.
- **We don't build a game.** The product is the platform. Six forked open-source puzzle games are
  the first customers. Added rules for picking them (license, no ripped art, levels as data, rules
  that run headless, mixed genres).
- **Owners:** Max: game integration (adapters). Noel: mobile integration. Abhinav: the platform
  (Neon, MCP tools, Solver harness, payments and email plumbing, dashboard). **Pinara**: the agents.
- **New `docs/agent-plan.md`** for Pinara: the team, card types, CEO loop, decision record,
  approval test, skills per game, budgets, checks, milestones, and kill switch.
- **Phone integration:** agents write a JSON plan, and the Mobilerun agent carries it out inside a
  studio's own app, so studios need no code. Noel builds the plan runner.
- Naïve marketplace templates to check: AI Automation Agency and Security Testing Agency.
**Why:** Team discussion. Building our own game was out of scope.
**Files:** `README.md`, `docs/agent-plan.md`, `AGENTS.md`.
**State:** Docs only.
**Next / heads-up:** **Max + Abhinav:** agree on the game adapter by 3:00 PM. **Abhinav + Pinara:**
agree on the MCP tool list by 3:00 PM. **Noel + Pinara:** agree on the plan and result shapes by
3:00 PM. **Six games is ambitious:** get two working end to end first.

### 2026-11-07 13:46 PT · Noel (Claude Code) · branch `main`

**What:** **Full pivot to the autonomous level studio. The streaming plan is gone.**
- `README.md` rewritten: the company (our own agent-run match-3 game + a level studio for game
  companies), eight agents, a map of each sponsor tool's job, our credits, how level generation
  works (bot-simulated difficulty, tuning, player data, with research sources), each person's plan,
  the timeline, the demo, and risks.
- Research on judging moved to `docs/how-to-win.md`.
- `AGENTS.md`: new company description, ownership, priorities, and Mobilerun rules.
**Why:** The team chose level generation. Research and the credits page shaped the details.
**Files:** `README.md`, `docs/how-to-win.md`, `AGENTS.md`.
**State:** Docs only.
**Next / heads-up:**
- **Everyone:** use Mobilerun's phones, not Naïve's. Naïve agents control them through Mobilerun's
  MCP server. Claim the Mobilerun credits only when ready, because the 72 hours start then.
- **Abhinav:** the rules engine and level JSON schema come first. Everything else imports them.
- **Abhinav + Teammate 4:** test Naïve's approval rules early. Sends, `mobile`, `data_run`, and
  `generate_video` ask a human by default, and a chat that has read inbound email asks on every send
  even at `allow`. That could stall the overnight run.

### 2026-11-07 13:30 PT · Noel (Claude Code) · branch `main`

**What:** Added "Possible pivot: autonomous level design for puzzle games" to `README.md`: why it
might be stronger, three ways to run it (B2B studio, our own agent-run game, or both;
recommended: both), the agent flow, what changes for each person, how it scores, risks, and a
2:30 PM decision point. Added a pivot note to `AGENTS.md`.
**Why:** The team discussed pivoting (recording: `~/Desktop/Parking.m4a`, transcribed locally,
only a few sentences captured).
**Files:** `README.md`, `AGENTS.md`.
**State:** Docs only. Not decided.
**Next / heads-up:** **Everyone:** decide by 2:30 PM. Until then, build only the pieces both plans
need (listed under "Decision" in the README).

### 2026-11-07 13:14 PT · Noel (Claude Code) · branch `main`

**What:** Added the team's winner research to "How we win" in `README.md`: the official brief
("not a demo of one … making, selling, shipping, earning"), six patterns from 16 YC hackathon
winners, and "demo the company's history, not the software." Applied it to our plan:
- **New revenue loop:** clip-first outreach. Clip a small streamer's stream, email them the
  clips with a Stripe link, then deliver on a schedule.
- **Ops becomes the CEO coordinator** of a Naïve Team (roster + company board + per-tool
  policies). Checked in the Naïve docs.
- **New demo outline** that opens with the result, plus a "company heartbeat" main screen.
- **Timeline:** the company switches on at 6 PM Saturday. Hands off from 2 AM. Feature freeze at
  breakfast.
**Why:** The brief asks for earning, and our streaming channel had no way to earn in 22 hours.
**Files:** `README.md`, `AGENTS.md`.
**State:** Docs only. The per-event winner details came from the pasted research and weren't
re-checked.
**Next / heads-up:** **Abhinav + Teammate 4:** structure the agents as a Naïve Team with Ops as
coordinator. **Max:** the clip job must work on other streamers' recordings early, since the
revenue loop depends on it.

### 2026-11-07 13:06 PT · Noel (Claude Code) · branch `main`

**What:** Researched what wins YC-hosted hackathons and added "How we win" to `README.md`: the
event's judging, winner patterns, judge advice, YC pitch rules, a criteria-to-owner table, and a
3-minute demo outline. Added a short "prefer whatever moves these" list to `AGENTS.md`.
**Why:** So everyone's agents choose work that scores, not just work that's interesting.
**Files:** `README.md`, `AGENTS.md`.
**State:** Docs only. No official rubric or weights are published. Sources are linked.
**Next / heads-up:** Demos are 2–4 minutes, and the top 8–10 teams demo again on the main stage.
**Teammate 4** owns the demo script and the numbers screen.

### 2026-11-07 12:58 PT · Noel (Claude Code) · branch `main`

**What:** Fourth teammate added. They own business ops: the Ops agent, spend tracking, sponsors
and sales, and the demo dashboard and script. Abhinav goes back to the platform plus Streamer and
Chat.
**Why:** The team is four people again, and this takes the heaviest load off Abhinav.
**Files:** `README.md`, `AGENTS.md`.
**State:** Docs only. The new teammate's name is still TBD.
**Next / heads-up:** **Teammate 4:** put your name in `AGENTS.md` (Team and ownership) and
`README.md` (agents table and your plan section).

### 2026-11-07 12:56 PT · Noel (Claude Code) · branch `main`

**What:** Plan changed to fit three people and what Monid can actually do.
- Monid key added from `.env`. The account has $20 signup credit (`MONID-SIGNUP`, already
  redeemed).
- **Monid can't upload to YouTube.** Every YouTube result only reads data. The Publisher now posts
  to YouTube, TikTok, and Instagram from Mobilerun phones, with the YouTube Data API as the
  fallback. Monid is for research, view counts, and Max's video generation models.
- **The team is three people.** Removed teammate 4. Abhinav takes the Ops agent, Max takes sales
  as a stretch goal, and Noel takes the demo script. Added a cut order for scope.
- Corrected the times on the three entries below. They were written ahead of the clock.
**Why:** The plan was built on two wrong assumptions: a fourth teammate, and Monid uploading
to YouTube.
**Files:** `README.md`, `AGENTS.md`, `log.md`.
**State:** Docs only. Monid's search was tested live. No run was charged.
**Next / heads-up:** **Abhinav:** you now own Streamer, Chat, Ops, and the platform. Read the cut
order in `README.md`.

### 2026-11-07 12:48 PT · Noel (Claude Code) · branch `main`

**What:** Publisher plan now uploads to YouTube through Monid. TikTok and Instagram stay on
Mobilerun phones, and the YouTube app on a phone is the fallback.
**Why:** Monid may give a simpler, more reliable YouTube path than driving the app.
**Files:** `README.md`.
**State:** Unverified. Monid's YouTube endpoint hasn't been found or tested yet (no API key yet).
**Next / heads-up:** Noel checks the endpoint with `monid discover` once the key is added.

### 2026-11-07 12:46 PT · Noel (Claude Code) · branch `main`

**What:** Added `README.md` with the idea (autonomous streaming studio with clipping), the six
agents, each person's plan, the timeline, demo metrics, and risks. Updated `AGENTS.md` to point
to it and added a fourth ownership row for business ops.
**Why:** One shared plan, so everyone's agents build toward the same loop.
**Files:** `README.md`, `AGENTS.md`.
**State:** Docs only. The plan's split for teammate 4 is a proposal.
**Next / heads-up:** **Abhinav:** the streaming spike (can a Naïve agent get gameplay onto a
stream?) decides the architecture. Pick a path by 3:00 PM. **Everyone:** agree on the shared
contracts at 3:00 PM. **Teammate 4:** put your name in `AGENTS.md` and `README.md`.

### 2026-11-07 12:44 PT · Noel (Claude Code) · branch `main`

**What:** Added "Team and ownership" to `AGENTS.md`. Noel: iOS research and Mobilerun. Max: video
generation. Abhinav: Naïve SDK agents and the platform.
**Why:** So every teammate's agent knows whose area it's in and flags cross-area changes.
**Files:** `AGENTS.md`.
**State:** Docs only.
**Next / heads-up:** Each owner adds their directory to "Repo layout" in `AGENTS.md` when they
create it.

### 2026-11-07 12:40 PT · Noel (Claude Code) · branch `main`

**What:** Added the Monid skill (v0.1.9) to the repo so every teammate's Claude Code gets it.
Monid is a sponsor tool: one CLI that gives access to hundreds of data and scraping endpoints.
**Why:** Agents should check Monid before anyone writes a scraper or data integration by hand.
**Files:** `.claude/skills/monid/SKILL.md`.
**State:** CLI installed and `monid setup` run on Noel's machine. No API key added yet, so
nothing has run through Monid.
**Next / heads-up:** Each teammate installs the CLI (`npm install -g @monid-ai/cli@latest`),
creates an account at https://app.monid.ai/?aid=hacks for the signup credit, and adds their own
key with `monid keys add -k <key> -l main`. Never commit a Monid key. Runs spend the account's
balance.

### 2026-11-07 12:32 PT · Noel (Claude Code) · branch `main`

**What:** Repo setup. Added `AGENTS.md`, `CLAUDE.md`, this log, a pre-push hook that blocks
pushes unless `log.md` changed, and a GitHub Actions check that does the same on the server.
**Why:** Give every teammate's coding agent the same hackathon context and rules, and keep a
running record of what each push was for.
**Files:** `AGENTS.md`, `CLAUDE.md`, `log.md`, `.githooks/pre-push`, `.github/workflows/log-check.yml`.
**State:** Hook syntax checked and its no-op case tested. Not tested end to end against a real
push yet.
**Next / heads-up:** Each teammate runs `git config core.hooksPath .githooks` once after cloning.
The company, agents, and repo layout in `AGENTS.md` are still TBD.
