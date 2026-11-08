import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/store.js";
import { pollOnce, type PolledMessage } from "../src/outreach/poll.js";

describe("inbox polling", () => {
  it("handles a studio's reply once, skips our own and AgentMail's mail, and honors stop", async () => {
    const store = new MemoryStore();
    const lead = await store.upsertLead({ company: "Loop Games", appId: null, contactName: null, email: "support@loopgames.net", source: "research", stage: "emailed", reason: null, sampleUrl: null, crmContactId: null });
    const other = await store.upsertLead({ company: "Rotatelab", appId: null, contactName: null, email: "info@rotatelab.com", source: "research", stage: "emailed", reason: null, sampleUrl: null, crmContactId: null });
    const msgs: PolledMessage[] = [
      { messageId: "<w>", from: "AgentMail Admin <admin@agentmail.to>", subject: "Welcome", text: "hi", threadId: null, labels: ["received"] },
      { messageId: "<r1>", from: "Loop <support@loopgames.net>", subject: "Re: levels", text: "Interesting, what does a pilot cost?", threadId: "t1", labels: ["received"] },
      { messageId: "<r2>", from: "info@rotatelab.com", subject: "Re", text: "stop", threadId: "t2", labels: ["received"] },
    ];
    const woken: string[] = [];
    const seen = new Set<string>();
    const first = await pollOnce({ list: async () => msgs, store, ownAddress: "levelai@agentmail.to", seen, onReply: async (o) => { woken.push(o.leadId); } });
    expect(first.map((o) => o.kind).sort()).toEqual(["needs_reader", "opted_out"]);
    expect(woken).toEqual([lead.id]);
    expect((await store.getLead(lead.id))!.stage).toBe("replied");
    expect((await store.getLead(other.id))!.stage).toBe("opted_out");
    // Next minute: nothing new, nothing handled twice (even after a restart, the saved email blocks it).
    expect(await pollOnce({ list: async () => msgs, store, ownAddress: "levelai@agentmail.to" })).toEqual([]);
  });
});
