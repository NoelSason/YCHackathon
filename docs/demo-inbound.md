# Demo scenario: a studio reaches out, pays, and gets levels

Companion to `docs/demo-script.md` (Noel's run of show). This is the **customer-side story**,
told end to end, with the Stripe sandbox so the payment is real to the system and costs nobody
anything. Written Nov 7, 6:45 PM by Abhinav. Every step below maps to something that already
exists in the repo; nothing here is a mock.

## The story (90 seconds, can replace 1:50–2:45 in the run of show)

**Cast:** a judge playing "Dana from Pixel Pond Games," a small studio with a match-3 game whose
players say the mid-game is too hard. The presenter narrates; the agents do the work.

| # | What Dana does | What the company does, on its own | Where the judge sees it |
|---|---|---|---|
| 1 | Scans the QR, enters her game's Play Store link, puts the phone down. | Research reads the newest reviews through Monid, finds the difficulty complaints, writes the audit email, and sends it from `levelai@agentmail.to` with a link to free sample levels. Each step is an `activity_log` row. | The stage feed lights up step by step; Dana's phone buzzes within ~30 s. |
| 2 | Opens the email, taps the sample levels, plays one. | The level was designed by the Designer, measured by the Solver, accepted by the Tuner, and playtested on a Mobilerun iPhone before it went live. | The phone panel on stage; `player_events` rows land as she plays. |
| 3 | Replies: "Yes, we want the pilot." | AgentMail's webhook wakes the **Sales Reader**, which summarizes the reply (intent: interested) and moves the lead to `pilot_offered`. A fresh **Sales Sender** chat answers with the pilot terms and a **Stripe payment link** (`business.send_reply` with `includePaymentLink`). | Pipeline panel: `replied → pilot_offered`. |
| 4 | Pays. **Test mode: no money moves.** | Stripe sends `checkout.session.completed` to `/webhooks/stripe`. The business server records the payment once, moves the lead to `pilot_paid`, queues a delivery, and logs `payment received (test mode)`. | Pipeline panel: `pilot_paid`; the activity feed shows the billing row with "(test mode)". |
| 5 | Nothing. | The delivery step sends the pack and a receipt; stage → `delivered`. | Pipeline: `delivered`. |

**What to say at step 4:** "That's Stripe's sandbox. The system can't tell the difference: the
webhook fired, the lead moved, the delivery was queued. We don't take real money until the team
flips `BILLING_ALLOW_LIVE`, and we'd say so."

## The Stripe sandbox: paying without paying

Stripe **test mode** is a complete, separate Stripe environment. Keys that start with `sk_test_`
can only create test objects, and test cards never charge anything. The business server already
runs in it: `business/src/billing/stripe.ts` refuses a live key unless `BILLING_ALLOW_LIVE=1`.

### One-time setup (Noel's laptop, where the business server runs)

1. `.env` has `STRIPE_SECRET_KEY=sk_test_…` (present), `STRIPE_WEBHOOK_SECRET=whsec_…` (present),
   `PLAYTEST_PRICE_USD=5` (present). For the pilot link in step 3, also set
   `PILOT_PRICE_USD=` to the team's number (unset means the email says "reply for details" and no
   link is made).
2. The webhook endpoint in the Stripe dashboard (test mode) must point at the **public** URL of the
   business server: `https://levelai.vercel.app/webhooks/stripe`, event `checkout.session.completed`.
   Its signing secret is the `whsec_` in `.env`. If the endpoint was registered against an older
   tunnel URL, re-create it and update the secret.
3. Restart the business server after any `.env` change.

### Rehearsal (do this before 10:30 AM, and once tonight)

**Path A, the real flow (what the demo shows):**
1. Create a test lead through the QR page (or `POST /leads`), reply "interested" from the test
   inbox, or call `business.send_reply` with `includePaymentLink: true` for that lead.
2. Open the payment link. Pay with Stripe's test card:
   - Number `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP.
   - To rehearse a failure: `4000 0000 0000 0002` (declined). The system should do nothing.
3. Within a few seconds: `payments` has a row with `mode = 'test'`, `studios.stage = 'pilot_paid'`,
   `biz_deliveries` has a pending row, and `activity_log` has `payment received: pilot_pack … (test mode)`.
4. Confirm with the readiness check: `cd platform/checks && npm run check -- --only=billing`.

**Path B, no browser, from the Stripe CLI (fastest, for a quick re-test):**
```bash
# the CLI on Noel's laptop is already signed in to the test account (business/README.md)
stripe listen --forward-to https://levelai.vercel.app/webhooks/stripe   # prints a whsec_; use that one
stripe trigger checkout.session.completed
```
This fires a synthetic event. Note: the triggered session carries no `lead_id` metadata, so the
payment is recorded with "no lead attached" and no stage moves; it proves the webhook, the
signature check, and the idempotent insert, not the pipeline. Use Path A for the real rehearsal.

### What the judge can verify

- The payment row says `test` and the feed says "(test mode)". We never present it as revenue.
- Stripe's dashboard (test mode) shows the same session, which the presenter can open.
- Flipping to live is a team decision: `BILLING_ALLOW_LIVE=1` plus a live key. The code path is
  identical.

## If something breaks

| Break | Do |
|---|---|
| Payment link page says "something went wrong" | The link was created with a key the dashboard endpoint doesn't know; re-create the webhook endpoint for the current public URL and restart. |
| Paid, but no stage change | The webhook didn't reach the server: check Stripe dashboard → Webhooks → recent deliveries for the HTTP status; 503 means `STRIPE_WEBHOOK_SECRET` unset, 400 means the signature secret is stale. |
| No email in step 1 | Say so and show the activity row that explains why (AgentMail limit, no Play link). Never fake the send. |
| Reply never wakes the Reader | `SALES_READER_AGENT_ID` unset in Noel's `.env`, or the AgentMail webhook isn't registered. The presenter can read the reply aloud and run `business.record_reply` by hand, and it is logged as a step-in. |
