# Business ops

Owner: **Noel**. Outreach, CRM, billing, finance, and phone playtests, built as tools that the
Naïve agents call. See `docs/master-plan.md` for where this fits.

## What's here

| Part | What it does | File |
|---|---|---|
| Research | Pulls the top free puzzle games on Google Play and their newest reviews through Monid, finds level-design complaints (too easy, too hard, wants more levels, repetitive), and ranks studios with a reason a person can check | `src/research/` |
| Outreach | Writes the first email from that evidence, checks it, and sends it through AgentMail. `send_reply` answers a studio's reply in the same thread, with the footer added and every number checked. | `src/outreach/compose.ts`, `guard.ts`, `send.ts` |
| Replies | Verifies AgentMail webhooks, handles opt-outs, moves the stage, and wakes the Sales Reader agent in a fresh Naïve session | `src/outreach/inbound.ts` |
| CRM | Mirrors every lead into Naïve's CRM (`client.crm`) | `src/naive.ts` |
| Billing | Stripe payment links at the team's set price, and the webhook that records a payment once and queues delivery | `src/billing/stripe.ts` |
| Finance | Revenue (real and test mode kept apart), spend by source, margin, cost per level. A source it can't read is reported as missing, never as zero. | `src/finance/snapshot.ts` |
| Lead form | The QR code at our table: a signup becomes a lead | `src/leads/intake.ts` |
| Phone playtests | Turns a plan into a Mobilerun Agent task with a structured result per level | `src/mobile/` |
| MCP server | The 12 tools the agents call, gated per agent in Naïve | `src/mcp/` |
| Agents | The business agents live in Abhinav's roster (`platform/naive/src/roster.ts`), which attaches this server's tools by name (`businessTools`). `src/agents/definitions.ts` is the earlier standalone version; `agents:apply` is disabled so it can't overwrite the roster. | `platform/naive/src/roster.ts` |
| Server | One Node HTTP server: `/mcp`, `/webhooks/stripe`, `/webhooks/agentmail`, `/leads`, `/health` | `src/server.ts` |
| Smoke checks | The business rows of the demo-readiness table | `src/smoke/business.ts` |

## Where the data goes

Business ops writes to the platform's tables (`platform/db/schema.sql`), so the dashboard,
`get_company_metrics`, and the demo stage all read one truth: leads go to `studios`, sent and received
emails to `emails`, payments to `payments`, agent actions to `activity_log`, and human step-ins to
`interventions`. `src/db/schema.sql` only adds what business ops needs on top: four studio columns,
three more stages, one payment row per Stripe event, opt-outs, and deliveries. **Apply it after the
platform schema.** It's tested against the real platform schema in an in-process Postgres
(`test/platform-store.test.ts`).

## Safety defaults

- **Emails are drafts until `OUTREACH_SEND=1`.** Every email is checked first. It needs a postal
  address and an opt-out line (US email law), respects opt-outs and a daily cap of 20, allows one
  first email per lead, and states only numbers that came from research. Sending takes a draft
  id, so an agent can't change the text after the check.
- **Live Stripe keys are refused** unless `BILLING_ALLOW_LIVE=1`. Prices come from settings, never
  from an agent. No price set means the email says "reply for details" and no link is made.
- **The Sales Sender never reads raw email.** The Sales Reader reads it in its own session and
  writes a summary. This works around Naïve's rule that a chat which read email asks a person
  before every send.
- **Agents deny built-in tools by default** and get only the business tools their job needs.

## Commands

Run from `business/`.

```bash
npm install
npm test               # 41 tests, no network
npm run typecheck
npm run research -- --max 8    # real Monid run, about $0.01
npm run webhooks       # the server (reads env)
npm run agents:plan    # prints the 5 agent configs, secrets masked
npm run agents:apply   # creates or updates them in Naïve
npm run smoke          # demo-readiness checks against BUSINESS_BASE_URL
```

## What's verified

- The tests cover the guard rules, the Svix and Stripe signature checks, idempotent payments,
  opt-outs, the stage mapping, the plan format, and a full research → lead → sample → draft → send
  → reply flow with fake network calls.
- **Real Monid run, Nov 7 at 2:37 PM:** 8 top free puzzle games read for about $0.01. The best
  target was Parking Loop (Loop Games): 7 of its 86 newest reviews say the levels are too easy.
  The same run found false positives ("not too hard"), which are now fixed and tested.
- The server started locally. `/mcp` refused requests without the token and listed all 11 tools.
  `/leads` accepted a valid signup and rejected an incomplete one.

## Not verified yet (needs keys or accounts)

- AgentMail: the key works and reads the `levelai@agentmail.to` inbox (one welcome email so far). It's
  inbox-scoped, so it can't read organization status or change labels. No email has been sent, and
  the inbound webhook isn't registered yet because it needs a public URL.
- Stripe payment links against a real test account. The Stripe CLI on this laptop is signed in to
  a different account (South Indian Society sandbox), and its key expired in July.
- Naïve CRM writes and `agents:apply`: no `NAIVE_API_KEY` in `.env` yet.
- Mobilerun: the key and device work ("Noel's iPhone", iOS, ready), and the demo stage's phone check
  passes with live screenshots. No playtest task has run yet.
- The live Neon database: `DATABASE_URL` isn't set yet. The SQL is tested against the platform schema
  in PGlite, not against Neon itself.
- Naïve rejects login tokens written into agent definitions. The business server's bearer goes in
  Naïve's vault, keyed to `BUSINESS_MCP_URL`, the same way as the platform server's.
