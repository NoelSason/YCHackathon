import { activeStripeKey } from "../config.js";
import { z } from "zod";
import type { ToolContext } from "../mcp/tools.js";
import { createCheckout, ensurePrice, isLiveKey } from "../billing/stripe.js";
import { sendCustomerEmail } from "../billing/outbox.js";
import { idempotencyKey } from "../outreach/send.js";
import type { Lead, PaymentRecord } from "../types.js";
import * as E from "../email/html.js";
import { PACK_GAME_IDS, type PackGameId } from "../levels/pack-types.js";
import { addPackDelivery, GENRES, packGameFor, packGameOpen, runDueDeliveries, SECOND_HALF_DAYS } from "../levels/deliver-pack.js";
import { MARKET_GAMES } from "../mobile/loop.js";

/**
 * Level orders from the pricing page: the level pack (one-time) and the level subscription
 * (monthly). The buyer fills in our form first, so the webhook knows which game and difficulty
 * the levels are for; then they pay on a hosted checkout page. After payment, the customer gets
 * an honest confirmation and the team gets a "delivery owed" line with a due date. Nothing here
 * says levels exist before a person or agent delivers them.
 */
export const PLANS = ["level_pack", "subscription"] as const;
export type Plan = (typeof PLANS)[number];
export const DIFFICULTIES = ["easy", "medium", "hard"] as const;

/** Hours from payment to delivery that we promise on the site and in the email. */
export const DELIVERY_HOURS = 48;

export const OrderSchema = z.object({
  plan: z.enum(PLANS),
  name: z.string().trim().min(1).max(120),
  email: z.email().max(200),
  company: z.string().trim().min(1).max(160),
  gameUrl: z.url().max(450).refine((u) => /^https?:\/\//i.test(u), "Use a web link (https://…)."),
  difficulty: z.enum(DIFFICULTIES),
  /** Which of our games the levels are made in: the customer's genre. */
  game: z.enum(PACK_GAME_IDS),
  consent: z.literal(true),
});
export type Order = z.infer<typeof OrderSchema>;

/** Our product names, as payments and the webhook know them. */
export const PRODUCT_FOR_PLAN = { level_pack: "pilot_pack", subscription: "subscription" } as const satisfies Record<Plan, PaymentRecord["product"]>;

const usd = (n: number): string => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

export function planDetails(ctx: ToolContext, plan: Plan): { name: string; priceUsd: number; label: string } {
  const c = ctx.config;
  return plan === "level_pack"
    ? { name: `Level pack: ${c.PILOT_LEVELS} levels for your game`, priceUsd: c.PILOT_PRICE_USD, label: `${usd(c.PILOT_PRICE_USD)}` }
    : { name: `Level subscription: ${c.SUBSCRIPTION_LEVELS} new levels a month`, priceUsd: c.SUBSCRIPTION_PRICE_USD, label: `${usd(c.SUBSCRIPTION_PRICE_USD)}/month` };
}

export async function createOrder(ctx: ToolContext, input: unknown): Promise<
  { ok: true; lead: Lead; payUrl: string; sessionId: string } | { ok: false; error: string }
> {
  const parsed = OrderSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please fill in your name, email, company, your game's link (https://…), your game type, and a difficulty, and tick the box." };
  }
  if (!packGameOpen(parsed.data.game)) {
    return { ok: false, error: `${GENRES[parsed.data.game].label[0]!.toUpperCase()}${GENRES[parsed.data.game].label.slice(1)} packs aren't open yet. Pick another game type, or email levelai@agentmail.to.` };
  }
  if (!ctx.stripe) return { ok: false, error: "Checkout is closed right now. Email levelai@agentmail.to and we'll set up your order." };
  const o = parsed.data;
  const plan = planDetails(ctx, o.plan);
  const lead = await ctx.store.upsertLead({
    company: o.company, appId: null, contactName: o.name, email: o.email, source: "inbound_form", stage: "found",
    reason: `Ordered a ${o.plan === "level_pack" ? "level pack" : "level subscription"} for ${o.gameUrl} (${GENRES[o.game].label}, ${o.difficulty}).`,
    sampleUrl: null, crmContactId: null,
  });
  const site = ctx.config.SITE_URL.replace(/\/+$/, "");
  const test = isLiveKey(activeStripeKey(ctx.config)) ? "" : "&test=1";
  const short = o.plan === "level_pack" ? "pack" : "subscription";
  const amountMinor = Math.round(plan.priceUsd * 100);
  const priceId = await ensurePrice(ctx.stripe, {
    lookupKey: o.plan === "level_pack" ? `levelai_level_pack_${amountMinor}` : `levelai_subscription_monthly_${amountMinor}`,
    productName: plan.name,
    amountMinor,
    ...(o.plan === "subscription" ? { interval: "month" as const } : {}),
  });
  const checkout = await createCheckout(ctx.stripe, {
    mode: o.plan === "subscription" ? "subscription" : "payment",
    priceId,
    metadata: { product: PRODUCT_FOR_PLAN[o.plan], lead_id: lead.id, game_url: o.gameUrl, difficulty: o.difficulty, game_id: o.game },
    customerEmail: o.email,
    leadId: lead.id,
    successUrl: `${site}/pricing?paid=${short}${test}`,
    cancelUrl: `${site}/pricing?plan=${short}&cancelled=1#order`,
  });
  await ctx.store.setStage(lead.id, "pilot_offered");
  await ctx.store.logActivity({
    at: new Date().toISOString(), agent: "sales", action: `${o.plan === "level_pack" ? "level pack" : "level subscription"} ordered by ${o.company}`,
    why: `${o.gameUrl} (${GENRES[o.game].label}, ${o.difficulty})`, result: `checkout opened at ${plan.label}${test ? " (test mode)" : ""}`, costUsd: null, human: false,
  });
  return { ok: true, lead, payUrl: checkout.url, sessionId: checkout.id };
}

