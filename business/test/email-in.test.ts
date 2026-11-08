import { beforeEach, describe, expect, it } from "vitest";
import reviewsSample from "./fixtures/reviews-sample.json" with { type: "json" };
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store.js";
import { displayName, parseAuditRequest, takeAuditRequest } from "../src/leads/email-in.js";
import { resetWelcomeCounts, setPlaySearch } from "../src/leads/live.js";
import { resetProgress } from "../src/leads/progress.js";
import { pollOnce, type PolledMessage } from "../src/outreach/poll.js";
import type { MonidRunArgs } from "../src/research/monid.js";
import type { ToolContext } from "../src/mcp/tools.js";

/** Email-in audits: "Audit: <game>" to the sales inbox gets the same audit, answered in the thread. */
function ctx() {
  const replies: Array<{ messageId: string; text: string; html?: string; idempotencyKey: string }> = [];
  const sends: unknown[] = [];
  const c: ToolContext = {
    config: loadConfig({ COMPANY_NAME: "Level AI", COMPANY_POSTAL_ADDRESS: "1752 Shattuck Avenue, Berkeley, CA 94704", DEMO_PLAY_URL: "https://levelai.vercel.app/play", AGENTMAIL_INBOX_ID: "levelai@agentmail.to", TEAM_EMAILS: "noel_sason@berkeley.edu" }),
    store: new MemoryStore(),
    monid: {
      async run(a: MonidRunArgs) {
        return a.endpoint === "/google-play/apps" ? { app_highlight: { title: "Parking Loop", product_id: "com.loop.packedloop", author: "Loop Games" } } : [reviewsSample];
      },
    },
    mail: {
      async send(a) { sends.push(a); return { messageId: "new" }; },
      async reply(a) { replies.push(a); return { messageId: `reply-${replies.length}` }; },
    },
    stripe: null, mobilerun: null, naive: null,
  };
  return { c, replies, sends };
}

const msg = (over: Partial<PolledMessage> = {}): PolledMessage => ({
  messageId: "<in-1@mail.example>", from: "Ada Lovelace <ada@studio.example>", subject: "Audit: Parking Loop", text: "", threadId: "t1",
  labels: ["received"], at: new Date().toISOString(), ...over,
});

beforeEach(() => { resetProgress(); resetWelcomeCounts(); setPlaySearch(async () => null); });

describe("which emails are audit requests", () => {
  it("reads the game from the subject, the body prompt, or a store link", () => {
    expect(parseAuditRequest({ subject: "Audit: Parking Loop", text: "" })).toEqual({ game: "Parking Loop", storeUrl: null });
    expect(parseAuditRequest({ subject: "audit - Royal Match!", text: "" })).toEqual({ game: "Royal Match", storeUrl: null });
    expect(parseAuditRequest({ subject: "Audit:", text: "Game name or store link: Candy Crush\n\nSent from my iPhone" })).toEqual({ game: "Candy Crush", storeUrl: null });
    expect(parseAuditRequest({ subject: "Audit: ", text: "Hi!\nBlock Blast\nthanks" })).toEqual({ game: "Block Blast", storeUrl: null });
    expect(parseAuditRequest({ subject: "our game", text: "https://play.google.com/store/apps/details?id=com.loop.packedloop" }))
      .toEqual({ game: null, storeUrl: "https://play.google.com/store/apps/details?id=com.loop.packedloop" });
    expect(parseAuditRequest({ subject: "Audit: https://apps.apple.com/us/app/royal-match/id1482155847", text: "" }))
      .toEqual({ game: null, storeUrl: "https://apps.apple.com/us/app/royal-match/id1482155847" });
  });

  it("leaves replies and ordinary mail to the reply path", () => {
    expect(parseAuditRequest({ subject: "Re: Audit: Parking Loop", text: "thanks!" })).toBeNull();
    expect(parseAuditRequest({ subject: "Re: What Parking Loop's players are saying", text: "https://play.google.com/store/apps/details?id=a.b" })).toBeNull();
    expect(parseAuditRequest({ subject: "Question about pricing", text: "How much is a pack?" })).toBeNull();
    expect(parseAuditRequest({ subject: "Audit:", text: "" })).toBeNull();
  });

  it("takes the sender's name from the From header", () => {
    expect(displayName("\"Ada Lovelace\" <ada@x.example>")).toBe("Ada Lovelace");
    expect(displayName("ada@x.example")).toBeNull();
  });
});

describe("answering an audit request", () => {
  it("runs the audit and replies in the same thread with the evidence", async () => {
    const { c, replies, sends } = ctx();
    const r = await takeAuditRequest(c, msg());
    expect(r.taken).toBe(true);
    if (!r.taken) return;
    const out = await r.done;
    expect(out).toMatchObject({ audited: true, email: "sent", signal: "too_easy" });
    expect(sends).toHaveLength(0);
    expect(replies).toHaveLength(1);
    expect(replies[0]!.messageId).toBe("<in-1@mail.example>");
    expect(replies[0]!.text).toMatch(/Hi Ada,[\s\S]*Thanks for writing to us[\s\S]*of them say the levels are too easy/);
    expect(replies[0]!.text).toContain("because you emailed us for it");
    expect(replies[0]!.html).toContain("Parking Loop");
    const lead = await c.store.findLeadByEmail("ada@studio.example");
    expect(lead).toMatchObject({ source: "inbound_form", stage: "emailed", contactName: "Ada Lovelace", company: "Ada Lovelace" });
    const actions = (await c.store.listActivity()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["new inbound lead: Ada Lovelace", "found Parking Loop on Google Play", "audited Parking Loop", "outreach sent to Ada Lovelace"]));
    expect(await c.store.hasInboundMessage("<in-1@mail.example>")).toBe(true);
  });

  it("doesn't promise player quotes when there's no evidence", async () => {
    const { c, replies } = ctx();
    c.monid = { async run() { throw new Error("down"); } };
    const r = await takeAuditRequest(c, msg());
    if (r.taken) await r.done;
    expect(replies[0]!.text).toContain("Thanks for writing to us.");
    expect(replies[0]!.text).not.toContain("what your players are saying");
  });

  it("ignores old mail, so a restart doesn't answer yesterday's inbox", async () => {
    const { c } = ctx();
    expect((await takeAuditRequest(c, msg({ at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() }))).taken).toBe(false);
  });

  it("takes audit requests before the reply path, once, and leaves other mail alone", async () => {
    const { c, replies } = ctx();
    const done: Array<Promise<unknown>> = [];
    const inbox = [msg(), msg({ messageId: "<in-2@x>", from: "bob@other.example", subject: "Hello", text: "who are you?" })];
    const onNewMessage = async (m: PolledMessage) => {
      const r = await takeAuditRequest(c, m);
      if (r.taken) done.push(r.done);
      return r.taken;
    };
    await pollOnce({ list: async () => inbox, store: c.store, ownAddress: "levelai@agentmail.to", onNewMessage });
    await pollOnce({ list: async () => inbox, store: c.store, ownAddress: "levelai@agentmail.to", onNewMessage });
    await Promise.all(done);
    expect(replies).toHaveLength(1);
    const actions = (await c.store.listActivity()).map((a) => a.action);
    expect(actions.filter((a) => a === "reply from an unknown sender")).toHaveLength(1); // the "Hello" one
  });
});
