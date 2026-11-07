# Noel: strengths

_Written 2026-11-07, 2:10 PM PT with Claude Code._

## Ratings

1 = never done it, 5 = shipped recently and could lead it.

Coding agents wrote most of the code below. My part was the design, the direction, and the review.

| Area | Rating | Evidence (what I built, my part, how recent) |
|---|---|---|
| Game integration | 2 | Ikku Game (Apr 2026): a React, Phaser, and Colyseus 1v1 arena with a 20 Hz game loop on a Node server. Server tests pass, but it never got a visual check. I can't say whether its rules were separate from the drawing code. I've never forked someone else's game. |
| Solvers and simulation | 2 | Coursework only: BFS and graph search (CS 61B) and probability (Stat 134). I've built other algorithm work, a min-cost max-flow planner and a Monte Carlo parity check, but never a bot, a solver, or a simulation that plays something many times. |
| Backend and platform | 5 | Noel MCP (Oct 2026): my personal MCP server on Neon and Vercel, with OAuth 2.1, about 190 tools, and 825+ tests. Claude Code, claude.ai, and ChatGPT all use it. An event check-in app on Next.js, Neon, and Vercel, used live in Aug 2026. |
| AI agents | 4 | I've used eve, the Claude Agent SDK, and OpenAI Agents. Noel MCP has an approval queue and per-tool permission gating. Overclock (Cal Hacks, Oct 2026, solo) is a browser agent with its own eval. I've never used Naïve, and my multi-agent hand-off work is limited to Overclock and an MCP relay at Cal Hacks. |
| Mobile | 4 | Lectra, a shipped iPad app (Swift and SwiftUI). ios-agent-use (Sep 2026, public): a coding agent drives a real iOS device and reads back a screenshot plus a diff of the accessibility tree, the same loop a playtest needs. It only works on apps that have a UI test target built in. I've never used Mobilerun, cloud phones, or Android. |
| Frontend and visual design | 2 | Design lead and Figma work on Blink2Talk (Cal Hacks, Oct 2026). Otherwise I don't do frontend and don't want to. |
| Business | 3 | I've written outreach emails for my startup. Live Stripe Checkout and webhooks for event tickets (Aug 2026). I haven't used HubSpot or AgentMail, and my startup has no revenue yet. |
| Demo and pitch | 3 | Hackathon table demos at DataHacks and Cal Hacks (two projects), and pitch decks for my startup. No live stage demo or demo video I recorded myself. |

## Preferences

- **Most want:** Mobile (Mobilerun) and Business (automating business ops)
- **Want to learn this weekend:** Mobilerun
- **Avoid:** Frontend and visual design

## Time and limits

- **Hours available until 11:00 AM Sunday:** about 21 (all of it)
- **Awake and reachable 2:00–8:00 AM:** yes
- **Limits:** none

## One-line summary

I'm best placed to own mobile integration, meaning the Mobilerun playtest tools and the plan runner. I've already built the agent-drives-a-phone loop once in ios-agent-use, and I can write the MCP tools myself without waiting on the platform.
