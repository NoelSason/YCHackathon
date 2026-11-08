import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import type Mobilerun from "@mobilerun/sdk";
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store.js";
import { createHandler } from "../src/app.js";
import { enqueue, resumePaidOrders } from "../src/leads/playtest-offer.js";
import { handleInboundReply } from "../src/outreach/inbound.js";
import { moneyRequest } from "../src/billing/requests.js";
import type { ToolContext } from "../src/mcp/tools.js";

// Payment paths that go wrong: an order we don't have, a follow-up that fails after the payment is
// recorded, a payment still pending, a database outage, a restart mid-playtest, and refund emails.
// Each must be logged honestly and never dropped. No network: events are signed locally.
const SECRET = "whsec_test_secret";
const stripe = new Stripe("sk_test_dummy");
const REPORT = { results: [{ level: "app", loaded: true, touchOk: true, won: null, movesUsed: null, visualIssues: [], stuckReason: null, notes: "Menus load." }] };

function fakePhone(): Mobilerun & { runs: number } {
  const phone = {
    runs: 0,
    tasks: {
      run: async () => { phone.runs++; return { id: "task_1", status: "created" }; },
      getStatus: async () => ({ status: "completed", succeeded: true, message: "done", output: REPORT, steps: 9 }),
    },
  };
  return phone as unknown as Mobilerun & { runs: number };
}

function setup(store: MemoryStore = new MemoryStore()) {
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const phone = fakePhone();
  const ctx: ToolContext = {
    config: loadConfig({
      COMPANY_POSTAL_ADDRESS: "1752 Shattuck Avenue, Berkeley, CA 94704", MOBILERUN_DEVICE_ID: "dev_1",
      PLAYTEST_PRICE_USD: "5", STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_SECRET_KEY: "sk_test_dummy",
    }),
    store, monid: null, stripe, naive: null, mobilerun: phone,
    mail: { async send(a) { sent.push(a); return { messageId: `m${sent.length}` }; }, async reply() { return { messageId: "r" }; } },
  };
  return { ctx, store, sent, phone, handle: createHandler(ctx.config, ctx) };
}

