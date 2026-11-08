import { z } from "zod";
import type { ToolContext } from "../mcp/tools.js";
import { createPaymentLink } from "../billing/stripe.js";
import { runPlan, type PlaytestOutcome } from "../mobile/playtest.js";
import { installFromAppStore } from "../mobile/install.js";
import { appIdFromStoreUrl } from "./intake.js";
import { idempotencyKey } from "../outreach/send.js";
import { sendCustomerEmail } from "../billing/outbox.js";
import type { Lead, WatchOrder, WatchState, WatchSummary } from "../types.js";
import { finish, step } from "./progress.js";
import { composeWatchEmail, gameNameFromUrl, newWatchToken, phoneDone, phoneStart, watchUrl } from "./watch.js";
import * as E from "../email/html.js";

/**
 * The phone playtest offer: "Your app, played on a real iPhone, with a report in about 10 minutes."
 * A team enters their app's link. With a price set and Stripe configured they pay first, and the
 * paid webhook starts the playtest; otherwise it's free and starts right away. The Playtest agent
 * plays it on the cloud iPhone and the report is emailed. Orders run one at a time (one phone).
 */
export const PlaytestOrderSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().max(200),
  team: z.string().trim().min(1).max(160),
  appUrl: z.url().max(500).refine((u) => /^https?:\/\//i.test(u), "Use a web link (https://…)."),
  focus: z.string().trim().max(400).optional(),
  consent: z.literal(true),
});
export type PlaytestOrder = z.infer<typeof PlaytestOrderSchema>;

let queue: Promise<unknown> = Promise.resolve();
/** Runs playtests one after another, because there's one phone. */
export function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job);
  queue = next.catch(() => undefined);
  return next;
}

export async function createPlaytestOrder(ctx: ToolContext, input: unknown): Promise<
  { ok: true; lead: Lead; payUrl: string | null } | { ok: false; error: string }
