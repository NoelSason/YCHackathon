import type { ToolContext } from "../mcp/tools.js";
import type { MailAttachment } from "../outreach/send.js";
import type { Query } from "../store.js";

/**
 * Customer emails after a payment: order confirmations, playtest watch links and reports, level
 * packs. The mail provider can refuse a send for hours (a new account can't email new addresses
 * yet), and the work must not wait on it. So `sendCustomerEmail` tries once; if that fails it logs
 * the failure honestly, keeps the email in `biz_mail_outbox`, and returns. `retryOutbox` tries
 * again every 15 minutes with the same idempotency key (so it can't send twice) and gives up after
 * two days, leaving it for a person. Without a database (tests), the outbox is kept in memory.
 */
export type CustomerEmailKind = "order-confirmation" | "playtest-watch" | "playtest-report" | "level-pack";

export interface CustomerEmail {
  kind: CustomerEmailKind;
  leadId: string | null;
  company: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
  idempotencyKey: string;
  /** Test-mode order: the log lines say so. */
  test: boolean;
}

const WHAT: Record<CustomerEmailKind, string> = {
  "order-confirmation": "order confirmation",
  "playtest-watch": "live watch link",
  "playtest-report": "playtest report",
  "level-pack": "level pack",
};
export const RETRY_MINUTES = 15;
export const GIVE_UP_HOURS = 48;

interface Queued { id: string; email: CustomerEmail; attempts: number; nextAt: number; createdAt: number; done: boolean }
const memory: Queued[] = [];

/** For tests: forget the in-memory outbox. */
export function clearMemoryOutbox(): void {
  memory.length = 0;
}