/** "Sat, Nov 9, 7:30 PM PT": the delivery deadline, in the team's time zone. */
export function formatDue(at: Date): string {
  return `${at.toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} PT`;
}

export function composeOrderEmail(args: {
  plan: Plan;
  name: string | null;
  company: string;
  gameUrl: string | null;
  difficulty: string | null;
  levels: number;
  playtests: number;
  priceLabel: string;
  due: string;
  test: boolean;
  companyName: string;
  postalAddress: string;
  replyTo: string;
  siteUrl: string;
  /** Our game the levels are made in, when this order is delivered automatically. */
  genre?: string | null;
  /** The game our phone studies first, by name. */
  studiedGame?: string | null;
}): { subject: string; body: string; html: string } {
  const first = args.name ? args.name.split(" ")[0]! : args.company;
  const pack = args.plan === "level_pack";
  const what = pack ? `your level pack (${args.priceLabel})` : `your level subscription (${args.priceLabel})`;
  const game = args.gameUrl ?? "your game";
  const target = args.difficulty ? `${args.difficulty} difficulty` : "the difficulty you want";
  const auto = args.genre
    ? [
        `Our iPhone plays ${args.studiedGame ?? game} to see how quickly it gets harder, and we set your pack's difficulty curve from that and your ${target} pick.`,
        `We build ${args.levels} ${args.genre} levels in our own engine, one at a time. Our bots play each one until it lands on its target. We don't put levels inside your game.`,
        `We email you playable previews plus JSON in a documented format (${args.siteUrl}/developers), usually within the hour and no later than ${args.due}.`,
      ]
    : null;
  const steps = pack && auto
    ? auto
    : pack
    ? [
        `We design ${args.levels} new levels for ${game} in its style.`,
        `Bot players play each level many times, and we tune it until it lands on ${target}.`,
        `We email you the levels by ${args.due}.`,
      ]
    : [
        auto
          ? `We start on this month's ${args.levels} ${args.genre} levels, in our own engine and calibrated to how ${args.studiedGame ?? game} plays on our iPhone. The first ${Math.ceil(args.levels / 2)} reach you within the hour (no later than ${args.due}), the rest two weeks later.`
          : `We start on this month's ${args.levels} levels for ${game}, each tested by bot players and tuned to ${target}. The first ones reach you by ${args.due}.`,
        `Your plan includes ${args.playtests} iPhone playtests a month. Order them at ${args.siteUrl}/playtest with this email address.`,
        `Get your developer key at ${args.siteUrl}/developers to pull your levels into your tools or connect your coding agent.`,
        "You can cancel anytime. Reply to this email and we'll stop the next charge.",
      ];
  const missing = !args.gameUrl || !args.difficulty
    ? `We don't have ${!args.gameUrl ? "a link to your game" : "your target difficulty"} yet. Reply with it so we can start.`
    : null;
  const testNote = args.test ? "This was a test order, so no money was charged." : null;
  const footerReason = pack ? "You're getting it because you ordered a level pack." : "You're getting it because you subscribed to levels.";
  const body = [
    `Hi ${first},`,
    "",
    `Thanks for ordering ${what}. Here's what happens next:`,
    "",
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    ...(missing ? [missing, ""] : []),
    `Questions, or something to change? Reply to this email or write to ${args.replyTo}.`,
    "",
    ...(testNote ? [testNote, ""] : []),
    args.companyName,
    "",
    "—",
    `${args.companyName} is a small studio where AI agents design and test levels, and this email was written by one of them. ${footerReason}`,
    args.postalAddress,
  ].join("\n");
  const html = E.layout({
    preheader: pack ? `Your ${args.levels} levels arrive by ${args.due}.` : `Your first levels arrive by ${args.due}.`,
    companyName: args.companyName,
    postalAddress: args.postalAddress,
    footerReason,
    body: [
      E.eyebrow(args.test ? "Order confirmed · test order" : "Order confirmed", E.C.green),
      E.heading(pack ? `Your level pack is in the works, ${first}` : `Your subscription has started, ${first}`),
      E.text(`Thanks for ordering ${what}. Here's what happens next.`, { color: E.C.muted }),
      E.panel(E.rows([
        E.checkRow("Game", args.gameUrl ?? "Reply with a link", args.gameUrl ? "info" : "fail"),
        E.checkRow("Difficulty", args.difficulty ? args.difficulty[0]!.toUpperCase() + args.difficulty.slice(1) : "Reply with a target", args.difficulty ? "info" : "fail"),
        E.checkRow(pack ? "Levels" : "Levels each month", String(args.levels), "info"),
        E.checkRow(pack ? "Delivered by" : "First levels by", args.due, "info"),
        ...(pack ? [] : [E.checkRow("iPhone playtests each month", String(args.playtests), "info")]),
      ].join(""))),
      ...steps.map((s, i) => E.text(`${i + 1}. ${s}`)),
      ...(missing ? [E.text(missing, { weight: 800 })] : []),
      E.text(`Questions, or something to change? Reply to this email or write to ${args.replyTo}.`, { color: E.C.muted }),
      ...(testNote ? [E.text(testNote, { color: E.C.muted })] : []),
      ...(pack ? [] : [E.button("Get your developer key", `${args.siteUrl}/developers`)]),
    ].join(""),
  });
  const subject = pack ? `Your level pack order: ${args.company}` : `Your level subscription: ${args.company}`;
  return { subject: args.test ? `[Test order] ${subject}` : subject, body, html };
}

