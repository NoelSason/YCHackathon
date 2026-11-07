# Abhinav: strengths

_Written 2026-11-07, 2:10 PM PT with Claude (claude.ai)._

## Ratings

1 = never done it, 5 = shipped recently and could lead it.

Evidence comes from my resume, my public GitHub (`allot`, `vibeforge`, `AlfWorldBot`), and the
interview. I haven't used Naïve, Mobilerun, Neon, Vercel, or Render yet.

| Area | Rating | Evidence (what I built, my part, how recent) |
|---|---|---|
| Game integration | 2 | Nothing with game code. I write TypeScript and JavaScript regularly, but I've never forked a game, split rules from drawing code, or run game logic headless in Node. |
| Solvers and simulation | 3 | USACO Gold (BFS, DP, graph search). AlfWorldBot: a planning agent that acts in a text environment. culpr.it: entropy-based question selection. No physics stepping and no Monte Carlo or bot-player simulation. |
| Backend and platform | 4 | thriftO: a peer-to-peer reselling app on Postgres and AWS. VibeForge: Node/Express API with JWT auth. allot (Ramp hackathon, 2026): FastAPI backend, Twilio SMS webhook, approval routing with deterministic rules. PromptNite: a Python service. I've consumed APIs a lot but never built an MCP server, and I haven't deployed on Neon, Vercel, or Render. |
| AI agents | 4 | AlfWorldBot: tool-calling agent with 20+ prompt strategies and an eval harness. VibeForge: Claude on Bedrock with schema-checked output. allot: Claude adjudicates account matches and drafts memos inside a state machine. Agent Foundry chatbot. No Naïve SDK, no multi-agent hand-offs, no per-tool permission gating yet. |
| Mobile | 3 | thriftO is an iOS app I built (peer-to-peer reselling). Real iOS work, but app building, not device automation. Never used Mobilerun, cloud phones, or Android. |
| Frontend and visual design | 3 | React, Next.js, and Vite UIs, and the PromptNite dashboard. Functional UI, not visual design; nothing on art or rebranding. |
| Business | 2 | Sold on Whatnot. No outreach emails, Stripe integration, HubSpot, or AgentMail. |
| Demo and pitch | 3 | PromptNite internal demo that got sign-off. Led a hackathon team at Cisco in high school. Performs violin, so comfortable on a stage. No recorded demo video. |

## Preferences

- **Most want:** _not answered yet; current plan has me on the platform (MCP server, Neon, Solver harness), which matches my two highest areas_
- **Want to learn this weekend:** building an MCP server with per-tool permissions
- **Avoid:** _not answered yet_

## Time and limits

- **Hours available until 11:00 AM Sunday:** _not answered yet_
- **Awake and reachable 2:00–8:00 AM:** _not answered yet_
- **Limits:** _not answered yet_

## One-line summary

I'm best placed to own the platform: the MCP server the agents call, the Neon schema and activity
log, and the Solver harness as a Render worker. It's API-and-agent plumbing like allot and
VibeForge, and I'm a backup for Noel on anything iOS.
