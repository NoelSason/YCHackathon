import type { MailAttachment, MailSender } from "./send.js";
import { SendRefused } from "./send.js";
import type { PolledMessage } from "./poll.js";

type SendArgs = Parameters<MailSender["send"]>[0];
type ReplyArgs = Parameters<MailSender["reply"]>[0];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Status and a short log-safe message from a JSON error body. Never includes request headers. */
async function errorOf(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: unknown } | string; message?: unknown } | null;
  const inner = typeof body?.error === "object" ? body.error?.message : body?.error;
  const message = typeof inner === "string" ? inner : typeof body?.message === "string" ? body.message : `HTTP ${res.status}`;
  return message.replace(/\s+/g, " ").slice(0, 240);
}

/**
 * POST with up to `tries` attempts for a network error, 429, or 5xx. Both providers honor
 * Idempotency-Key and release it on a non-2xx, so a retry can't send twice. Any other 4xx throws
 * SendRefused at once.
 */
async function postOnce(url: string, init: RequestInit, f: typeof fetch, tries = 4): Promise<Response> {
  let last: SendRefused | null = null;
  for (let i = 0; i < tries; i++) {
    if (i > 0) await wait(1500 * i);
    let res: Response;
    try {
      res = await f(url, { ...init, signal: AbortSignal.timeout(20_000) });
    } catch (err) {
      last = new SendRefused(err instanceof Error ? err.message.slice(0, 200) : "network error", null);
      continue;
    }
    if (res.ok) return res;
    const message = await errorOf(res);
    last = new SendRefused(message, res.status);
    if (res.status !== 429 && res.status < 500) throw last;
  }
  throw last ?? new SendRefused("send failed", null);
}

export interface NaiveInboxOptions { apiKey: string; baseUrl: string; identityId: string; inboxId: string; address: string; fetchImpl?: typeof fetch }

interface NaiveMessage { id: string; from?: string; subject?: string | null; text?: string; received_at?: string; channel?: string }

/**
 * Sends from a Naïve inbox on the organization's free system domain. Naïve's send takes only
 * `to`, `subject`, and `text`: no HTML, attachments, or Reply-To (a `reply_to` field is refused), so
 * replies come back to this inbox and `naiveMailLister` feeds them to the same handlers.
 */
export class NaiveMailSender implements MailSender {
  private readonly f: typeof fetch;
  constructor(private readonly o: NaiveInboxOptions) {
    this.f = o.fetchImpl ?? fetch;
  }

  get address(): string {
    return this.o.address;
  }

  private headers(key?: string): Record<string, string> {
    return { authorization: `Bearer ${this.o.apiKey}`, "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) };
  }

  private async deliver(to: string, subject: string, text: string, key: string): Promise<{ messageId: string; from: string }> {
    const url = `${this.o.baseUrl}/v1/identities/${this.o.identityId}/emails/${this.o.inboxId}/send`;
    await postOnce(url, { method: "POST", headers: this.headers(key), body: JSON.stringify({ to: [to], subject, text }) }, this.f);
    // The receipt deliberately has no provider message id; the idempotency key identifies the send.
    return { messageId: `naive-${key}`, from: this.o.address };
  }

  send(args: SendArgs): Promise<{ messageId: string; from: string }> {
    return this.deliver(args.to, args.subject, args.text, args.idempotencyKey);
  }

  /** Answers a message that arrived at this inbox (`inb_…`), looked up in the inbound feed for its sender and subject. */
  async reply(args: ReplyArgs): Promise<{ messageId: string; from: string }> {
    const found = (await listNaiveMessages(this.o, this.f)).find((m) => m.id === args.messageId);
    if (!found?.from) throw new SendRefused("that message isn't in the inbound feed", null);
    const subject = found.subject ?? "";
    return this.deliver(found.from, /^re:/i.test(subject) ? subject : `Re: ${subject}`, args.text, args.idempotencyKey);
  }
}

async function listNaiveMessages(o: NaiveInboxOptions, f: typeof fetch): Promise<NaiveMessage[]> {
  const res = await f(`${o.baseUrl}/v1/identities/${o.identityId}/messages?channel=email&limit=50`, {
    headers: { authorization: `Bearer ${o.apiKey}` }, signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`inbound feed: ${await errorOf(res)}`);
  return ((await res.json()) as { data?: NaiveMessage[] }).data ?? [];
}

/** Lists mail that arrived at the Naïve inbox, in the shape the inbox poll expects. */
export function naiveMailLister(o: NaiveInboxOptions, fetchImpl?: typeof fetch): () => Promise<PolledMessage[]> {
  const f = fetchImpl ?? fetch;
  return async () =>
    (await listNaiveMessages(o, f)).map((m) => ({
      messageId: m.id, from: m.from ?? "", subject: m.subject ?? "", text: m.text ?? "", threadId: null, labels: ["received"], at: m.received_at ?? null,
    }));
}

export interface ResendOptions { apiKey: string; from: string; replyTo: string; fetchImpl?: typeof fetch; url?: string }

/** Sends through Resend's HTTP API with a Reply-To, so replies land in the inbox the sales agent already watches. */
export class ResendMailSender implements MailSender {
  private readonly f: typeof fetch;
  constructor(private readonly o: ResendOptions) {
    this.f = o.fetchImpl ?? fetch;
  }

  async send(args: SendArgs): Promise<{ messageId: string; from: string }> {
    const attachments = args.attachments?.map((a: MailAttachment) => ({
      filename: a.filename, content: a.contentBase64, content_type: a.contentType, ...(a.contentId ? { content_id: a.contentId } : {}),
    }));
    const body = {
      from: this.o.from, to: [args.to], subject: args.subject, text: args.text, reply_to: this.o.replyTo,
      ...(args.html ? { html: args.html } : {}), ...(attachments?.length ? { attachments } : {}),
    };
    const res = await postOnce(this.o.url ?? "https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.o.apiKey}`, "content-type": "application/json", "idempotency-key": args.idempotencyKey },
      body: JSON.stringify(body),
    }, this.f);
    const id = ((await res.json().catch(() => null)) as { id?: string } | null)?.id;
    return { messageId: id ?? `resend-${args.idempotencyKey}`, from: this.o.from };
  }

  /** Reply-To sends replies to the AgentMail inbox, so this path never has its own thread to answer. */
  async reply(): Promise<{ messageId: string }> {
    throw new SendRefused("replies go through the main inbox", null);
  }
}
