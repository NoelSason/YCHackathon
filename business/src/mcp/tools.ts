import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import type Mobilerun from "@mobilerun/sdk";
import type { Config } from "../config.js";
import type { Query, Store } from "../store.js";
import type { PackMaker } from "../levels/pack-types.js";
import type { Lead, PipelineStage, Target } from "../types.js";
import type { MonidRunner } from "../research/monid.js";
import { buildTarget, findTargets } from "../research/targets.js";
import { fetchRecentReviews } from "../research/monid.js";
import { composeOutreach, type OutreachDraft } from "../outreach/compose.js";
import { checkOutreach, checkReply } from "../outreach/guard.js";
import { idempotencyKey, sendOutreach, type MailSender } from "../outreach/send.js";
import { createPaymentLink } from "../billing/stripe.js";
import { readMonid, summarize, type SpendSource } from "../finance/snapshot.js";
import { runPlan } from "../mobile/playtest.js";
import type { PlanInput } from "../mobile/plan.js";
import { syncLeadToCrm, type NaiveClient } from "../naive.js";

/**
 * The business tools the Naïve agents call, as plain functions. `server.ts` exposes them over MCP.
 * Each tool logs what it did, and anything that sends or charges goes through a guard first.
 */
export interface ToolContext {
  config: Config;
  store: Store;
  monid: MonidRunner | null;
  mail: MailSender | null;
  stripe: Stripe | null;
  mobilerun: Mobilerun | null;
  naive: NaiveClient | null;
  /** The platform database for levels and packs (level pack delivery). Absent in most tests. */
  db?: Query | null;
  /** Makes a pack's levels. Defaults to a worker thread running levels/pack-maker.ts. */
  packMaker?: PackMaker;
}

const targetsByApp = new Map<string, Target>();

/** Lets other flows (like a live signup) hand research to the outreach tools. */
export function rememberTarget(t: Target): void {
  targetsByApp.set(t.appId, t);
}
const drafts = new Map<string, { leadId: string; draft: OutreachDraft; extraAllowed: string[] }>();

const usd = (n: number): string => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

async function crm(ctx: ToolContext, lead: Lead, note: string): Promise<void> {
  if (!ctx.naive) return;
  const id = await syncLeadToCrm(ctx.naive, lead, note);
  if (!lead.crmContactId) await ctx.store.upsertLead({ ...lead, crmContactId: id });
}

export async function toolFindTargets(ctx: ToolContext, args: { maxGames?: number }): Promise<Target[]> {
  if (!ctx.monid) throw new Error("Monid isn't configured.");
  const targets = await findTargets(ctx.monid, { maxGames: Math.min(args.maxGames ?? 5, 15) });
  for (const t of targets) targetsByApp.set(t.appId, t);
  await ctx.store.logActivity({
    at: new Date().toISOString(), agent: "research", action: `found ${targets.length} targets`,
    why: "scanned top free puzzle games on Google Play and their newest reviews",
    result: targets.slice(0, 3).map((t) => t.appTitle).join(", ") || "none", costUsd: null, human: false,
  });
  return targets;
}

/** Research one specific game (not from the chart): read its newest reviews and keep the result for outreach. */
export async function toolAuditGame(ctx: ToolContext, args: { appId: string; title: string; developer: string }): Promise<Target> {
  if (!ctx.monid) throw new Error("Monid isn't configured.");
  const reviews = await fetchRecentReviews(ctx.monid, args.appId);
  const target = buildTarget({ appId: args.appId, title: args.title, developer: args.developer, rating: null, downloads: null }, reviews);
  targetsByApp.set(target.appId, target);
  await ctx.store.logActivity({
    at: new Date().toISOString(), agent: "research", action: `audited ${args.title}`,
    why: target.reason, result: target.primarySignal ? `pitch angle: ${target.primarySignal}` : "no difficulty complaints", costUsd: null, human: false,
  });
  return target;
}

export async function toolSaveLead(
  ctx: ToolContext,
  args: { appId: string; company: string; email?: string; contactName?: string },
): Promise<Lead> {
  const target = targetsByApp.get(args.appId);
  const lead = await ctx.store.upsertLead({
    company: args.company,
    appId: args.appId,
    contactName: args.contactName ?? null,
    email: args.email ?? null,
    source: "research",
    stage: "found",
    reason: target?.reason ?? null,
    sampleUrl: null,
    crmContactId: null,
  });
  await crm(ctx, lead, target?.reason ?? "Found by Research.");
  return lead;
}

