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
}

export async function pollOnce(args: {
  list: () => Promise<PolledMessage[]>;
  store: Store;
  ownAddress: string;
  onReply?: (outcome: Extract<InboundOutcome, { kind: "needs_reader" }>) => Promise<void>;
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

/** Lists the newest received messages in an AgentMail inbox, with their text. */
export function agentMailLister(apiKey: string, inboxId: string): () => Promise<PolledMessage[]> {
  const client = new AgentMailClient({ apiKey });
  return async () => {
    const page = await client.inboxes.messages.list(inboxId, { limit: 25, labels: ["received"] });
    const items: PolledMessage[] = [];
    for (const m of page.messages ?? []) {
      const full = await client.inboxes.messages.get(inboxId, m.messageId);
      items.push({
        messageId: m.messageId,
        from: Array.isArray(full.from) ? String(full.from[0] ?? "") : String(full.from ?? ""),
        subject: full.subject ?? "",
        text: full.extractedText ?? full.text ?? "",
        threadId: full.threadId ?? null,
        labels: full.labels ?? [],
      });
    }
    return items;
  };
}
