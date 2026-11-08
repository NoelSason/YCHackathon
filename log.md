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

### 2026-11-07 17:45 PT · Max (Codex) · branch `max-game-adapters-fruit-patch`

**What:** Connected the Designer/Tuner roster to the pinned match-3 skill and added MCP schema discovery from the registered adapter. Updated routing and tool contracts so the Designer checks adapter availability, fetches the authoritative schema, validates, then saves a draft.
**Why:** The game-making agent needs to use the same adapter rules as the browser game and solver instead of relying on copied or guessed level constraints.
**Files:** `platform/mcp/src/tools.ts`, `platform/naive/src/roster.ts`, `platform/naive/src/setup-team.ts`, `platform/CONTRACTS.md`, `games/skill-routing.json`, `docs/agent-plan.md`, `docs/skill-routing-plan.md`.
**State:** MCP typecheck passed; routing JSON parsed; `git diff --check` passed. Naïve setup was not run because its dependencies and API credentials are unavailable here.
**Next / heads-up:** Publish `games/match3/SKILL.md` as `game-match3@1` before running Naïve setup; the roster pins that version. Then run the setup with the deployed platform MCP URL and validate an end-to-end Designer session.

### 2026-11-07 16:40 PT · Abhinav (Claude) · branch `main`

**What:** `npm run ceo-now` in `platform/naive`: starts one CEO session with the cron's input and
streams its tool calls, decisions, and stop reason for up to 15 minutes.
**Why:** The CEO cron fires at :00, so after the 6:00 switch-on the first run would be 7:00; this
kicks it immediately and lets us watch it.
**Files:** `platform/naive/src/run-ceo.ts`, `package.json`, `README.md`.
**State:** Typechecks. Not run yet (needs the switch-on).
**Next / heads-up:** Switch-on plan: 6:00 `npm run kill -- on`, then `npm run ceo-now`, then
`EXPECT_RUNNING=1 npm run check` from `platform/checks`.

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

### 2026-11-07 17:25 PT · Noel (Claude Code) · branch `main`

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

### 2026-11-07 17:05 PT · Noel (Claude Code) · branch `main`

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

### 2026-11-07 16:55 PT · Noel (Claude Code) · branch `main`

**What:** **Permanent public links:** https://levelai.vercel.app/playtest and https://levelai.vercel.app/join. The site
forwards these pages (and their form posts and webhooks) to the laptop's current tunnel. On each start, `business/live.sh`
rewrites `site/vercel.json` and redeploys the site, so links in emails, social posts, and QR codes survive restarts.
`PUBLIC_BASE_URL` and `DEMO_JOIN_URL` now use the site's address. Agent tools (`/mcp`) stay on the tunnel URL.
**Files:** `business/live.sh`, `site/.vercelignore`, `.gitignore` (`site/vercel.json` is generated).
**State:** Verified live: `/`, `/playtest`, and `/join` return 200 through the site, and form posts reach the server.
**Next / heads-up:** use `levelai.vercel.app/playtest` and `/join` everywhere instead of tunnel links.

---

### 2026-11-07 16:45 PT · Noel (Claude Code) · branch `main`

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

### 2026-11-07 16:30 PT · Noel (Claude Code) · branch `main`

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
