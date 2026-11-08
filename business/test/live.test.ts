import { beforeEach, describe, expect, it } from "vitest";
import reviewsSample from "./fixtures/reviews-sample.json" with { type: "json" };
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store.js";
import { intakeLead } from "../src/leads/intake.js";
import { composeWelcome, resetWelcomeCounts, runLiveSignup, setPlaySearch } from "../src/leads/live.js";
import { joinPage } from "../src/leads/join-page.js";
import type { ToolContext } from "../src/mcp/tools.js";

function ctx(env: Record<string, string> = {}, opts: { failMonid?: boolean } = {}) {
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const c: ToolContext = {
    config: loadConfig({ COMPANY_NAME: "Level AI", COMPANY_POSTAL_ADDRESS: "1752 Shattuck Avenue, Berkeley, CA 94704", DEMO_PLAY_URL: "https://play.levelai.example/match3?level=7", ...env }),
    store: new MemoryStore(),
    monid: {
      async run() {
        if (opts.failMonid) throw new Error("monid down");
        return [reviewsSample];
      },
    },
    mail: { async send(a) { sent.push(a); return { messageId: "m1" }; }, async reply() { return { messageId: "r" }; } },
    stripe: null, mobilerun: null, naive: null,
  };
  return { c, sent };
}

const form = {
  name: "Ada Lovelace", email: "ada@studio.example", company: "Loop Games", game: "Parking Loop",
  storeUrl: "https://play.google.com/store/apps/details?id=com.loop.packedloop", consent: true,
};

describe("live signup", () => {
  beforeEach(() => { resetWelcomeCounts(); setPlaySearch(async () => null); });
  it("audits the game's reviews and emails the evidence and free levels within one call", async () => {
    const { c, sent } = ctx();
    const r = await intakeLead(form, c.store);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const out = await runLiveSignup(c, r.lead, "Parking Loop");
    expect(out).toMatchObject({ audited: true, signal: "too_easy", email: "sent" });
    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    expect(mail.to).toBe("ada@studio.example");
    expect(mail.subject).toBe("What Parking Loop's players are saying");
    expect(mail.text).toMatch(/We just read the 86 newest Google Play reviews of Parking Loop\. \d+ of them say the levels are too easy/);
    expect(mail.text).toContain("https://play.levelai.example/match3?level=7");
    expect(mail.text).toContain("You're getting it because you signed up at our table.");
    expect(mail.text).toContain('Reply "stop"');
    expect((await c.store.getLead(r.lead.id))!.stage).toBe("emailed");
    const actions = (await c.store.listActivity()).map((a) => a.action);
    expect(actions.some((a) => a.startsWith("audited Parking Loop"))).toBe(true);
    expect(actions.some((a) => a.startsWith("outreach sent"))).toBe(true);
  });

  it("still sends a welcome if the reviews can't be read", async () => {
    const { c, sent } = ctx({}, { failMonid: true });
    const r = await intakeLead(form, c.store);
    if (!r.ok) throw new Error("intake failed");
    const out = await runLiveSignup(c, r.lead, "Parking Loop");
    expect(out).toMatchObject({ audited: false, email: "sent" });
    expect(sent[0]!.subject).toBe("Your free levels from Level AI");
  });

  it("only drafts when auto-reply is off", async () => {
    const { c, sent } = ctx({ INBOUND_AUTO_REPLY: "0" });
    const r = await intakeLead(form, c.store);
    if (!r.ok) throw new Error("intake failed");
    expect((await runLiveSignup(c, r.lead, "Parking Loop")).email).toBe("drafted");
    expect(sent).toHaveLength(0);
  });

  it("links the free levels the agents made when real ones exist", async () => {
    const { c, sent } = ctx({ DEMO_PLAY_URL: "" });
    const r = await intakeLead(form, c.store);
    if (!r.ok) throw new Error("intake failed");
    const out = await runLiveSignup(c, r.lead, "Parking Loop", async () => "https://levelai.vercel.app/play?pack=6f1c2a4e-9b3d-4c1a-8e2f-0a1b2c3d4e5f");
    expect(out.email).toBe("sent");
    const mail = sent[0]!;
    expect(mail.text).toContain("Play them on your phone: https://levelai.vercel.app/play?pack=6f1c2a4e-9b3d-4c1a-8e2f-0a1b2c3d4e5f");
    const html = composeWelcome({ lead: r.lead, gameTitle: "Parking Loop", target: null, sampleUrl: "https://levelai.vercel.app/play", companyName: "Level AI", postalAddress: "x" }).html;
    expect(html).toContain("Play your free levels");
    expect(html).toContain('href="https://levelai.vercel.app/play"');
    expect(html).not.toContain("Reply for your free levels");
  });

  it("keeps the reply wording when no levels are ready yet", async () => {
    const { c, sent } = ctx({ DEMO_PLAY_URL: "" });
    const r = await intakeLead(form, c.store);
    if (!r.ok) throw new Error("intake failed");
    expect((await runLiveSignup(c, r.lead, "Parking Loop", async () => null)).email).toBe("sent");
    expect(sent[0]!.text).toContain("Reply and we'll send you free levels made for your game.");
    expect(sent[0]!.text).not.toContain("/play");
    const html = composeWelcome({ lead: r.lead, gameTitle: "Parking Loop", target: null, sampleUrl: null, companyName: "Level AI", postalAddress: "x" }).html;
    expect(html).toContain("Reply for your free levels");
    expect(html).not.toContain("/play");
  });

  it("uses a team-set SAMPLE_PLAY_URL first, and survives a failed level lookup", async () => {
    const pinned = ctx({ SAMPLE_PLAY_URL: "https://levelai.vercel.app/play?level=0b9f3c1e-2d4a-4f6b-8c7d-9e0f1a2b3c4d" });
    const r1 = await intakeLead(form, pinned.c.store);
    if (!r1.ok) throw new Error("intake failed");
    await runLiveSignup(pinned.c, r1.lead, "Parking Loop", async () => "https://levelai.vercel.app/play");
    expect(pinned.sent[0]!.text).toContain("?level=0b9f3c1e-2d4a-4f6b-8c7d-9e0f1a2b3c4d");

    const failing = ctx();
    const r2 = await intakeLead(form, failing.c.store);
    if (!r2.ok) throw new Error("intake failed");
    await runLiveSignup(failing.c, r2.lead, "Parking Loop", async () => { throw new Error("db down"); });
    expect(failing.sent[0]!.text).toContain("https://play.levelai.example/match3?level=7");
  });

  it("serves a join page with no internal details", () => {
    const html = joinPage("Level AI");
    expect(html).toContain("Free levels for your game");
    expect(html).not.toMatch(/monid|agentmail|neon|mcp|webhook/i);
  });
});
