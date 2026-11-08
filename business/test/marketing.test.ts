import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/store.js";
import { composePost, fitForX, gatherStats, publish } from "../src/marketing/posts.js";
import type { NaiveClient } from "../src/naive.js";

describe("marketing posts", () => {
  it("uses only our own numbers and links the site and the playtest page", async () => {
    const store = new MemoryStore();
    for (const email of ["a@x.example", "b@x.example"]) {
      await store.upsertLead({ company: email, appId: null, contactName: null, email, source: "research", stage: "emailed", reason: null, sampleUrl: null, crmContactId: null });
    }
    const stats = await gatherStats(store);
    expect(stats).toEqual({ studiosResearched: 2, studiosEmailed: 2, playtestsDelivered: 0 });
    const levels = composePost("levels", stats, { site: "https://levelai.vercel.app", playtest: null });
    expect(levels.content).toContain("newest reviews of 2 puzzle games");
    expect(levels.content).toContain("https://levelai.vercel.app");
    expect(levels.title).toMatch(/^\[For Hire\]/);
    const playtest = composePost("playtest", stats, { site: "s", playtest: "https://x.trycloudflare.com/playtest" });
    expect(playtest.content).not.toMatch(/delivered \d+/); // none delivered yet, so no claim
    expect(playtest.content).toContain("/playtest");
  });

  it("fits X's 280-character limit without cutting the link", () => {
    const long = `${"word ".repeat(80)}https://levelai.vercel.app`;
    const x = fitForX(long);
    expect(x.length).toBeLessThanOrEqual(280);
    expect(x.endsWith("https://levelai.vercel.app")).toBe(true);
  });

  it("posts per network, labels posts as AI-generated, and stops at the daily cap", async () => {
    const store = new MemoryStore();
    const calls: Array<{ platforms: string[]; ai_generated?: boolean }> = [];
    const naive = { social: { createPost: async (_id: string, body: { platforms: string[]; ai_generated?: boolean }) => { calls.push(body); return { id: "p1", status: "posted" }; } } } as unknown as NaiveClient;
    const post = { title: "t", content: "c https://levelai.vercel.app", platforms: ["x", "linkedin"] as const };
    const first = await publish({ naive, identityId: "idn_1", store, post: { ...post, platforms: [...post.platforms] }, dailyCap: 1 });
    expect(first.posted).toEqual(["x", "linkedin"]);
    expect(calls.every((c) => c.ai_generated === true && c.platforms.length === 1)).toBe(true);
    const second = await publish({ naive, identityId: "idn_1", store, post: { ...post, platforms: [...post.platforms] }, dailyCap: 1 });
    expect(second.posted).toEqual([]);
    expect(second.skipped.map((s) => s.reason)).toEqual(["daily cap of 1 reached", "daily cap of 1 reached"]);
  });
});
