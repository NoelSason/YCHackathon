# Platform (Abhinav)

The Naïve backbone: Neon schema, the MCP server the agents call, and the demo-readiness checks.

- `CONTRACTS.md`: the three contracts (adapter plug-in, MCP tool list, activity/step-in log).
- `db/schema.sql`: all tables. Idempotent. Apply with `npm run migrate` in `mcp/`.
- `mcp/`: the MCP server (Streamable HTTP at `/mcp`, bearer auth), plus `POST /events` for the
  browser games and `GET /games/:id/schema`.

## Run it locally

```bash
cd platform/mcp
cp .env.example .env     # fill in DATABASE_URL, MCP_BEARER_TOKEN
npm install
npm run migrate          # applies db/schema.sql
npm run dev              # :8787
npm run smoke            # lists tools, saves a stub level, queues a solve, logs a decision
```

Deploy target: Render (web service, `npm run build && npm start`). Naïve needs a public HTTPS URL
and takes the bearer from its vault, keyed to that URL.
