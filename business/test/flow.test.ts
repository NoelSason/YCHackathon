import { describe, expect, it } from "vitest";
import reviewsSample from "./fixtures/reviews-sample.json" with { type: "json" };
import gamesSample from "./fixtures/games-sample.json" with { type: "json" };
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store.js";
import type { MonidRunner } from "../src/research/monid.js";
import type { MailSender } from "../src/outreach/send.js";
import {
  toolDraftOutreach, toolFindTargets, toolRecordReply, toolSaveLead, toolSendOutreach, toolSendReply, toolSetSample, type ToolContext,
} from "../src/mcp/tools.js";

const monid: MonidRunner = {
  async run({ endpoint }) {
    return endpoint === "/google-play/games" ? gamesSample : [reviewsSample];
  },
};

function context(env: Record<string, string>, mail: MailSender | null = null): ToolContext {
  return {
    config: loadConfig({ COMPANY_NAME: "Level AI", COMPANY_POSTAL_ADDRESS: "1752 Shattuck Avenue, Berkeley, CA 94704", ...env }),
    store: new MemoryStore(),
    monid, mail, stripe: null, mobilerun: null, naive: null,
  };
}

describe("business flow, research to reply (no network)", () => {
  it("finds a target, saves a lead, drafts without sending, and records a reply", async () => {
    const ctx = context({});
    const [top] = await toolFindTargets(ctx, { maxGames: 3 });
    expect(top).toBeDefined();
    const lead = await toolSaveLead(ctx, { appId: top!.appId, company: top!.developer, email: "biz@studio.example" });
    expect(lead.stage).toBe("found");

    await expect(toolDraftOutreach(ctx, { leadId: lead.id, senderName: "Noel" })).rejects.toThrow(/sample pack first/);
    const staged = await toolSetSample(ctx, { leadId: lead.id, sampleUrl: "https://levels.example.com/s/1" });
    expect(staged.stage).toBe("sample_made");

    const draft = await toolDraftOutreach(ctx, { leadId: lead.id, senderName: "Noel" });
    expect(draft.blockedReason).toBeNull();
    // No price set, so no payment link and no invented price.
    expect(draft.body).toContain("Just reply and I'll send the details.");
    expect(draft.body).not.toMatch(/\$\d/);

    const sent = await toolSendOutreach(ctx, { draftId: draft.draftId });
    expect(sent.status).toBe("drafted"); // OUTREACH_SEND defaults to off
    await expect(toolSendOutreach(ctx, { draftId: draft.draftId })).rejects.toThrow(/Unknown or expired draft/);

    const after = await toolRecordReply(ctx, { leadId: lead.id, summary: "Asked what a pilot includes.", intent: "interested", nextStep: "send pilot details" });
    expect(after.stage).toBe("pilot_offered");
    expect((await ctx.store.listActivity()).length).toBeGreaterThanOrEqual(3);
  });

  it("sends for real only when OUTREACH_SEND=1 and a mail sender exists", async () => {
    let sends = 0;
    const replies: Array<{ messageId: string; text: string }> = [];
    const ctx = context({ OUTREACH_SEND: "1" }, {
      async send() { sends++; return { messageId: "m1" }; },
      async reply(a) { replies.push(a); return { messageId: "r1" }; },
    });
    const [top] = await toolFindTargets(ctx, { maxGames: 1 });
    const lead = await toolSaveLead(ctx, { appId: top!.appId, company: top!.developer, email: "biz@studio.example" });
    await toolSetSample(ctx, { leadId: lead.id, sampleUrl: "https://levels.example.com/s/2" });
    const draft = await toolDraftOutreach(ctx, { leadId: lead.id, senderName: "Noel" });
    expect((await toolSendOutreach(ctx, { draftId: draft.draftId })).status).toBe("sent");
    expect(sends).toBe(1);
    expect((await ctx.store.getLead(lead.id))!.stage).toBe("emailed");

    // Their reply arrives, and the Sender answers in the same thread with the footer added.
    const { handleInboundReply } = await import("../src/outreach/inbound.js");
    await handleInboundReply({ eventId: "evt_r", from: "biz@studio.example", subject: "Re", text: "What's in a pilot?", threadId: "t", messageId: "<their-msg>" }, ctx.store);
    const invented = await toolSendReply(ctx, { leadId: lead.id, text: "A pilot is 35 levels and we guarantee 99% happy players." });
    expect(invented.status).toBe("blocked");
    expect(invented.reason).toMatch(/no source: 35, 99/);
    const ok = await toolSendReply(ctx, { leadId: lead.id, text: "A pilot is 20 levels in your game's style, each tuned to the difficulty curve you pick." });
    expect(ok.status).toBe("sent");
    expect(replies[0]!.messageId).toBe("<their-msg>");
    expect(replies[0]!.text).toContain("Reply \"stop\"");
    expect(replies[0]!.text).toContain("1752 Shattuck");
  });
});
