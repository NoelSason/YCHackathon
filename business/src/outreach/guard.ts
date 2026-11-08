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

/**
 * Drops the quoted thread from a reply (lines starting with ">", and everything after an
 * "On … wrote:" or "Original Message" line), so only the studio's own words are judged.
 */
export function ownWords(replyText: string): string {
  const lines = replyText.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*On .{3,200}wrote:\s*$/i.test(line) || /^-{2,}\s*(original|forwarded) message/i.test(line) || /^\s*From: .+@.+/i.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

export type ReplyIntent = "interested" | "not_interested" | "auto_reply" | "hostile" | "unclear";

/**
 * Sorts a studio's reply into what the agent may do about it on its own. Deliberately narrow:
 * only short, plainly positive replies count as interested. Anything mixed, long, hostile, or
 * asking a real question is "unclear" or "hostile", and those go to a person. Opt-outs are
 * handled before this runs (`isOptOut`).
 */
export function classifyReply(subject: string, text: string): { intent: ReplyIntent; why: string } {
  const t = ownWords(text).toLowerCase().replace(/\s+/g, " ").trim();
  const s = subject.toLowerCase();
  if (/\b(out of (the )?office|automatic reply|auto-?reply|autoreply|on (vacation|holiday|leave)|away from (my|the) (desk|office)|undeliverable|delivery status notification|mailer-daemon)\b/.test(`${s} ${t}`)) {
    return { intent: "auto_reply", why: "an automatic reply (out of office or a bounce)" };
  }
  if (!t) return { intent: "unclear", why: "no text of their own in the reply" };
  if (/\b(spam|scam|fuck\w*|shit|wtf|stupid|idiot|lawyer|legal action|attorney|report(ed|ing)? (you|this)|how did you get (my|this|our) (email|address)|gdpr|harass\w*|creepy)\b/.test(t)) {
    return { intent: "hostile", why: "the reply is upset or asks how we got the address" };
  }
  if (t.length > 400) return { intent: "unclear", why: "a long reply needs a person to read it" };
  if (/\b(not interested|no thanks|no thank you|not (a )?(good )?fit|not (right )?now|maybe later|we'?re (good|all set|set)|no need|pass on this|we'?ll pass)\b/.test(t)) {
    return { intent: "not_interested", why: "they said no or not now" };
  }
  if (/\b(not sure|unsure|maybe|depends|but|however|although|confused|what is this|who are you)\b/.test(t)) {
    return { intent: "unclear", why: "the reply is mixed or unsure" };
  }
  const shortYes = /^(yes|yep|yeah|sure|ok|okay|sounds good|great)\b[\s\S]{0,40}$/.test(t);
  const interest = /\b(interested|interesting|sounds (good|great|interesting|cool)|tell me more|more (info|information|details)|learn more|send (it|them|me|over|us)|share (more|the|them)|how much|pricing|price|cost|let'?s (try|do it|talk|chat)|happy to (try|chat|talk|take a look)|would love|keen|curious|yes please|i'?d like to (try|see))\b/.test(t);
  if (!shortYes && !interest) return { intent: "unclear", why: "no clear interest in the reply" };
  // A question we can answer from the offer itself (price, details, send it) is fine. Any other question is for a person.
  const questions = t.split(/(?<=\?)/).filter((q) => q.includes("?"));
  const answerable = /how much|price|pricing|cost|more (info|information|details)|tell me more|send|share|can i (try|see)|where (can|do) i/;
  if (questions.some((q) => !answerable.test(q))) return { intent: "unclear", why: "they asked a question the offer doesn't answer" };
  return { intent: "interested", why: "a short, positive reply" };
}
