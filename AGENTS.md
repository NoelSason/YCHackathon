# AGENTS.md

Instructions for any coding agent (Claude Code, Codex, Cursor, and others) working in this repo.

## What this repo is

An entry for the **Naïve Autonomous Company Hackathon** at YC (560 20th St., San Francisco),
Nov 7–8, 2026. The goal is a company that agents run end to end: they find customers, deliver
the product, and handle day-to-day operations.

- **Company:** an autonomous level studio for puzzle games. Any game plugs in through an adapter.
  Agents design levels, test each one hundreds of times with bot players or exact solvers, tune
  the difficulty, playtest on real phones, and ship. We run three forked open-source games as our
  first customers (a match-3 puzzle game, a rhythm runner, and a property-trading board game) and sell
  the same service to studios. We don't build a game.
- **Decided Nov 7, ~1:45 PM:** the team dropped the earlier streaming idea completely. Don't build
  anything for streaming, chat, or clipping streams.
- **Full plan:** `README.md` has the agents, the sponsor-tool map, each person's plan, the
  timeline, and the risks. Read it before starting work.
- **Games: open source only.** Fork only open-source games whose license allows it, and keep their
  credit and license files. Our forks are "Candy Crush–style," "Geometry Dash–style," and
  "Monopoly-style" in genre only. Never use those games' names, logos, art, music, levels, boards,
  or card text, and replace any copied assets a repo ships with.
  The levels the agents make are new. Phones may play other companies' games only to study them.

## Team and ownership

| Person | Owns |
|---|---|
| **Max** | Game integration: the three forks, their own names and art, each game's adapter (schema, validate, simulate or solve, load by URL, events, `SKILL.md`), hosting, then the heartbeat dashboard |
| **Pinara** | Level quality: the Solver harness, bot players, the three solvers, the Designer and Tuner agents, evals, and the CEO's expected-vs-result check |
| **Abhinav** | The Naïve backbone: Neon, the platform MCP server, the Naïve Team setup (roster, board, skills, budgets, permissions, cron, kill switch), the CEO loop, and the demo-readiness checks |
| **Noel** | Business ops as Naïve agents (outreach, finance, billing, CRM), Mobilerun playtests, and the demo script |

**`docs/master-plan.md` is the source of truth** for roles, times, backups, contracts, and the cut
order. If another doc disagrees, the master plan wins.

Rules for agents:

- **Know who you're working for.** If it isn't clear which teammate you're helping, ask before you
  edit anything.
- **Stay in that person's area.** Changes to another person's area need your user's explicit
  go-ahead. Write them in `log.md` under "Next / heads-up" and name the owner.
- **Shared contracts:** the five contracts listed in `docs/master-plan.md` (game adapter, MCP tool
  list, activity log, playtest tool, business events). They're defined in `README.md` and `docs/agent-plan.md`
  and recorded in `log.md`. The Solver and the browser game must use the same adapter code for a
  game. Never write a second copy of a game's rules. Before you change a shared interface (agent tools, API
  routes, environment variable names, the database schema), check `log.md` for that interface
  and keep it backward compatible, or flag the break in the log.
- **Put each area in its own directory** so people don't edit the same files. List the
  directories under "Repo layout" once they exist.

## Deadlines

| When (Pacific) | What |
|---|---|
| Sat Nov 7, 1:00 PM | Hacking begins |
| **Sun Nov 8, 11:00 AM** | **Hacking stops. Judging begins. Code freeze.** |
| Sun Nov 8, 1:00 PM | Final presentations (live demo) |
| Sun Nov 8, 1:45 PM | Winners announced |

Anything that isn't working and demoable by 11:00 AM Sunday doesn't count. Prefer finishing one
loop over starting a second one.

## How judges score it

Judges focus on **how much of the company runs without a human**. At the demo, the team shows:

1. **What the agents delivered:** real output, not a plan.
2. **What decisions they made:** and why.
3. **Where a human stepped in:** honestly.

That has direct engineering consequences:

- **Log every agent decision and action** with a timestamp, the agent's name, what it did, why, and
  the result. The demo is built from this log, so treat it as a product feature, not debugging.
- **Log every human intervention separately**, with the reason. Don't hide them. A short, honest
  intervention list beats a long one that nobody admits to.
- **Run the agents on real work before the demo** so there's a track record to show, not only a
  live run that might fail on stage.
- Keep a way to replay or show past runs if the live demo breaks.

The research is in `docs/how-to-win.md`, and the demo outline is in `README.md`. When choosing
what to build next, prefer whatever moves one of these:

- **Autonomy:** fewer human step-ins, and a longer unattended run.
- **Numbers:** anything that produces a real, measured figure for the demo (levels made, solver
  win rates, target vs. measured difficulty, players, studios emailed, decisions, spend).
- **Visible output:** something a judge can see or click, over something we'd have to explain.
- **Sponsor depth:** Naïve, Mobilerun, and Monid used centrally, not as a token call.
- **Demo reliability:** removing a place the 3-minute demo could stall beats adding a feature.

- **Earning:** the brief says "making, selling, shipping, earning." We earn through studio pilot
  packs (sample levels made before outreach, then a Stripe link) and in-game hint or level packs.
  Work on either is high priority.
- **Decisions:** the CEO agent changes the plan from player data, solver results, and sales, and
  logs the reason.
