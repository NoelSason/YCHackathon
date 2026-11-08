import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/store.js";
import { composeOutreach, numbersIn } from "../src/outreach/compose.js";
import { checkOutreach, isOptOut } from "../src/outreach/guard.js";
import { idempotencyKey, sendOutreach, type MailSender } from "../src/outreach/send.js";
import { handleInboundReply, verifySvixSignature, parseAgentMailEvent } from "../src/outreach/inbound.js";
import { createHmac } from "node:crypto";
import type { Lead, Target } from "../src/types.js";

const ADDRESS = "560 20th St, San Francisco, CA 94107";

const target: Target = {
  appId: "com.example.puzzle",
  appTitle: "Example Puzzle",
  developer: "Example Games",
  storeUrl: "https://play.google.com/store/apps/details?id=com.example.puzzle",
  downloads: "1,000,000+",
  reviewsAnalyzed: 86,
  signalCounts: { too_easy: 7, too_hard: 1, wants_more_levels: 0, repetitive: 0 },
  primarySignal: "too_easy",
  examples: [{ kind: "too_easy", quote: "it's way too easy", rating: 3, timestamp: null }],
  reason: "7 of the 86 newest Google Play reviews of Example Puzzle say the levels are too easy.",
  score: 8.1,
};

async function setup(stage: Lead["stage"] = "sample_made") {
  const store = new MemoryStore();
  const lead = await store.upsertLead({
    company: "Example Games", appId: target.appId, contactName: "Ada Lovelace", email: "Hello@Example.com",
    source: "research", stage, reason: target.reason, sampleUrl: "https://levels.example.com/s/abc", crmContactId: null,
  });
  return { store, lead };
}

function draftFor(lead: Lead, paymentUrl: string | null = null) {
  return composeOutreach({
    lead, target, sampleUrl: lead.sampleUrl!, pilot: { levels: 20, priceLabel: "$49", paymentUrl },
    sender: { name: "Noel", company: "Level Studio", postalAddress: ADDRESS },
  });
}

const ctx = (store: MemoryStore, extra: string[] = []) => ({
  store, dailyCap: 2, postalAddress: ADDRESS, extraAllowedNumbers: ["https://levels.example.com/s/abc", "$49", ADDRESS, ...extra],
});

describe("composeOutreach", () => {
  it("opens with the measured evidence and includes the legal footer", async () => {
    const { lead } = await setup();
    const { body, subject } = draftFor(lead);
    expect(subject).toBe("A harder early curve for Example Puzzle");
    expect(body).toContain("I read the 86 newest Google Play reviews of Example Puzzle, and 7 of them");
    expect(body).toContain("Hi Ada,");
    expect(body).toContain(ADDRESS);
    expect(body).toMatch(/Reply "stop"/);
    expect(body).toContain("written by one of them");
  });

  it("finds every number in text", () => {
    expect(numbersIn("86 reviews, 7 say, 1,000 players, 4.5 stars")).toEqual(["86", "7", "1000", "4.5"]);
  });
});

describe("checkOutreach", () => {
  it("passes a correct draft", async () => {
    const { store, lead } = await setup();
    expect(await checkOutreach(lead, draftFor(lead), ctx(store))).toBeNull();
  });

  it("blocks a number that no tool measured", async () => {
    const { store, lead } = await setup();
    const draft = draftFor(lead);
    draft.body = draft.body.replace("7 of them", "40 of them");
    expect(await checkOutreach(lead, draft, ctx(store))).toMatch(/numbers with no source: 40/);
  });

  it("blocks without a postal address, after opt-out, and on a second first-touch", async () => {
    const { store, lead } = await setup();
    expect(await checkOutreach(lead, draftFor(lead), { ...ctx(store), postalAddress: undefined })).toMatch(/POSTAL_ADDRESS/);
    await store.suppress("hello@example.com", "test");
    expect(await checkOutreach(lead, draftFor(lead), ctx(store))).toMatch(/opted out/);
    const emailed = await setup("emailed");
    expect(await checkOutreach(emailed.lead, draftFor(emailed.lead), ctx(emailed.store))).toMatch(/already contacted/);
  });

  it("enforces the daily cap", async () => {
    const { store, lead } = await setup();
    for (let i = 0; i < 2; i++) {
      await store.addOutreach({ leadId: "x", to: "a@b.c", subject: "s", body: "b", status: "sent", blockedReason: null, providerMessageId: "m" });
    }
    expect(await checkOutreach(lead, draftFor(lead), ctx(store))).toMatch(/Daily cap of 2/);
  });
});

describe("separate caps", () => {
  it("doesn't count signup welcomes against the cold-outreach cap", async () => {
    const { store, lead } = await setup();
    const signup = await store.upsertLead({ company: "Fan", appId: null, contactName: null, email: "fan@x.example", source: "inbound_form", stage: "found", reason: null, sampleUrl: null, crmContactId: null });
    for (let i = 0; i < 3; i++) {
      await store.addOutreach({ leadId: signup.id, to: "fan@x.example", subject: "s", body: "b", status: "sent", blockedReason: null, providerMessageId: `m${i}` });
    }
    expect(await checkOutreach(lead, draftFor(lead), ctx(store))).toBeNull(); // cold cap is 2, but 0 cold sent
    expect(await store.countSentSince(new Date(0).toISOString(), true)).toBe(3);
  });
});

