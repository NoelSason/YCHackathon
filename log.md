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

### 2026-11-07 16:30 PT · Max (Codex) · branch `max-game-adapters-fruit-patch`

**What:** Added the match-3 and platformer adapter prototypes, a local Fruit Patch client using the shared Gem Swap engine, three mask-shaped match-3 layouts with clearable crate blockers, and saved-level read routes. Updated game routing and integration docs.
**Why:** Deliver playable, measurable game integration work for the studio demo while keeping all game art and level designs original.
**Files:** `games/match3/`, `games/platformer/adapter/`, `games/editors/geometry-dash/`, `games/skill-routing.json`, `platform/mcp/`, shared game docs and contracts.
**State:** Works locally. `npm run typecheck` passed; all three layouts loaded through the engine; match-3 bots validated the level settings; `git diff --check` passed. Demo server is local only and is not hosted.
**Next / heads-up:** Max: deploy the browser client and connect it to saved-level URLs/player events before claiming hosted end-to-end playtests. Abhinav: review the additive public `GET /levels/:id` route and adapter registry wiring. Platformer remains a grid-step prototype; Geometry Dash remains an editor workflow, not a product adapter.

### 2026-11-07 15:44 PT · Max (Codex) · branch `main`

**What:** Added registered match-3 and platformer adapter prototypes, integrated Houseki's MIT headless Gem Swap engine, added a public read endpoint for saved-level URLs, and updated the Geometry Dash Mobilerun editor workflow documentation. Updated routing and plan docs to replace the board game with a platformer adapter.
**Why:** Implement the requested Candy Crush-style, Mario-style, and Geometry Dash workflows without using proprietary game content.
**Files:** `games/match3/adapter/`, `games/platformer/adapter/`, `games/skill-routing.json`, `platform/mcp/src/adapters.ts`, `platform/mcp/src/server.ts`, contracts and game docs.
**State:** Partly works. Platform typecheck and build passed after installing locked dev dependencies; `git diff --check` passed. Routing JSON parsed with Node. Python route-interpreter check could not run because `python.exe` is unavailable. No browser clients or Mobilerun tools/device were available. Platformer rules are a grid-step prototype, not a forked game's rules.
**Next / heads-up:** Abhinav: `/levels/:level_id` is an additive public read route for random UUID level IDs. Max: Systematic was reviewed but not integrated because its DOM-driven physics and editor-specific multilayer levels do not share the adapter rules. Houseki's headless engine is integrated, but its demo UI/campaigns are excluded; connect a browser client using the same engine before claiming a playable fork. Noel: Mobilerun agent/tools are not attached in this session, so no phone task was run.

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
