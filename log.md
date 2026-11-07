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
