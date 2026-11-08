import { createHmac, timingSafeEqual } from "node:crypto";
import type { Store } from "../store.js";
import type { ToolContext } from "../mcp/tools.js";
import { offerLinks, toolRecordReply, toolSendReply } from "../mcp/tools.js";
import { classifyReply, isOptOut, ownWords } from "./guard.js";

/**
 * Handles replies that arrive in the sales inbox (AgentMail `message.received` webhooks).
 *
 * The deterministic part runs here: dedupe, opt-outs, and the stage change. A short, plainly
 * interested reply is answered right away from a fixed template (`answerReply`); everything else
 * is left for the Sales Reader agent or a person. The Reader runs in its own Naïve session, so the
 * Sender never reads the raw email (see the approval rule in docs/agent-plan.md).
 */
export interface InboundReply {
  eventId: string;
  from: string;
  subject: string;
  text: string;
  threadId: string | null;
  messageId: string | null;
}

/** AgentMail delivers through Svix. Verifies `svix-signature` over `${id}.${timestamp}.${body}`. */
export function verifySvixSignature(args: {
  secret: string;
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
  body: string;
  toleranceSeconds?: number;
  nowSeconds?: number;
}): boolean {
  const { secret, id, timestamp, signature, body } = args;
  if (!id || !timestamp || !signature) return false;
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > (args.toleranceSeconds ?? 300)) return false;
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** Extracts the address from `"Name" <a@b.com>` or returns the input trimmed. */
export function addressOf(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m?.[1] ?? from).trim().toLowerCase();
}

export function parseAgentMailEvent(payload: unknown): InboundReply | null {
  const p = payload as Record<string, unknown>;
  if (p?.event_type !== "message.received") return null;
  const m = (p.message ?? {}) as Record<string, unknown>;
  const fromRaw = Array.isArray(m.from) ? String(m.from[0] ?? "") : String(m.from ?? "");
  return {
    eventId: String(p.event_id ?? m.message_id ?? ""),
    from: addressOf(fromRaw),
    subject: String(m.subject ?? ""),
    text: String(m.extracted_text ?? m.text ?? ""),
    threadId: m.thread_id ? String(m.thread_id) : null,
    messageId: m.message_id ? String(m.message_id) : null,
  };
}

export type InboundOutcome =
  | { kind: "duplicate" }
  | { kind: "unknown_sender"; reply: InboundReply }
  | { kind: "opted_out"; leadId: string }
  | { kind: "needs_reader"; leadId: string; reply: InboundReply }
  | { kind: "auto_answered"; leadId: string };

const seenEvents = new Set<string>();

/** Answers a reply on its own. Returns true when nothing is left for the Reader or a person. */
export type ReplyResponder = (o: { leadId: string; reply: InboundReply }) => Promise<boolean>;
let responder: ReplyResponder | null = null;
/** The server sets this once (`createHandler`), so both the webhook and the inbox poll use it. */
export function setReplyResponder(fn: ReplyResponder | null): void {
  responder = fn;
}

export async function handleInboundReply(reply: InboundReply, store: Store): Promise<InboundOutcome> {
  if (reply.eventId && seenEvents.has(reply.eventId)) return { kind: "duplicate" };
  if (reply.eventId) seenEvents.add(reply.eventId);

  const lead = await store.findLeadByEmail(reply.from);
  const at = new Date().toISOString();
  if (!lead) {
    await store.logActivity({ at, agent: "sales-inbox", action: "reply from an unknown sender", why: null, result: "left for a person", costUsd: null, human: false });
    return { kind: "unknown_sender", reply };
  }

  await store.addInboundEmail({ leadId: lead.id, subject: reply.subject, summary: reply.text.slice(0, 500), externalId: reply.messageId });

  if (isOptOut(reply.text)) {
    await store.suppress(reply.from, "replied stop");
    await store.setStage(lead.id, "opted_out");
    await store.logActivity({ at, agent: "sales-inbox", action: `${lead.company} opted out`, why: "reply asked to stop", result: "suppressed", costUsd: null, human: false });
    return { kind: "opted_out", leadId: lead.id };
  }

  if (lead.stage === "emailed") await store.setStage(lead.id, "replied");
  await store.logActivity({ at, agent: "sales-inbox", action: `reply from ${lead.company}`, why: null, result: responder ? "checking whether it can be answered now" : "sent to the Sales Reader", costUsd: null, human: false });
  if (responder) {
    try {
      if (await responder({ leadId: lead.id, reply })) return { kind: "auto_answered", leadId: lead.id };
    } catch (err) {
      await store.logActivity({
        at: new Date().toISOString(), agent: "sales-inbox", action: `auto-answer failed for ${lead.company}`,
        why: err instanceof Error ? err.message.slice(0, 200) : "unknown error", result: "left for the Sales Reader or a person", costUsd: null, human: false,
      });
    }
  }
  return { kind: "needs_reader", leadId: lead.id, reply };
}

