import { beforeEach, describe, expect, it } from "vitest";
import Stripe from "stripe";
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store.js";
import { classifyReply, ownWords } from "../src/outreach/guard.js";
import { answerReply, handleInboundReply, setReplyResponder, type InboundReply } from "../src/outreach/inbound.js";
import { toolSendReply, type ToolContext } from "../src/mcp/tools.js";

// Replies to outreach, answered without a person: only short, plainly interested ones get an
// email. Everything else is closed (a clear no) or left for a person, and every decision is logged.
const ADDRESS = "1752 Shattuck Avenue, Berkeley, CA 94704";

function setup(env: Record<string, string> = {}) {
  const replies: Array<{ messageId: string; text: string; idempotencyKey: string }> = [];
  const store = new MemoryStore();
  const ctx: ToolContext = {
    config: loadConfig({ COMPANY_POSTAL_ADDRESS: ADDRESS, OUTREACH_SEND: "1", PLAYTEST_PRICE_USD: "5", ...env }),
    store, monid: null, naive: null, mobilerun: null, stripe: new Stripe("sk_test_dummy"),
    mail: {
      async send() { throw new Error("no first emails in this test"); },
      async reply(a) { replies.push(a); return { messageId: `reply_${replies.length}` }; },
    },
  };
  return { ctx, store, replies };
}

let n = 0;
const reply = (from: string, text: string, subject = "Re: your levels"): InboundReply => {
  n += 1;
  return { eventId: `<e${n}>`, from, subject, text, threadId: "t1", messageId: `<msg${n}>` };
};

async function studio(store: MemoryStore, email = "hi@loopgames.example", company = "Loop Games") {
  return store.upsertLead({ company, appId: "com.loop.parking", contactName: null, email, source: "research", stage: "emailed", reason: "7 of 86 newest reviews say levels are too easy.", sampleUrl: null, crmContactId: null });
}

describe("classifyReply", () => {
  it.each([
    ["Sounds interesting, tell me more.", "interested"],
    ["Yes, send me the levels", "interested"],
    ["How much does it cost?", "interested"],
    ["sure", "interested"],
    ["Not interested, thanks.", "not_interested"],
    ["Interesting, but not right now.", "not_interested"],
    ["This is spam. How did you get my email?", "hostile"],
    ["Interesting. Can your agents handle our custom physics engine?", "unclear"],
    ["Not sure what this is.", "unclear"],
    ["Thanks", "unclear"],
    ["I'm out of the office until Monday.", "auto_reply"],
    [`Interested! ${"We have a lot of context to share. ".repeat(15)}`, "unclear"],
  ])("%s → %s", (text, intent) => {
    expect(classifyReply("Re: levels", text).intent).toBe(intent);
  });

  it("judges only their own words, not our quoted email", () => {
    const text = "Not interested.\n\nOn Sat, Nov 7, 2026 at 3:00 PM Level AI <levelai@agentmail.to> wrote:\n> Would you like to see more? Tell me more interested sounds good";
    expect(ownWords(text)).toBe("Not interested.");
    expect(classifyReply("Re:", text).intent).toBe("not_interested");
  });
});

