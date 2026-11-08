import type { ToolContext } from "../mcp/tools.js";
import type { InboundReply } from "../outreach/inbound.js";
import { ownWords } from "../outreach/guard.js";

/**
 * Emails about money: refunds, cancellations, disputes, and double charges. Agents never refund,
 * cancel, or promise either, so these always go to a person, and they never get the sales
 * auto-answer (a short "yes please refund me" otherwise reads as a positive reply).
 *
 * Only the sender's own words count: our confirmation email says "reply and we'll stop the next
 * charge", and that quoted text must not make every reply look like a cancellation.
 */
export type MoneyRequestKind = "refund" | "cancel" | "billing";

const PATTERNS: Array<[MoneyRequestKind, RegExp, string]> = [
  ["refund", /\b(refund\w*|money back|reimburse\w*|charge ?back|dispute\w*)\b/, "asks for a refund or disputes a charge"],
  ["billing", /\b(charged (me )?(twice|double|again|two times|the wrong)|double[- ]charged|over-?charged|wrong (amount|charge)|didn'?t (authori[sz]e|order|buy) (this|that|it)|unauthori[sz]ed (charge|payment))\b/, "says a charge is wrong"],
  ["cancel", /\b(cancel\w*|end|stop) (my |our |the |this )?(subscription|plan|order|membership|renewal|billing|payments?|charges?|next charge)\b|\bunsubscribe me from (the |my )?(plan|subscription)\b/, "asks to cancel a subscription or an order"],
];

export function moneyRequest(subject: string, text: string): { kind: MoneyRequestKind; why: string } | null {
  const own = ownWords(text).toLowerCase().replace(/\s+/g, " ");
  // A "Re:" subject is our own subject line, so only a subject the sender wrote counts.
  const subj = /^\s*(re|fwd?):/i.test(subject) ? "" : subject.toLowerCase();
  const haystack = `${subj} ${own}`;
  for (const [kind, re, why] of PATTERNS) if (re.test(haystack)) return { kind, why };
  return null;
}

/**
 * Logs a money request for a person, with what this customer has paid us, and returns true so the
 * caller skips the automatic answer. Nothing is refunded, cancelled, or replied to here.
 */
export async function flagMoneyRequest(ctx: ToolContext, o: { leadId: string; reply: InboundReply }): Promise<boolean> {
  const found = moneyRequest(o.reply.subject, o.reply.text);
  if (!found) return false;
  const lead = await ctx.store.getLead(o.leadId);
  const company = lead?.company ?? o.reply.from;
  const paid = (await ctx.store.listPayments().catch(() => [])).filter((p) => p.leadId === o.leadId);
  const history = paid.length
    ? paid.slice(0, 3).map((p) => `${(p.amountMinor / 100).toFixed(2)} ${p.currency.toUpperCase()} ${p.product}${p.livemode ? "" : " (test mode)"}`).join("; ")
    : "no payments on file for this address";
  const label = { refund: "refund request", cancel: "cancellation request", billing: "billing problem" }[found.kind];
  await ctx.store.logActivity({
    at: new Date().toISOString(), agent: "billing", action: `${label} from ${company}`,
    why: `the reply ${found.why}; paid: ${history}`,
    result: "left for a person; agents never refund or cancel, and no automatic answer was sent", costUsd: null, human: false,
  });
  return true;
}
