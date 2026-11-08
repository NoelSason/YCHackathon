import { beforeEach, describe, expect, it } from "vitest";
import Stripe from "stripe";
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store.js";
import { createHandler } from "../src/app.js";
import { clearPriceCache } from "../src/billing/stripe.js";
import { createOrder } from "../src/leads/orders.js";
import type { ToolContext } from "../src/mcp/tools.js";

// Level pack and subscription orders: form → checkout → webhook → payment, email, and team log.
// No network: Stripe's object calls are faked, and its events are signed locally.
const SECRET = "whsec_test_secret";
const real = new Stripe("sk_test_dummy");

interface Calls {
  pricesList: Array<Record<string, unknown>>;
  pricesCreate: Array<Record<string, unknown>>;
  sessions: Array<Record<string, unknown>>;
}

function fakeStripe(existing: Array<{ id: string; lookup_key: string; unit_amount: number; recurring: { interval: string } | null }> = []) {
  const calls: Calls = { pricesList: [], pricesCreate: [], sessions: [] };
  const prices = [...existing];
  const stripe = {
    webhooks: real.webhooks,
    prices: {
      list: async (p: { lookup_keys: string[] }) => {
        calls.pricesList.push(p);
        return { data: prices.filter((x) => p.lookup_keys.includes(x.lookup_key)) };
      },
      create: async (p: { lookup_key: string; unit_amount: number; recurring?: { interval: string } }) => {
        calls.pricesCreate.push(p);
        const price = { id: `price_${prices.length + 1}`, lookup_key: p.lookup_key, unit_amount: p.unit_amount, recurring: p.recurring ?? null };
        prices.push(price);
        return price;
      },
    },
    checkout: {
      sessions: {
        create: async (p: Record<string, unknown>) => {
          calls.sessions.push(p);
          return { id: `cs_test_${calls.sessions.length}`, url: `https://checkout.example/cs_test_${calls.sessions.length}` };
        },
      },
    },
  } as unknown as Stripe;
  return { stripe, calls };
}

function setup(opts: { stripe?: Stripe | null; key?: string } = {}) {
  const sent: Array<{ to: string; subject: string; text: string; html?: string; idempotencyKey: string }> = [];
  const store = new MemoryStore();
  const fake = fakeStripe();
  const ctx: ToolContext = {
    config: loadConfig({
      COMPANY_POSTAL_ADDRESS: "1752 Shattuck Avenue, Berkeley, CA 94704", STRIPE_WEBHOOK_SECRET: SECRET,
      STRIPE_SECRET_KEY: opts.key ?? "sk_test_dummy", AGENTMAIL_INBOX_ID: "levelai@agentmail.to",
    }),
    store, monid: null, naive: null, mobilerun: null,
    stripe: opts.stripe === undefined ? fake.stripe : opts.stripe,
    mail: { async send(a) { sent.push(a); return { messageId: `m${sent.length}` }; }, async reply() { return { messageId: "r" }; } },
  };
  return { ctx, store, sent, calls: fake.calls, handle: createHandler(ctx.config, ctx, null) };
}

const ORDER = { name: "Ada Lovelace", email: "ada@studio.example", company: "Ada Games", gameUrl: "https://ada.example/game", difficulty: "medium", game: "watersort", consent: true };

function webhook(event: object): Request {
  const payload = JSON.stringify(event);
  return new Request("http://x/webhooks/stripe", {
    method: "POST", body: payload, headers: { "stripe-signature": real.webhooks.generateTestHeaderString({ payload, secret: SECRET }) },
  });
}

function sessionEvent(id: string, metadata: Record<string, string>, opts: { amount: number; livemode?: boolean; subscription?: string }) {
  return {
    id, object: "event", type: "checkout.session.completed", livemode: opts.livemode ?? false, api_version: "2026-10-28", created: 1, data: {
      object: {
        id: `cs_${id}`, object: "checkout.session", mode: opts.subscription ? "subscription" : "payment", payment_status: "paid",
        amount_total: opts.amount, currency: "usd", metadata, subscription: opts.subscription ?? null,
        customer_details: { email: "ada@studio.example" },
      },
    },
  };
}

function invoiceEvent(id: string, sub: string, reason: string, amount = 19900, metadata: Record<string, string> = {}) {
  return {
    id, object: "event", type: "invoice.paid", livemode: false, api_version: "2026-10-28", created: 1, data: {
      object: {
        id: `in_${id}`, object: "invoice", billing_reason: reason, amount_paid: amount, currency: "usd",
        parent: { type: "subscription_details", subscription_details: { subscription: sub, metadata } },
      },
    },
  };
}

function cancelEvent(id: string, sub: string, metadata: Record<string, string> = {}) {
  return {
    id, object: "event", type: "customer.subscription.deleted", livemode: false, api_version: "2026-10-28", created: 1,
    data: { object: { id: sub, object: "subscription", status: "canceled", metadata } },
  };
}

