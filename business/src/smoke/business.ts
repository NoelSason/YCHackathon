/**
 * Demo-readiness checks for business ops (docs/master-plan.md, "Demo readiness").
 *   BUSINESS_BASE_URL=https://... BUSINESS_MCP_TOKEN=... npm run smoke
 * Exits non-zero if any check fails. Safe to run against the live server: the test lead uses an
 * example.com address, and the Stripe check sends a signed test-mode event only when
 * STRIPE_WEBHOOK_SECRET is set locally.
 */
import Stripe from "stripe";

const base = process.env.BUSINESS_BASE_URL ?? "http://localhost:8787";
const token = process.env.BUSINESS_MCP_TOKEN ?? "";
const EXPECTED_TOOLS = [
  "find_targets", "save_lead", "list_leads", "set_sample_url", "draft_outreach", "send_outreach",
  "record_reply", "send_reply", "create_payment_link", "finance_snapshot", "run_playtest", "recent_activity", "log_activity",
];

type Check = { name: string; run: () => Promise<string> };
const checks: Check[] = [
  {
    name: "server is up",
    run: async () => {
      const res = await fetch(`${base}/health`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { integrations: Record<string, boolean> };
      const off = Object.entries(body.integrations).filter(([, v]) => !v).map(([k]) => k);
      return off.length ? `up; not configured: ${off.join(", ")}` : "up; everything configured";
    },
  },
  {
    name: "MCP tools are offered to agents",
    run: async () => {
      const res = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      const text = await res.text();
      const missing = EXPECTED_TOOLS.filter((t) => !text.includes(`"name":"${t}"`));
      if (missing.length) throw new Error(`missing tools: ${missing.join(", ")}`);
      return `${EXPECTED_TOOLS.length} tools`;
    },
  },
  {
    name: "table QR lead form accepts a signup",
    run: async () => {
      const res = await fetch(`${base}/leads`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Smoke Test", email: "smoke-test@example.com", company: "Smoke Test Co", consent: true }),
      });
      if (res.status !== 201) throw new Error(`HTTP ${res.status}`);
      return "201 created";
    },
  },
  {
    name: "a test-mode payment reaches billing",
    run: async () => {
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret) return "skipped (STRIPE_WEBHOOK_SECRET not set locally)";
      const payload = JSON.stringify({
        id: `evt_smoke_${Date.now()}`, object: "event", type: "checkout.session.completed", livemode: false,
        data: { object: { object: "checkout.session", payment_status: "paid", amount_total: 100, currency: "usd", metadata: { lead_id: "", product: "other" } } },
      });
      const header = new Stripe("sk_test_unused").webhooks.generateTestHeaderString({ payload, secret });
      const res = await fetch(`${base}/webhooks/stripe`, { method: "POST", headers: { "stripe-signature": header, "content-type": "application/json" }, body: payload });
      const body = (await res.json()) as { outcome?: string };
      if (!res.ok || body.outcome !== "paid") throw new Error(`HTTP ${res.status} ${JSON.stringify(body)}`);
      return "recorded and queued for delivery";
    },
  },
];

let failed = 0;
for (const c of checks) {
  try {
    console.log(`PASS  ${c.name}: ${await c.run()}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${c.name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
process.exit(failed ? 1 : 0);