export async function toolSetSample(ctx: ToolContext, args: { leadId: string; sampleUrl: string }): Promise<Lead> {
  const lead = await ctx.store.getLead(args.leadId);
  if (!lead) throw new Error("No such lead.");
  const updated = await ctx.store.upsertLead({ ...lead, sampleUrl: args.sampleUrl });
  const staged = (await ctx.store.setStage(updated.id, lead.stage === "found" ? "sample_made" : lead.stage)) ?? updated;
  await crm(ctx, staged, `Sample pack ready: ${args.sampleUrl}`);
  return staged;
}

async function pilotOffer(ctx: ToolContext, lead: Lead): Promise<{ levels: number; priceLabel: string; paymentUrl: string | null }> {
  const price = ctx.config.PILOT_PRICE_USD;
  const levels = ctx.config.PILOT_LEVELS;
  if (!price) return { levels, priceLabel: "priced to fit your game", paymentUrl: null };
  const paymentUrl = ctx.stripe
    ? (
        await createPaymentLink(ctx.stripe, {
          product: "pilot_pack",
          name: `Pilot pack: ${levels} tuned levels`,
          amountMinor: Math.round(price * 100),
          leadId: lead.id,
          successUrl: `${ctx.config.SITE_URL.replace(/\/+$/, "")}/pricing?paid=pack`,
        })
      ).url
    : null;
  return { levels, priceLabel: usd(price), paymentUrl };
}

/** Writes the first email and checks it. Returns a draft id; sending takes that id, so the text can't change. */
export async function toolDraftOutreach(
  ctx: ToolContext,
  args: { leadId: string; senderName: string },
): Promise<{ draftId: string; subject: string; body: string; blockedReason: string | null }> {
  const lead = await ctx.store.getLead(args.leadId);
  if (!lead) throw new Error("No such lead.");
  if (!lead.appId) throw new Error("Lead has no app id, so there's no evidence to pitch on.");
  const target = targetsByApp.get(lead.appId);
  if (!target) throw new Error("No research for this app in this session. Run find_targets first.");
  const evidence = target.primarySignal ? target.signalCounts[target.primarySignal] : 0;
  if (lead.source === "research" && evidence < 3) {
    return { draftId: "", subject: "", body: "", blockedReason: `Only ${evidence} review(s) show the problem. Cold outreach needs at least 3.` };
  }

  const pilot = await pilotOffer(ctx, lead);
  const draft = composeOutreach({
    lead,
    target,
    sampleUrl: lead.sampleUrl ?? null,
    pilot,
    sender: { name: args.senderName, company: ctx.config.COMPANY_NAME, postalAddress: ctx.config.COMPANY_POSTAL_ADDRESS ?? "" },
  });
  const extraAllowed = [lead.sampleUrl ?? "", pilot.paymentUrl ?? "", pilot.priceLabel, ctx.config.COMPANY_POSTAL_ADDRESS ?? ""];
  const blockedReason = await checkOutreach(lead, draft, {
    store: ctx.store, dailyCap: ctx.config.OUTREACH_DAILY_CAP, postalAddress: ctx.config.COMPANY_POSTAL_ADDRESS, extraAllowedNumbers: extraAllowed,
  });
  const draftId = randomUUID();
  drafts.set(draftId, { leadId: lead.id, draft, extraAllowed });
  return { draftId, subject: draft.subject, body: draft.body, blockedReason };
}

export async function toolSendOutreach(ctx: ToolContext, args: { draftId: string }): Promise<{ status: string; reason: string | null }> {
  const entry = drafts.get(args.draftId);
  if (!entry) throw new Error("Unknown or expired draft. Draft it again.");
  const lead = await ctx.store.getLead(entry.leadId);
  if (!lead) throw new Error("No such lead.");
  const record = await sendOutreach(lead, entry.draft, {
    store: ctx.store,
    dailyCap: ctx.config.OUTREACH_DAILY_CAP,
    postalAddress: ctx.config.COMPANY_POSTAL_ADDRESS,
    extraAllowedNumbers: entry.extraAllowed,
    sender: ctx.mail,
    sendingEnabled: ctx.config.OUTREACH_SEND === "1",
    agent: "sales-sender",
  });
  drafts.delete(args.draftId);
  if (record.status === "sent") {
    const updated = await ctx.store.getLead(lead.id);
    if (updated) await crm(ctx, updated, `Emailed: ${entry.draft.subject}`);
  }
  return { status: record.status, reason: record.blockedReason };
}

/** The Sales Reader's output: a summary of a reply and the suggested next step. */
export async function toolRecordReply(
  ctx: ToolContext,
  args: { leadId: string; summary: string; intent: "interested" | "question" | "not_now" | "not_interested"; nextStep: string },
): Promise<Lead> {
  const lead = await ctx.store.getLead(args.leadId);
  if (!lead) throw new Error("No such lead.");
  const stage: PipelineStage = args.intent === "not_interested" ? "lost" : args.intent === "interested" ? "pilot_offered" : "replied";
  const updated = (await ctx.store.setStage(lead.id, stage)) ?? lead;
  await crm(ctx, updated, `Reply: ${args.summary} Next: ${args.nextStep}`);
  await ctx.store.logActivity({
    at: new Date().toISOString(), agent: "sales-reader", action: `read reply from ${lead.company}`,
    why: args.summary, result: `${args.intent}; next: ${args.nextStep}`, costUsd: null, human: false,
  });
  return updated;
}

