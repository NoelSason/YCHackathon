import { createHmac, timingSafeEqual } from "node:crypto";
import type { Store } from "../store.js";
import { isOptOut } from "./guard.js";

/**
 * Handles replies that arrive in the sales inbox (AgentMail `message.received` webhooks).
 *
 * The deterministic part runs here: dedupe, opt-outs, and the stage change. Understanding the reply
 * and writing the answer is the Sales Reader agent's job. It runs in its own Naïve session, so the
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
  | { kind: "needs_reader"; leadId: string; reply: InboundReply };

const seenEvents = new Set<string>();

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
  await store.logActivity({ at, agent: "sales-inbox", action: `reply from ${lead.company}`, why: null, result: "sent to the Sales Reader", costUsd: null, human: false });
  return { kind: "needs_reader", leadId: lead.id, reply };
}