describe("sendOutreach", () => {
  it("only drafts when sending is off", async () => {
    const { store, lead } = await setup();
    const record = await sendOutreach(lead, draftFor(lead), { ...ctx(store), sender: null, sendingEnabled: false, agent: "test" });
    expect(record.status).toBe("drafted");
    expect((await store.getLead(lead.id))!.stage).toBe("sample_made");
  });

  it("sends once with an idempotency key, then moves the lead to emailed", async () => {
    const { store, lead } = await setup();
    const calls: string[] = [];
    const sender: MailSender = { async send(a) { calls.push(a.idempotencyKey); return { messageId: "msg_1" }; }, async reply() { return { messageId: "r" }; } };
    const record = await sendOutreach(lead, draftFor(lead), { ...ctx(store), sender, sendingEnabled: true, agent: "test" });
    expect(record.status).toBe("sent");
    expect(calls).toEqual([idempotencyKey("first-touch", lead.id)]);
    expect(calls[0]).toMatch(/^[0-9a-f]{40}$/);
    expect((await store.getLead(lead.id))!.stage).toBe("emailed");
    expect((await store.listActivity()).some((a) => a.action.includes("outreach sent"))).toBe(true);
  });
});

describe("inbound replies", () => {
  it("recognizes opt-outs broadly", () => {
    expect(isOptOut("STOP")).toBe(true);
    expect(isOptOut("please remove me from your list")).toBe(true);
    expect(isOptOut("Sounds interesting, what does a pilot include?")).toBe(false);
  });

  it("suppresses an opt-out and never emails again", async () => {
    const { store, lead } = await setup("emailed");
    const out = await handleInboundReply({ eventId: "evt_stop", from: "hello@example.com", subject: "Re", text: "stop", threadId: null, messageId: null }, store);
    expect(out.kind).toBe("opted_out");
    expect(await store.isSuppressed("hello@example.com")).toBe(true);
    expect((await store.getLead(lead.id))!.stage).toBe("opted_out");
  });

  it("routes a real reply to the Sales Reader and dedupes retries", async () => {
    const { store } = await setup("emailed");
    const reply = { eventId: "evt_1", from: "hello@example.com", subject: "Re", text: "What does it cost?", threadId: "t", messageId: "m" };
    expect((await handleInboundReply(reply, store)).kind).toBe("needs_reader");
    expect((await handleInboundReply(reply, store)).kind).toBe("duplicate");
  });

  it("parses AgentMail message.received and pulls the address out of a display name", () => {
    const r = parseAgentMailEvent({
      event_type: "message.received", event_id: "evt_9",
      message: { from: "Ada <ada@example.com>", subject: "Re: levels", text: "hi", thread_id: "th", message_id: "mid" },
    });
    expect(r).toMatchObject({ eventId: "evt_9", from: "ada@example.com", subject: "Re: levels" });
  });

  it("verifies Svix signatures and rejects tampering and stale timestamps", () => {
    const secret = `whsec_${Buffer.from("test-secret").toString("base64")}`;
    const body = '{"event_type":"message.received"}';
    const ts = "1700000000";
    const sig = createHmac("sha256", Buffer.from("test-secret")).update(`msg_1.${ts}.${body}`).digest("base64");
    const base = { secret, id: "msg_1", timestamp: ts, signature: `v1,${sig}`, nowSeconds: 1700000010 };
    expect(verifySvixSignature({ ...base, body })).toBe(true);
    expect(verifySvixSignature({ ...base, body: body + " " })).toBe(false);
    expect(verifySvixSignature({ ...base, body, nowSeconds: 1700009999 })).toBe(false);
  });
});

describe("html email", () => {
  it("passes the draft's HTML version to the sender", async () => {
    const { sendOutreach } = await import("../src/outreach/send.js");
    const { MemoryStore } = await import("../src/store.js");
    const store = new MemoryStore();
    const lead = await store.upsertLead({ company: "Loop Games", email: "hi@loop.example", source: "inbound", appId: null, reason: "signed up" } as never);
    const sent: Array<{ html?: string }> = [];
    await sendOutreach(lead, { subject: "s", body: "Hello.\n\n1752 Shattuck Avenue, Berkeley, CA 94704\nReply \"stop\" to opt out.", facts: [], html: "<b>hi</b>" }, {
      store, dailyCap: 20, inboundDailyCap: 200, postalAddress: "1752 Shattuck Avenue, Berkeley, CA 94704", extraAllowedNumbers: ["1752 Shattuck Avenue, Berkeley, CA 94704"],
      sender: { async send(a: { html?: string }) { sent.push(a); return { messageId: "m" }; }, async reply() { return { messageId: "r" }; } },
      sendingEnabled: true, agent: "test",
    } as never);
    expect(sent[0]?.html).toBe("<b>hi</b>");
  });
});
