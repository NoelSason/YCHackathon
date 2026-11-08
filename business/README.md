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
| Billing | Stripe payment links and Checkout at the team's set price, and the webhook that records a payment once and queues delivery | `src/billing/stripe.ts` |
| Level orders | The pricing page's order form: a level pack ($49, one-time) or the level subscription ($199 a month) through Checkout, then a confirmation email and a "delivery owed" line with a due date. Renewals (`invoice.paid`) and cancellations (`customer.subscription.deleted`) are recorded once. | `src/leads/orders.ts` |
| Level pack delivery | A paid pack (or each half of a subscription month, or a demo run) delivers itself: the main phone studies the customer's game, that sets a 20-level difficulty curve, the levels are built one at a time in our engine for their genre and measured by the game's bots, then saved as a published pack, emailed with play and JSON links, and level 1 is played on the phone. See "Level pack delivery" below. | `src/levels/deliver-pack.ts`, `pack-maker.ts`, `pack-worker.ts` |
| Finance | Revenue (real and test mode kept apart), spend by source, margin, cost per level. A source it can't read is reported as missing, never as zero. | `src/finance/snapshot.ts` |
| Lead form | The QR code at our table: a signup becomes a lead | `src/leads/intake.ts` |
| Phone playtests | Turns a plan into a Mobilerun Agent task with a structured result per level | `src/mobile/` |
| MCP server | The 12 tools the agents call, gated per agent in Naïve | `src/mcp/` |
| Agents | The business agents live in Abhinav's roster (`platform/naive/src/roster.ts`), which attaches this server's tools by name (`businessTools`). `src/agents/definitions.ts` is the earlier standalone version; `agents:apply` is disabled so it can't overwrite the roster. | `platform/naive/src/roster.ts` |
| Server | One fetch handler for `/mcp`, `/webhooks/stripe`, `/webhooks/agentmail`, `/leads`, and `/health`. It runs on Node (`src/server.ts`) and as a Neon Function (`src/fn.ts`). | `src/app.ts` |
| Smoke checks | The business rows of the demo-readiness table | `src/smoke/business.ts` |

## Level pack delivery

No person in the loop from payment to inbox. `afterOrderPaid` (`src/leads/orders.ts`) adds a row to
`biz_pack_deliveries` (one per pack; a subscription month is two rows, 20 levels now and 20 two weeks
later) and starts the queue. The queue runs one delivery at a time:

1. **Phone study.** Through the shared phone queue (`enqueue`, so it never collides with paid
   playtests or the playtest loop), the main phone plays the customer's game: a known App Store app
   by bundle id (`MARKET_GAMES`, e.g. Candy Crush Saga), or a web link. A short session (10 moves, 20
   agent steps, 6-minute limit). Logged as "studying <game> on the iPhone to set the difficulty curve"
   and "<game>: gets harder after ~N moves (reached level L); players get stuck at …". If the live
   session fails, the newest successful session of the same game this week (the playtest loop studies
   App Store games too) is used and named as such; with neither, the default curve. Right after the
   study the customer gets a **recap email** ("How <game> played on our iPhone"): levels reached,
   result, moves, where it got harder, where a player gets stuck, the design note, an inline phone
   screenshot (JPEG via `sips`, about 50 KB), the curve mapping, and "Next: we're building 20 levels
   calibrated to this curve; you'll get them in about N minutes."
2. **Curve.** `curveFor`, logged as "difficulty curve for <studio>'s pack: <mapping>", for example
   "Candy Crush Saga got harder after ~6 moves at level 2; players get stuck at level 3 jelly → so pack
   levels start at 85% win rate for 3 levels and ramp to 40% by level 20, with the steepest step
   around level 4." Rules: 85% held for a plateau of (moves before the ramp ÷ 2) levels, 1 to 6, then
   an ease-out ramp (biggest step first) to the difficulty's end point: easy 55%, medium 40%, hard 28%,
   5 points harder when the game got harder within 5 moves. **Default curve** when the study measured
   no ramp (or there was no study): plateau 3, the difficulty's end point, and the log and emails say
   there was no measured ramp. Study fields the phone didn't report are shown as not seen, never
   filled in. Stored on the row as `curve`.