function webhook(event: object, signature?: string): Request {
  const payload = JSON.stringify(event);
  return new Request("http://x/webhooks/stripe", {
    method: "POST", body: payload,
    headers: signature === undefined ? { "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET }) } : signature ? { "stripe-signature": signature } : {},
  });
}

function sessionEvent(id: string, metadata: Record<string, string>, opts: { type?: string; status?: string; amount?: number } = {}) {
  return {
    id, object: "event", type: opts.type ?? "checkout.session.completed", livemode: false, api_version: "2024-06-20", created: 1, data: {
      object: { id: `cs_${id}`, object: "checkout.session", payment_status: opts.status ?? "paid", amount_total: opts.amount ?? 500, currency: "usd", metadata },
    },
  };
}

const newLead = (store: MemoryStore, email = "ada@team.example") =>
  store.upsertLead({ company: "Team Ada", appId: null, contactName: "Ada Lovelace", email, source: "inbound_form", stage: "pilot_offered", reason: null, sampleUrl: null, crmContactId: null });

const actions = async (store: MemoryStore) => (await store.listActivity(100)).map((a) => `${a.action} | ${a.result}`);

describe("a payment for an order we don't have", () => {
  it("records the money without a lead, flags it for a person, and starts no playtest", async () => {
    const { store, sent, phone, handle } = setup();
    const res = await handle(webhook(sessionEvent("evt_u1", { product: "playtest", lead_id: "6f1c1f0e-0000-4000-8000-000000000000", app_url: "https://a.example" })));
    expect(await res.json()).toEqual({ received: true, outcome: "paid" });
    await enqueue(async () => undefined);
    const payments = await store.listPayments();
    expect(payments).toHaveLength(1);
    expect(payments[0]!.leadId).toBeNull();
    const acts = await actions(store);
    expect(acts).toContain("payment for an order we don't have on file | recorded without a lead; left for a person (test mode)");
    expect(acts).toContain("paid playtest can't start | left for a person (test mode)");
    expect(phone.runs).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("leaves a payment with no metadata at all (a link made elsewhere) for a person", async () => {
    const { store, handle } = setup();
    await handle(webhook(sessionEvent("evt_u2", {}, { amount: 1200 })));
    expect((await store.listPayments())[0]).toMatchObject({ product: "other", leadId: null, amountMinor: 1200 });
    expect(await actions(store)).toContain("delivery owed: other | left for a person (test mode)");
  });
});

describe("when the work after a recorded payment fails", () => {
  it("answers 200 so Stripe doesn't retry it into a duplicate, and logs it for a person", async () => {
    const store = new MemoryStore();
    const log = store.logActivity.bind(store);
    store.logActivity = async (e) => {
      if (e.action.startsWith("playtest queued after payment")) throw new Error("database hiccup");
      return log(e);
    };
    const { handle } = setup(store);
    const l = await newLead(store);
    const event = sessionEvent("evt_f1", { product: "playtest", lead_id: l.id, app_url: "https://a.example" });
    const res = await handle(webhook(event));
    expect(res.status).toBe(200);
    const acts = await store.listActivity(20);
    const flagged = acts.find((a) => a.action === "payment recorded, but starting its work failed");
    expect(flagged?.result).toBe("left for a person");
    expect(flagged?.why).toMatch(/^playtest payment .+ \(test mode\): database hiccup$/);
    // A retry is a duplicate, and the payment is still recorded once.
    expect(await (await handle(webhook(event))).json()).toEqual({ received: true, outcome: "duplicate" });
    expect(await store.listPayments()).toHaveLength(1);
  });

  it("answers 400 (so Stripe retries) when the payment itself couldn't be recorded", async () => {
    const store = new MemoryStore();
    store.recordPayment = async () => { throw new Error("database down"); };
    const { handle } = setup(store);
    const l = await newLead(store);
    const res = await handle(webhook(sessionEvent("evt_f2", { product: "playtest", lead_id: l.id, app_url: "https://a.example" })));
    expect(res.status).toBe(400);
    expect((await actions(store)).some((a) => a.startsWith("payment recorded"))).toBe(false);
  });
});

describe("payments that aren't finished", () => {
  it("logs a checkout that completed unpaid, then records it once when the delayed payment succeeds", async () => {
    const { store, handle } = setup();
    const l = await newLead(store);
    const meta = { product: "pilot_pack", lead_id: l.id };
    expect(await (await handle(webhook(sessionEvent("evt_p1", meta, { status: "unpaid", amount: 4900 })))).json()).toMatchObject({ outcome: "ignored" });
    expect(await store.listPayments()).toHaveLength(0);
    expect(await actions(store)).toContainEqual(expect.stringMatching(/^checkout finished, payment still pending \| nothing recorded until it's paid \(test mode\)$/));
    const later = sessionEvent("evt_p2", meta, { type: "checkout.session.async_payment_succeeded", amount: 4900 });
    expect(await (await handle(webhook(later))).json()).toMatchObject({ outcome: "paid" });
    expect(await store.listPayments()).toHaveLength(1);
  });

  it("logs a delayed payment that failed, and records nothing", async () => {
    const { store, handle } = setup();
    await handle(webhook(sessionEvent("evt_p3", { product: "pilot_pack" }, { type: "checkout.session.async_payment_failed", status: "unpaid" })));
    expect(await store.listPayments()).toHaveLength(0);
    expect(await actions(store)).toContain("a delayed payment failed | nothing recorded; no work started (test mode)");
  });
});

describe("events not signed by Stripe", () => {
  it("are refused with 400, recorded nowhere, and logged once rather than on every attempt", async () => {
    const { store, handle } = setup();
    const event = sessionEvent("evt_s1", { product: "playtest" });
    expect((await handle(webhook(event, "t=1,v1=forged"))).status).toBe(400);
    expect((await handle(webhook(event, ""))).status).toBe(400);
    expect(await store.listPayments()).toHaveLength(0);
    expect((await actions(store)).filter((a) => a.startsWith("rejected a payment event"))).toHaveLength(1);
  });
});

describe("a restart in the middle of a paid playtest", () => {
  it("runs the cut-off order again and delivers its report", async () => {
    const { ctx, store, sent, phone } = setup();
    const l = await newLead(store);
    const order = await store.addWatchOrder({ leadId: l.id, token: "tok_resume", appUrl: "https://a.example", gameName: "A" });
    await store.updateWatchOrder(order.id, { paymentId: "pay_1", test: true, state: "testing" });
    expect(await resumePaidOrders(ctx)).toBe(1);
    await enqueue(async () => undefined);
    expect(phone.runs).toBe(1);
    expect(sent.map((s) => s.subject)).toContain("[Test order] Your iPhone playtest report: Team Ada");
    expect((await store.getWatchOrder(order.id))!.state).toBe("finished");
    expect(await actions(store)).toContain(`resumed a paid playtest after a restart: Team Ada | order ${order.id} (test mode)`);
    // Finished now, so a second restart doesn't run it again.
    expect(await resumePaidOrders(ctx)).toBe(0);
  });

  it("logs a paid order whose customer record is gone instead of skipping it quietly", async () => {
    const { ctx, store, phone } = setup();
    const order = await store.addWatchOrder({ leadId: "missing-lead", token: "tok_gone", appUrl: "https://a.example", gameName: "A" });
    await store.updateWatchOrder(order.id, { paymentId: "pay_2", test: true });
    await resumePaidOrders(ctx);
    await enqueue(async () => undefined);
    expect(phone.runs).toBe(0);
    expect(await actions(store)).toContain("paid playtest can't resume after a restart | left for a person (test mode)");
  });
});

describe("refund and cancellation emails", () => {
  it("recognizes money requests, including ones the sales classifier reads as a yes", () => {
    for (const t of ["Yes please refund me", "I'd like a refund. How much will I get back?", "Sounds good, send me my money back", "Please cancel my subscription", "I was charged twice", "I want to dispute this charge"]) {
      expect(moneyRequest("Re: Your order", t), t).not.toBeNull();
    }
    for (const t of ["Yes, sounds good! How much is the pack?", "Interested, tell me more", "Can you send the levels?"]) {
      expect(moneyRequest("Re: Your order", t), t).toBeNull();
    }
    // Our own quoted email says "we'll stop the next charge"; that isn't the customer asking.
    expect(moneyRequest("Re: Your order", "Great, thanks!\n\nOn Sat, Nov 7, 2026 at 8:00 PM Level AI wrote:\n> Reply to this email and we'll stop the next charge.")).toBeNull();
    expect(moneyRequest("Refund please", "")).toMatchObject({ kind: "refund" });
  });

  it("go to a person with the customer's payments, and never get the automatic sales answer", async () => {
    const { store, sent, handle } = setup();
    void handle; // createHandler installs the reply responder
    const l = await newLead(store);
    await store.recordPayment({ leadId: l.id, provider: "stripe", providerEventId: "evt_r1", amountMinor: 500, currency: "usd", livemode: true, product: "playtest" });
    const outcome = await handleInboundReply({ eventId: "in_1", from: "ada@team.example", subject: "Re: Your iPhone playtest report: Team Ada", text: "Yes please refund me", threadId: "t1", messageId: "msg1" }, store);
    expect(outcome.kind).toBe("needs_reader");
    expect(sent).toHaveLength(0);
    const flagged = (await store.listActivity(20)).find((a) => a.action === "refund request from Team Ada");
    expect(flagged?.why).toBe("the reply asks for a refund or disputes a charge; paid: 5.00 USD playtest");
    expect(flagged?.result).toMatch(/^left for a person; agents never refund or cancel/);
  });
});

// ---------------------------------------------------------------------------------------------
// Delivery rows, public counts, and the email outbox (coordinator fixes, Nov 7 evening).
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { PlatformStore, type Query } from "../src/store.js";
import { clearMemoryOutbox, retryOutbox, sendCustomerEmail } from "../src/billing/outbox.js";
import { runPlaytestOrder } from "../src/leads/playtest-offer.js";

async function pg(): Promise<{ store: PlatformStore; q: Query }> {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(await readFile(new URL("../../platform/db/schema.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8"));
  const q: Query = async (text, params = []) => (await db.query<Record<string, unknown>>(text, params)).rows;
  return { store: new PlatformStore(q, new Set(["team@levelai.example"])), q };
}

describe("delivery rows", () => {
  it("close the payment's pending row instead of leaving it open next to the outcome (memory)", async () => {
    const store = new MemoryStore();
    await store.addDelivery({ paymentId: "p1", leadId: null, status: "pending", detail: null });
    await store.addDelivery({ paymentId: "p1", leadId: "l1", status: "delivered", detail: "report emailed" });
    expect(store.listDeliveries()).toEqual([expect.objectContaining({ paymentId: "p1", status: "delivered", detail: "report emailed", leadId: "l1" })]);
    // A re-run after a failure has no open row, so its outcome is added.
    await store.addDelivery({ paymentId: "p1", leadId: "l1", status: "delivered", detail: "again" });
    expect(store.listDeliveries()).toHaveLength(2);
  });

  it("close the pending row in Postgres too, and mark the payment delivered", async () => {
    const { store, q } = await pg();
    const lead = await store.upsertLead({ company: "Ada", appId: null, contactName: null, email: "ada@x.example", source: "inbound_form", stage: "found", reason: null, sampleUrl: null, crmContactId: null });
    const p = (await store.recordPayment({ leadId: lead.id, provider: "stripe", providerEventId: "evt_d1", amountMinor: 500, currency: "usd", livemode: false, product: "playtest" }))!;
    await store.addDelivery({ paymentId: p.id, leadId: lead.id, status: "pending", detail: null });
    await store.addDelivery({ paymentId: p.id, leadId: lead.id, status: "delivered", detail: "report emailed" });
    expect(await q("select status, detail from biz_deliveries")).toEqual([{ status: "delivered", detail: "report emailed" }]);
    expect((await q("select status from payments"))[0]!.status).toBe("delivered");
  });
});

describe("the home page's public counts", () => {
  it("count over the whole log, not the newest rows, and leave out the team's test orders (memory)", async () => {
    const store = new MemoryStore();
    const at = new Date().toISOString();
    const row = (action: string) => store.logActivity({ at, agent: "playtest-lead", action, why: null, result: null, costUsd: null, human: false });
    await row("playtested 2048 (web game): played in 15 moves");
    await row("playtested Candy Crush Saga (iOS app): won");
    await row("playtested Level AI billing check's app");
    for (let i = 0; i < 600; i++) await row(`compiled level ${i}`);
    expect((await store.publicCounts()).playtestsRun).toBe(2);
  });

  it("count sent emails to non-team studios and non-team playtests in Postgres", async () => {
    const { store, q } = await pg();
    const lead = (email: string, company: string) => store.upsertLead({ company, appId: null, contactName: null, email, source: "inbound_form", stage: "found", reason: null, sampleUrl: null, crmContactId: null });
    const real = await lead("ada@x.example", "Ada Games");
    const team = await lead("team@levelai.example", "Team Test Co");
    const send = (leadId: string) => store.addOutreach({ leadId, to: "x", subject: "s", body: "b", status: "sent", blockedReason: null, providerMessageId: "m" });
    await send(real.id); await send(real.id); await send(team.id);
    const at = new Date().toISOString();
    for (const action of ["playtested 2048 (web game): played", "playtested Ada Games's app", "playtested Team Test Co's app", "playtested Level AI's app"]) {
      await store.logActivity({ at, agent: "playtest-lead", action, why: null, result: null, costUsd: null, human: false });
    }
    expect(await store.publicCounts()).toEqual({ emailsSent: 2, playtestsRun: 2 });
    void q;
  });
});

describe("customer emails the mail provider refuses", () => {
  class Refused extends Error {}
  const refusing = { async send(): Promise<{ messageId: string }> { throw new Refused("Recipient limit reached for new addresses"); }, async reply() { return { messageId: "r" }; } };

  it("still deliver a finished paid playtest (results on the watch page), then send the report on a retry, once", async () => {
    clearMemoryOutbox();
    const { ctx, store, sent } = setup();
    const working = ctx.mail!;
    ctx.mail = refusing;
    const l = await newLead(store);
    const p = (await store.recordPayment({ leadId: l.id, provider: "stripe", providerEventId: "evt_o1", amountMinor: 500, currency: "usd", livemode: true, product: "playtest" }))!;
    await store.addDelivery({ paymentId: p.id, leadId: l.id, status: "pending", detail: null });
    const order = await store.addWatchOrder({ leadId: l.id, token: "tok_o1", appUrl: "https://a.example", gameName: "A" });
    await runPlaytestOrder(ctx, l, "https://a.example", null, { id: p.id, livemode: true }, order.id);

    expect(store.listDeliveries()).toEqual([expect.objectContaining({ status: "delivered", detail: "results on the customer's watch page; the report email is kept to retry" })]);
    expect((await store.getWatchOrder(order.id))!.state).toBe("finished");
    const acts = await store.listActivity(30);
    expect(acts.find((a) => a.action === "couldn't email Team Ada their playtest report yet")?.why).toBe("Recipient limit reached for new addresses");
    expect(acts.some((a) => a.action.startsWith("playtest order needs a person"))).toBe(false);

    // Not due yet: nothing is tried.
    ctx.mail = working;
    expect(await retryOutbox(ctx)).toBe(0);
    // Due: the watch link and the report go out once each, with their original keys.
    expect(await retryOutbox(ctx, { now: Date.now() + 16 * 60_000 })).toBe(2);
    expect(sent.map((m) => m.subject)).toEqual(["Your playtest is starting: watch it live", "Your iPhone playtest report: Team Ada"]);
    expect((await store.listActivity(5)).map((a) => a.action)).toContain("emailed Team Ada their playtest report (on try 2)");
    expect(await retryOutbox(ctx, { force: true })).toBe(0);
  });

  it("never stop a paid order: the webhook answers 200 and the confirmation waits in the outbox", async () => {
    clearMemoryOutbox();
    const { ctx, store, handle } = setup();
    ctx.mail = refusing;
    const l = await newLead(store);
    const res = await handle(webhook(sessionEvent("evt_o2", { product: "pilot_pack", lead_id: l.id, game_url: "https://a.example", difficulty: "medium" }, { amount: 4900 })));
    expect(res.status).toBe(200);
    expect(await store.listPayments()).toHaveLength(1);
    const acts = await actions(store);
    expect(acts).toContainEqual(expect.stringMatching(/^couldn't email Team Ada their order confirmation yet \| kept to retry every 15 minutes for 48 hours; the order goes ahead \(test order\)$/));
    expect(acts).toContainEqual(expect.stringMatching(/^delivery owed: level pack for Team Ada/));
  });

  it("give up after two days and tell a person", async () => {
    clearMemoryOutbox();
    const { ctx, store } = setup();
    ctx.mail = refusing;
    await sendCustomerEmail(ctx, { kind: "order-confirmation", leadId: null, company: "Bo Games", to: "bo@x.example", subject: "s", text: "t", idempotencyKey: "k1", test: false });
    await retryOutbox(ctx, { now: Date.now() + 49 * 3600_000 });
    expect(await actions(store)).toContainEqual(expect.stringMatching(/^gave up emailing Bo Games their order confirmation \| left for a person$/));
    expect(await retryOutbox(ctx, { now: Date.now() + 50 * 3600_000 })).toBe(0);
  });

  it("keep refused emails in Postgres across restarts, and send each once", async () => {
    const { store, q } = await pg();
    const { ctx, sent } = setup(store as unknown as MemoryStore);
    ctx.db = q;
    const working = ctx.mail!;
    ctx.mail = refusing;
    const email = { kind: "order-confirmation" as const, leadId: null, company: "Bo Games", to: "bo@x.example", subject: "Your order", text: "t", html: "<p>t</p>", idempotencyKey: "k2", test: true };
    expect((await sendCustomerEmail(ctx, email)).sent).toBe(false);
    await sendCustomerEmail(ctx, email); // the same email again doesn't queue twice
    expect(await q("select count(*)::int as n from biz_mail_outbox")).toEqual([{ n: 1 }]);
    ctx.mail = working;
    expect(await retryOutbox(ctx, { force: true })).toBe(1);
    expect(sent).toEqual([expect.objectContaining({ to: "bo@x.example", subject: "Your order", html: "<p>t</p>", idempotencyKey: "k2" })]);
    expect(await retryOutbox(ctx, { force: true })).toBe(0);
    expect((await q("select message_id, attempts from biz_mail_outbox"))[0]).toEqual({ message_id: "m1", attempts: 2 });
  });
});
