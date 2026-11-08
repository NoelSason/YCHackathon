import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../src/mcp/tools.js";
import { MemoryStore } from "../src/store.js";
import type { Config } from "../src/config.js";
import type { MonidRunArgs, MonidRunner } from "../src/research/monid.js";

// The loop and the spend counter keep state in temp files. Point them away from the running server's.
process.env.TMPDIR = mkdtempSync(join(tmpdir(), "research-budget-"));
const monidModule = () => import("../src/research/monid.js");
const autopilot = () => import("../src/outreach/autopilot.js");

const chart = (ids: string[]) => ({ organic_results: [{ items: ids.map((id) => ({ product_id: id, title: id, author: `Dev ${id}` })) }] });
const quietReviews = [{ items: [{ review_text: "nice colors", rating: { value: 5 } }] }];

function monidWith(charts: string[][]) {
  const calls: MonidRunArgs[] = [];
  let n = 0;
  const monid: MonidRunner = {
    async run(args) {
      calls.push(args);
      return args.endpoint === "/google-play/games" ? chart(charts[n++] ?? []) : quietReviews;
    },
  };
  return { monid, calls, chartCalls: () => calls.filter((c) => c.endpoint === "/google-play/games").length };
}

function ctxFor(monid: MonidRunner, MONID_DAILY_USD = 5) {
  const store = new MemoryStore();
  return { store, ctx: { config: { MONID_DAILY_USD } as Config, store, monid } as unknown as ToolContext };
}

beforeAll(async () => {
  await monidModule();
});

describe("Monid cost parsing", () => {
  it("reads the CLI's top-level cost in USD", async () => {
    const { reportedCostMicro } = await monidModule();
    expect(reportedCostMicro(JSON.stringify({ cost: { value: 0.0015, currency: "USD" } }))).toBe(1500);
    expect(reportedCostMicro(JSON.stringify({ cost: { value: 0.0015, currency: "EUR" } }))).toBe(0);
  });

  it("starts the daily total over on a new Pacific day", async () => {
    const { addDaily } = await monidModule();
    expect(addDaily({ day: "2026-11-07", micro: 100 }, 50, "2026-11-07")).toEqual({ day: "2026-11-07", micro: 150 });
    expect(addDaily({ day: "2026-11-07", micro: 100 }, 50, "2026-11-08")).toEqual({ day: "2026-11-08", micro: 50 });
  });
});

describe("review cache", () => {
  it("reuses a game's reviews and only remembers real results", async () => {
    const { fetchRecentReviews, recentlyFetchedAppIds } = await monidModule();
    const { monid, calls } = monidWith([]);
    await fetchRecentReviews(monid, "com.a");
    await fetchRecentReviews(monid, "com.a");
    expect(calls).toHaveLength(1);
    expect(recentlyFetchedAppIds(monid)).toEqual(new Set(["com.a"]));

    const empty: MonidRunner = { run: async () => [{ items: [] }] };
    await fetchRecentReviews(empty, "com.b");
    expect(recentlyFetchedAppIds(empty).size).toBe(0);
  });
});

describe("outreach pass", () => {
  it("times the next pass from when this one started", async () => {
    const { nextPassDelayMs } = await autopilot();
    expect(nextPassDelayMs(0, 4 * 60_000, 10 * 60_000)).toBe(6 * 60_000);
    expect(nextPassDelayMs(0, 14 * 60_000, 10 * 60_000)).toBe(30_000);
  });

  it("stops at the daily cap without touching the stores, and logs it once", async () => {
    const { runOutreachCycle } = await autopilot();
    const { monid, calls } = monidWith([["com.capped"]]);
    const { ctx, store } = ctxFor(monid, 0);
    expect(await runOutreachCycle(ctx)).toMatchObject({ sent: 0, reason: "Monid daily cap reached" });
    await runOutreachCycle(ctx);
    expect(calls).toHaveLength(0);
    expect((await store.listActivity()).filter((a) => a.action.startsWith("paused market research"))).toHaveLength(1);
  });

  it("moves to the next chart when one has nothing new, and counts only games read", async () => {
    const { runOutreachCycle } = await autopilot();
    const { monid, chartCalls } = monidWith([[], ["com.fresh"]]);
    const { ctx, store } = ctxFor(monid);
    await runOutreachCycle(ctx, { maxGames: 5 });
    expect(chartCalls()).toBe(2);
    const runs = await store.listResearchRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ gamesRead: 1, reviewsRead: 1 });
    expect((await store.listActivity()).some((a) => /^read 1 player reviews of 1 /.test(a.action))).toBe(true);
  });

  it("says so plainly when no chart has new games", async () => {
    const { runOutreachCycle } = await autopilot();
    const { monid, chartCalls } = monidWith([[], [], []]);
    const { ctx, store } = ctxFor(monid);
    expect(await runOutreachCycle(ctx, { maxGames: 5 })).toMatchObject({ sent: 0, reason: null });
    expect(chartCalls()).toBe(3);
    expect(await store.listResearchRuns()).toHaveLength(0);
    expect((await store.listActivity()).some((a) => a.action.startsWith("no new games to read"))).toBe(true);
  });
});
