import type { ToolContext } from "../mcp/tools.js";
import type { PolledMessage } from "../outreach/poll.js";
import { addressOf } from "../outreach/inbound.js";
import { classifyReply, ownWords } from "../outreach/guard.js";
import { isTeamEmail } from "../store.js";
import { parseAuditRequest } from "../leads/email-in.js";
import { tagLead } from "./outreach.js";
import type { AgencyStore } from "./store.js";

/**
 * Prospects who write to us first. The inbox poll only answers known leads, so this runs just before
 * it: a new message from someone we don't know (or a teammate starting the test agency) becomes a
 * lead, and the poll then handles it like any reply, which hands it to the sales agent. Replies to
 * people who wrote first aren't limited the way new cold recipients are.
 *
 *   - A TEAM_EMAILS address with "agency" in a new subject (e.g. "Agency inquiry") starts a fresh
 *     test-agency conversation: the lead is renamed "Level AI Test Agency" and stored as an internal test.
 *   - Anyone else we don't know, writing a new message about levels, games, playtests, or prices,
 *     becomes a lead. Automatic mail (no-reply senders, out-of-office, bounces) never does.
 */
export const TEST_AGENCY = "Level AI Test Agency";
export const WROTE_FIRST = "wrote to us first";

const AUTOMATED = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?|notifications?|alerts?|news(letter)?|updates?|billing|receipts?)([._+-].*)?@/i;
const BUSINESS_TOPIC = /\b(levels?|puzzles?|games?|gaming|playtests?|pric(e|es|ing)|cost|quote|samples?|agenc(y|ies)|studios?|outsourc\w*|clients?)\b/i;
const FREE_MAIL = /^(gmail|googlemail|yahoo|outlook|hotmail|live|icloud|me|aol|proton(mail)?|gmx|mail)\./i;

export type ProspectKind = "test_agency" | "new_prospect" | null;

/**
 * Email-in audits (leads/email-in.ts) take new mail with an "Audit:" subject or a store link before
 * the reply path. Those are theirs; the prospect hook stands aside so the two never both act.
 */
const AUDIT_LIKE = /^\s*audit\b|apps\.apple\.com\/|play\.google\.com\/store\/apps/i;

export function prospectKind(m: Pick<PolledMessage, "from" | "subject" | "text">, teamEmails: string[], known: boolean): ProspectKind {
  const from = addressOf(m.from);
  const isReply = /^\s*(re|aw|sv)\s*:/i.test(m.subject);
  const own = ownWords(m.text);
  if (!isReply && AUDIT_LIKE.test(`${m.subject}\n${own}`)) return null;
  if (isTeamEmail(from, teamEmails)) {
    return !isReply && /\bagenc(y|ies)\b/i.test(`${m.subject} ${own.slice(0, 400)}`) ? "test_agency" : null;
  }
  if (known || isReply || AUTOMATED.test(from)) return null;
  if (classifyReply(m.subject, m.text).intent === "auto_reply") return null;
  return BUSINESS_TOPIC.test(`${m.subject} ${own.slice(0, 2000)}`) ? "new_prospect" : null;
}

/** "Pixel Forge" <hello@pixelforge.com> → "Pixel Forge" on a free-mail domain, else the company domain. */
export function prospectName(fromRaw: string): string {
  const display = fromRaw.match(/^\s*"?([^"<]+?)"?\s*</)?.[1]?.trim() ?? "";
  const domain = addressOf(fromRaw).split("@")[1] ?? "";
  if (domain && !FREE_MAIL.test(domain)) return domain;
  return display || addressOf(fromRaw);
}

/**
 * Makes the lead for a prospect's first message, if it is one. Returns what it did. Safe to call on
 * every poll: messages already on file are skipped, and the caller remembers what it has seen.
 */
export async function prepareProspect(ctx: ToolContext, agencies: AgencyStore, m: PolledMessage): Promise<ProspectKind> {
  const from = addressOf(m.from);
  if (!m.labels.includes("received") || from.endsWith("@agentmail.to")) return null;
  // "Audit: <game>" or a store link: an email-in review audit (leads/email-in.ts), not an agency prospect.
  if (parseAuditRequest(m)) return null;
  if (await ctx.store.hasInboundMessage(m.messageId)) return null;
  const team = ctx.config.TEAM_EMAILS.split(",").map((e) => e.trim()).filter(Boolean);
  const existing = await ctx.store.findLeadByEmail(from);
  const kind = prospectKind(m, team, Boolean(existing));
  if (!kind) return null;
  if (await ctx.store.isSuppressed(from)) return null;
  await agencies.ensure();
  const now = new Date().toISOString();
  const company = kind === "test_agency" ? TEST_AGENCY : prospectName(m.from);
  const lead = await ctx.store.upsertLead({
    ...(existing ? { id: existing.id } : {}),
    company, appId: null, contactName: null, email: from, source: "manual", stage: "emailed",
    reason: kind === "test_agency"
      ? "Internal test agency: a teammate wrote in as a game-development agency for the demo."
      : `Wrote to us first: "${m.subject.slice(0, 120)}".`,
    sampleUrl: null, crmContactId: null,
  });
  // "emailed" means "in conversation" here; the inbox handler moves it to "replied" and the agent answers.
  await ctx.store.setStage(lead.id, "emailed");
  if (kind === "test_agency") await tagLead(ctx, lead.id, "internal_test", null);
  await agencies.save({
    leadId: lead.id, slug: null, domain: null, company, about: kind === "test_agency" ? "builds and ships mobile puzzle games for client studios" : null,
    services: null, website: null, contactEmail: from, internalTest: kind === "test_agency", status: "emailed", detail: WROTE_FIRST, startedAt: now,
  });
  await ctx.store.logActivity({
    at: now, agent: "agency-sales",
    action: kind === "test_agency" ? `new prospect wrote in: ${TEST_AGENCY} (test agency)` : `new prospect wrote in: ${company}`,
    why: kind === "test_agency" ? "a teammate playing an agency emailed us first; kept out of the numbers" : `subject "${m.subject.slice(0, 120)}"`,
    result: "handing the message to the sales agent", costUsd: null, human: false,
  });
  return kind;
}

/** Wraps the inbox lister so each new prospect has a lead before the poll handles their message. */
export function withProspects(ctx: ToolContext, agencies: AgencyStore, list: () => Promise<PolledMessage[]>): () => Promise<PolledMessage[]> {
  const checked = new Set<string>();
  return async () => {
    const items = await list();
    // Oldest first, so a prospect's first message is the one that makes the lead.
    for (const m of [...items].reverse()) {
      if (checked.has(m.messageId)) continue;
      checked.add(m.messageId);
      await prepareProspect(ctx, agencies, m).catch((err: unknown) =>
        console.error("prospect check failed:", err instanceof Error ? err.message.slice(0, 160) : "unknown"));
    }
    return items;
  };
}