3. **Build.** `pack-maker.ts` in a worker thread, slot by slot: the game's own generator (match-3 uses
   our practice board shapes with a fresh seed; Splash Sort and Turbo Lanes use their generators; Lot
   Escape uses `games/lotescape/src/generate.ts` notches), measured by the game's reference bot
   through its platform adapter, the knob moved by the solver's `nextEase`, accepted by the solver's
   `onTarget`. Match-3 tunes with 30-game looks and accepts on 100 games across worker threads. A
   candidate that misses after 6 rounds is replaced. Each acceptance logs "level pack for <studio>:
   level k of 20 accepted at X% (target Y%)".
4. **Save.** One statement: the levels (`published`, `created_by = 'pack-delivery'`), one `solver_runs`
   row each (replayable seeds), and the pack. Customer levels open by id but stay out of the public lists.
5. **Email** (keyed to the row, so it sends once): the play link (`/play?pack=` or
   `/games/<id>/?pack=`), the JSON link (`/api/packs/<id>`), "How we set the curve: <mapping>", and the
   curve as a table: level, target, measured, play link.
6. **Closing shot.** The main phone opens level 1 of the pack in our player and plays it ("playtested
   level 1 of <studio>'s <genre> pack"), and the customer gets a second recap: "We played level 1 of
   your pack on our iPhone: <result>", with the design note and a screenshot. This step runs from the
   in-memory phone queue, so a server restart before it starts skips it (the pack is already delivered).

Every email uses our games' public names (Gem Match, Splash Sort, Turbo Lanes, Lot Escape), labels
test orders "[Test order]", and never puts the studied game's name, art, or levels into ours.

Short of the full count within the caps (`PACK_MAX_MINUTES`, default 40; 6 candidates per slot), it
delivers what passed, says so, and logs "step-in needed". On boot, rows a restart cut off go back in
the queue; a pack already saved is only emailed, never remade. Every 10 minutes the queue picks up
deliveries that came due (subscription second halves). The maker runs from source (tsx), as
`live.sh` and `keepalive.sh` run the server; `npm run build` leaves it out.

Measured on this laptop, Nov 7: 20 Splash Sort levels in about 4 s, 20 Turbo Lanes levels in about
80 s, 20 match-3 levels in about 8 minutes (12 threads).

### The stage trigger

`POST /orders/demo-run` runs the exact same path as a paid pack, with no payment, for a team address
(it's stored as an internal test, `demo = true`):

```bash
curl -X POST "$BUSINESS_BASE_URL/orders/demo-run" -H "authorization: Bearer $BUSINESS_MCP_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"game":"Candy Crush Saga","bundleId":"com.midasplayer.apps.candycrushsaga","genre":"match3","email":"<a TEAM_EMAILS address>"}'
```

Optional fields: `url` (a web game to study instead of an app), `company`, `name`, `difficulty`
(`easy`, `medium`, `hard`). `genre` is `match3`, `watersort`, `racer`, or `lotescape` (or "sort",
"parking"…). It answers 202 at once; follow the activity log.

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
npm test               # 46 tests, no network
npm run typecheck
npm run research -- --max 8    # real Monid run, about $0.01
npm run webhooks       # the server from source (reads env)
npm run build          # compiles src/ to dist/
npm start              # the built server: node dist/server.js (reads env, PORT defaults to 8787)
npm run deploy         # deploys the Neon Function (see Deploy)
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
- Mobilerun: verified end to end on Nov 7 at 4:35 PM. A public playtest order ran on "Noel's iPhone" in about 65 s
  (task `7ed2c72d…`, 9 steps, structured results), the report was emailed, and the demo stage showed "Now testing".
- The live Neon database: `DATABASE_URL` isn't set yet. The SQL is tested against the platform schema
  in PGlite, not against Neon itself.
- Naïve rejects login tokens written into agent definitions. The business server's bearer goes in
  Naïve's vault, keyed to `BUSINESS_MCP_URL`, the same way as the platform server's.

## Deploy

The business server deploys the same way as the platform: as a Neon Function. The function is
named `business`. It runs on the platform's Neon project (`raspy-bread-00151777`) and branch
(`production`), so it gets its own URL and shares the platform's database. Nothing has been
deployed yet.

| File | Role |
|---|---|
| `neon.ts` | Declares the `business` function and the env it reads at deploy time |
| `src/fn.ts` | The function entry: `export default { fetch }` |
| `src/app.ts` | Every route as one fetch handler, shared by the function and Node |
| `src/server.ts` | The same handler on Node (`npm start`, `npm run webhooks`) |

How this differs from the platform's setup (`platform/mcp/neon.ts`):

- The platform keeps two copies of its routes (`fn.ts` and `server.ts`). Here both entries call
  `src/app.ts`, so a local `npm start` runs the same code as the function.
- There's no `@neon/functions` or `attachDatabasePool`. Business ops uses Neon's HTTP driver,
  which has no connection pool.
- `neon.ts` marks agentmail's optional `@x402/fetch` import as external. Without that, the bundle
  step fails with `Could not resolve "@x402/fetch"`.
- The env file is the repo-root `.env`, so the deploy passes `--env ../.env`.
- `/mcp` now answers in JSON mode, as the platform's function does, instead of an SSE stream.

### What works on the function

These work: `/health`, `/leads`, both webhooks, and every tool that keeps its state in Postgres:
`save_lead`, `list_leads`, `set_sample_url`, `record_reply`, `send_reply`,
`create_payment_link`, `finance_snapshot`, and `log_activity`.

These don't:

- **`find_targets` needs the `monid` CLI.** A Neon Function is a bundled JavaScript file with no
  image to install a CLI into, and the CLI keeps its key in a local config file
  (`monid keys add`). `neon.ts` leaves `MONID_API_KEY` out on purpose, so the tool answers
  "Monid isn't configured" instead of failing to start a missing program.
- **`draft_outreach` and `send_outreach` keep state in memory between calls.**
  `draft_outreach` reads the research that `find_targets` held in memory, and `send_outreach`
  reads the draft that `draft_outreach` held in memory (`src/mcp/tools.ts`). On the function,
  `find_targets` can't run, and calls may land on different instances. Drafting fails with "No
  research for this app in this session."
- **`run_playtest` might time out.** It holds the request open until the phone finishes, which
  is 17 minutes for a default plan. Neon's request time limit for functions isn't shown in its
  config, so this is untested.
- **Duplicate-reply detection is per instance.** An AgentMail retry that reaches a new instance
  can wake the Sales Reader twice. Payments still record once, because the database enforces one
  row per Stripe event.

**Recommendation, the simplest option:** run Research where the CLI already works, on Noel's
laptop. `draft_outreach` needs `find_targets`' results in the same process, so Research and the
Sales Sender should use one long-running server there:
`npm run build && node --env-file=../.env dist/server.js`, exposed through a tunnel (for example,
`cloudflared tunnel --url http://localhost:8787`). Point `BUSINESS_MCP_URL` at that tunnel's
`/mcp`. Keep the Neon Function for the parts that need a stable URL that doesn't depend on the
laptop: the AgentMail and Stripe webhooks, and the `/leads` QR form. Both write to the same
database. The durable fix is to store research results and drafts in Postgres instead of memory.
That makes every tool work on the function, and it isn't done.

### Before you deploy

1. Get access to the Neon project `raspy-bread-00151777`. Abhinav owns it.
2. Make sure `business/src/db/schema.sql` has been applied on top of the platform schema. It's
   safe to apply again (`if not exists` throughout). One way to apply it:
   `psql "$(npx -y neon@9.2.0 connection-string production)" -f src/db/schema.sql`.
3. Set the values in the repo-root `.env` (see the table below). At minimum, set
   `BUSINESS_MCP_TOKEN`; the deploy refuses to run without it. To make one, run
   `openssl rand -hex 32`.

### Deploy steps

Run these from `business/`.

1. Sign in, and link this directory to the platform's project and branch. Linking writes
   `business/.neon` and pulls `DATABASE_URL` into `business/.env.local`. Both are gitignored.

   ```bash
   npx -y neon@9.2.0 login
   npx -y neon@9.2.0 link --project-id raspy-bread-00151777 --branch production
   ```

2. Deploy. This is the one command:

   ```bash
   npm run deploy        # npx -y neon@9.2.0 deploy --env ../.env
   ```

   It bundles `src/fn.ts`, deploys it, and prints the function's `invocation_url`. Following the
   platform's naming, the URL should be
   `https://br-broad-violet-bem8cpy5-business.compute.c-9.us-east-2.aws.neon.tech`. Use the URL
   that's printed. To show it again, run `npx -y neon@9.2.0 functions get business`. The deploy
   only adds or updates `business`; it doesn't touch the platform's function.

3. Check it:

   ```bash
   curl https://<invocation_url>/health
   BUSINESS_BASE_URL=https://<invocation_url> node --env-file=../.env --import tsx src/smoke/business.ts
   ```

   The first request after the function sits idle takes a few seconds.

4. Set `PUBLIC_BASE_URL=https://<invocation_url>` in `../.env`, and run `npm run deploy` again.
   Stripe payment links use it for the page a buyer returns to.

### Follow-up steps

Redeploy (`npm run deploy`) after any change to `../.env`. The function reads its env only at
deploy time.

1. **Register the AgentMail webhook.** In the AgentMail console, add a webhook for the inbox
   `levelai@agentmail.to`. Set the URL to `https://<invocation_url>/webhooks/agentmail` and the
   event type to `message.received`. Copy its signing secret into `../.env` as
   `AGENTMAIL_WEBHOOK_SECRET`, and redeploy. The API call is
   `POST https://api.agentmail.to/v0/webhooks` with
   `{"url": ..., "event_types": ["message.received"], "inbox_ids": ["levelai@agentmail.to"]}`.
   The response holds the secret, so save it to a file instead of printing it. The current key is
   scoped to the inbox and might not be allowed to create webhooks. If it isn't, use the console.
2. **Register the Stripe webhook** when Stripe is on. In the Stripe dashboard (test mode), add an
   endpoint at `https://<invocation_url>/webhooks/stripe` for `checkout.session.completed`,
   `invoice.paid`, and `customer.subscription.deleted`. Copy
   its signing secret into `../.env` as `STRIPE_WEBHOOK_SECRET`, and redeploy.
3. **Put the business bearer in Naïve's vault, keyed to `BUSINESS_MCP_URL`.** Abhinav's
   `npm run vault` (in `platform/naive`, on the latest `main`) stores one bearer keyed to
   `PLATFORM_MCP_URL`. Values already in the environment override its `.env`, so the same script
   stores the business bearer:

   ```bash
   cd ../platform/naive
   PLATFORM_MCP_URL="https://<invocation_url>/mcp" \
   MCP_BEARER_TOKEN="$(sed -n 's/^BUSINESS_MCP_TOKEN=//p' ../../.env)" \
   npm run vault
   ```

   The token is read from the file, so it doesn't end up in your shell history. The credential is
   labelled "platform mcp bearer"; that label is cosmetic. If you follow the recommendation above,
   use the tunnel's `/mcp` URL here instead.
4. **Attach the server to the agents.** Set `BUSINESS_MCP_URL` (the same `/mcp` URL as in step 3)
   in `platform/naive/.env`, and run `npm run setup` there.
5. **Wake the Sales Reader on replies.** After setup, copy the Sales Reader's agent id from
   `platform/naive/team.json` into `../.env` as `SALES_READER_AGENT_ID`, and redeploy.

### Environment variables

The deployed function reads these. Set them in the repo-root `.env`. `neon.ts` reads them at deploy
time. A blank or missing value counts as unset, so the default applies.

| Name | Needed for | Where the value comes from |
|---|---|---|
| `DATABASE_URL` | Every database read and write | Injected by Neon. Don't set it. Locally, `neon link` writes it to `.env.local`. |
| `BUSINESS_MCP_TOKEN` | `/mcp` (required; the deploy fails without it) | You generate it (`openssl rand -hex 32`). The same value goes in Naïve's vault. |
| `PUBLIC_BASE_URL` | Stripe's return page | The function's URL, after the first deploy |
| `NAIVE_API_KEY` | The CRM, and waking the Sales Reader | Naïve dashboard (API keys) |
| `NAIVE_BASE_URL` | Optional (default `https://api.vetta.sh`) | Leave unset |
| `SALES_READER_AGENT_ID` | Waking the Sales Reader on a reply | `platform/naive/team.json` after `npm run setup` |
| `AGENTMAIL_API_KEY` | Sending email | AgentMail console (already in `.env`) |
| `AGENTMAIL_INBOX_ID` | Sending email | `levelai@agentmail.to` (already in `.env`) |
| `AGENTMAIL_WEBHOOK_SECRET` | `/webhooks/agentmail` | The signing secret from registering the webhook (follow-up step 1) |
| `STRIPE_SECRET_KEY` | Payment links | Stripe dashboard, test-mode secret key (`sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | `/webhooks/stripe` | The signing secret from the Stripe endpoint (follow-up step 2) |
| `BILLING_ALLOW_LIVE` | Optional (default `0`: live keys refused) | Team decision |
| `PILOT_PRICE_USD` | Optional (default `49`): the level pack, one-time | Team decision (approved Nov 7) |
| `SUBSCRIPTION_PRICE_USD`, `SUBSCRIPTION_LEVELS`, `SUBSCRIPTION_PLAYTESTS` | Optional (defaults `199` a month, `40`, `4`): the level subscription | Team decision (approved Nov 7) |
| `PLAYTEST_PRICE_USD` | The iPhone playtest (unset means free) | Team decision (`5`) |
| `HINT_PACK_PRICE_USD` | Hint packs (unset means "reply for details") | Team decision |
| `PILOT_LEVELS` | Optional (default `20`) | Team decision |
| `OUTREACH_SEND` | Optional (default `0`: drafts only) | Set `1` only when the team approves real sends |
| `OUTREACH_DAILY_CAP` | Optional (default `20`) | Team decision |
| `COMPANY_NAME` | Optional (default `Level AI`) | Already in `.env` |
| `COMPANY_POSTAL_ADDRESS` | Required before any email is sent (US email law) | Already in `.env` |
| `MOBILERUN_API_KEY`, `MOBILERUN_DEVICE_ID` | `run_playtest` | Mobilerun dashboard (already in `.env`) |
| `MOBILERUN_APPSTORE_DEVICE_ID` | Optional. "Level AI App Store iPhone", signed in to the App Store by a person. App Store links that Mobilerun's API can't install (404) are downloaded there by a phone agent (free apps only), and the playtest runs on that phone (`src/mobile/install.ts`) | Already in `.env` |
| `MOBILERUN_MODEL` | Optional (default `mobilerun/mobile-agent-fast`) | Leave unset |

These are deliberately not deployed: `MONID_API_KEY` (no CLI on the function), `PORT` (Node
only), and `AGENT_MODEL`, `BUSINESS_MCP_URL`, and `BUSINESS_BASE_URL` (read only by local
scripts).