/** The Sales Sender's answer to a studio's reply. Our footer is added, and the reply threads onto their email. */
export async function toolSendReply(
  ctx: ToolContext,
  args: { leadId: string; text: string; includePaymentLink?: boolean },
): Promise<{ status: "sent" | "drafted" | "blocked"; reason: string | null }> {
  const lead = await ctx.store.getLead(args.leadId);
  if (!lead) throw new Error("No such lead.");
  const price = ctx.config.PILOT_PRICE_USD;
  let link: string | null = null;
  if (args.includePaymentLink && ctx.stripe && price) link = (await toolPaymentLink(ctx, { leadId: lead.id, product: "pilot_pack" })).url;
  const allowedNumbers = [
    String(ctx.config.PILOT_LEVELS), price ? usd(price) : "", lead.reason ?? "", lead.sampleUrl ?? "", link ?? "",
    ...offerLinks(ctx),
  ];
  const at = new Date().toISOString();
  const blocked = await checkReply(lead, args.text, { store: ctx.store, allowedNumbers });
  if (blocked) {
    await ctx.store.logActivity({ at, agent: "sales-sender", action: `reply blocked for ${lead.company}`, why: blocked, result: "not sent", costUsd: null, human: false });
    return { status: "blocked", reason: blocked };
  }
  const messageId = await ctx.store.lastInboundMessageId(lead.id);
  if (!messageId) return { status: "blocked", reason: "No inbound message on file to reply to." };
  // One answer per message they sent, whether the auto-answer or an agent wrote it.
  const answering = `answering message ${messageId}`;
  if ((await ctx.store.listActivity(500)).some((a) => /^replied to /.test(a.action) && a.why === answering)) {
    await ctx.store.logActivity({ at, agent: "sales-sender", action: `reply blocked for ${lead.company}`, why: "their latest message was already answered", result: "not sent", costUsd: null, human: false });
    return { status: "blocked", reason: "Their latest message was already answered." };
  }
  const body = [
    args.text.trim(),
    ...(link ? ["", `You can start the pilot here: ${link}`] : []),
    "",
    "—",
    `${ctx.config.COMPANY_NAME} is a small studio where AI agents design and test levels, and this email was written by one of them.`,
    ctx.config.COMPANY_POSTAL_ADDRESS ?? "",
    `Reply "stop" and we won't email you again.`,
  ].join("\n");
  if (!ctx.config.COMPANY_POSTAL_ADDRESS) return { status: "blocked", reason: "COMPANY_POSTAL_ADDRESS isn't set." };
  if (ctx.config.OUTREACH_SEND !== "1" || !ctx.mail) {
    await ctx.store.logActivity({ at, agent: "sales-sender", action: `reply drafted for ${lead.company}`, why: "sending is turned off (OUTREACH_SEND=0)", result: "draft only", costUsd: null, human: false });
    return { status: "drafted", reason: null };
  }
  const sent = await ctx.mail.reply({ messageId, text: body, idempotencyKey: idempotencyKey("reply", lead.id, messageId) });
  await ctx.store.addOutreach({ leadId: lead.id, to: lead.email ?? "", subject: "Re:", body, status: "sent", blockedReason: null, providerMessageId: sent.messageId });
  if (link && lead.stage === "replied") await ctx.store.setStage(lead.id, "pilot_offered");
  await ctx.store.logActivity({ at, agent: "sales-sender", action: `replied to ${lead.company}`, why: answering, result: `message ${sent.messageId}`, costUsd: null, human: false });
  const updated = await ctx.store.getLead(lead.id);
  if (updated) await crm(ctx, updated, `Replied${link ? " with a pilot link" : ""}.`);
  return { status: "sent", reason: null };
}

/**
 * The self-serve offers a reply may point to, with the numbers in them: the free levels to play
 * and the phone playtest order page (which takes the payment at the team's set price).
 */
export function offerLinks(ctx: ToolContext, lead?: Lead): [levelsUrl: string, playtestUrl: string, playtestPrice: string] {
  const site = ctx.config.SITE_URL.replace(/\/+$/, "");
  const levelsUrl = lead?.sampleUrl ?? ctx.config.SAMPLE_PLAY_URL ?? ctx.config.DEMO_PLAY_URL ?? `${site}/play`;
  const price = ctx.config.PLAYTEST_PRICE_USD && ctx.stripe ? usd(ctx.config.PLAYTEST_PRICE_USD) : "";
  return [levelsUrl, `${site}/playtest`, price];
}

