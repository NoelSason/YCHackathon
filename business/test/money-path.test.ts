import { beforeEach, describe, expect, it } from "vitest";
import Stripe from "stripe";
import type Mobilerun from "@mobilerun/sdk";
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store.js";
import { createHandler } from "../src/app.js";
import { createPlaytestOrder, enqueue, runPlaytestOrder } from "../src/leads/playtest-offer.js";
import type { ToolContext } from "../src/mcp/tools.js";

// The paid playtest path: order → test payment webhook → payment row → phone playtest → email.
// No network: the Stripe event is signed locally, and the phone and mail are fakes.
const SECRET = "whsec_test_secret";
const stripe = new Stripe("sk_test_dummy");

function fakePhone(result: unknown): Mobilerun {
  return {
    tasks: {
      run: async () => ({ id: "task_1", status: "created" }),
      getStatus: async () => ({ status: "completed", succeeded: true, message: "done", output: result, steps: 9 }),
    },
  } as unknown as Mobilerun;
}
const REPORT = { results: [{ level: "app", loaded: true, touchOk: true, won: null, movesUsed: null, visualIssues: [], stuckReason: null, notes: "Menus load." }] };

function setup(phone: Mobilerun | null = fakePhone(REPORT)) {
  const sent: Array<{ to: string; subject: string; text: string; idempotencyKey: string }> = [];
  const store = new MemoryStore();
  const ctx: ToolContext = {
    config: loadConfig({
      COMPANY_POSTAL_ADDRESS: "1752 Shattuck Avenue, Berkeley, CA 94704", MOBILERUN_DEVICE_ID: "dev_1",
      PLAYTEST_PRICE_USD: "5", STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_SECRET_KEY: "sk_test_dummy",
    }),
    store, monid: null, stripe, naive: null, mobilerun: phone,
    mail: { async send(a) { sent.push(a); return { messageId: `m${sent.length}` }; }, async reply() { return { messageId: "r" }; } },
  };
  return { ctx, store, sent, handle: createHandler(ctx.config, ctx) };
}

function webhook(event: object): Request {
  const payload = JSON.stringify(event);
  return new Request("http://x/webhooks/stripe", {
    method: "POST", body: payload, headers: { "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET }) },
  });
}

function paidEvent(id: string, metadata: Record<string, string>, amount = 500, livemode = false) {
  return {
    id, object: "event", type: "checkout.session.completed", livemode, api_version: "2024-06-20", created: 1, data: {
      object: { id: `cs_${id}`, object: "checkout.session", payment_status: "paid", amount_total: amount, currency: "usd", metadata },
    },
  };
}

async function lead(store: MemoryStore) {
  return store.upsertLead({ company: "Team Ada", appId: null, contactName: "Ada Lovelace", email: "ada@team.example", source: "inbound_form", stage: "pilot_offered", reason: null, sampleUrl: null, crmContactId: null });
}

describe("paid playtest webhook", () => {
  it("records a test payment once, runs the playtest, emails a report labeled as a test order, and closes the delivery", async () => {
    const { store, sent, handle } = setup();
    const l = await lead(store);
    const event = paidEvent("evt_1", { product: "playtest", lead_id: l.id, app_url: "https://ada.example.app", focus: "" });

    const res = await handle(webhook(event));
    expect(await res.json()).toEqual({ received: true, outcome: "paid" });
    await enqueue(async () => undefined);

    const payments = await store.listPayments();
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ amountMinor: 500, livemode: false, product: "playtest", providerEventId: "evt_1" });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe("[Test order] Your iPhone playtest report: Team Ada");
    expect(sent[0]!.text).toContain("This was a test order, so no money was charged.");
    expect(sent[0]!.text).not.toMatch(/stripe|mobilerun|agentmail|neon/i);
    expect((await store.getLead(l.id))!.stage).toBe("delivered");

    const acts = (await store.listActivity(100)).map((a) => `${a.action} | ${a.result}`);
    expect(acts).toContainEqual(expect.stringMatching(/^payment received: playtest \| 5\.00 USD \(test mode\)$/));
    expect(acts).toContainEqual(expect.stringMatching(/^playtest queued after payment: Team Ada \| payment .+ \(test mode\)$/));
    expect(acts).toContainEqual(expect.stringMatching(/^emailed the playtest report to Team Ada \| message m1 \(test order\)$/));

    // Stripe retries the same event: nothing is recorded, played, or emailed twice.
    const again = await handle(webhook(event));
    expect(await again.json()).toEqual({ received: true, outcome: "duplicate" });
    await enqueue(async () => undefined);
    expect(await store.listPayments()).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect((await store.listActivity(5)).map((a) => a.action)).toContain("payment event seen again");
  });

  it("flags an amount that differs from the set price, and a paid playtest with no app link", async () => {
    const { store, sent, handle } = setup();
    const l = await lead(store);
    await handle(webhook(paidEvent("evt_2", { product: "playtest", lead_id: l.id }, 700)));
    await enqueue(async () => undefined);
    const acts = await store.listActivity(20);
    expect(acts.find((a) => a.action === "payment amount differs from the set price: playtest")?.why).toBe("expected 5.00 USD, got 7.00 USD");
    expect(acts.find((a) => a.action === "paid playtest can't start")?.result).toBe("left for a person (test mode)");
    expect(sent).toHaveLength(0);
  });

  it("rejects a bad signature without recording anything", async () => {
    const { store, handle } = setup();
    const res = await handle(new Request("http://x/webhooks/stripe", { method: "POST", body: "{}", headers: { "stripe-signature": "t=1,v1=bad" } }));
    expect(res.status).toBe(400);
    expect(await store.listPayments()).toHaveLength(0);
  });
});