> {
  const parsed = PlaytestOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please fill in your name, email, team, and app link (https://…), and tick the box." };
  const o = parsed.data;
  // Don't take an order (or money) for a link our iPhone can't play.
  const unplayable = unplayableReason(o.appUrl);
  if (unplayable) return { ok: false, error: unplayable };
  const lead = await ctx.store.upsertLead({
    company: o.team, appId: null, contactName: o.name, email: o.email, source: "inbound_form", stage: "found",
    reason: `Ordered a phone playtest of ${o.appUrl}${o.focus ? ` (focus: ${o.focus})` : ""}.`, sampleUrl: null, crmContactId: null,
  });
  // The order's live watch link. If it can't be stored, the order still goes ahead without one.
  const watch = await ctx.store.addWatchOrder({ leadId: lead.id, token: newWatchToken(), appUrl: o.appUrl, gameName: gameNameFromUrl(o.appUrl) })
    .catch(() => null);
  await ctx.store.logActivity({
    at: new Date().toISOString(), agent: "sales", action: `playtest ordered by ${o.team}`, why: o.appUrl, result: `lead ${lead.id}`, costUsd: null, human: false,
  });

  const price = ctx.config.PLAYTEST_PRICE_USD;
  if (price && ctx.stripe) {
    const link = await createPaymentLink(ctx.stripe, {
      product: "playtest",
      name: "Phone playtest: your app on a real iPhone, with a report",
      amountMinor: Math.round(price * 100),
      leadId: lead.id,
      // After paying, the buyer lands on their order's watch page (it shows "in line" until it starts).
      successUrl: watch ? watchUrl(ctx.config.SITE_URL, watch.token) : `${ctx.config.PUBLIC_BASE_URL}/playtest?paid=1`,
      extraMetadata: { app_url: o.appUrl, focus: (o.focus ?? "").slice(0, 400), ...(watch ? { order_id: watch.id } : {}) },
    });
    await ctx.store.setStage(lead.id, "pilot_offered");
    return { ok: true, lead, payUrl: link.url };
  }
  step(lead.id, "In the queue for the iPhone");
  void enqueue(() => runPlaytestOrder(ctx, lead, o.appUrl, o.focus ?? null, null, watch?.id ?? null)).catch(async (err) => {
    finish(lead.id, "Something went wrong. A person will follow up", false);
    await ctx.store.logActivity({
      at: new Date().toISOString(), agent: "playtest-lead", action: `playtest order needs a person: ${lead.company}`,
      why: err instanceof Error ? err.message.slice(0, 200) : "unknown error", result: "left for a person", costUsd: null, human: false,
    }).catch(() => undefined);
  });
  return { ok: true, lead, payUrl: null };
}

export function composeReport(args: {
  name: string | null;
  team: string;
  appUrl: string;
  outcome: PlaytestOutcome | null;
  error: string | null;
  companyName: string;
  postalAddress: string;
  siteUrl?: string;
  /** A reason written for the customer (for example, "That link is for Android…"). Never an internal error. */
  reason?: string | null;
  /** How the order was paid for: a real payment, a test payment (no money moved), or free. */
  paid?: "live" | "test" | "free";
}): { subject: string; body: string; html: string } {
  const r = args.outcome?.results?.results?.[0];
  const hi = args.name ? `Hi ${args.name.split(" ")[0]},` : `Hi ${args.team},`;
  const failure = [
    args.error ? "Our phone couldn't finish this playtest, so there's no report yet." : "The playtest ran, but the phone didn't return a readable report, so there's no report yet.",
    ...(args.reason ? [args.reason] : []),
    args.paid === "live"
      ? "A person on our team has been told and will either run it again or refund you."
      : "A person on our team has been told and will write back.",
  ].join(" ");
  const testNote = args.paid === "test" ? "This was a test order, so no money was charged." : null;
  const findings: string[] = [];
  if (!r) {
    findings.push(failure);
  } else {
    findings.push(`• Loaded on iPhone: ${r.loaded ? "yes" : "no"}`);
    findings.push(`• Taps and swipes worked: ${r.touchOk ? "yes" : "no"}`);
    findings.push(`• Visual problems: ${r.visualIssues.length ? r.visualIssues.join("; ") : "none seen"}`);
    if (r.stuckReason) findings.push(`• Where it got stuck: ${r.stuckReason}`);
    if (r.notes) findings.push(`• Notes: ${r.notes}`);
  }
  const body = [
    hi,
    "",
    r ? `We played ${args.appUrl} on a real iPhone. Here's what we found:` : `We tried to play ${args.appUrl} on a real iPhone.`,
    "",
    ...findings,
    "",
    ...(r ? ["Reply with anything you'd like us to check next, like a specific flow or screen, and we'll run it again.", ""] : []),
    ...(testNote ? [testNote, ""] : []),
    args.companyName,
    "",
    "—",
    `${args.companyName} is a small studio where AI agents play, design, and test games, and this report was written by one of them. You're getting it because you ordered a playtest.`,
    args.postalAddress,
    `Reply "stop" and we won't email you again.`,
  ].join("\n");
  const site = args.siteUrl ?? "https://levelai.vercel.app";
  const first = args.name ? args.name.split(" ")[0]! : args.team;
  const html = E.layout({
    preheader: r ? `Loaded: ${r.loaded ? "yes" : "no"} · Touch: ${r.touchOk ? "works" : "problems"} · Visual issues: ${r.visualIssues.length || "none"}` : "Our phone couldn't finish this playtest.",
    companyName: args.companyName,
    postalAddress: args.postalAddress,
    footerReason: "You're getting it because you ordered a playtest.",
    body: [
      r ? E.eyebrow("iPhone playtest report", E.C.green) : E.eyebrow("Playtest update", E.C.red),
      E.heading(r ? `Here's how your app did, ${first}` : `We couldn't finish this one, ${first}`),
      E.text(r ? `We played ${args.appUrl} on a real iPhone, like a first-time user.` : `We tried to play ${args.appUrl} on a real iPhone.`, { color: E.C.muted }),
      r
        ? E.panel(E.rows([
            E.checkRow("Loaded on iPhone", r.loaded ? "Yes" : "No", r.loaded ? "pass" : "fail"),
            E.checkRow("Taps and swipes", r.touchOk ? "Worked" : "Problems", r.touchOk ? "pass" : "fail"),
            E.checkRow("Visual problems", r.visualIssues.length ? `${r.visualIssues.length} found` : "None seen", r.visualIssues.length ? "fail" : "pass"),
            ...(r.stuckReason ? [E.checkRow("Got stuck", "Yes", "fail")] : []),
          ].join("")))
        : E.panel(E.text(failure)),
      ...(r && r.visualIssues.length ? [E.text("What looked wrong", { weight: 800 }), ...r.visualIssues.map((v) => E.quote(v))] : []),
      ...(r?.stuckReason ? [E.text("Where it got stuck", { weight: 800 }), E.quote(r.stuckReason)] : []),
      ...(r?.notes ? [E.text("Notes from the playtest", { weight: 800 }), E.text(r.notes, { color: E.C.muted })] : []),
      ...(r ? [E.text("Reply with anything you'd like us to check next, like a specific flow or screen, and we'll run it again.")] : []),
      ...(testNote ? [E.text(testNote, { color: E.C.muted })] : []),
      E.button("Order another playtest", `${site}/playtest`),
    ].join(""),
  });
  const subject = r ? `Your iPhone playtest report: ${args.team}` : `Your iPhone playtest: an update for ${args.team}`;
  return { subject: args.paid === "test" ? `[Test order] ${subject}` : subject, body, html };
}

/** Links our iPhone can't play, with the reason the customer sees. */
export function unplayableReason(appUrl: string): string | null {
  try {
    const host = new URL(appUrl).hostname;
    if (/(^|\.)play\.google\.com$/.test(host)) return "That link is to Google Play, and our test phone is an iPhone. Send an App Store link or a web link instead.";
  } catch {
    return "That link doesn't open.";
  }
  return null;
}

/** The watch order being run, and how it ends up. */
interface WatchRun { order: WatchOrder | null; state: Exclude<WatchState, "queued" | "testing">; summary: WatchSummary | null }

export async function runPlaytestOrder(
  ctx: ToolContext,
  lead: Lead,
  appUrl: string,
  focus: string | null,
  /** Set when a payment started this order: the payments row it delivers, and whether it was test money. */
  payment: { id: string; livemode: boolean } | null = null,
  /** The order's watch record (`order_id` in the payment metadata), when it has one. */
  orderId: string | null = null,
): Promise<void> {
  const found = orderId ? await ctx.store.getWatchOrder(orderId).catch(() => null) : null;
  const run: WatchRun = { order: found && found.leadId === lead.id ? found : null, state: "failed", summary: null };
  try {
    await playAndReport(ctx, lead, appUrl, focus, payment, run);
  } finally {
    if (run.order) {
      await phoneDone(run.order.id);
      await ctx.store.updateWatchOrder(run.order.id, { state: run.state, finishedAt: new Date().toISOString(), summary: run.summary }).catch(() => null);
    }
  }
}

/** Tells a paying customer their playtest is starting, with the live watch link. Never stops the playtest. */
async function sendWatchEmail(ctx: ToolContext, lead: Lead, order: WatchOrder, test: boolean, label: string): Promise<void> {
  const log = (action: string, why: string | null, result: string | null) =>
    ctx.store.logActivity({ at: new Date().toISOString(), agent: "playtest-lead", action, why, result, costUsd: null, human: false });
  if (!lead.email || !ctx.mail || (await ctx.store.isSuppressed(lead.email))) return;
  const { subject, body, html } = composeWatchEmail({
    name: lead.contactName, team: lead.company, gameName: order.gameName, watchUrl: watchUrl(ctx.config.SITE_URL, order.token), test,
    companyName: ctx.config.COMPANY_NAME, postalAddress: ctx.config.COMPANY_POSTAL_ADDRESS ?? "",
  });
  // A refused send is logged and kept for a retry (billing/outbox.ts); the playtest never waits on it.
  const sent = await sendCustomerEmail(ctx, {
    kind: "playtest-watch", leadId: lead.id, company: lead.company, to: lead.email, subject, text: body, html,
    idempotencyKey: idempotencyKey("playtest-watch", lead.id, order.id), test,
  });
  if (!sent.sent) return;
  await ctx.store.addOutreach({ leadId: lead.id, to: lead.email, subject, body, status: "sent", blockedReason: null, providerMessageId: sent.messageId });
  await log(`emailed the live watch link to ${lead.company}`, null, `message ${sent.messageId}${label}`);
}

async function playAndReport(
  ctx: ToolContext,
  lead: Lead,
  appUrl: string,
  focus: string | null,
  payment: { id: string; livemode: boolean } | null,
  run: WatchRun,
): Promise<void> {
  const label = payment && !payment.livemode ? " (test order)" : "";
  const log = (action: string, why: string | null, result: string | null) =>
    ctx.store.logActivity({ at: new Date().toISOString(), agent: "playtest-lead", action, why, result, costUsd: null, human: false });
  let outcome: PlaytestOutcome | null = null;
  let error: string | null = null;
  let reason: string | null = unplayableReason(appUrl);
  const deviceId = ctx.config.MOBILERUN_DEVICE_ID;
  if (reason) {
    error = reason;
    await log(`playtest skipped for ${lead.company}`, reason, `not playable on our iPhone${label}`);
  } else if (!ctx.mobilerun || !deviceId) {
    error = "phone not configured";
    await log(`playtest skipped for ${lead.company}`, "the phone isn't configured on this server", `no phone${label}`);
  } else {
    const watch = run.order;
    try {
      if (watch) {
        const test = payment ? !payment.livemode : false;
        run.order = (await ctx.store.updateWatchOrder(watch.id, { state: "testing", startedAt: new Date().toISOString(), test }).catch(() => null)) ?? watch;
        phoneStart(watch, ctx.mobilerun, deviceId);
        if (payment) await sendWatchEmail(ctx, lead, run.order, test, label);
      }
      // An App Store link means a real iOS app: install it from the App Store first, then open it.
      // It may land on the App Store phone instead of the main one; the playtest runs wherever it is.
      const storeId = appIdFromStoreUrl(appUrl);
      let app: { platform: "ios"; package: string; label?: string } = { platform: "ios", package: "safari" };
      let open = appUrl;
      let playOn = deviceId;
      if (storeId?.startsWith("ios:")) {
        step(lead.id, "Installing your app from the App Store");
        await log(`installing ${lead.company}'s app from the App Store`, appUrl, label.trim() || null);
        const client = ctx.mobilerun;
        try {
          const installed = await installFromAppStore({
            client, deviceId, appStoreId: storeId.slice(4),
            appStoreDeviceId: ctx.config.MOBILERUN_APPSTORE_DEVICE_ID ?? null,
            model: ctx.config.MOBILERUN_MODEL,
            // The live watch view follows the install to the App Store phone.
            onAppStorePhone: (id) => { if (watch) phoneStart(watch, client, id); },
          });
          playOn = installed.deviceId;
          if (watch) phoneStart(watch, client, playOn);
          // The action wording is matched by the watch page (leads/watch.ts), so the phone detail goes in the result.
          await log(`installed ${installed.label} on the iPhone`, appUrl, `${installed.packageName}${installed.via === "app_store" ? " (downloaded in the App Store app on the App Store iPhone)" : ""}`);
          app = { platform: "ios", package: installed.packageName, label: installed.label };
          if (watch) await ctx.store.updateWatchOrder(watch.id, { gameName: installed.label.slice(0, 80) }).catch(() => null);
          open = `the "${installed.label}" app icon on the home screen`;
        } catch (err) {
          // The install step's messages are written for the customer ("couldn't find that app…").
          reason = err instanceof Error ? err.message.slice(0, 200) : null;
          throw err;
        }
      }
      await log(`playtesting ${lead.company}'s app on the iPhone`, appUrl, label.trim() || null);
      step(lead.id, "Playing your app on the iPhone");
      outcome = await runPlan({
        client: ctx.mobilerun,
        deviceId: playOn,
        model: ctx.config.MOBILERUN_MODEL,
        plan: {
          planId: `order-${lead.id.slice(0, 8)}`,
          app,
          goal: `Try this app like a first-time user${focus ? `, paying attention to: ${focus}` : ""}. Explore its main screens (and play a level if it's a game), and report what works and what breaks.`,
          steps: [{ level: "app", open, attempts: 1 }],
          limits: { maxMinutes: 8 },
        },
      });
      await log(`playtested ${lead.company}'s app`, appUrl, `${outcome.status}${outcome.results ? "" : " (no report)"}${label}`);
    } catch (err) {
      error = err instanceof Error ? err.message.slice(0, 200) : "unknown error";
      await log(`playtest failed for ${lead.company}`, error, label.trim() || null);
    } finally {
      // The live view ends with the phone's part; its last screen stays as the final frame.
      if (watch) await phoneDone(watch.id);
    }
  }

  const first = outcome?.results?.results?.[0];
  const delivered = first != null;
  if (first) {
    run.summary = { loaded: first.loaded, touchOk: first.touchOk, visualIssues: first.visualIssues, stuckReason: first.stuckReason ?? null, notes: first.notes || null };
  }
  const settle = async (status: "delivered" | "failed", detail: string) => {
    if (payment) await ctx.store.addDelivery({ paymentId: payment.id, leadId: lead.id, status, detail });
    if (status === "failed") {
      await log(`playtest order needs a person: ${lead.company}`, detail, `left for a person${label}`);
    }
  };

  if (!lead.email || !ctx.mail) {
    await settle("failed", delivered ? "report ready, but there's no email address or mail sender to send it" : "no report and no way to email the customer");
    finish(lead.id, "Playtest finished", delivered);
    return;
  }
  if (await ctx.store.isSuppressed(lead.email)) {
    await settle(delivered ? "delivered" : "failed", "customer opted out of email, so nothing was sent");
    finish(lead.id, "Playtest finished", delivered);
    return;
  }
  step(lead.id, "Writing your report");
  const { subject, body, html } = composeReport({
    name: lead.contactName, team: lead.company, appUrl, outcome, error, reason,
    paid: payment ? (payment.livemode ? "live" : "test") : "free",
    companyName: ctx.config.COMPANY_NAME, postalAddress: ctx.config.COMPANY_POSTAL_ADDRESS ?? "", siteUrl: ctx.config.SITE_URL,
  });
  // Keyed to the payment (or the phone task), so a retried job never sends twice but a new order does.
  const key = idempotencyKey("playtest-report", lead.id, appUrl, payment?.id ?? outcome?.taskId ?? new Date().toISOString().slice(0, 16));
  const sent = await sendCustomerEmail(ctx, {
    kind: "playtest-report", leadId: lead.id, company: lead.company, to: lead.email, subject, text: body, html, idempotencyKey: key,
    test: Boolean(payment && !payment.livemode),
  });
  if (!sent.sent) {
    // The send is logged and kept for a retry (billing/outbox.ts). A finished playtest is still
    // delivered: the results are on the customer's watch page, where they land after paying.
    if (delivered) {
      run.state = "finished";
      await ctx.store.setStage(lead.id, "delivered");
      await settle("delivered", run.order ? "results on the customer's watch page; the report email is kept to retry" : "report ready; the email is kept to retry");
      finish(lead.id, "Playtest finished. Your report is below, and we'll email it too", true);
    } else {
      await settle("failed", "no report, and the status email is kept to retry");
      finish(lead.id, "Something went wrong. A person will follow up", false);
    }
    return;
  }
  const messageId = sent.messageId;
  await ctx.store.addOutreach({ leadId: lead.id, to: lead.email, subject, body, status: "sent", blockedReason: null, providerMessageId: messageId });
  if (delivered) {
    run.state = "finished";
    await ctx.store.setStage(lead.id, "delivered");
    await log(`emailed the playtest report to ${lead.company}`, null, `message ${messageId}${label}`);
    await settle("delivered", `report emailed, message ${messageId}`);
  } else {
    await log(`emailed a playtest status update to ${lead.company}`, error ?? "no readable report", `message ${messageId}${label}`);
    await settle("failed", `no report; status email sent, message ${messageId}`);
  }
  finish(lead.id, delivered ? "Report sent. Check your inbox" : "We emailed you an update; the phone couldn't finish this time", delivered);
}

/**
 * After a restart: paid orders from the last day that never finished go back in the queue. A run that
 * was cut off mid-test starts over; the customer's watch page picks it up again.
 */
export async function resumePaidOrders(ctx: ToolContext): Promise<number> {
  const orders = await ctx.store.listUnfinishedPaidOrders().catch(() => []);
  for (const o of orders) {
    const lead = await ctx.store.getLead(o.leadId);
    if (!o.paymentId) continue;
    if (!lead) {
      await ctx.store.logActivity({
        at: new Date().toISOString(), agent: "billing", action: "paid playtest can't resume after a restart",
        why: `order ${o.id}: its customer record is missing`, result: `left for a person${o.test ? " (test mode)" : ""}`, costUsd: null, human: false,
      }).catch(() => undefined);
      continue;
    }
    // At most 2 resumes per order: restarts by other processes shouldn't re-run a playtest forever
    // (seen Nov 7: one order ran 5 times). After that it goes to a person.
    const resumes = (await ctx.store.listActivity(2000).catch(() => []))
      .filter((a) => a.action.startsWith("resumed a paid playtest") && (a.result ?? "").includes(o.id)).length;
    if (resumes >= 2) {
      if (resumes === 2) {
        await ctx.store.logActivity({
          at: new Date().toISOString(), agent: "billing", action: `resumed a paid playtest after a restart: ${lead.company} (stopped retrying)`,
          why: "it was already resumed twice and still didn't finish", result: `order ${o.id}: left for a person${o.test ? " (test mode)" : ""}`, costUsd: null, human: false,
        }).catch(() => undefined);
      }
      continue;
    }
    await ctx.store.logActivity({
      at: new Date().toISOString(), agent: "billing", action: `resumed a paid playtest after a restart: ${lead.company}`,
      why: "the server restarted before this order finished", result: `order ${o.id}${o.test ? " (test mode)" : ""}`, costUsd: null, human: false,
    });
    void enqueue(() => runPlaytestOrder(ctx, lead, o.appUrl, o.focus ?? null, { id: o.paymentId!, livemode: !o.test }, o.id)).catch((err) =>
      ctx.store.logActivity({
        at: new Date().toISOString(), agent: "playtest-lead", action: `playtest order needs a person: ${lead.company}`,
        why: err instanceof Error ? err.message.slice(0, 200) : "unknown error", result: `left for a person${o.test ? " (test order)" : ""}`, costUsd: null, human: false,
      }).catch(() => undefined),
    );
  }
  return orders.length;
}