describe("answering replies on our own", () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
    setReplyResponder((o) => answerReply(s.ctx, o));
  });

  it("answers an interested reply in the thread with the free levels and the playtest order link, once", async () => {
    const lead = await studio(s.store);
    const first = await handleInboundReply(reply(lead.email!, "Sounds interesting, tell me more!"), s.store);
    expect(first).toEqual({ kind: "auto_answered", leadId: lead.id });
    expect(s.replies).toHaveLength(1);
    const body = s.replies[0]!.text;
    expect(s.replies[0]!.messageId).toBe(`<msg${n}>`);
    expect(body).toContain("https://levelai.vercel.app/play");
    expect(body).toContain("$5 phone playtest");
    expect(body).toContain("https://levelai.vercel.app/playtest");
    expect(body).toContain(ADDRESS);
    expect(body).toContain('Reply "stop"');
    expect(body).not.toMatch(/stripe|mobilerun|agentmail|neon|naïve|naive/i);
    expect((await s.store.getLead(lead.id))!.stage).toBe("pilot_offered");
    const acts = (await s.store.listActivity(50)).map((a) => a.action);
    expect(acts).toContain("auto-replied to Loop Games");
    expect(acts).toContain("replied to Loop Games");

    // A second reply is a conversation now: a person handles it.
    const second = await handleInboundReply(reply(lead.email!, "Great, send them over"), s.store);
    expect(second.kind).toBe("needs_reader");
    expect(s.replies).toHaveLength(1);
    expect((await s.store.listActivity(5)).find((a) => a.action === "reply from Loop Games left for a person")?.why).toMatch(/already answered/);
  });

  it("an agent can't answer the same message again after the auto-answer", async () => {
    const lead = await studio(s.store);
    await handleInboundReply(reply(lead.email!, "Yes please, tell me more"), s.store);
    const again = await toolSendReply(s.ctx, { leadId: lead.id, text: "Following up on your note with more details for you." });
    expect(again).toEqual({ status: "blocked", reason: "Their latest message was already answered." });
    expect(s.replies).toHaveLength(1);
  });

  it("leaves hostile and unclear replies for a person, and closes a clear no without emailing", async () => {
    const a = await studio(s.store, "a@x.example", "Studio A");
    const b = await studio(s.store, "b@x.example", "Studio B");
    const c = await studio(s.store, "c@x.example", "Studio C");
    expect((await handleInboundReply(reply(a.email!, "This is spam. How did you get my email?"), s.store)).kind).toBe("needs_reader");
    expect((await handleInboundReply(reply(b.email!, "Can you do levels for our Unity game with custom physics?"), s.store)).kind).toBe("needs_reader");
    expect((await handleInboundReply(reply(c.email!, "No thanks."), s.store)).kind).toBe("auto_answered");
    expect(s.replies).toHaveLength(0);
    expect((await s.store.getLead(c.id))!.stage).toBe("lost");
    const acts = await s.store.listActivity(50);
    expect(acts.filter((x) => / left for a person$/.test(x.action)).map((x) => x.action).sort()).toEqual([
      "reply from Studio A left for a person", "reply from Studio B left for a person",
    ]);
    expect(acts.map((x) => x.action)).toContain("decided not to answer Studio C");
  });

  it("honors stop: suppressed, no answer", async () => {
    const lead = await studio(s.store);
    expect((await handleInboundReply(reply(lead.email!, "stop"), s.store)).kind).toBe("opted_out");
    expect(await s.store.isSuppressed(lead.email!)).toBe(true);
    expect(s.replies).toHaveLength(0);
  });

  it("stops at the daily cap", async () => {
    setReplyResponder((o) => answerReply(s.ctx, o, { dailyCap: 1 }));
    const a = await studio(s.store, "a@x.example", "Studio A");
    const b = await studio(s.store, "b@x.example", "Studio B");
    expect((await handleInboundReply(reply(a.email!, "Interested, tell me more"), s.store)).kind).toBe("auto_answered");
    expect((await handleInboundReply(reply(b.email!, "Interested, tell me more"), s.store)).kind).toBe("needs_reader");
    expect(s.replies).toHaveLength(1);
    expect((await s.store.listActivity(5)).find((x) => x.action === "reply from Studio B left for a person")?.why).toBe("daily cap of 1 automatic answers reached");
  });

  it("sends nothing while sending is off, and leaves the reply for the Reader", async () => {
    s = setup({ OUTREACH_SEND: "0" });
    setReplyResponder((o) => answerReply(s.ctx, o));
    const lead = await studio(s.store);
    expect((await handleInboundReply(reply(lead.email!, "Interested, tell me more"), s.store)).kind).toBe("needs_reader");
    expect(s.replies).toHaveLength(0);
    expect((await s.store.listActivity(5)).map((x) => x.action)).toContain("auto-answer not sent to Loop Games");
  });

  it("leaves the price out when no playtest price is set", async () => {
    s = setup({ PLAYTEST_PRICE_USD: "" });
    setReplyResponder((o) => answerReply(s.ctx, o));
    const lead = await studio(s.store);
    await handleInboundReply(reply(lead.email!, "Interested, tell me more"), s.store);
    expect(s.replies[0]!.text).toContain("Phone playtest: send us your app's link");
    expect(s.replies[0]!.text).not.toContain("$");
  });
});
