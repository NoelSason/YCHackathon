import type { Store } from "../store.js";
import type { Lead } from "../types.js";
import { numbersIn, type OutreachDraft } from "./compose.js";

/**
 * Checks an outreach email before it can be sent. Each rule exists for a reason a judge, a studio,
 * or the law would care about. Returns the first reason to block, or null when the email may go.
 */
export interface GuardContext {
  store: Store;
  dailyCap: number;
  /** Separate, higher cap for people who signed up and asked for the email. */
  inboundDailyCap?: number;
  postalAddress: string | undefined;
  /** Numbers allowed outside `draft.facts`, such as those in the price, sample URL, or address. */
  extraAllowedNumbers: string[];
  now?: Date;
}

export async function checkOutreach(lead: Lead, draft: OutreachDraft, ctx: GuardContext): Promise<string | null> {
  if (!lead.email) return "Lead has no email address.";
  if (await ctx.store.isSuppressed(lead.email)) return "This address opted out.";
  if (lead.stage === "opted_out" || lead.stage === "lost") return `Lead is ${lead.stage}.`;
  if (["emailed", "replied", "pilot_offered", "pilot_paid", "delivered"].includes(lead.stage)) {
    return "Lead was already contacted. Replies go through the Sales Reader, not a new first email.";
  }

  // CAN-SPAM: commercial email must include a physical postal address and a way to opt out.
  if (!ctx.postalAddress) return "COMPANY_POSTAL_ADDRESS isn't set, which US email law requires.";
  if (!draft.body.includes(ctx.postalAddress)) return "Email is missing the postal address.";
  if (!/reply "stop"/i.test(draft.body)) return "Email is missing the opt-out line.";

  // Honesty: the body may only state numbers that came from a tool or a team setting.
  const allowed = new Set([...draft.facts.map((f) => f.value), ...ctx.extraAllowedNumbers.flatMap(numbersIn)]);
  const unverified = numbersIn(draft.body).filter((n) => !allowed.has(n));
  if (unverified.length > 0) return `Email states numbers with no source: ${[...new Set(unverified)].join(", ")}.`;

  const since = new Date((ctx.now ?? new Date()).getTime() - 24 * 60 * 60 * 1000).toISOString();
  const inbound = lead.source === "inbound_form";
  const cap = inbound ? (ctx.inboundDailyCap ?? 200) : ctx.dailyCap;
  if ((await ctx.store.countSentSince(since, inbound)) >= cap) {
    return `Daily cap of ${cap} ${inbound ? "signup welcome" : "outreach"} emails reached.`;
  }

  return null;
}

/** Recognizes an opt-out reply. Deliberately broad: when in doubt, stop emailing. */
export function isOptOut(replyText: string): boolean {
  const t = replyText.toLowerCase();
  return /^\s*(stop|unsubscribe|remove me)\b/.test(t) || /\b(unsubscribe|remove me|take me off|do not (contact|email)|don'?t (contact|email))\b/.test(t);
}

/**
 * Checks a reply the Sales Sender wrote. The footer is added for it, so this checks who it's going
 * to and that every number in the agent's own words is one we can stand behind.
 */
export async function checkReply(lead: Lead, agentText: string, ctx: { store: Store; allowedNumbers: string[] }): Promise<string | null> {
  if (!lead.email) return "Lead has no email address.";
  if (await ctx.store.isSuppressed(lead.email)) return "This address opted out.";
  if (lead.stage === "opted_out" || lead.stage === "lost") return `Lead is ${lead.stage}.`;
  if (!["replied", "pilot_offered", "pilot_paid", "delivered"].includes(lead.stage)) return "There's no reply from this studio to answer.";
  if (agentText.trim().length < 20) return "Reply is too short to be useful.";
  if (agentText.length > 2000) return "Reply is too long. Keep it under 2,000 characters.";
  const allowed = new Set(ctx.allowedNumbers.flatMap(numbersIn));
  const unverified = numbersIn(agentText).filter((n) => !allowed.has(n));
  if (unverified.length > 0) return `Reply states numbers with no source: ${[...new Set(unverified)].join(", ")}.`;
  return null;
}