const reasonOf = (err: unknown): string => (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").slice(0, 200);

/** Sends now, or queues for a retry. Never throws, so a refused email can't stop an order or a delivery. */
export async function sendCustomerEmail(ctx: ToolContext, email: CustomerEmail): Promise<{ sent: true; messageId: string } | { sent: false; reason: string }> {
  const label = email.test ? " (test order)" : "";
  const log = (action: string, why: string | null, result: string) =>
    ctx.store.logActivity({ at: new Date().toISOString(), agent: "billing", action, why, result, costUsd: null, human: false }).catch(() => undefined);
  if (!ctx.mail) {
    await log(`couldn't email ${email.company} their ${WHAT[email.kind]}`, "no mail sender on this server", `left for a person${label}`);
    return { sent: false, reason: "no mail sender" };
  }
  try {
    const { messageId } = await ctx.mail.send({
      to: email.to, subject: email.subject, text: email.text, html: email.html, idempotencyKey: email.idempotencyKey,
      ...(email.attachments ? { attachments: email.attachments } : {}),
    });
    return { sent: true, messageId };
  } catch (err) {
    const reason = reasonOf(err);
    const queued = await enqueue(ctx.db ?? null, email, reason).catch(() => false);
    await log(
      `couldn't email ${email.company} their ${WHAT[email.kind]} yet`, reason,
      queued ? `kept to retry every ${RETRY_MINUTES} minutes for ${GIVE_UP_HOURS} hours; the order goes ahead${label}` : `not kept for a retry; left for a person${label}`,
    );
    return { sent: false, reason };
  }
}

async function enqueue(db: Query | null, email: CustomerEmail, reason: string): Promise<boolean> {
  if (!db) {
    if (!memory.some((q) => q.email.idempotencyKey === email.idempotencyKey)) {
      memory.push({ id: email.idempotencyKey, email, attempts: 1, nextAt: Date.now() + RETRY_MINUTES * 60_000, createdAt: Date.now(), done: false });
    }
    return true;
  }
  const { leadId, company, to, kind, test, idempotencyKey, ...payload } = email;
  await db(
    `insert into biz_mail_outbox (idempotency_key, kind, studio_id, company, to_email, payload, test_order, last_error)
     values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (idempotency_key) do nothing`,
    [idempotencyKey, kind, leadId, company, to, JSON.stringify(payload), test, reason],
  );
  return true;
}

/**
 * Retries due emails. Returns how many went out. On success the email is recorded like any other
 * sent email (so it counts once, on the studio's record); after two days a person is told.
 */
export async function retryOutbox(ctx: ToolContext, opts: { now?: number; force?: boolean } = {}): Promise<number> {
  if (!ctx.mail) return 0;
  const now = opts.now ?? Date.now();
  const log = (action: string, why: string | null, result: string) =>
    ctx.store.logActivity({ at: new Date(now).toISOString(), agent: "billing", action, why, result, costUsd: null, human: false }).catch(() => undefined);
  const due = await listDue(ctx.db ?? null, now, opts.force ?? false);
  let sent = 0;
  for (const q of due) {
    const label = q.email.test ? " (test order)" : "";
    const what = WHAT[q.email.kind];
    try {
      const { messageId } = await ctx.mail.send({
        to: q.email.to, subject: q.email.subject, text: q.email.text, html: q.email.html, idempotencyKey: q.email.idempotencyKey,
        ...(q.email.attachments ? { attachments: q.email.attachments } : {}),
      });
      await markSent(ctx.db ?? null, q, messageId);
      if (q.email.leadId) {
        await ctx.store.addOutreach({ leadId: q.email.leadId, to: q.email.to, subject: q.email.subject, body: q.email.text, status: "sent", blockedReason: null, providerMessageId: messageId }).catch(() => undefined);
      }
      await log(`emailed ${q.email.company} their ${what} (on try ${q.attempts + 1})`, null, `message ${messageId}${label}`);
      sent++;
    } catch (err) {
      const giveUp = now - q.createdAt >= GIVE_UP_HOURS * 3600_000;
      await markFailed(ctx.db ?? null, q, reasonOf(err), now, giveUp);
      if (giveUp) await log(`gave up emailing ${q.email.company} their ${what}`, `${q.attempts + 1} tries over ${GIVE_UP_HOURS} hours: ${reasonOf(err)}`, `left for a person${label}`);
    }
  }
  return sent;
}

async function listDue(db: Query | null, now: number, force: boolean): Promise<Queued[]> {
  if (!db) return memory.filter((q) => !q.done && (force || q.nextAt <= now));
  const rows = await db(
    `select * from biz_mail_outbox where sent_at is null and gave_up_at is null and ($2 or next_at <= to_timestamp($1 / 1000.0))
     order by created_at limit 20`,
    [now, force],
  );
  return rows.map((r) => {
    const p = (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Pick<CustomerEmail, "subject" | "text" | "html" | "attachments">;
    return {
      id: String(r.id), attempts: Number(r.attempts), nextAt: 0, createdAt: new Date(r.created_at as string).getTime(), done: false,
      email: {
        ...p, kind: r.kind as CustomerEmailKind, leadId: r.studio_id ? String(r.studio_id) : null, company: String(r.company), to: String(r.to_email),
        idempotencyKey: String(r.idempotency_key), test: Boolean(r.test_order),
      },
    };
  });
}

async function markSent(db: Query | null, q: Queued, messageId: string): Promise<void> {
  q.done = true;
  if (db) await db(`update biz_mail_outbox set sent_at = now(), message_id = $2, attempts = attempts + 1 where id::text = $1`, [q.id, messageId]);
}

async function markFailed(db: Query | null, q: Queued, reason: string, now: number, giveUp: boolean): Promise<void> {
  q.attempts++;
  q.nextAt = now + RETRY_MINUTES * 60_000;
  if (giveUp) q.done = true;
  if (db) {
    await db(
      `update biz_mail_outbox set attempts = attempts + 1, last_error = $2, next_at = to_timestamp($3 / 1000.0),
         gave_up_at = case when $4 then now() else gave_up_at end where id::text = $1`,
      [q.id, reason, q.nextAt, giveUp],
    );
  }
}

/** Retries the outbox every few minutes on the business server. */
export function startOutboxLoop(ctx: ToolContext, everyMinutes = 5): void {
  const tick = () => void retryOutbox(ctx).then((n) => n && console.log(`outbox: sent ${n} held email(s)`)).catch(() => undefined);
  setTimeout(tick, 30_000).unref?.();
  setInterval(tick, everyMinutes * 60_000).unref?.();
}
