# Naïve Team setup (Abhinav)

Scripts that create and operate the company's agents on Naïve. Run them from a laptop; they need
`NAIVE_API_KEY` and the deployed MCP server URL in `.env` (copy `.env.example`).

| Command | What it does |
|---|---|
| `npm run setup` | Creates or updates the seven roster agents and the CEO coordinator (board on, roster pinned), and creates the cron deployments **disabled**. Idempotent. Writes `team.json`. |
| `npm run approval-test` | The test from `docs/agent-plan.md` step 1: runs a probe agent that calls two allow-listed platform tools and prints whether the session paused for approval. |
| `npm run kill -- off <reason>` | Kill switch: pauses every deployment and blocks publishing. Logs a step-in. |
| `npm run kill -- on <reason>` | Switch-on (6:00 PM): enables the deployments and publishing. Logs a step-in. |

The roster, prompts, allow-listed tools, budgets, and cron schedules are in `src/roster.ts`.

**Before `setup`:** the MCP server must be deployed (see `platform/render.yaml`) and its bearer
token stored in Naïve's vault as a `static_bearer` credential keyed to the server URL. Naïve
rejects inline `Authorization` headers on `mcp_servers`, so the script sets none.

**Known gap:** the phone tools (Noel's Mobilerun MCP) and the email tool are not attached yet; add
them to the Playtest Lead and Sales agents in `roster.ts` once their names are known, allow-listed
by name like the platform tools.