const actions = async (store: MemoryStore) => (await store.listActivity(200)).map((a) => `${a.action} | ${a.why} | ${a.result}`);

beforeEach(() => clearPriceCache());

describe("creating a checkout", () => {
  it("opens a one-time checkout for the level pack, with the order on the session", async () => {
    const { ctx, calls, store } = setup();
    const r = await createOrder(ctx, { ...ORDER, plan: "level_pack" });
    if (!r.ok) throw new Error(r.error);
    expect(r.payUrl).toBe("https://checkout.example/cs_test_1");
    expect(calls.pricesCreate).toEqual([expect.objectContaining({ unit_amount: 4900, lookup_key: "levelai_level_pack_4900", currency: "usd" })]);
    expect(calls.pricesCreate[0]).not.toHaveProperty("recurring");
    const s = calls.sessions[0]!;
    const metadata = { product: "pilot_pack", lead_id: r.lead.id, game_url: "https://ada.example/game", difficulty: "medium", game_id: "watersort" };
    expect(s).toMatchObject({
      mode: "payment", line_items: [{ price: "price_1", quantity: 1 }], customer_email: "ada@studio.example", client_reference_id: r.lead.id,
      metadata, payment_intent_data: { metadata },
      success_url: "https://levelai.vercel.app/pricing?paid=pack&test=1", cancel_url: "https://levelai.vercel.app/pricing?plan=pack&cancelled=1#order",
    });
    expect((await store.getLead(r.lead.id))!.stage).toBe("pilot_offered");
    expect(await actions(store)).toContainEqual("level pack ordered by Ada Games | https://ada.example/game (water-sort, medium) | checkout opened at $49 (test mode)");
  });

  it("opens a subscription checkout on a monthly price, and reuses the price by lookup key instead of making one per order", async () => {
    const { ctx, calls } = setup();
    const r = await createOrder(ctx, { ...ORDER, plan: "subscription" });
    if (!r.ok) throw new Error(r.error);
    expect(calls.pricesCreate).toEqual([expect.objectContaining({ unit_amount: 19900, recurring: { interval: "month" }, lookup_key: "levelai_subscription_monthly_19900" })]);
    expect(calls.sessions[0]).toMatchObject({ mode: "subscription", subscription_data: { metadata: { product: "subscription", lead_id: r.lead.id } } });
    expect(calls.sessions[0]).not.toHaveProperty("payment_intent_data");

    await createOrder(ctx, { ...ORDER, plan: "subscription" });
    expect(calls.pricesCreate).toHaveLength(1);

    // A fresh process finds the existing price by its lookup key.
    clearPriceCache();
    const fresh = fakeStripe([{ id: "price_old", lookup_key: "levelai_subscription_monthly_19900", unit_amount: 19900, recurring: { interval: "month" } }]);
    ctx.stripe = fresh.stripe;
    await createOrder(ctx, { ...ORDER, plan: "subscription" });
    expect(fresh.calls.pricesCreate).toHaveLength(0);
    expect(fresh.calls.sessions[0]).toMatchObject({ line_items: [{ price: "price_old", quantity: 1 }] });
  });

  it("makes a new price when the set price changes, and leaves the test label off a live key", async () => {
    const { ctx, calls } = setup({ key: "sk_live_x" });
    ctx.config = { ...ctx.config, PILOT_PRICE_USD: 59 };
    const r = await createOrder(ctx, { ...ORDER, plan: "level_pack" });
    if (!r.ok) throw new Error(r.error);
    expect(calls.pricesCreate[0]).toMatchObject({ unit_amount: 5900, lookup_key: "levelai_level_pack_5900" });
    expect(calls.sessions[0]!.success_url).toBe("https://levelai.vercel.app/pricing?paid=pack");
  });

  it("validates the form like the playtest form, and refuses orders when checkout isn't set up", async () => {
    const { handle, calls } = setup();
    const bad = await handle(new Request("http://x/orders", { method: "POST", body: JSON.stringify({ ...ORDER, plan: "level_pack", difficulty: "brutal" }) }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/difficulty/);
    for (const missing of ["name", "email", "company", "gameUrl", "consent"]) {
      const body: Record<string, unknown> = { ...ORDER, plan: "subscription" };
      delete body[missing];
      expect((await handle(new Request("http://x/orders", { method: "POST", body: JSON.stringify(body) }))).status).toBe(400);
    }
    expect((await handle(new Request("http://x/orders", { method: "POST", body: JSON.stringify({ ...ORDER, plan: "gold" }) }))).status).toBe(400);
    expect(calls.sessions).toHaveLength(0);

    const ok = await handle(new Request("http://x/orders", { method: "POST", body: JSON.stringify({ ...ORDER, plan: "level_pack" }) }));
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({ ok: true, payUrl: "https://checkout.example/cs_test_1" });

    const closed = setup({ stripe: null });
    const r = await createOrder(closed.ctx, { ...ORDER, plan: "level_pack" });
    expect(r).toEqual({ ok: false, error: expect.stringContaining("Checkout is closed") });
  });
});

describe("the webhook for level orders", () => {
  it("records a level pack once, emails an honest confirmation labeled as a test, and logs the delivery owed with a due date", async () => {
    const { ctx, store, sent, handle } = setup();
    const r = await createOrder(ctx, { ...ORDER, plan: "level_pack" });
    if (!r.ok) throw new Error(r.error);
    const event = sessionEvent("evt_pack", { product: "pilot_pack", lead_id: r.lead.id, game_url: "https://ada.example/game", difficulty: "medium" }, { amount: 4900 });

    expect(await (await handle(webhook(event))).json()).toEqual({ received: true, outcome: "paid" });
    const payments = await store.listPayments();
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ product: "pilot_pack", amountMinor: 4900, livemode: false, leadId: r.lead.id });
    expect((await store.getLead(r.lead.id))!.stage).toBe("pilot_paid");

    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    expect(mail.to).toBe("ada@studio.example");
    expect(mail.subject).toBe("[Test order] Your level pack order: Ada Games");
    expect(mail.text).toContain("We design 20 new levels for https://ada.example/game");
    expect(mail.text).toContain("medium difficulty");
    expect(mail.text).toMatch(/We email you the levels by \w{3}, \w{3} \d+, \d+:\d\d [AP]M PT\./);
    expect(mail.text).toContain("Reply to this email or write to levelai@agentmail.to");
    expect(mail.text).toContain("This was a test order, so no money was charged.");
    expect(mail.text).not.toMatch(/your levels are ready|attached|here are your levels/i);
    expect(`${mail.text}${mail.html}`).not.toMatch(/stripe|agentmail\.to\/|neon|mobilerun|webhook/i);

    const acts = await actions(store);
    expect(acts).toContainEqual("payment received: pilot_pack | lead " + r.lead.id + " | 49.00 USD (test mode)");
    expect(acts).toContainEqual(expect.stringMatching(/^delivery owed: level pack for Ada Games \(due \w{3}, \w{3} \d+, \d+:\d\d [AP]M PT\) \| 20 levels; https:\/\/ada\.example\/game, medium \| left for the team \(test mode\)$/));
    expect(acts).toContainEqual("emailed the order confirmation to Ada Games | level pack | message m1 (test mode)");

    // Stripe retries: no second payment, email, or delivery line.
    expect(await (await handle(webhook(event))).json()).toEqual({ received: true, outcome: "duplicate" });
    expect(await store.listPayments()).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect((await actions(store)).filter((a) => a.startsWith("delivery owed"))).toHaveLength(1);
  });

  it("asks for the game link when a pack was paid without one (an outreach payment link)", async () => {
    const { store, sent, handle } = setup();
    const lead = await store.upsertLead({ company: "Bob Games", appId: null, contactName: "Bob", email: "bob@x.example", source: "research", stage: "emailed", reason: null, sampleUrl: null, crmContactId: null });
    await handle(webhook(sessionEvent("evt_link", { product: "pilot_pack", lead_id: lead.id }, { amount: 4900 })));
    expect(sent[0]!.text).toContain("We don't have a link to your game yet. Reply with it so we can start.");
    expect(await actions(store)).toContainEqual(expect.stringMatching(/^delivery owed: level pack for Bob Games .* \| 20 levels; no game link, no difficulty \|/));
  });

  it("starts a subscription: one payment, an active subscription, and a confirmation with the plan's contents", async () => {
    const { ctx, store, sent, handle } = setup();
    const r = await createOrder(ctx, { ...ORDER, plan: "subscription" });
    if (!r.ok) throw new Error(r.error);
    const meta = { product: "subscription", lead_id: r.lead.id, game_url: "https://ada.example/game", difficulty: "hard" };
    await handle(webhook(sessionEvent("evt_sub", meta, { amount: 19900, subscription: "sub_1" })));

    expect(await store.listPayments()).toEqual([expect.objectContaining({ product: "subscription", amountMinor: 19900 })]);
    expect(await store.getSubscription("sub_1")).toMatchObject({ status: "active", leadId: r.lead.id, gameUrl: "https://ada.example/game", difficulty: "hard", livemode: false });
    expect(sent[0]!.subject).toBe("[Test order] Your level subscription: Ada Games");
    expect(sent[0]!.text).toContain("this month's 40 levels");
    expect(sent[0]!.text).toContain("4 iPhone playtests a month");
    expect(sent[0]!.text).toContain("https://levelai.vercel.app/developers");
    expect(await actions(store)).toContainEqual(expect.stringMatching(/^delivery owed: level subscription for Ada Games \(first levels due .+ PT\) \| 40 levels a month and 4 playtests; https:\/\/ada\.example\/game, hard \| left for the team \(test mode\)$/));

    // The first invoice belongs to the checkout above, so it isn't counted again.
    expect(await (await handle(webhook(invoiceEvent("evt_inv1", "sub_1", "subscription_create")))).json()).toEqual({ received: true, outcome: "ignored" });
    expect(await store.listPayments()).toHaveLength(1);

    // A renewal is recorded once and logged for the team.
    const renewal = invoiceEvent("evt_inv2", "sub_1", "subscription_cycle");
    expect(await (await handle(webhook(renewal))).json()).toEqual({ received: true, outcome: "renewal" });
    expect(await (await handle(webhook(renewal))).json()).toEqual({ received: true, outcome: "duplicate" });
    const payments = await store.listPayments();
    expect(payments).toHaveLength(2);
    expect(payments[1]).toMatchObject({ product: "subscription", amountMinor: 19900, leadId: r.lead.id, providerEventId: "evt_inv2" });
    const acts = await actions(store);
    expect(acts).toContainEqual("subscription renewed: Ada Games | subscription sub_1 | 199.00 USD (test mode)");
    expect(acts).toContainEqual("delivery owed: level subscription for Ada Games (this month) | 40 levels and 4 playtests | left for the team (test mode)");
    expect(acts.filter((a) => a.startsWith("subscription renewed"))).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("marks a cancelled subscription once, and ignores invoices that aren't for a subscription", async () => {
    const { ctx, store, handle } = setup();
    const r = await createOrder(ctx, { ...ORDER, plan: "subscription" });
    if (!r.ok) throw new Error(r.error);
    await handle(webhook(sessionEvent("evt_s", { product: "subscription", lead_id: r.lead.id }, { amount: 19900, subscription: "sub_2" })));

    expect(await (await handle(webhook(cancelEvent("evt_c1", "sub_2")))).json()).toEqual({ received: true, outcome: "cancelled" });
    expect(await store.getSubscription("sub_2")).toMatchObject({ status: "cancelled", cancelledAt: expect.any(String) });
    expect(await (await handle(webhook(cancelEvent("evt_c2", "sub_2")))).json()).toEqual({ received: true, outcome: "duplicate" });
    const acts = await actions(store);
    expect(acts.filter((a) => a.startsWith("subscription cancelled: Ada Games | subscription sub_2 |"))).toHaveLength(1);
    expect(acts).toContainEqual(expect.stringMatching(/^subscription cancelled: Ada Games .*\(test mode\)$/));

    // A cancel for a subscription we never saw is still recorded, by its metadata.
    expect(await (await handle(webhook(cancelEvent("evt_c3", "sub_unknown", { lead_id: r.lead.id })))).json()).toEqual({ received: true, outcome: "cancelled" });
    expect(await store.getSubscription("sub_unknown")).toMatchObject({ status: "cancelled", leadId: r.lead.id });

    const oneOff = { ...invoiceEvent("evt_i", "x", "manual"), data: { object: { id: "in_x", object: "invoice", billing_reason: "manual", amount_paid: 100, currency: "usd", parent: null } } };
    expect(await (await handle(webhook(oneOff))).json()).toEqual({ received: true, outcome: "ignored" });
  });

  it("labels nothing as a test when the payment is live", async () => {
    const { ctx, store, sent, handle } = setup();
    const r = await createOrder(ctx, { ...ORDER, plan: "level_pack" });
    if (!r.ok) throw new Error(r.error);
    await handle(webhook(sessionEvent("evt_live", { product: "pilot_pack", lead_id: r.lead.id, game_url: "https://ada.example/game", difficulty: "easy" }, { amount: 4900, livemode: true })));
    expect(sent[0]!.subject).toBe("Your level pack order: Ada Games");
    expect(sent[0]!.text).not.toMatch(/test order/i);
    const acts = (await actions(store)).filter((a) => /payment received|delivery owed|order confirmation/.test(a));
    expect(acts).toHaveLength(3);
    for (const a of acts) expect(a).not.toMatch(/test mode/);
  });

  it("flags a paid amount that differs from the set price", async () => {
    const { ctx, store, handle } = setup();
    const r = await createOrder(ctx, { ...ORDER, plan: "level_pack" });
    if (!r.ok) throw new Error(r.error);
    await handle(webhook(sessionEvent("evt_odd", { product: "pilot_pack", lead_id: r.lead.id }, { amount: 100 })));
    expect(await actions(store)).toContainEqual("payment amount differs from the set price: pilot_pack | expected 49.00 USD, got 1.00 USD | recorded what was paid (test mode); left for a person");
  });
});
