import { createHash } from "node:crypto";
import { AgentMailClient } from "agentmail";
import type { Store } from "../store.js";
import type { Lead, OutreachRecord } from "../types.js";
import type { OutreachDraft } from "./compose.js";
import { checkOutreach, type GuardContext } from "./guard.js";

/** A stable, provider-safe idempotency key (hex only), so a retry never sends twice. */
export function idempotencyKey(...parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40);
}

export interface MailSender {
  send(args: { to: string; subject: string; text: string; idempotencyKey: string }): Promise<{ messageId: string }>;
  reply(args: { messageId: string; text: string; idempotencyKey: string }): Promise<{ messageId: string }>;
}

/** Sends through AgentMail: inboxes.messages.send(inboxId, request, { idempotencyKey }). */
export class AgentMailSender implements MailSender {
  private client: AgentMailClient;

  constructor(apiKey: string, private readonly inboxId: string) {
    this.client = new AgentMailClient({ apiKey });
  }

  async send(args: { to: string; subject: string; text: string; idempotencyKey: string }): Promise<{ messageId: string }> {
    const res = await this.client.inboxes.messages.send(
      this.inboxId,
      { to: args.to, subject: args.subject, text: args.text, labels: ["outreach"] },
      { idempotencyKey: args.idempotencyKey },
    );
    return { messageId: res.messageId };
  }

  async reply(args: { messageId: string; text: string; idempotencyKey: string }): Promise<{ messageId: string }> {
    const res = await this.client.inboxes.messages.reply(this.inboxId, args.messageId, { text: args.text, labels: ["outreach"] }, {
      idempotencyKey: args.idempotencyKey,
    });
    return { messageId: res.messageId };
  }
}

export interface SendOptions extends GuardContext {
  sender: MailSender | null;
  /** When false, the email is checked and recorded as a draft but never sent. */
  sendingEnabled: boolean;
  agent: string;
}

/**
 * Checks, records, and (only when enabled) sends one outreach email. Always writes an activity
 * entry, so the demo log shows drafts and blocks as well as sends.
 */
export async function sendOutreach(lead: Lead, draft: OutreachDraft, opts: SendOptions): Promise<OutreachRecord> {
  const blocked = await checkOutreach(lead, draft, opts);
  const to = lead.email ?? "";
  const base = { leadId: lead.id, to, subject: draft.subject, body: draft.body };

  if (blocked) {
    const record = await opts.store.addOutreach({ ...base, status: "blocked", blockedReason: blocked, providerMessageId: null });
    await opts.store.logActivity({
      at: new Date().toISOString(), agent: opts.agent, action: `outreach blocked for ${lead.company}`,
      why: blocked, result: "not sent", costUsd: null, human: false,
    });
    return record;
  }

  if (!opts.sendingEnabled || !opts.sender) {
    const record = await opts.store.addOutreach({ ...base, status: "drafted", blockedReason: null, providerMessageId: null });
    await opts.store.logActivity({
      at: new Date().toISOString(), agent: opts.agent, action: `outreach drafted for ${lead.company}`,
      why: "sending is turned off (OUTREACH_SEND=0)", result: "draft saved", costUsd: null, human: false,
    });
    return record;
  }

  const { messageId } = await opts.sender.send({
    to, subject: draft.subject, text: draft.body, idempotencyKey: idempotencyKey("first-touch", lead.id),
  });
  const record = await opts.store.addOutreach({ ...base, status: "sent", blockedReason: null, providerMessageId: messageId });
  await opts.store.setStage(lead.id, "emailed");
  await opts.store.logActivity({
    at: new Date().toISOString(), agent: opts.agent, action: `outreach sent to ${lead.company}`,
    why: lead.reason, result: `message ${messageId}`, costUsd: null, human: false,
  });
  return record;
}
