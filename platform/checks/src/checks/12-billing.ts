import type { Check } from "../types.js";
// Billing path: a Stripe payment (test mode is fine) reached the webhook, was recorded once, and
// queued a delivery that was fulfilled. Reads the platform `payments` table and Noel's
// `biz_deliveries`. No money is needed: Stripe test mode + the 4242 card produce a real event.
const check: Check = {
  name: "billing", owner: "Noel", path: "Billing (Stripe test payment → delivery)",
  async run({ db, expectRunning }) {
    const hasDeliveries = (await db.query(`select to_regclass('biz_deliveries') as t`)).rows[0]?.t;
    const p = await db.query(`select
        count(*) filter (where status in ('paid','delivered')) as paid,
        count(*) filter (where mode='live' and status in ('paid','delivered')) as live,
        max(ts) filter (where status in ('paid','delivered')) as last_paid
      from payments where stripe_id is not null`);
    const x = p.rows[0] as { paid: string; live: string; last_paid: string | null };
    let delivered = "n/a", pending = 0;
    if (hasDeliveries) {
      const d = await db.query(`select count(*) filter (where status='delivered') as delivered, count(*) filter (where status='pending' and created_at < now() - interval '30 minutes') as stale from biz_deliveries`);
      delivered = String((d.rows[0] as { delivered: string }).delivered);
      pending = Number((d.rows[0] as { stale: string }).stale);
    }
    const detail = `${x.paid} Stripe payments recorded (${x.live} live), ${delivered} delivered; last paid ${x.last_paid ?? "never"}; stale pending deliveries ${pending}`;
    if (pending > 0) return { ok: false, detail: `${detail}: deliveries not being fulfilled` };
    if (!expectRunning) return { ok: true, detail: `${detail} (a test payment is required before the demo)` };
    return Number(x.paid) > 0 ? { ok: true, detail } : { ok: false, detail: `${detail}: no Stripe event has reached the webhook; run the test payment in docs/demo-inbound.md` };
  },
};
export default check;
