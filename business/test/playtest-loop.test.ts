import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type Mobilerun from "@mobilerun/sdk";
import { z } from "zod";
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store.js";
import { enqueue } from "../src/leads/playtest-offer.js";
import type { ToolContext } from "../src/mcp/tools.js";
import { LoopResultSchema, MARKET_GAMES, pickWork, runLoopCycle, summarize, workToTask, type LoopResult } from "../src/mobile/loop.js";
import { decodePng, flatShare, isBlank } from "../src/mobile/screen.js";

/** A tiny 8-bit RGB PNG (CRCs left zero; the decoder doesn't check them). */
function png(w: number, h: number, color: (x: number, y: number) => [number, number, number], bitDepth: 8 | 16 = 8): Buffer {
  const bpp = 3 * (bitDepth / 8);
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * bpp); // filter 0
    for (let x = 0; x < w; x++) {
      const c = color(x, y);
      for (let k = 0; k < 3; k++) {
        if (bitDepth === 8) row[1 + x * 3 + k] = c[k]!;
        else { row[1 + x * 6 + k * 2] = c[k]!; row[2 + x * 6 + k * 2] = 0x80; }
      }
    }
    rows.push(row);
  }
  const chunk = (type: string, body: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    return Buffer.concat([len, Buffer.from(type, "ascii"), body, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = bitDepth; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
const BLANK = png(60, 120, () => [255, 255, 255]);
const BOARD = png(60, 120, (x, y) => (x > 10 && x < 50 && y > 30 && y < 90 ? [(x * 40) % 256, (y * 20) % 256, 90] : [250, 248, 239]));

const good: LoopResult = {
  loaded: true, touchOk: true, won: true, levelReached: 3, movesUsed: 18, movesBeforeRamp: 2,
  stuckAt: "level 4 needs a 3-move combo", designNote: "Introduce one new tube per level.", visualIssues: [],
};

interface Calls { runs: Array<Record<string, unknown>>; deepLinks: string[]; home: number; stopped: string[] }

function fakePhone(opts: { output?: unknown; active?: Array<{ id: string; deviceId: string; status: string }>; never?: boolean; screen?: (url: string | undefined) => Buffer } = {}) {
  const calls: Calls = { runs: [], deepLinks: [], home: 0, stopped: [] };
  const screen = opts.screen ?? (() => BOARD);
  const client = {
    tasks: {
      list: async () => ({ items: opts.active ?? [] }),
      run: async (body: Record<string, unknown>) => { calls.runs.push(body); return { id: `task_${calls.runs.length}`, status: "created" }; },
      getStatus: async () =>
        opts.never ? { status: "running" } : { status: "completed", succeeded: true, message: "done", output: opts.output ?? good, steps: 12 },
      stop: async (id: string) => { calls.stopped.push(id); return {}; },
    },
    devices: {
      deepLink: { executeDeepLink: async (_d: string, p: { deepLink: string }) => { calls.deepLinks.push(p.deepLink); } },
      actions: { global: async (_d: string, p: { action: number }) => { if (p.action === 2) calls.home++; } },
      screenshots: {
        capture: () => ({ asResponse: async () => new Response(new Uint8Array(screen(calls.deepLinks.at(-1))), { headers: { "content-type": "image/png" } }) }),
      },
    },
  } as unknown as Mobilerun;
  return { client, calls };
}

function ctx(phone: Mobilerun | null): ToolContext {
  return {
    config: loadConfig({ MOBILERUN_DEVICE_ID: "dev_1", SITE_URL: "https://levels.example" }),
    store: new MemoryStore(), monid: null, mail: null, stripe: null, naive: null, mobilerun: phone,
  };
}

const noLevels: typeof fetch = async () => new Response(JSON.stringify({ game_id: "match3", pack: null, levels: [] }));
const withLevels = (ids: string[]): typeof fetch => async () =>
  new Response(JSON.stringify({ game_id: "match3", pack: null, levels: ids.map((id) => ({ level_id: id, target_win_rate: 0.6 })) }));
const LEVEL_A = "11111111-1111-4111-8111-111111111111";
const LEVEL_B = "22222222-2222-4222-8222-222222222222";
const fast = { fetchImpl: noLevels, pollMs: 1 };
const log = (c: ToolContext, action: string) => c.store.logActivity({ at: new Date().toISOString(), agent: "playtest-lead", action, why: null, result: null, costUsd: null, human: false });

describe("blank-screen check", () => {
  it("tells a blank page from a game board, at 8 and 16 bits", () => {
    expect(isBlank(BLANK)).toBe(true);
    expect(isBlank(BOARD)).toBe(false);
    expect(isBlank(png(60, 120, () => [255, 255, 255], 16))).toBe(true);
    expect(decodePng(png(4, 4, () => [1, 2, 3], 16))).toMatchObject({ width: 4, height: 4, bytes: 2 });
    expect(flatShare(Buffer.from("not a png"))).toBe(null);
  });
});

describe("playtest loop", () => {
  it("gives Mobilerun an output schema without anyOf", () => {
    expect(JSON.stringify(z.toJSONSchema(LoopResultSchema))).not.toContain("anyOf");
  });

  it("studies a market game when we have no levels, with console-friendly wording, and leaves the board up", async () => {
    const { client, calls } = fakePhone();
    const c = ctx(client);
    const r = await runLoopCycle(c, fast);
    expect(r.ran).toBe(true);
    if (!r.ran) return;
    const g = MARKET_GAMES[0]!;
    expect(r.work.url).toBe(g.url);
    expect(calls.deepLinks).toEqual([g.url]);
    expect(calls.runs[0]).toMatchObject({ deviceId: "dev_1", maxSteps: 25, executionTimeout: 360, vision: true, recordingEnabled: false });
    expect(calls.home).toBe(0); // the board is showing, so it stays on screen
    const acts = await c.store.listActivity();
    const start = acts.find((a) => a.action.startsWith("playtesting "))!;
    expect(start.action).toBe(`playtesting ${g.name} (web game, market study) on the iPhone`);
    expect(start.why).toBe(`${g.name} (free web game)`);
    expect(acts.find((a) => a.action.startsWith("playtested "))!.action).toBe(
      `playtested ${g.name} (web game): won, reached level 3 in 18 moves; got harder after 2; stuck: level 4 needs a 3-move combo`,
    );
    for (const a of acts) expect(`${a.action} ${a.why} ${a.result}`).not.toMatch(/https?:|'s app/);
  });

  it("logs a game that stays blank as not loaded, and moves on to the next game", async () => {
    const [first, second] = MARKET_GAMES;
    const { client, calls } = fakePhone({ screen: (url) => (url === first!.url ? BLANK : BOARD) });
    const c = ctx(client);
    const r = await runLoopCycle(c, fast);
    expect(r.ran && r.work.name).toBe(second!.name);
    expect(r.ran && r.tried).toEqual([first!.name, second!.name]);
    expect(calls.runs).toHaveLength(1);
    const failed = (await c.store.listActivity()).find((a) => a.action === `playtest failed for ${first!.name} (web game)`);
    expect(failed?.result).toContain("didn't load on the phone");
  });

  it("stops a run when the screen goes blank mid-task, and goes home", async () => {
    let n = 0;
    const { client, calls } = fakePhone({ never: true, screen: () => (n++ < 1 ? BOARD : BLANK) });
    const c = ctx(client);
    const r = await runLoopCycle(c, fast);
    expect(r.ran && r.error).toContain("went blank");
    expect(calls.stopped).toEqual(["task_1"]);
    expect(calls.home).toBe(1);
    expect((await c.store.listActivity()).some((a) => a.action.startsWith("playtested "))).toBe(false);
  });

  it("rotates to the market game played least recently", async () => {
    const c = ctx(fakePhone().client);
    await log(c, `playtested ${MARKET_GAMES[0]!.name} (web game): won`);
    expect((await pickWork(c, noLevels))[0]!.name).toBe(MARKET_GAMES[1]!.name);
    for (const g of MARKET_GAMES.slice(1)) await log(c, `playtested ${g.name} (${g.bundleId ? "iOS app" : "web game"}): won`);
    expect((await pickWork(c, noLevels))[0]!.name).toBe(MARKET_GAMES[0]!.name);
  });

  it("playtests our own levels first, preferring one the phone hasn't played", async () => {
    const c = ctx(fakePhone().client);
    const [w1] = await pickWork(c, withLevels([LEVEL_A, LEVEL_B]));
    expect(w1).toMatchObject({ kind: "own", url: `https://levels.example/play?level=${LEVEL_A}`, levelId: LEVEL_A });
    await log(c, `playtested ${w1!.name}: won in 9 moves`);
    const next = await pickWork(c, withLevels([LEVEL_A, LEVEL_B]));
    expect(next[0]!.url).toContain(LEVEL_B);
    expect(next.at(-1)!.kind).toBe("market");
    expect(workToTask(w1!)).toContain("match-3 level made by our level designer");
  });

  it("studies another game after two runs of our own levels", async () => {
    const c = ctx(fakePhone().client);
    const [w1] = await pickWork(c, withLevels([LEVEL_A, LEVEL_B]));
    await log(c, `playtested ${w1!.name}: won in 9 moves`);
    const [w2] = await pickWork(c, withLevels([LEVEL_A, LEVEL_B]));
    await log(c, `playtested ${w2!.name}: lost`);
    const [w3] = await pickWork(c, withLevels([LEVEL_A, LEVEL_B]));
    expect(w3!.kind).toBe("market");
    await log(c, `playtested ${w3!.name} (web game): won`);
    expect((await pickWork(c, withLevels([LEVEL_A, LEVEL_B])))[0]!.kind).toBe("own");
  });

  it("falls back to market work when the level list can't be read", async () => {
    const c = ctx(fakePhone().client);
    const down: typeof fetch = async () => { throw new Error("offline"); };
    expect((await pickWork(c, down))[0]!.kind).toBe("market");
  });

  it("skips while another task is active on the phone", async () => {
    const { client, calls } = fakePhone({ active: [{ id: "busy_1", deviceId: "dev_1", status: "running" }, { id: "x", deviceId: "other", status: "running" }] });
    const r = await runLoopCycle(ctx(client), fast);
    expect(r).toEqual({ ran: false, reason: "another task is running on the phone (busy_1)" });
    expect(calls.runs).toHaveLength(0);
  });

  it("re-checks the phone right before the run and backs off if an order started elsewhere", async () => {
    const { client, calls } = fakePhone();
    let listed = 0;
    (client.tasks as unknown as { list: () => Promise<unknown> }).list = async () =>
      ({ items: listed++ === 0 ? [] : [{ id: "order_9", deviceId: "dev_1", status: "running" }] });
    const r = await runLoopCycle(ctx(client), fast);
    expect(r).toEqual({ ran: false, reason: "another task is running on the phone (order_9)" });
    expect(calls.runs).toHaveLength(0);
    expect(calls.deepLinks).toHaveLength(0);
  });

  it("skips while a paid order is in the queue", async () => {
    const { client, calls } = fakePhone();
    let release!: () => void;
    const order = enqueue(() => new Promise<void>((r) => { release = r; }));
    const r = await runLoopCycle(ctx(client), fast);
    expect(r).toEqual({ ran: false, reason: "a paid playtest order is queued or running" });
    expect(calls.runs).toHaveLength(0);
    release();
    await order;
  });

  it("logs a failure honestly and goes home when the result is unreadable", async () => {
    const { client, calls } = fakePhone({ output: { nope: true } });
    const c = ctx(client);
    const r = await runLoopCycle(c, fast);
    expect(r.ran && r.result).toBe(null);
    expect(calls.home).toBe(1);
    const acts = await c.store.listActivity();
    expect(acts.find((a) => a.action.startsWith("playtest failed for "))?.result).toContain("without a readable result");
    expect(acts.some((a) => a.action.startsWith("playtested "))).toBe(false);
  });

  it("counts an agent report of loaded = false as a failure", async () => {
    const { client } = fakePhone({ output: { ...good, loaded: false } });
    const c = ctx(client);
    const r = await runLoopCycle(c, fast);
    expect(r.ran && r.error).toBe("didn't load on the phone");
    expect((await c.store.listActivity()).some((a) => a.action.startsWith("playtested "))).toBe(false);
  });

  it("stops a task that runs past the time cap", async () => {
    const { client, calls } = fakePhone({ never: true });
    const r = await runLoopCycle(ctx(client), { ...fast, deadlineMs: 20 });
    expect(r.ran && r.error).toContain("was stopped");
    expect(calls.stopped).toEqual(["task_1"]);
    expect(calls.home).toBe(1);
  });

  it("does nothing without a phone", async () => {
    expect(await runLoopCycle(ctx(null))).toEqual({ ran: false, reason: "phone not configured" });
  });

  it("summarizes a game that didn't load", () => {
    expect(summarize({ ...good, loaded: false })).toBe("didn't load on the phone");
  });
});