export async function toolPaymentLink(
  ctx: ToolContext,
  args: { leadId: string | null; product: "pilot_pack" | "hint_pack" },
): Promise<{ url: string }> {
  if (!ctx.stripe) throw new Error("Stripe isn't configured.");
  const price = args.product === "pilot_pack" ? ctx.config.PILOT_PRICE_USD : ctx.config.HINT_PACK_PRICE_USD;
  if (!price) throw new Error(`No price set for ${args.product}. Prices are a team decision.`);
  const name = args.product === "pilot_pack" ? `Pilot pack: ${ctx.config.PILOT_LEVELS} tuned levels` : "Hint pack";
  const link = await createPaymentLink(ctx.stripe, {
    product: args.product, name, amountMinor: Math.round(price * 100), leadId: args.leadId, successUrl: `${ctx.config.SITE_URL.replace(/\/+$/, "")}/pricing?paid=${args.product === "pilot_pack" ? "pack" : "1"}`,
  });
  await ctx.store.logActivity({
    at: new Date().toISOString(), agent: "billing", action: `payment link created: ${args.product}`,
    why: args.leadId ? `lead ${args.leadId}` : null, result: usd(price), costUsd: null, human: false,
  });
  return { url: link.url };
}

export async function toolFinance(ctx: ToolContext, args: { monidStartingUsd: number; acceptedLevels?: number }) {
  const spend: SpendSource[] = [
    ctx.monid ? await readMonid(args.monidStartingUsd) : { name: "monid", spentUsd: null, balanceUsd: null, note: "not configured" },
    { name: "naive", spentUsd: null, balanceUsd: null, note: "read from the Naïve credit ledger (not wired yet)" },
    { name: "mobilerun", spentUsd: null, balanceUsd: null, note: "read from the Mobilerun dashboard (not wired yet)" },
  ];
  return summarize({ store: await ctx.store.listPayments(), spend, acceptedLevels: args.acceptedLevels ?? null });
}

export async function toolRunPlaytest(ctx: ToolContext, args: { plan: PlanInput; deviceId?: string }) {
  if (!ctx.mobilerun) throw new Error("Mobilerun isn't configured.");
  const deviceId = args.deviceId ?? ctx.config.MOBILERUN_DEVICE_ID;
  if (!deviceId) throw new Error("No device id. Set MOBILERUN_DEVICE_ID or pass deviceId.");
  const outcome = await runPlan({ client: ctx.mobilerun, deviceId, plan: args.plan, model: ctx.config.MOBILERUN_MODEL });
  await ctx.store.logActivity({
    at: new Date().toISOString(), agent: "playtest-lead", action: `phone playtest ${args.plan.planId}`,
    why: args.plan.goal, result: `${outcome.status}; missing: ${outcome.missingLevels.join(", ") || "none"}`, costUsd: null, human: false,
  });
  return outcome;
}

/** The Marketing agent: publish a "for hire" post on Level AI's connected social accounts through Naïve. */
export async function toolPostUpdate(ctx: ToolContext, args: { angle: "levels" | "playtest" | "research" }) {
  // Social accounts live on the team workspace's identity (NAIVE_API_KEY_SOCIAL + NAIVE_SOCIAL_IDENTITY_ID);
  // fall back to the main key's identity if those aren't set.
  const social = ctx.config.NAIVE_API_KEY_SOCIAL && ctx.config.NAIVE_SOCIAL_IDENTITY_ID
    ? { naive: (await import("../naive.js")).naiveClient(ctx.config.NAIVE_API_KEY_SOCIAL, ctx.config.NAIVE_BASE_URL), identityId: ctx.config.NAIVE_SOCIAL_IDENTITY_ID }
    : ctx.naive && ctx.config.NAIVE_IDENTITY_ID ? { naive: ctx.naive, identityId: ctx.config.NAIVE_IDENTITY_ID } : null;
  if (!social) throw new Error("Naïve social isn't set up (NAIVE_API_KEY_SOCIAL and NAIVE_SOCIAL_IDENTITY_ID).");
  const { gatherStats, composePost, publish } = await import("../marketing/posts.js");
  const stats = await gatherStats(ctx.store);
  const playtest = ctx.config.PUBLIC_BASE_URL.startsWith("https://") ? `${ctx.config.PUBLIC_BASE_URL}/playtest` : null;
  const post = composePost(args.angle, stats, { site: ctx.config.SITE_URL, playtest });
  return publish({ naive: social.naive, identityId: social.identityId, store: ctx.store, post, dailyCap: ctx.config.SOCIAL_DAILY_CAP });
}
