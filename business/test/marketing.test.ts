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
    expect(stats).toMatchObject({ studiosResearched: 2, studiosEmailed: 2, playtestsDelivered: 0, reviewsRead: 0 });
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

describe("research posts", () => {
  it("shares real research totals as percentages, and posts only where an account is connected", async () => {
    const store = new MemoryStore();
    await store.addResearchRun({ at: "2026-11-07T00:00:00Z", chart: "top free puzzle", gamesRead: 30, reviewsRead: 4000, tooHard: 30, tooEasy: 15, wantsMoreLevels: 5, repetitive: 0, gamesWithEvidence: 2, topGame: "A", topReason: "r" });
    const stats = await gatherStats(store);
    const post = composePost("research", stats, { site: "https://levelai.vercel.app/", playtest: null });
    expect(post.content).toContain("read 4,000 player reviews of 30 top mobile puzzle and casual games");
    expect(post.content).toContain("When players complain about the levels, 60% say a level is too hard, 30% say it's too easy, 10% want more levels");
    expect(post.content).not.toContain("repetitive");
    const small = composePost("research", { ...stats, tooHard: 4, tooEasy: 8, wantsMoreLevels: 0 }, { site: "https://levelai.vercel.app", playtest: null });
    expect(small.content).toContain("12 reviews complain about the levels: 8 say it's too easy, 4 say a level is too hard.");
    expect(post.content.endsWith("https://levelai.vercel.app/join")).toBe(true);
    const calls: string[][] = [];
    const naive = { social: {
      accounts: async () => ({ data: [{ platform: "x" }] }),
      createPost: async (_id: string, body: { platforms: string[] }) => { calls.push(body.platforms); return { id: "p", status: "posted" }; },
    } } as unknown as NaiveClient;
    const r = await publish({ naive, identityId: "idn", store, post, dailyCap: 4 });
    expect(r.posted).toEqual(["x"]);
    expect(calls).toEqual([["x"]]);
    expect(r.skipped.every((x) => x.reason === "no account connected")).toBe(true);
  });
});

describe("social loop", () => {
  it("rotates angles and skips research with no new numbers", async () => {
    const { pickAngle } = await import("../src/marketing/loop.js");
    expect(pickAngle({ turn: 0, lastResearchReviews: 0 }, 3150, true)).toBe("research");
    expect(pickAngle({ turn: 0, lastResearchReviews: 3150 }, 3150, true)).toBe("levels");
    expect(pickAngle({ turn: 3, lastResearchReviews: 0 }, 100, true)).toBe("playtest");
    expect(pickAngle({ turn: 3, lastResearchReviews: 0 }, 100, false)).toBe("levels");
  });
});

describe("post status", () => {
  it("counts a post the network rejected as failed, not posted", async () => {
    const store = new MemoryStore();
    const naive = { social: {
      createPost: async () => ({ id: "p1", status: "scheduled" }),
      getPost: async () => ({ status: "failed", error: null }),
    } } as unknown as NaiveClient;
    const r = await publish({ naive, identityId: "idn", store, post: { title: "t", content: "c", platforms: ["x"] }, dailyCap: 4, pollMs: 0 });
    expect(r.posted).toEqual([]);
    expect(r.skipped[0]?.reason).toBe("the network rejected the post");
    expect((await store.listActivity())[0]?.action).toBe("couldn't post on x");
  });
});