describe("playtest delivery when the phone can't finish", () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => { s = setup(null); });

  it("emails an honest status update (no promise of a retry) and records the failed delivery", async () => {
    const l = await lead(s.store);
    const payment = (await s.store.recordPayment({ leadId: l.id, provider: "stripe", providerEventId: "evt_9", amountMinor: 500, currency: "usd", livemode: true, product: "playtest" }))!;
    await runPlaytestOrder(s.ctx, l, "https://ada.example.app", null, { id: payment.id, livemode: true });
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]!.subject).toBe("Your iPhone playtest: an update for Team Ada");
    expect(s.sent[0]!.text).toContain("couldn't finish this playtest");
    expect(s.sent[0]!.text).toContain("will either run it again or refund you");
    expect(s.sent[0]!.text).not.toMatch(/we'll retry|test order/i);
    const acts = (await s.store.listActivity(20)).map((a) => a.action);
    expect(acts).toContain("emailed a playtest status update to Team Ada");
    expect(acts).toContain("playtest order needs a person: Team Ada");
    expect(acts).not.toContain("emailed the playtest report to Team Ada");
  });

  it("refuses a Google Play link at order time, so nobody pays for a test our iPhone can't run", async () => {
    const r = await createPlaytestOrder(s.ctx, { name: "A", email: "a@x.example", team: "T", appUrl: "https://play.google.com/store/apps/details?id=com.x.y", consent: true });
    expect(r).toEqual({ ok: false, error: expect.stringContaining("our test phone is an iPhone") });
  });

  it("still tells the customer why when an unplayable link reaches the phone", async () => {
    const l = await lead(s.store);
    s.ctx.mobilerun = fakePhone(REPORT);
    await runPlaytestOrder(s.ctx, l, "https://play.google.com/store/apps/details?id=com.x.y", null, null);
    expect(s.sent[0]!.text).toContain("That link is to Google Play, and our test phone is an iPhone.");
  });

  it("logs a failed send instead of going silent", async () => {
    const l = await lead(s.store);
    s.ctx.mail = { async send() { throw new Error("mail down"); }, async reply() { return { messageId: "r" }; } };
    await runPlaytestOrder(s.ctx, l, "https://ada.example.app", null, null);
    const acts = await s.store.listActivity(20);
    expect(acts.find((a) => a.action === "couldn't email Team Ada about their playtest")?.why).toBe("mail down");
    expect(acts.map((a) => a.action)).toContain("playtest order needs a person: Team Ada");
  });
});