- **Everything in the demo really works.** Every demo path has an automated check (see "Demo
  readiness" in `docs/master-plan.md`). Never show a mock as real, and never type in a number the
  logs didn't produce.
- **Approvals:** Naïve makes sends, phone actions, data runs, and video generation ask a human by
  default, and a chat that has read people's data asks on every send even at `allow`. Every
  approval is a step-in. Design agents so the overnight run needs none (see Risks in `README.md`).

The demo shows the company's history since we stopped touching it, not what the software could
do. Don't build anything that only shows up in a slide. Never fake or inflate a number. Keep
outreach small, personal, and honest: no spam, and no claims the agent can't back up.

## Hard requirement: the Naïve SDK

Every team must build its company with the Naïve SDK. Don't replace it with a hand-rolled agent
loop or another agent framework for the core agents.

**Read the docs before writing code. Don't guess package names, method signatures, or fields.**

- Docs index (start here): https://vetta.sh/docs/llms.txt
- Quickstart: https://vetta.sh/docs/quickstart.md
- TypeScript SDK: https://vetta.sh/docs/sdk/typescript.md
- CLI: https://vetta.sh/docs/cli/overview.md
- API overview: https://vetta.sh/docs/api/overview.md
- Web Studio (deploy and operate): https://app.usenaive.ai

Facts checked against the docs on Nov 7, 2026. Re-check them if something doesn't work.

- TypeScript SDK package: `@usenaive-sdk/managed-agents`, ESM, `createClient`.
- CLI: `@usenaive-sdk/cli` (`naive login`).
- API base URL: `https://api.vetta.sh`. Key in the `NAIVE_API_KEY` environment variable.
- Core objects: **Agent** (versioned config of model, harness, prompt, tools, skills, budget),
  **Session** (one run), **Events** (resumable activity stream), **Computer** (disposable sandbox
  with shell and optional browser), **Skills**, **Files**, **Tools**, **Teams**.
- Budgets are set on the agent (`cap_micro_usd`, `max_task_micro_usd`, `period`). Set one on every
  agent. An agent with no cap can spend the team's credits overnight.
- The Observability and Audit-log docs cover what the demo log needs. Use them before building a
  custom logger.

## Mobile automation: Mobilerun

There is a separate **Best Mobile Automation** prize, powered by Mobilerun. Use it when an agent
needs a real phone: publishing to mobile-only apps, comparing ride quotes, placing delivery
orders, testing an app.

- Docs index: https://docs.mobilerun.ai/llms.txt
- Quickstart: https://docs.mobilerun.ai/cloud/quickstart
- API reference: https://docs.mobilerun.ai/api-reference
- Cloud SDK: `@mobilerun/sdk` (npm) or `mobilerun-sdk` (PyPI). The PyPI package named
  `mobilerun` is a different, local framework. Don't mix their docs or imports.
- Key in `MOBILERUN_API_KEY` (starts with `dr_sk_`). It's a Mobilerun key, not an LLM key.
- **Agent** (Tasks API) takes a goal in plain language. **Phone** (Devices API) takes individual
  taps, swipes, and screenshots. Default to Agent. Use Phone only when you need exact control.
- Cloud phones keep their state. Reuse the same device across related tasks. Don't provision,
  reset, or release devices without asking.
- Each team has 72 hours of device minutes and six seats. iPhones are first come, first served.
- **Use Mobilerun's phones, not Naïve's.** Naïve's phones bill $0.08 per iPhone-minute against the
  $250 Naïve balance, and Mobilerun's credits cover far more phone time. Naïve agents drive
  Mobilerun phones through Mobilerun's MCP server, added to the agent as an MCP toolset.
- On a cloud iPhone, open links by tapping and typing in Safari. On Android, Chrome can be driven
  directly (Browser Automation in the Mobilerun docs), which lets a playtest read the game's state.

## Sponsor tools

Each sponsor tool has one job in the main loop. The map is under "Sponsor tools" in `README.md`.
Check it before adding another vendor. Naïve also has its own email, data, media, and social
posting. The map says which one we use for what, so don't add a second tool for the same job.

## Engineering rules

- **Scope:** this is a 22-hour build. Choose the simplest thing that works on stage. No
  abstractions for features that don't exist yet.
- **Secrets:** API keys live in `.env` (never committed) and in the host's environment settings.
  Never hard-code, print, or log a key, a stream token, or a signed media URL. Keep `.env.example`
  current, with names and no values.
- **Server-side keys:** privileged SDK calls (Naïve, Mobilerun, Stripe) run on the server. Never
  send a key to browser code.
- **Real side effects:** agents that send email, charge cards, post publicly, or place orders act
  on the real world. Use test mode (Stripe test keys, a test inbox) until the team decides to go
  live, and give each such action a kill switch.
- **Types:** prefer strict TypeScript. Avoid `any` unless there's a stated reason.
- **Verification:** run the smallest meaningful check after each change (typecheck, one test, or
  one agent run). Say what you didn't verify.
- **Git:** keep commits small and logically scoped. Don't commit `.env`, keys, or recordings that
  contain customer data.

## Dev log (required on every push)

`log.md` records what each push did and why, so anyone who pulls can see what changed. **You
can't push until it's updated.**

Before every push, add an entry at the **top** of `log.md` (below the template) and commit it with
the work. Use the template in the file. Each entry gives:

- Date and time (Pacific), the person, the agent that did the work (or "by hand"), and the branch
- **What** changed, in one to three lines
- **Why**: the goal or the problem it fixes
- **Files**: the main files or directories touched
- **State**: works, partly works, or broken, and how you checked
- **Next / heads-up**: what's left, and anything teammates must know before they pull

If a push holds several commits, write one entry that covers all of them. Be specific: "fixed
outreach agent sending duplicate emails, added dedupe on recipient" helps a teammate; "updates"
doesn't.

After a pull, read the new entries at the top of `log.md` before you start work.

**Enforcement:**

- `.githooks/pre-push` blocks a push when none of its commits change `log.md`. Turn it on once
  per clone with `git config core.hooksPath .githooks`. If it isn't on in your clone, turn it on.
- `.github/workflows/log-check.yml` runs the same check on GitHub for pushes and pull requests,
  which catches clones without the hook.
- **Never bypass the check** with `git push --no-verify`, and never edit the hook or the workflow
  to get around it. If the check is wrong, tell a human.

`log.md` is the team's build log. The company's agent activity log (the demo log described under
"How judges score it") is separate.

## Repo layout

- `platform/`: Abhinav. Neon schema, the MCP server, contracts. See `platform/README.md`.
- `games/<game_id>/`: Max. One directory per game; adapter at `games/<game_id>/adapter/`.
