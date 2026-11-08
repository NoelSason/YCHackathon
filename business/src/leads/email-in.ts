import type { ToolContext } from "../mcp/tools.js";
import { addressOf } from "../outreach/inbound.js";
import { ownWords } from "../outreach/guard.js";
import { isTeamEmail } from "../store.js";
import { appIdFromStoreUrl, lenientUrl } from "./intake.js";
import { runLiveSignup, type LiveOutcome } from "./live.js";
import { start } from "./progress.js";

/**
 * Email-in audits: someone emails levelai@agentmail.to with a game's name ("Audit: Parking Loop") or
 * a store link, and the agents run the same audit as the signup form, then answer in the same thread.
 *
 * Why this exists (Nov 7, 8 PM): the inbox's provider caps how many new addresses a new account may
 * email first (10 in its first day), so the form's welcome to a new address fails until Nov 8, 3 PM.
 * Replies to people who wrote to us first aren't capped, so this route always works.
 *
 * Only a fresh message counts: a subject starting "Re:" or "Fwd:" is a reply to us and goes through the
 * normal reply path (outreach/inbound.ts), so thanking us for an audit doesn't start another one.
 */
export interface AuditRequest {
  game: string | null;
  storeUrl: string | null;
}

const STORE_LINK = /(?:https?:\/\/)?(?:play\.google\.com|apps\.apple\.com|itunes\.apple\.com)\/[^\s<>"')\]]+/i;
const REPLY_PREFIX = /^\s*(?:re|fwd?|fw|aw|sv|antw)\s*:/i;
const AUDIT_SUBJECT = /^\s*(?:review\s+)?(?:audit|free\s+levels?)\b\s*(?:for|of)?\s*[:\-–—]?\s*(.*)$/i;
/** The prompt our mailto link puts in the body ("Game name or store link: ..."). */
const BODY_PROMPT = /^\s*(?:game(?:\s+name)?(?:\s+or\s+store\s+link)?|store\s+link)\s*[:\-–—]\s*(.+)$/i;

const clean = (s: string): string => s.replace(/\s+/g, " ").replace(/^["'“”]+|["'“”.,;!?]+$/g, "").trim().slice(0, 100);

/** Whether a message is a new audit request, and for which game. Null means it isn't one. */
export function parseAuditRequest(m: { subject: string; text: string }): AuditRequest | null {
  const subject = (m.subject ?? "").trim();
  if (REPLY_PREFIX.test(subject)) return null;
  const body = ownWords(m.text ?? "");
  const linkMatch = `${subject}\n${body}`.match(STORE_LINK);
  const storeUrl = linkMatch ? lenientUrl(linkMatch[0]) ?? null : null;
  const audit = subject.match(AUDIT_SUBJECT);
  if (!audit && !storeUrl) return null;

  let game: string | null = audit?.[1] ? clean(audit[1]) || null : null;
  if (game && STORE_LINK.test(game)) game = null;
  if (!game) {
    const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
    const prompted = lines.map((l) => l.match(BODY_PROMPT)?.[1]).find(Boolean);
    if (prompted && !STORE_LINK.test(prompted)) game = clean(prompted) || null;
    // "Audit:" with nothing after it: the first short line of the body is the game, if there's no link.
    else if (!storeUrl && audit) {
      const first = lines.find((l) => l.length <= 80 && !/^(hi|hello|hey|dear)\b/i.test(l));
      game = first ? clean(first) || null : null;
    }
  }
  if (!game && !storeUrl) return null;
  return { game, storeUrl };
}

/** "Ada Lovelace <ada@x.com>" → "Ada Lovelace"; a bare address → null. */
export function displayName(from: string): string | null {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*</);
  const name = m?.[1]?.trim();
  return name && !name.includes("@") ? name.slice(0, 120) : null;
}

/** Messages older than this aren't answered (so a restart doesn't answer old mail). */
export const MAX_AGE_MS = 30 * 60 * 1000;

export interface InboxMessage {
  messageId: string;
  from: string;
  subject: string;
  text: string;
  /** When it arrived (ISO). Unknown means it's treated as new. */
  at?: string | null;
}

/**
 * Starts the audit for one inbox message if it's an audit request, and returns true when it is (so the
 * reply path skips it). The audit itself runs in the background; `done` resolves with its outcome.
 */
export async function takeAuditRequest(
  ctx: ToolContext,
  m: InboxMessage,
  now = Date.now(),
): Promise<{ taken: false } | { taken: true; done: Promise<LiveOutcome | null> }> {
  const req = parseAuditRequest(m);
  if (!req) return { taken: false };
  if (m.at && now - Date.parse(m.at) > MAX_AGE_MS) return { taken: false };
  const from = addressOf(m.from);
  if (!from.includes("@") || (await ctx.store.isSuppressed(from))) return { taken: true, done: Promise.resolve(null) };

  const teamTest = isTeamEmail(from, ctx.config.TEAM_EMAILS.split(","));
  const name = displayName(m.from);
  const existing = await ctx.store.findLeadByEmail(from);
  const appId = appIdFromStoreUrl(req.storeUrl ?? undefined);
  const lead = await ctx.store.upsertLead({
    company: existing?.company ?? name ?? from.split("@")[0]!,
    appId,
    contactName: name ?? existing?.contactName ?? null,
    email: from,
    source: "inbound_form",
    stage: "found",
    reason: req.game ? `Emailed us for a review audit of ${req.game}.` : "Emailed us for a review audit.",
    sampleUrl: null,
    crmContactId: null,
  });
  // Saved as their inbound email, so the inbox check never handles this message twice (even after a restart).
  await ctx.store.addInboundEmail({ leadId: lead.id, subject: m.subject.slice(0, 300), summary: ownWords(m.text).slice(0, 500), externalId: m.messageId });
  await ctx.store.logActivity({
    at: new Date().toISOString(), agent: "intake", action: `new inbound lead: ${lead.company}`,
    why: teamTest ? "a team member's test email (not counted as a customer)" : "emailed us for a review audit",
    result: `lead ${lead.id}`, costUsd: null, human: false,
  });
  start(lead.id, "Got your email. Starting now");
  const done = runLiveSignup(ctx, lead, req.game, undefined, { appId, teamTest, replyToMessageId: m.messageId }).catch(() => null);
  return { taken: true, done };
}
