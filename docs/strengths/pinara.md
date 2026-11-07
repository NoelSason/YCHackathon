# Pinara: strengths

_Written 2026-11-07, 2:08 PM PT with Claude Code._

## Ratings

1 = never done it, 5 = shipped recently and could lead it.

These ratings come from my public GitHub and my local repos.

| Area | Rating | Evidence (what I built, my part, how recent) |
|---|---|---|
| Game integration | 3 | tweetchess (Oct 2026): real-time multiplayer chess in TypeScript on Cloudflare. The server checks the rules with chess.js, separately from the board UI. Paws-Order (2025–26): a pet-care mobile game in Godot. I've never forked someone else's web game or run game logic headless with bots. |
| Solvers and simulation | 4 | AegisQ (Sep 2026): a distributed quantum simulator in C++ and MPI. Monte Carlo option pricing (Feb 2026). benchmark-zoo: measured null distributions across about 19,000 strategies. No game search (BFS, DP) or bot players yet. |
| Backend and platform | 4 | PROJECT-NORTHSTAR (Sep 2026): five FastAPI services on Postgres with pgvector, set up with Terraform. mergermarket (Oct 2026): FastAPI with its own MCP server and an eval harness. Deploys on Cloudflare and AWS. Never used Neon, Vercel, or Render. |
| AI agents | 3 | dsh-conformance (Aug 2026): checks for plugins of an agent harness (tool registration, pre-step hooks, session events). The mergermarket MCP server is built for agents to call. In NORTHSTAR, LLM answers are checked against the sources they cite. Strong at evals. AI PhD research in fairness and causal AI. Never used Naïve or built multi-agent hand-offs. |
| Mobile | 3 | bestvideo (May 2026): a React Native and Expo app. Paws-Order targets iOS. No device automation and no Mobilerun. |
| Frontend and visual design | 4 | mimaar (Sep 2026): about 3,500 lines of TypeScript for a 3D LiDAR viewport with photoreal rendering. tweetchess: a mobile-first, accessible UI. The bestvideo app UI. |
| Business | 1 | Nothing found. If I've done sales emails, Stripe, HubSpot, or AgentMail, this rating should go up. |
| Demo and pitch | 2 | No demo or pitch found. I write clearly: a first-author paper under review, and careful READMEs. |

## Preferences

- **Most want:** AI agents (the Naïve Team) and Solvers and simulation (measuring and tuning difficulty)
- **Want to learn this weekend:** the Naïve SDK
- **Avoid:** Business (sales and outreach)

## Time and limits

- **Hours available until 11:00 AM Sunday:** about 21 (all of it)
- **Awake and reachable 2:00–8:00 AM:** yes
- **Limits:** none

## One-line summary

I'm best placed to own how the agents check their own work: the CEO's "did that decision work?"
step and the "Is it working?" numbers. My strongest work is careful evaluation, simulation, and
backend services, and causal AI is exactly the "expected vs. result" question the CEO has to answer.

## My ideas, sized for this hackathon

Judges score how much of the company runs without us, and we have 22 hours. So:

1. **AI LevelOps: makes, playtests, balances, and improves levels from player data.** This is
   already our plan. To make it stronger, the CEO writes down what it expects from each change,
   then checks the result against player data. That's the clearest proof that the agents make real
   decisions, and it's my research area (causal AI).
2. **AI LiveOps Engine: seasonal events, missions, and challenges.** An easy add-on. Overnight, the
   CEO runs one timed event, for example "Saturday night challenge: 10 hard levels, ends 8:00 AM",
   and reports how many people played. It's the same pipeline plus a theme and an end time.
3. **AI Game World Builder: text to playable 3D worlds.** Too big for 22 hours. The small version:
   type a theme and get a new board for the board game (names, prices, look), balanced before it
   ships.
4. **AI Roblox Creator: turns an idea into a Roblox experience.** Not this weekend, because it
   means Roblox Studio, Luau, and Roblox's rules. Keep it for the pitch: Roblox creators could be
   the next market for the same level studio.