/** At most this many automatic answers a day, across all studios. */
export const AUTO_REPLY_DAILY_CAP = 10;

/** The fixed answer to an interested reply. Every number and link in it is a team setting. */
export function composeAutoAnswer(args: { levelsUrl: string; playtestUrl: string; playtestPrice: string }): string {
  return [
    "Thanks for writing back. Here are two ways to try us right now:",
    "",
    `- Free: play a pack of levels our agents designed and tested: ${args.levelsUrl}`,
    `- ${args.playtestPrice ? `${args.playtestPrice} phone playtest` : "Phone playtest"}: send us your app's link, and one of our agents plays it on a real iPhone and emails you a report. ${args.playtestPrice ? "Order and pay here" : "Order it here"}: ${args.playtestUrl}`,
    "",
    "If you'd like levels made for your own game, reply with a link to it and we'll follow up.",
  ].join("\n");
}

/**
 * Decides what to do with one reply, without a person: answer it (short, plainly interested
 * replies only), close it (a clear no), or leave it for a person (anything mixed, hostile, long, or
 * asking a real question). Logs every decision. Sending goes through `toolSendReply`, so the
 * reply guard, the opt-out list, the send switch, and the one-answer-per-message rule all apply.
 */
export async function answerReply(
  ctx: ToolContext,
  o: { leadId: string; reply: InboundReply },
  opts: { dailyCap?: number; enabled?: boolean; now?: Date } = {},
): Promise<boolean> {
  const lead = await ctx.store.getLead(o.leadId);
  if (!lead) return false;
  const log = (action: string, why: string, result: string) =>
    ctx.store.logActivity({ at: new Date().toISOString(), agent: "sales-inbox", action, why, result, costUsd: null, human: false });
  if (!(opts.enabled ?? process.env.AUTO_REPLY !== "0")) {
    await log(`reply from ${lead.company} left for a person`, "automatic answers are turned off (AUTO_REPLY=0)", "not answered");
    return false;
  }
  const { intent, why } = classifyReply(o.reply.subject, o.reply.text);
  const snippet = ownWords(o.reply.text).replace(/\s+/g, " ").slice(0, 200);

  if (intent === "auto_reply") {
    await log(`ignored an automatic reply from ${lead.company}`, why, "no answer needed");
    return true;
  }
  if (intent === "not_interested") {
    if (["emailed", "replied", "pilot_offered", "found", "sample_made"].includes(lead.stage)) {
      await toolRecordReply(ctx, { leadId: lead.id, summary: snippet, intent: "not_interested", nextStep: "none; don't email again unless they write" });
    }
    await log(`decided not to answer ${lead.company}`, why, "closed; no email sent");
    return true;
  }
  if (intent !== "interested") {
    await log(`reply from ${lead.company} left for a person`, why, "not answered");
    return false;
  }

  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const recent = (await ctx.store.listActivity(500)).filter((a) => /^auto-replied to /.test(a.action));
  const cap = opts.dailyCap ?? AUTO_REPLY_DAILY_CAP;
  if (recent.filter((a) => a.at >= since).length >= cap) {
    await log(`reply from ${lead.company} left for a person`, `daily cap of ${cap} automatic answers reached`, "not answered");
    return false;
  }
  if (recent.some((a) => a.why?.startsWith(`lead ${lead.id}:`))) {
    await log(`reply from ${lead.company} left for a person`, "we already answered this studio once automatically; a second reply is a conversation", "not answered");
    return false;
  }

  if (["emailed", "replied", "found", "sample_made"].includes(lead.stage)) {
    await toolRecordReply(ctx, { leadId: lead.id, summary: snippet, intent: "interested", nextStep: "sent the free levels and the playtest order link" });
  }
  const [levelsUrl, playtestUrl, playtestPrice] = offerLinks(ctx, lead);
  const sent = await toolSendReply(ctx, { leadId: lead.id, text: composeAutoAnswer({ levelsUrl, playtestUrl, playtestPrice }) });
  if (sent.status !== "sent") {
    await log(`auto-answer not sent to ${lead.company}`, `lead ${lead.id}: ${why}`, `${sent.status}${sent.reason ? `: ${sent.reason}` : ""}; left for a person`);
    return false;
  }
  await log(`auto-replied to ${lead.company}`, `lead ${lead.id}: ${why}`, "sent the free levels and the playtest order link");
  return true;
}