/** The phone-study target for a game link: a known App Store app (by store page) or the link itself. */
export function studiedGameFor(gameUrl: string | null, company: string): { name: string; bundleId: string | null } {
  const known = gameUrl ? MARKET_GAMES.find((g) => g.url === gameUrl || (g.bundleId && gameUrl.includes(g.url.replace(/^https?:\/\//, "")))) : undefined;
  return known ? { name: known.name, bundleId: known.bundleId ?? null } : { name: `${company}'s game`, bundleId: null };
}

/**
 * Queues the level pack (or a subscription month: two halves, two weeks apart) for automatic
 * delivery. False when it can't be automated (no database, or no game type on the order).
 */
export async function queueLevelDelivery(ctx: ToolContext, args: {
  plan: Plan; paymentId: string | null; leadId: string | null; company: string; gameId: PackGameId | null; difficulty: string | null;
  gameUrl: string | null; test: boolean; demo?: boolean; studiedGame?: string | null; bundleId?: string | null; paidAt?: Date;
}): Promise<boolean> {
  if (!ctx.db || !args.gameId || !packGameOpen(args.gameId)) return false;
  const difficulty = (DIFFICULTIES as readonly string[]).includes(args.difficulty ?? "") ? (args.difficulty as (typeof DIFFICULTIES)[number]) : "medium";
  const study = args.studiedGame ? { name: args.studiedGame, bundleId: args.bundleId ?? null } : studiedGameFor(args.gameUrl, args.company);
  const paidAt = args.paidAt ?? new Date();
  const parts = args.plan === "level_pack"
    ? [{ part: 1, levels: ctx.config.PILOT_LEVELS, dueAt: paidAt }]
    : [
        { part: 1, levels: Math.ceil(ctx.config.SUBSCRIPTION_LEVELS / 2), dueAt: paidAt },
        { part: 2, levels: Math.floor(ctx.config.SUBSCRIPTION_LEVELS / 2), dueAt: new Date(paidAt.getTime() + SECOND_HALF_DAYS * 86_400_000) },
      ];
  for (const p of parts) {
    await addPackDelivery(ctx.db, {
      paymentId: args.paymentId, part: p.part, leadId: args.leadId, plan: args.plan, gameId: args.gameId, difficulty, levelsOwed: p.levels,
      studiedGame: study.name, gameUrl: args.gameUrl, bundleId: study.bundleId, test: args.test, demo: args.demo ?? false, dueAt: p.dueAt,
    });
  }
  const mode = args.test ? " (test order)" : "";
  await ctx.store.logActivity({
    at: new Date().toISOString(), agent: "billing",
    action: `level pack queued for ${args.company}: ${parts[0]!.levels} ${GENRES[args.gameId].label} levels (${difficulty})`,
    why: args.plan === "subscription" ? `subscription month: ${parts[0]!.levels} now, ${parts[1]!.levels} in ${SECOND_HALF_DAYS} days` : `level pack; phone study of ${study.name} first`,
    result: `delivered automatically${mode}`, costUsd: null, human: false,
  });
  void runDueDeliveries(ctx).catch(() => undefined);
  return true;
}

/**
 * After a paid level pack or a new subscription: queues the levels for automatic delivery (the
 * phone studies their game, the bots build and measure the pack, and it's emailed), then emails the
 * customer a confirmation (once per payment). An order we can't automate (no game type, e.g. an
 * outreach payment link) is logged as owed for the team.
 */
export async function afterOrderPaid(
  ctx: ToolContext,
  payment: PaymentRecord,
  metadata: Record<string, string>,
  customerEmail: string | null,
): Promise<void> {
  const label = payment.livemode ? "" : " (test mode)";
  const log = (action: string, why: string | null, result: string | null) =>
    ctx.store.logActivity({ at: new Date().toISOString(), agent: "billing", action, why, result, costUsd: null, human: false });
  const plan: Plan = payment.product === "subscription" ? "subscription" : "level_pack";
  const lead = payment.leadId ? await ctx.store.getLead(payment.leadId) : null;
  const company = lead?.company ?? customerEmail ?? "an unknown buyer";
  const due = formatDue(new Date(Date.parse(payment.createdAt) + DELIVERY_HOURS * 3600_000));
  const gameUrl = metadata.game_url || null;
  const difficulty = metadata.difficulty || null;
  const details = [gameUrl ?? "no game link", difficulty ?? "no difficulty"].join(", ");
  const gameId = packGameFor(metadata.game_id);
  const automated = await queueLevelDelivery(ctx, {
    plan, paymentId: payment.id, leadId: payment.leadId, company, gameId, difficulty, gameUrl, test: !payment.livemode,
    paidAt: new Date(Date.parse(payment.createdAt) || Date.now()),
  }).catch(async (err: unknown) => {
    await log(`couldn't queue the level pack for ${company}`, err instanceof Error ? err.message.slice(0, 200) : "unknown error", `left for the team${label}`);
    return false;
  });
  if (automated) {
    // Queued: the delivery worker logs each step from here.
  } else if (plan === "level_pack") {
    await log(`delivery owed: level pack for ${company} (due ${due})`, `${ctx.config.PILOT_LEVELS} levels; ${details}`, `left for the team${label}`);
  } else {
    await log(`delivery owed: level subscription for ${company} (first levels due ${due})`, `${ctx.config.SUBSCRIPTION_LEVELS} levels a month and ${ctx.config.SUBSCRIPTION_PLAYTESTS} playtests; ${details}`, `left for the team${label}`);
  }

  const to = lead?.email ?? customerEmail;
  if (!to || !ctx.mail) {
    await log(`order confirmation not sent: ${company}`, !to ? "no email address on the order" : "no mail sender on this server", `left for a person${label}`);
    return;
  }
  if (await ctx.store.isSuppressed(to)) {
    await log(`order confirmation not sent: ${company}`, "the customer opted out of email", `nothing sent${label}`);
    return;
  }
  const { subject, body, html } = composeOrderEmail({
    plan, name: lead?.contactName ?? null, company: lead?.company ?? "your studio", gameUrl, difficulty,
    levels: plan === "level_pack" ? ctx.config.PILOT_LEVELS : ctx.config.SUBSCRIPTION_LEVELS,
    playtests: ctx.config.SUBSCRIPTION_PLAYTESTS, priceLabel: planDetails(ctx, plan).label, due, test: !payment.livemode,
    companyName: ctx.config.COMPANY_NAME, postalAddress: ctx.config.COMPANY_POSTAL_ADDRESS ?? "",
    replyTo: ctx.config.AGENTMAIL_INBOX_ID ?? "levelai@agentmail.to", siteUrl: ctx.config.SITE_URL.replace(/\/+$/, ""),
    genre: automated && gameId ? GENRES[gameId].label : null, studiedGame: automated ? studiedGameFor(gameUrl, company).name : null,
  });
  // A refused send is logged and kept for a retry (billing/outbox.ts); the order goes ahead either way.
  const sent = await sendCustomerEmail(ctx, {
    kind: "order-confirmation", leadId: lead?.id ?? null, company, to, subject, text: body, html,
    idempotencyKey: idempotencyKey("order-confirmation", payment.id), test: !payment.livemode,
  });
  if (!sent.sent) return;
  if (lead) await ctx.store.addOutreach({ leadId: lead.id, to, subject, body, status: "sent", blockedReason: null, providerMessageId: sent.messageId });
  await log(`emailed the order confirmation to ${company}`, plan === "level_pack" ? "level pack" : "level subscription", `message ${sent.messageId}${label}`);
}
