# Naïve Team setup (Abhinav)

Scripts that create and operate the company's agents on Naïve. Run them from a laptop; they need
`NAIVE_API_KEY` and the deployed MCP server URL in `.env` (copy `.env.example`).

| Command | What it does |
|---|---|
| `npm run vault` | Stores the MCP bearer in Naïve's vault keyed to `PLATFORM_MCP_URL` (run once, before setup). |
| `npm run setup` | Creates or updates the seven roster agents and the CEO coordinator (board on, roster pinned), and creates the cron deployments **disabled**. Idempotent. Writes `team.json`. |
| `npm run approval-test` | The test from `docs/agent-plan.md` step 1: runs a probe agent that calls two allow-listed platform tools and prints whether the session paused for approval. |
| `npm run approver` | **Policy auto-approver (team decision B, Nov 7 7:22 PM).** Naïve pauses every MCP call after the first in a chat (`read_people`), for any MCP server. This loop approves held calls **only** on our own servers (`platform.*`, `platformcrm.*`, `business.*`), only for agents in `team.json`, with scope "session", and writes every approval to `activity_log` as `platform.auto_approve`. Run it on a laptop that stays awake. It is disclosed on stage. |
| `npm run kill -- off <reason>` | Kill switch: pauses every deployment and blocks publishing. Logs a step-in. |
| `npm run ceo-now` | Starts one CEO run now and prints its tool calls and decisions as they happen. |
| `npm run kill -- on <reason>` | Switch-on (6:00 PM): enables the deployments and publishing. Logs a step-in. |

The roster, prompts, allow-listed tools, budgets, and cron schedules are in `src/roster.ts`.

**Before `setup`:** the MCP server must be deployed (`platform/README.md`) and `npm run vault` run once.
token stored in Naïve's vault as a `static_bearer` credential keyed to the server URL. Naïve
rejects inline `Authorization` headers on `mcp_servers`, so the script sets none.

**Known gap:** the phone tools (Noel's Mobilerun MCP) and the email tool are not attached yet; add
them to the Playtest Lead and Sales agents in `roster.ts` once their names are known, allow-listed
by name like the platform tools.
