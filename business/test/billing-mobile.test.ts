import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { MemoryStore } from "../src/store.js";
import { assertKeyMode, handleStripeWebhook } from "../src/billing/stripe.js";
import { summarize } from "../src/finance/snapshot.js";
import { intakeLead, appIdFromStoreUrl } from "../src/leads/intake.js";
import { checkCompleteness, planToTask, PlanSchema } from "../src/mobile/plan.js";
import { toCrmStage } from "../src/naive.js";
import { agentDefinitions } from "../src/agents/definitions.js";

const WEBHOOK_SECRET = "whsec_test_secret";
const stripe = new Stripe("sk_test_dummy");

function signedEvent(event: object) {
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return { payload, header };
}

const paidSession = (leadId: string) => ({
  id: "evt_test_1",
  object: "event",
  type: "checkout.session.completed",
  livemode: false,
  data: { object: { object: "checkout.session", payment_status: "paid", amount_total: 4900, currency: "usd", metadata: { lead_id: leadId, product: "pilot_pack" } } },
});

describe("billing", () => {
  it("refuses live keys unless allowed", () => {
    expect(() => assertKeyMode("sk_live_abc", false)).toThrow(/Live Stripe key refused/);
    expect(() => assertKeyMode("sk_live_abc", true)).not.toThrow();
    expect(() => assertKeyMode("sk_test_abc", false)).not.toThrow();
  });

  it("turns a paid checkout into one payment, a stage change, and a pending delivery", async () => {
    const store = new MemoryStore();
    const lead = await store.upsertLead({ company: "Ex", appId: null, contactName: null, email: "a@ex.com", source: "manual", stage: "pilot_offered", reason: null, sampleUrl: null, crmContactId: null });
    const { payload, header } = signedEvent(paidSession(lead.id));
    const first = await handleStripeWebhook({ stripe, webhookSecret: WEBHOOK_SECRET, rawBody: payload, signature: header, store });
    expect(first.kind).toBe("paid");
    expect((await store.getLead(lead.id))!.stage).toBe("pilot_paid");
    const retry = await handleStripeWebhook({ stripe, webhookSecret: WEBHOOK_SECRET, rawBody: payload, signature: header, store });
    expect(retry.kind).toBe("duplicate");
    expect(await store.listPayments()).toHaveLength(1);
  });

  it("rejects a bad signature", async () => {
    const store = new MemoryStore();
    const { payload } = signedEvent(paidSession("x"));
    await expect(handleStripeWebhook({ stripe, webhookSecret: WEBHOOK_SECRET, rawBody: payload, signature: "t=1,v1=bad", store })).rejects.toThrow();
  });
});

describe("finance", () => {
  it("separates real and test revenue and never treats a missing source as zero", () => {
    const s = summarize({
      store: [
        { id: "1", leadId: null, provider: "stripe", providerEventId: "e1", amountMinor: 4900, currency: "usd", livemode: true, product: "pilot_pack", createdAt: "" },
        { id: "2", leadId: null, provider: "stripe", providerEventId: "e2", amountMinor: 999, currency: "usd", livemode: false, product: "hint_pack", createdAt: "" },
      ],
      spend: [
        { name: "monid", spentUsd: 0.25, balanceUsd: 19.75, note: "" },
        { name: "naive", spentUsd: null, balanceUsd: null, note: "not wired" },
      ],
      acceptedLevels: 50,
    });
    expect(s.revenueUsd).toBe(49);
    expect(s.testModeRevenueUsd).toBe(9.99);
    expect(s.missing).toEqual(["naive"]);
    expect(s.totalKnownSpendUsd).toBe(0.25);
    expect(s.costPerAcceptedLevelUsd).toBe(0.005);
  });
});

describe("lead intake", () => {
  it("requires consent and creates a lead from the table form", async () => {
    const store = new MemoryStore();
    expect((await intakeLead({ name: "A", email: "a@b.co", company: "B" }, store)).ok).toBe(false);
    const ok = await intakeLead({ name: "A", email: "a@b.co", company: "B", storeUrl: "https://play.google.com/store/apps/details?id=com.b.game", consent: true }, store);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.lead.appId).toBe("com.b.game");
    expect(appIdFromStoreUrl("not a url")).toBeNull();
  });
});

describe("phone plans", () => {
  const plan = PlanSchema.parse({
    planId: "pt-1",
    app: { platform: "ios", package: "safari" },
    goal: "Check levels 1 and 2 load and play",
    steps: [{ level: 1, open: "https://games.example.com/match3?level=1" }, { level: 2, open: "https://games.example.com/match3?level=2" }],
    limits: {},
  });

  it("fills safe defaults and writes a task that forbids purchases and sign-ins", () => {
    expect(plan.limits.never).toContain("purchases");
    const task = planToTask(plan);
    expect(task).toContain("Safari");
    expect(task).toContain("Never do any of these: purchases, sign-ins");
    expect(task).toContain("1. Level 1");
  });

  it("reports levels missing from the results", () => {
    const result = { results: [{ level: "1", loaded: true, touchOk: true, won: true, movesUsed: 12, visualIssues: [], stuckReason: null, notes: "" }] };
    expect(checkCompleteness(plan, result).missing).toEqual(["2"]);
  });

  it("matches results the phone agent labels as \"Level N\"", () => {
    const row = { loaded: true, touchOk: true, won: false, movesUsed: 1, visualIssues: [], stuckReason: null, notes: "" };
    const result = { results: [{ ...row, level: "Level 1" }, { ...row, level: "level 2" }] };
    expect(checkCompleteness(plan, result).missing).toEqual([]);
  });
});

describe("Naïve integration", () => {
  it("maps our stages onto Naïve CRM stages", () => {
    expect(toCrmStage("found")).toBe("lead");
    expect(toCrmStage("replied")).toBe("talking");
    expect(toCrmStage("pilot_offered")).toBe("proposal");
    expect(toCrmStage("delivered")).toBe("won");
    expect(toCrmStage("opted_out")).toBe("lost");
  });

  it("defines five agents that deny built-ins by default and have budgets", () => {
    const defs = agentDefinitions({ model: "m", businessMcpUrl: "https://x.example.com/mcp", businessMcpToken: "t" });
    expect(defs.map((d) => d.name)).toEqual(["research", "sales-sender", "sales-reader", "finance", "playtest-lead"]);
    for (const d of defs) {
      expect(d.tools?.default_config.permission).toBe("deny");
      expect(d.budget.cap_micro_usd).toBeGreaterThan(0);
    }
    const sender = defs.find((d) => d.name === "sales-sender")!;
    expect(Object.keys(sender.tools?.configs ?? {})).not.toContain("business.record_reply");
    const reader = defs.find((d) => d.name === "sales-reader")!;
    expect(Object.keys(reader.tools?.configs ?? {})).not.toContain("business.send_outreach");
  });
});
