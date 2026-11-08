import { AgentMailClient } from "agentmail";
import type { Store } from "../store.js";
import { addressOf, handleInboundReply, type InboundOutcome } from "./inbound.js";

/**
 * Checks the sales inbox for replies. Used instead of a webhook while the server runs behind a
 * quick tunnel whose URL changes. Each new reply goes through the same path as a webhook would:
 * opt-outs, the stage change, the saved email, and (via onReply) the Sales Reader.
 */
export interface PolledMessage {
  messageId: string;
  from: string;
  subject: string;
  text: string;
  threadId: string | null;
  labels: string[];
  /** When it arrived (ISO), if the provider said. */
  at?: string | null;
}

export async function pollOnce(args: {
  list: () => Promise<PolledMessage[]>;
  store: Store;
  ownAddress: string;
  onReply?: (outcome: Extract<InboundOutcome, { kind: "needs_reader" }>) => Promise<void>;
  /**
   * Called first for each new received message. Returns true when it took the message (an email-in
   * audit request, leads/email-in.ts), so it isn't handled as a reply.
   */
  onNewMessage?: (m: PolledMessage) => Promise<boolean>;
  seen?: Set<string>;
}): Promise<InboundOutcome[]> {
  const out: InboundOutcome[] = [];
  const seen = args.seen ?? new Set<string>();
  for (const m of await args.list()) {
    if (seen.has(m.messageId)) continue;
    seen.add(m.messageId);
    const from = addressOf(m.from);
    if (from === args.ownAddress.toLowerCase() || from.endsWith("@agentmail.to")) continue;
    if (!m.labels.includes("received")) continue;
    if (await args.store.hasInboundMessage(m.messageId)) continue;
    if (args.onNewMessage && (await args.onNewMessage(m).catch(() => false))) continue;
    const outcome = await handleInboundReply(
      { eventId: m.messageId, from, subject: m.subject, text: m.text, threadId: m.threadId, messageId: m.messageId },
      args.store,
    );
    if (outcome.kind === "unknown_sender" || outcome.kind === "duplicate") continue;
    out.push(outcome);
    if (outcome.kind === "needs_reader" && args.onReply) await args.onReply(outcome);
  }
  return out;
}

/**
 * Lists the newest received messages in an AgentMail inbox, with their text. Each message's full text
 * is fetched once and kept, so a fast poll (every 15 s) costs one list call plus one call per new message.
 */
export function agentMailLister(apiKey: string, inboxId: string): () => Promise<PolledMessage[]> {
  const client = new AgentMailClient({ apiKey, timeoutInSeconds: 20, maxRetries: 1 });
  const cache = new Map<string, PolledMessage>();
  return async () => {
    const page = await client.inboxes.messages.list(inboxId, { limit: 25, labels: ["received"] });
    const items: PolledMessage[] = [];
    for (const m of page.messages ?? []) {
      let item = cache.get(m.messageId);
      if (!item) {
        const full = await client.inboxes.messages.get(inboxId, m.messageId);
        const ts = (full as { timestamp?: unknown }).timestamp ?? (m as { timestamp?: unknown }).timestamp;
        item = {
          messageId: m.messageId,
          from: Array.isArray(full.from) ? String(full.from[0] ?? "") : String(full.from ?? ""),
          subject: full.subject ?? "",
          text: full.extractedText ?? full.text ?? "",
          threadId: full.threadId ?? null,
          labels: full.labels ?? [],
          at: ts instanceof Date ? ts.toISOString() : typeof ts === "string" ? ts : null,
        };
        cache.set(m.messageId, item);
      }
      items.push(item);
    }
    if (cache.size > 500) for (const id of [...cache.keys()].slice(0, cache.size - 500)) cache.delete(id);
    return items;
  };
}
