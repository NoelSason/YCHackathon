import type { Check } from "../types.js";
// Billing: the business server has Stripe configured and the playtest offer answers through the site.
// Read-only: it never creates a payment link or a charge.
const check: Check = {
  name: "billing", owner: "Noel", path: "Billing",
  async run({ db, env }) {
    const base = (env.BUSINESS_MCP_URL ?? "").replace(/\/mcp\/?$/, "");
    if (!base) return { ok: false, detail: "BUSINESS_MCP_URL not set" };
    const h = await fetch(`${base}/health`, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!h?.ok) return { ok: false, detail: `${base}/health unreachable` };
    const integ = ((await h.json()) as { integrations?: Record<string, boolean> }).integrations ?? {};
    const offer = await fetch(`${base}/offer`, { signal: AbortSignal.timeout(20_000) }).then((r) => r.json() as Promise<{ playtestPriceUsd: number | null }>).catch(() => null);
    const p = await db.query(`select count(*) filter (where mode='live') as live, count(*) filter (where mode='test') as test,
                                     coalesce(sum(amount_usd) filter (where mode='live'),0) as revenue from payments where status in ('paid','delivered')`);
    const x = p.rows[0] as { live: string; test: string; revenue: string };
    const detail = `stripe ${integ.stripe ? "configured" : "NOT configured"}${integ.billingLiveAllowed ? " (live allowed)" : " (test only)"}; playtest price ${offer?.playtestPriceUsd ? `$${offer.playtestPriceUsd}` : "free"}; ${x.live} live / ${x.test} test payments, $${Number(x.revenue).toFixed(2)} real revenue`;
    return integ.stripe ? { ok: true, detail } : { ok: false, detail: `${detail}: add STRIPE_SECRET_KEY to the business server's env` };
  },
};
export default check;
