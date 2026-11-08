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

/** An email attachment. With `contentId` and `inline`, HTML can show it as <img src="cid:…">. */
export interface MailAttachment { filename: string; contentType: string; contentBase64: string; contentId?: string; inline?: boolean }

export interface MailSender {
  send(args: { to: string; subject: string; text: string; html?: string; idempotencyKey: string; attachments?: MailAttachment[] }): Promise<{ messageId: string }>;
  reply(args: { messageId: string; text: string; html?: string; idempotencyKey: string }): Promise<{ messageId: string }>;
}

/**
 * A send the provider refused for a reason a retry won't fix soon (a sending or new-recipient limit,
 * a blocked address). `message` is short and safe for the activity log.
 */
export class SendRefused extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = "SendRefused";
  }
}

/** Status and the provider's own message from an AgentMail SDK error, if it is one. */
function providerError(err: unknown): { status: number | null; message: string } {
  const e = err as { statusCode?: unknown; body?: { message?: unknown } };
  const status = typeof e?.statusCode === "number" ? e.statusCode : null;
  const message = typeof e?.body?.message === "string" ? e.body.message : err instanceof Error ? err.message : String(err);
  return { status, message: message.replace(/\s+/g, " ").slice(0, 240) };
}

/**
 * Sends through AgentMail: inboxes.messages.send(inboxId, request, { idempotencyKey }).
 * Each try is capped at 15 s, and the SDK's own retries are off: it waits out a 429's Retry-After,
 * which for the new-account recipient limit is hours (seen Nov 7, 8:01 PM: a signup hung 2 minutes).
 * A network error, timeout, 5xx, or brief API rate limit is retried once here with the same
 * idempotency key, so it can't send twice. Any other 4xx (sending or recipient limits, blocked
 * recipients) fails at once as SendRefused.
 */
export class AgentMailSender implements MailSender {
  private client: AgentMailClient;

  constructor(apiKey: string, private readonly inboxId: string, private readonly timeoutSeconds = 15, fetchImpl?: typeof fetch) {
    this.client = new AgentMailClient({ apiKey, timeoutInSeconds: timeoutSeconds, maxRetries: 0, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  }

  async send(args: { to: string; subject: string; text: string; html?: string; idempotencyKey: string; attachments?: MailAttachment[] }): Promise<{ messageId: string }> {
    const attachments = args.attachments?.map((a) => ({
      filename: a.filename, contentType: a.contentType, content: a.contentBase64,
      ...(a.contentId ? { contentId: a.contentId } : {}), ...(a.inline ? { contentDisposition: "inline" as const } : {}),
    }));
    const once = () =>
      this.client.inboxes.messages.send(
        this.inboxId,
        { to: args.to, subject: args.subject, text: args.text, ...(args.html ? { html: args.html } : {}), ...(attachments?.length ? { attachments } : {}), labels: ["outreach"] },
        { idempotencyKey: args.idempotencyKey, timeoutInSeconds: this.timeoutSeconds, maxRetries: 0 },
      );
    try {
      return { messageId: (await once()).messageId };
    } catch (err) {
      const { status, message } = providerError(err);
      // A short API rate limit (Retry-After about 1 s) is worth one more try; a sending or
      // new-recipient limit isn't, and neither is any other 4xx.
      const briefRateLimit = status === 429 && !/recipient|send limit/i.test(message);
      if (status !== null && status >= 400 && status < 500 && status !== 408 && !briefRateLimit) throw new SendRefused(message, status);
      await new Promise((r) => setTimeout(r, briefRateLimit ? 1500 : 1000));
      try {
        return { messageId: (await once()).messageId };
      } catch (err2) {
        const second = providerError(err2);
        throw new SendRefused(second.message, second.status);
      }
    }
  }

  async reply(args: { messageId: string; text: string; html?: string; idempotencyKey: string }): Promise<{ messageId: string }> {
    // Same limits as send(): 15 s per try, no SDK retries (they wait out Retry-After), and one retry
    // with the same key for a network error, timeout, or 5xx.
    const once = () =>
      this.client.inboxes.messages.reply(
        this.inboxId, args.messageId, { text: args.text, ...(args.html ? { html: args.html } : {}), labels: ["outreach"] },
        { idempotencyKey: args.idempotencyKey, timeoutInSeconds: this.timeoutSeconds, maxRetries: 0 },
      );
    try {
      return { messageId: (await once()).messageId };
    } catch (err) {
      const { status, message } = providerError(err);
      if (status !== null && status >= 400 && status < 500 && status !== 408 && !(status === 429 && !/recipient|send limit/i.test(message))) {
        throw new SendRefused(message, status);
      }
      await new Promise((r) => setTimeout(r, 1000));
      try {
        return { messageId: (await once()).messageId };
      } catch (err2) {
        const second = providerError(err2);
        throw new SendRefused(second.message, second.status);
      }
    }
  }
}

export interface SendOptions extends GuardContext {
  sender: MailSender | null;
  /** When false, the email is checked and recorded as a draft but never sent. */
  sendingEnabled: boolean;
  agent: string;
  /** Defaults to one key per lead ("first-touch"). A repeat signup passes its own, so it isn't deduplicated away. */
  idempotencyKey?: string;
  /**
   * Answer this inbound message in its thread instead of starting a new email. Used when someone
   * emails us for an audit (leads/email-in.ts): replies to people who wrote first aren't held by
   * AgentMail's new-recipient limit.
   */
  replyToMessageId?: string;
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

  const key = opts.idempotencyKey ?? idempotencyKey("first-touch", lead.id);
  const { messageId } = opts.replyToMessageId
    ? await opts.sender.reply({ messageId: opts.replyToMessageId, text: draft.body, ...(draft.html ? { html: draft.html } : {}), idempotencyKey: key })
    : await opts.sender.send({ to, subject: draft.subject, text: draft.body, ...(draft.html ? { html: draft.html } : {}), idempotencyKey: key });
  const record = await opts.store.addOutreach({ ...base, status: "sent", blockedReason: null, providerMessageId: messageId });
  // Stages only move forward: a welcome to someone who already replied or paid leaves their stage alone.
  if (lead.stage === "found" || lead.stage === "sample_made") await opts.store.setStage(lead.id, "emailed");
  await opts.store.logActivity({
    at: new Date().toISOString(), agent: opts.agent, action: `outreach sent to ${lead.company}`,
    why: lead.reason, result: `message ${messageId}`, costUsd: null, human: false,
  });
  return record;
}
