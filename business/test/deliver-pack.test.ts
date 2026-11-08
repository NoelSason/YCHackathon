import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";
import Stripe from "stripe";
import type Mobilerun from "@mobilerun/sdk";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { loadConfig } from "../src/config.js";
import { PlatformStore, type Query } from "../src/store.js";
import { createHandler } from "../src/app.js";
import { clearPriceCache } from "../src/billing/stripe.js";
import { createOrder } from "../src/leads/orders.js";
import { makePack } from "../src/levels/pack-maker.js";
import { addPackDelivery, curveFor, CURVE_END, getPackDelivery, resumePackDeliveries, runDueDeliveries, studyWork } from "../src/levels/deliver-pack.js";
import type { MadeLevel, MakeRequest, PackMaker } from "../src/levels/pack-types.js";
import type { ToolContext } from "../src/mcp/tools.js";

// Level pack delivery end to end, with no network: Stripe events signed locally, the platform schema
// in PGlite, mail and the phone faked. The default maker below is the real one (Splash Sort's
// generator, its bots, the solver's tuning rule), run in-process at 3 levels so it takes a second.
const SECRET = "whsec_test_secret";
const real = new Stripe("sk_test_dummy");
const platformSchema = await readFile(new URL("../../platform/db/schema.sql", import.meta.url), "utf8");
const businessSchema = await readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8");

function fakeStripe() {
  return {
    webhooks: real.webhooks,
    prices: { list: async () => ({ data: [] }), create: async (p: { lookup_key: string }) => ({ id: `price_${p.lookup_key}` }) },
    checkout: { sessions: { create: async () => ({ id: "cs_test_1", url: "https://checkout.example/cs_test_1" }) } },
  } as unknown as Stripe;
}

interface Mail { to: string; subject: string; text: string; html?: string; idempotencyKey: string; attachments?: Array<{ contentId?: string; inline?: boolean }> }

async function setup(opts: { maker?: PackMaker; phone?: Mobilerun | null; levels?: number } = {}) {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(platformSchema);
  await db.exec(businessSchema);
  await db.exec(`insert into games (game_id, name, bots) values ('watersort', 'Splash Sort', '["human","greedy","random"]') on conflict do nothing`);
  const q: Query = async (text, params = []) => (await db.query<Record<string, unknown>>(text, params)).rows;
  const sent: Mail[] = [];
  const keys = new Set<string>();
  const ctx: ToolContext = {
    config: loadConfig({
      COMPANY_POSTAL_ADDRESS: "1752 Shattuck Avenue, Berkeley, CA 94704", STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_SECRET_KEY: "sk_test_dummy",
      AGENTMAIL_INBOX_ID: "levelai@agentmail.to", PILOT_LEVELS: String(opts.levels ?? 3), SUBSCRIPTION_LEVELS: "4",
      TEAM_EMAILS: "team@levelai.example", BUSINESS_MCP_TOKEN: "tok_demo", MOBILERUN_DEVICE_ID: "dev_1", SITE_URL: "https://levels.example",
    }),
    store: new PlatformStore(q, new Set(["team@levelai.example"])), monid: null, naive: null, stripe: fakeStripe(), mobilerun: opts.phone ?? null,
    // Like AgentMail: a repeated idempotency key doesn't send twice.
    mail: { async send(a) { if (!keys.has(a.idempotencyKey)) { keys.add(a.idempotencyKey); sent.push(a); } return { messageId: `m_${a.idempotencyKey.slice(0, 6)}` }; }, async reply() { return { messageId: "r" }; } },
    db: q,
    packMaker: opts.maker ?? ((req, onProgress) => makePack({ ...req, maxSeconds: 60 }, onProgress)),
  };
  return { ctx, q, sent, handle: createHandler(ctx.config, ctx, q) };
}

const ORDER = { name: "Ada Lovelace", email: "ada@studio.example", company: "Ada Games", gameUrl: "https://ada.example/game", difficulty: "medium", game: "watersort", consent: true };

function webhook(event: object): Request {
  const payload = JSON.stringify(event);
  return new Request("http://x/webhooks/stripe", { method: "POST", body: payload, headers: { "stripe-signature": real.webhooks.generateTestHeaderString({ payload, secret: SECRET }) } });
}
function paidEvent(id: string, metadata: Record<string, string>, opts: { amount?: number; subscription?: string } = {}) {
  return {
    id, object: "event", type: "checkout.session.completed", livemode: false, api_version: "2026-10-28", created: 1, data: {
      object: {
        id: `cs_${id}`, object: "checkout.session", mode: opts.subscription ? "subscription" : "payment", payment_status: "paid",
        amount_total: opts.amount ?? 4900, currency: "usd", metadata, subscription: opts.subscription ?? null, customer_details: { email: "ada@studio.example" },
      },
    },
  };
}

const actions = async (ctx: ToolContext) => (await ctx.store.listActivity(500)).map((a) => a.action).reverse();

/** A fake maker: `n` simple levels at their targets (or none), like the real one reports them. */
function fakeMaker(n: number | ((req: MakeRequest) => number), calls: MakeRequest[] = []): PackMaker {
  return async (req, onProgress) => {
    calls.push(req);
    const count = typeof n === "function" ? n(req) : n;
    const levels: MadeLevel[] = [];
    for (let i = 0; i < count; i++) {
      const target = req.targets[i]!;
      const l: MadeLevel = {
        slot: i + 1, target, level: { title: `Level ${i + 1}`, capacity: 4, tubes: [["red", "blue"], ["blue", "red"], []], move_limit: 10 },
        bot: "human", runs: 200, wins: Math.round(target * 200), measured_win_rate: Math.round(target * 200) / 200, ci95: [target - 0.07, target + 0.07],
        min_moves: 4, solvable: true, run_id: crypto.randomUUID(), results: { human: { runs: 200 } }, rounds: 2, candidates: 1,
      };
      levels.push(l);
      await onProgress?.({ kind: "accepted", level: l, of: req.targets.length });
    }
    return { gameId: req.gameId, levels, candidates: count + 1, elapsedMs: 5, stoppedBy: count >= req.targets.length ? "done" : "time", measuredBy: "win_rate" };
  };
}

async function orderAndPay(s: Awaited<ReturnType<typeof setup>>, eventId = "evt_pack") {
  const r = await createOrder(s.ctx, { ...ORDER, plan: "level_pack" });
  if (!r.ok) throw new Error(r.error);
  const meta = { product: "pilot_pack", lead_id: r.lead.id, game_url: ORDER.gameUrl, difficulty: "medium", game_id: "watersort" };
  const res = await s.handle(webhook(paidEvent(eventId, meta)));
  expect(await res.json()).toEqual({ received: true, outcome: "paid" });
  await runDueDeliveries(s.ctx); // waits for the run the webhook started
  return { lead: r.lead, meta };
}

beforeEach(() => clearPriceCache());

describe("the difficulty curve", () => {
  it("starts at 85%, holds, then falls to the difficulty's end by the last level", () => {
    const c = curveFor("medium", 20, null);
    expect(c.targets).toHaveLength(20);
    expect(c.targets.slice(0, 3)).toEqual([0.85, 0.85, 0.85]);
    expect(c.targets[19]).toBe(CURVE_END.medium);
    for (let i = 1; i < 20; i++) expect(c.targets[i]!).toBeLessThanOrEqual(c.targets[i - 1]!);
    expect(c.basis).toBe("No phone study, so there's no measured ramp → we used our default medium curve: pack levels start at 85% win rate for 3 levels and ramp to 40% by level 20, with the steepest step around level 4.");
    // Ease-out: the first step down (level 3 → 4) is the biggest.
    const steps = c.targets.slice(1).map((t, i) => Math.round((c.targets[i]! - t) * 100));
    expect(steps.indexOf(Math.max(...steps)) + 2).toBe(c.steepest);
  });

  it("follows the phone study: a game that ramps fast gets a short plateau and a harder end", () => {
    const study = { ok: true, game: "Candy Crush Saga", movesBeforeRamp: 2, levelReached: 3, stuckAt: "level 4", designNote: null, won: true, summary: "", taskId: "t" };
    const c = curveFor("medium", 20, study);
    expect(c.plateau).toBe(1);
    expect(c.end).toBe(0.35);
    expect(c.targets[1]!).toBeLessThan(0.85);
    expect(c.basis).toBe("Candy Crush Saga got harder after ~2 moves at level 3; players get stuck at level 4 → so pack levels start at 85% win rate and ramp to 35% by level 20, with the steepest step around level 2.");
    expect(c.fromStudy).toBe(true);
    // No measured ramp: the documented default, and it says so instead of inventing one.
    const none = curveFor("medium", 20, { ...study, movesBeforeRamp: null });
    expect(none).toMatchObject({ plateau: 3, end: 0.4, fromStudy: false });
    expect(none.basis).toMatch(/^Our iPhone reached level 3 without it getting noticeably harder in Candy Crush Saga, so there's no measured ramp → we used our default medium curve/);
  });

  it("studies a known App Store game by bundle id, and skips a store page it can't open", () => {
    expect(studyWork({ studiedGame: "Candy Crush Saga", gameUrl: "https://apps.apple.com/app/id553834731", bundleId: null, gameId: "match3" }))
      .toMatchObject({ kind: "market", name: "Candy Crush Saga", game: { bundleId: "com.midasplayer.apps.candycrushsaga" } });
    expect(studyWork({ studiedGame: "Mystery", gameUrl: "https://apps.apple.com/app/id1", bundleId: null, gameId: "match3" })).toBeNull();
    expect(studyWork({ studiedGame: "Web Game", gameUrl: "https://web.example/play", bundleId: null, gameId: "watersort" })).toMatchObject({ url: "https://web.example/play" });
  });
});

describe("a paid level pack delivers itself", () => {
  it("order → payment → levels built one at a time by the real bots, saved, published, and emailed", async () => {
    const s = await setup();
    const { lead } = await orderAndPay(s);

    const [d] = await s.q(`select * from biz_pack_deliveries`);
    expect(d).toMatchObject({ state: "delivered", game_id: "watersort", difficulty: "medium", levels_owed: 3, levels_delivered: 3, test_order: true });
    const packId = String(d!.pack_id);
    const curve = (typeof d!.curve === "string" ? JSON.parse(d!.curve) : d!.curve) as { targets: number[] };
    expect(curve.targets).toHaveLength(3);

    // Saved as published levels, a pack in order, and one solver_runs row per level.
    const levels = await s.q(`select level_id::text as id, status, target_win_rate, measured_win_rate, created_by from levels order by created_at`);
    expect(levels).toHaveLength(3);
    for (const [i, l] of levels.entries()) {
      expect(l).toMatchObject({ status: "published", created_by: "pack-delivery" });
      expect(Math.abs(Number(l.measured_win_rate) - curve.targets[i]!)).toBeLessThanOrEqual(0.08 + 1e-9); // the solver's onTarget rule
    }
    expect(await s.q(`select status, runs_per_bot from solver_runs`)).toEqual(expect.arrayContaining([expect.objectContaining({ status: "done", runs_per_bot: 200 })]));
    expect((await s.q(`select count(*)::int as n from solver_runs`))[0]!.n).toBe(3);

    // Served by id for the player and the JSON link, but kept out of the public lists.
    const pack = await s.handle(new Request(`http://x/packs/${packId}`));
    expect(pack.status).toBe(200);
    expect((await pack.json()).levels).toHaveLength(3);
    expect((await (await s.handle(new Request("http://x/levels?game=watersort"))).json()).levels).toEqual([]);

    // The email: play link, JSON link, target vs. measured for each level, and honest about the engine.
    expect(s.sent.map((m) => m.subject)).toEqual(["[Test order] Your level pack order: Ada Games", "[Test order] Your level pack is ready: 3 water-sort levels"]);
    const mail = s.sent[1]!;
    expect(mail.to).toBe("ada@studio.example");
    expect(mail.text).toContain(`Play them: https://levels.example/games/watersort/?pack=${packId}`);
    expect(mail.text).toContain(`JSON for all levels: https://levels.example/api/packs/${packId}`);
    expect(mail.text).toMatch(/Level  1   target  85%   measured +\d+%   https:\/\/levels\.example\/games\/watersort\/\?level=/);
    expect(mail.text).toContain("How we set the curve: No phone study, so there's no measured ramp");
    expect(mail.html).toMatch(/<th[^>]*>Target<\/th>/);
    expect(mail.text).toContain("They aren't built inside your game");
    expect(mail.html).toContain("Download the JSON");
    expect(s.sent[0]!.text).toContain("We don't put levels inside your game.");

    const acts = await actions(s.ctx);
    expect(acts).toContainEqual("level pack queued for Ada Games: 3 water-sort levels (medium)");
    expect(acts).toContainEqual("couldn't study Ada Games's game on the iPhone; using the default medium curve");
    expect(acts).toContainEqual(expect.stringMatching(/^difficulty curve for Ada Games's pack: No phone study/));
    expect(acts).toContainEqual("designing level pack for Ada Games: 3 water-sort levels");
    for (let k = 1; k <= 3; k++) expect(acts.some((a) => new RegExp(`^level pack for Ada Games: level ${k} of 3 accepted at \\d+% \\(target \\d+%\\)$`).test(a))).toBe(true);
    expect(acts).toContainEqual(expect.stringMatching(/^level pack for Ada Games: 3 levels, measured \d+%–\d+% vs 85% → 40% curve$/));
    expect(acts).toContainEqual("delivered level pack to Ada Games");
    expect(acts.indexOf("delivered level pack to Ada Games")).toBeGreaterThan(acts.findIndex((a) => a.includes("level 3 of 3 accepted")));
    expect(acts.filter((a) => a.startsWith("delivery owed"))).toEqual([]);

    expect((await s.q(`select status from payments`))[0]!.status).toBe("delivered");
    expect((await s.ctx.store.getLead(lead.id))!.stage).toBe("delivered");
  });

  it("is idempotent: a retried webhook, a second queue run, and a restart don't deliver twice", async () => {
    const calls: MakeRequest[] = [];
    const s = await setup({ maker: fakeMaker(3, calls) });
    const { meta } = await orderAndPay(s);
    expect(await (await s.handle(webhook(paidEvent("evt_pack", meta)))).json()).toEqual({ received: true, outcome: "duplicate" });
    await runDueDeliveries(s.ctx);
    await resumePackDeliveries(s.ctx);
    await runDueDeliveries(s.ctx);
    expect(calls).toHaveLength(1);
    expect((await s.q(`select count(*)::int as n from biz_pack_deliveries`))[0]!.n).toBe(1);
    expect((await s.q(`select count(*)::int as n from packs`))[0]!.n).toBe(1);
    expect(s.sent.filter((m) => m.subject.includes("Your level pack is ready"))).toHaveLength(1);
  });

  it("delivers what passed when it falls short, says so, and asks for a person", async () => {
    const s = await setup({ maker: fakeMaker(2) });
    await orderAndPay(s);
    const [d] = await s.q(`select state, levels_delivered, detail from biz_pack_deliveries`);
    expect(d).toEqual({ state: "partial", levels_delivered: 2, detail: "2 of 3 levels" });
    const mail = s.sent.at(-1)!;
    expect(mail.subject).toBe("[Test order] Your level pack: 2 of 3 levels ready");
    expect(mail.text).toContain("We promised 3 levels and 2 passed testing");
    const acts = await actions(s.ctx);
    expect(acts).toContainEqual("step-in needed: level pack for Ada Games");
    expect((await s.q(`select status from payments`))[0]!.status).toBe("paid"); // not marked delivered
  });

  it("sends nothing and asks for a person when no level passed", async () => {
    const s = await setup({ maker: fakeMaker(0) });
    await orderAndPay(s);
    expect((await s.q(`select state, pack_id from biz_pack_deliveries`))[0]!.state).toBe("failed");
    expect((await s.q(`select count(*)::int as n from packs`))[0]!.n).toBe(0);
    expect(s.sent.map((m) => m.subject)).toEqual(["[Test order] Your level pack order: Ada Games"]);
    expect(await actions(s.ctx)).toContainEqual("step-in needed: level pack for Ada Games");
  });

  it("resumes after a restart: remakes a pack that never saved, and only emails one that did", async () => {
    const calls: MakeRequest[] = [];
    const s = await setup({ maker: fakeMaker(3, calls) });
    const lead = await s.ctx.store.upsertLead({ company: "Bob Games", appId: null, contactName: "Bob", email: "bob@x.example", source: "inbound_form", stage: "pilot_paid", reason: null, sampleUrl: null, crmContactId: null });
    // Cut off mid-build: claimed, pack id chosen, nothing saved.
    const a = (await addPackDelivery(s.q, { paymentId: null, leadId: lead.id, plan: "level_pack", gameId: "watersort", difficulty: "hard", levelsOwed: 3, studiedGame: null, gameUrl: null, bundleId: null, test: true }))!;
    await s.q(`update biz_pack_deliveries set state = 'working', started_at = now() - interval '1 hour', pack_id = gen_random_uuid() where id = $1`, [a.id]);
    expect(await resumePackDeliveries(s.ctx)).toBe(1);
    await runDueDeliveries(s.ctx);
    expect(calls).toHaveLength(1);
    expect((await getPackDelivery(s.q, a.id))!.state).toBe("delivered");
    expect(await actions(s.ctx)).toContainEqual("resumed a level pack after a restart");

    // Cut off after saving but before the email: no second build.
    const b = (await addPackDelivery(s.q, { paymentId: null, leadId: lead.id, plan: "level_pack", gameId: "watersort", difficulty: "easy", levelsOwed: 3, studiedGame: null, gameUrl: null, bundleId: null, test: true }))!;
    const saved = (await getPackDelivery(s.q, a.id))!.packId!;
    await s.q(`update biz_pack_deliveries set state = 'working', started_at = now() - interval '1 hour', pack_id = $2, curve = (select curve from biz_pack_deliveries where id = $3) where id = $1`, [b.id, saved, a.id]);
    await resumePackDeliveries(s.ctx);
    await runDueDeliveries(s.ctx);
    expect(calls).toHaveLength(1);
    expect((await getPackDelivery(s.q, b.id))!.state).toBe("delivered");
    expect(s.sent.filter((m) => m.to === "bob@x.example")).toHaveLength(2);
    expect(s.sent.every((m) => m.subject.startsWith("[Test order]"))).toBe(true);
  });

  it("doesn't put back a delivery this process is already working on", async () => {
    const s = await setup({ maker: fakeMaker(3) });
    const d = (await addPackDelivery(s.q, { paymentId: null, leadId: null, plan: "level_pack", gameId: "watersort", difficulty: "medium", levelsOwed: 3, studiedGame: null, gameUrl: null, bundleId: null, test: true }))!;
    await s.q(`update biz_pack_deliveries set state = 'working', started_at = now() where id = $1`, [d.id]);
    expect(await resumePackDeliveries(s.ctx)).toBe(0);
    expect((await getPackDelivery(s.q, d.id))!.state).toBe("working");
  });

  it("delivers a subscription's first half now and keeps the second half for two weeks later", async () => {
    const calls: MakeRequest[] = [];
    const s = await setup({ maker: fakeMaker((r) => r.targets.length, calls) });
    const r = await createOrder(s.ctx, { ...ORDER, plan: "subscription" });
    if (!r.ok) throw new Error(r.error);
    await s.handle(webhook(paidEvent("evt_sub", { product: "subscription", lead_id: r.lead.id, game_url: ORDER.gameUrl, difficulty: "hard", game_id: "watersort" }, { amount: 19900, subscription: "sub_1" })));
    await runDueDeliveries(s.ctx);
    const rows = await s.q(`select part, state, levels_owed, due_at > now() + interval '13 days' as later from biz_pack_deliveries order by part`);
    expect(rows).toEqual([{ part: 1, state: "delivered", levels_owed: 2, later: false }, { part: 2, state: "queued", levels_owed: 2, later: true }]);
    expect(calls).toHaveLength(1);
    expect(s.sent[0]!.text).toContain("The first 2 reach you within the hour");
    expect((await s.q(`select status from payments`))[0]!.status).toBe("paid"); // delivered after both halves
  });
});

describe("the stage trigger: POST /orders/demo-run", () => {
  const body = { game: "Candy Crush Saga", bundleId: "com.midasplayer.apps.candycrushsaga", genre: "match3", email: "team@levelai.example" };
  const post = (s: Awaited<ReturnType<typeof setup>>, b: object, auth = "Bearer tok_demo") =>
    s.handle(new Request("http://x/orders/demo-run", { method: "POST", body: JSON.stringify(b), headers: { authorization: auth } }));

  it("needs the bearer and a team address", async () => {
    const s = await setup({ maker: fakeMaker(3) });
    expect((await post(s, body, "Bearer nope")).status).toBe(401);
    expect((await post(s, { ...body, email: "someone@else.example" })).status).toBe(400);
    expect((await post(s, { ...body, genre: "chess" })).status).toBe(400);
  });

  it("runs the same delivery path as a paid order, as an internal test with no payment", async () => {
    const calls: MakeRequest[] = [];
    const s = await setup({ maker: fakeMaker(3, calls) });
    const res = await post(s, body);
    expect(res.status).toBe(202);
    await runDueDeliveries(s.ctx);
    expect(calls[0]).toMatchObject({ gameId: "match3", difficulty: "medium" });
    expect(await s.q(`select source from studios`)).toEqual([{ source: "internal_test" }]);
    expect((await s.q(`select count(*)::int as n from payments`))[0]!.n).toBe(0);
    const [d] = await s.q(`select state, demo, test_order, studied_game, bundle_id, pack_id, detail from biz_pack_deliveries`);
    expect(d).toMatchObject({ state: "delivered", demo: true, test_order: true, studied_game: "Candy Crush Saga", bundle_id: "com.midasplayer.apps.candycrushsaga" });
    const mail = s.sent.at(-1)!;
    expect(mail.subject).toBe("[Test order] Your level pack is ready: 3 match-3 levels");
    expect(mail.text).toContain(`https://levels.example/play?pack=${String(d!.pack_id)}`);
    expect(await actions(s.ctx)).toContainEqual("level pack ordered by Level AI demo studio (demo run)");
  });
});

describe("the phone: study first, play level 1 last", () => {
  const png = (w: number, h: number, color: (x: number, y: number) => [number, number, number]) => {
    const rows: Buffer[] = [];
    for (let y = 0; y < h; y++) {
      const row = Buffer.alloc(1 + w * 3);
      for (let x = 0; x < w; x++) row.set(color(x, y), 1 + x * 3);
      rows.push(row);
    }
    const chunk = (type: string, b: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(b.length); return Buffer.concat([len, Buffer.from(type, "ascii"), b, Buffer.alloc(4)]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
  };
  const BOARD = png(60, 120, (x, y) => (x > 10 && x < 50 && y > 30 && y < 90 ? [(x * 40) % 256, (y * 20) % 256, 90] : [250, 248, 239]));

  function makePhone(status: (n: number) => Record<string, unknown>) {
    const runs: Array<Record<string, unknown>> = [];
    const deepLinks: string[] = [];
    const started: string[] = [];
    const phone = {
      tasks: {
        list: async () => ({ items: [] }),
        run: async (b: Record<string, unknown>) => { runs.push(b); return { id: `task_${runs.length}` }; },
        getStatus: async () => status(runs.length),
        stop: async () => ({}),
      },
      devices: {
        apps: { start: async (bundle: string) => { started.push(bundle); } },
        deepLink: { executeDeepLink: async (_d: string, p: { deepLink: string }) => { deepLinks.push(p.deepLink); } },
        actions: { global: async () => ({}) },
        screenshots: { capture: () => ({ asResponse: async () => new Response(new Uint8Array(BOARD), { headers: { "content-type": "image/png" } }) }) },
      },
    } as unknown as Mobilerun;
    return { phone, runs, deepLinks, started };
  }

  it("studies the customer's App Store game, sets the curve from it, and plays level 1 of the pack on the phone", async () => {
    const output = { loaded: true, touchOk: true, won: true, levelReached: 3, movesUsed: 14, movesBeforeRamp: 4, stuckAt: "level 3 with blockers", designNote: "Blockers arrive at level 3.", visualIssues: [] };
    const { phone, runs, deepLinks, started } = makePhone(() => ({ status: "completed", output }));
    const calls: MakeRequest[] = [];
    const s = await setup({ maker: fakeMaker(3, calls), phone });
    const lead = await s.ctx.store.upsertLead({ company: "Team Demo", appId: null, contactName: "Noel", email: "team@levelai.example", source: "inbound_form", stage: "pilot_paid", reason: null, sampleUrl: null, crmContactId: null });
    await addPackDelivery(s.q, { paymentId: null, leadId: lead.id, plan: "level_pack", gameId: "match3", difficulty: "medium", levelsOwed: 3, studiedGame: "Candy Crush Saga", gameUrl: null, bundleId: "com.midasplayer.apps.candycrushsaga", test: true, demo: true });
    await runDueDeliveries(s.ctx, { phonePollMs: 1 });

    expect(started).toEqual(["com.midasplayer.apps.candycrushsaga"]);
    expect(String(runs[0]!.task)).toContain("Candy Crush Saga");
    const [d] = await s.q(`select pack_id, curve, study from biz_pack_deliveries`);
    expect(calls[0]!.targets).toEqual([0.85, 0.85, 0.35]); // ramped after 4 moves: hold 2 levels, end 5 points harder
    const study = (typeof d!.study === "string" ? JSON.parse(d!.study) : d!.study) as { ok: boolean; movesBeforeRamp: number };
    expect(study).toMatchObject({ ok: true, movesBeforeRamp: 4 });

    const packUrl = `https://levels.example/play?pack=${String(d!.pack_id)}`;
    expect(deepLinks).toEqual([packUrl]);
    expect(String(runs[1]!.task)).toContain("playtest one match-3 level made by our level designer");

    const acts = await actions(s.ctx);
    const at = (needle: string) => acts.findIndex((a) => a.startsWith(needle));
    expect(at("studying Candy Crush Saga on the iPhone to set the difficulty curve")).toBeGreaterThanOrEqual(0);
    expect(acts).toContainEqual("Candy Crush Saga: gets harder after ~4 moves (reached level 3); players get stuck at level 3 with blockers");
    expect(acts).toContainEqual("difficulty curve for Team Demo's pack: Candy Crush Saga got harder after ~4 moves at level 3; players get stuck at level 3 with blockers → so pack levels start at 85% win rate for 2 levels and ramp to 35% by level 3, with the steepest step around level 3.");

    // A recap after each phone run, with the screenshot inline, before the pack and after level 1.
    const subjects = s.sent.map((m) => m.subject);
    expect(subjects).toEqual(["[Test order] How Candy Crush Saga played on our iPhone", "[Test order] Your level pack is ready: 3 match-3 levels", "[Test order] We played level 1 of your pack on our iPhone"]);
    const recap = s.sent[0]!;
    expect(recap.text).toContain("- Levels reached: level 3");
    expect(recap.text).toContain("- Got harder after: about 4 moves");
    expect(recap.text).toContain("- Where a player gets stuck: level 3 with blockers");
    expect(recap.text).toContain("- Design note: Blockers arrive at level 3.");
    expect(recap.text).toContain("Next: we're building 3 match-3 levels calibrated to this curve; you'll get them in about 2 minutes.");
    expect(recap.attachments?.[0]).toMatchObject({ contentId: "iphone-shot", inline: true });
    expect(recap.html).toContain("cid:iphone-shot");
    expect(s.sent[2]!.text).toContain("We played level 1 of your match-3 pack on our iPhone, as a first-time player: won, reached level 3 in 14 moves");
    expect(at("studying Candy Crush Saga")).toBeLessThan(at("designing level pack for Team Demo"));
    expect(at("delivered level pack to Team Demo")).toBeLessThan(at("playtested level 1 of Team Demo's match-3 pack"));
    expect(s.sent.find((m) => m.subject.includes("is ready"))!.text).toContain("How we set the curve: before building, our iPhone played Candy Crush Saga.");
    // The studied game is named only as the game we studied: never in the levels themselves.
    const levels = await s.q(`select level::text as l from levels`);
    for (const l of levels) expect(String(l.l)).not.toMatch(/candy|crush/i);
  });

  it("falls back to the newest earlier phone session of the game when the live study fails, and says so", async () => {
    const { phone } = makePhone((n) => (n === 1 ? { status: "failed", message: "Task execution timed out after 300 seconds" } : { status: "completed", output: { loaded: true, touchOk: true, won: true, levelReached: 1, movesUsed: 5, movesBeforeRamp: null, stuckAt: null, designNote: "", visualIssues: [] } }));
    const calls: MakeRequest[] = [];
    const s = await setup({ maker: fakeMaker(3, calls), phone });
    await s.ctx.store.logActivity({ at: new Date(Date.now() - 3600_000).toISOString(), agent: "playtest-lead", action: "playtested Candy Crush Saga (iOS app): won, reached level 2 in 9 moves; got harder after 6; stuck: level 3 jelly", why: null, result: "Design note: Jelly arrives on level 3. (task t_old)", costUsd: null, human: false });
    const lead = await s.ctx.store.upsertLead({ company: "Team Demo", appId: null, contactName: "Noel", email: "team@levelai.example", source: "inbound_form", stage: "pilot_paid", reason: null, sampleUrl: null, crmContactId: null });
    await addPackDelivery(s.q, { paymentId: null, leadId: lead.id, plan: "level_pack", gameId: "match3", difficulty: "medium", levelsOwed: 3, studiedGame: "Candy Crush Saga", gameUrl: null, bundleId: "com.midasplayer.apps.candycrushsaga", test: true, demo: true });
    await runDueDeliveries(s.ctx, { phonePollMs: 1 });
    expect(await actions(s.ctx)).toContainEqual(expect.stringMatching(/^Candy Crush Saga: gets harder after ~6 moves; players get stuck at level 3 jelly \(from our iPhone's earlier session, .+ PT\)$/));
    expect(s.sent[0]!.text).toMatch(/^Hi Noel,\n\nOur iPhone's session of Candy Crush Saga just now didn't finish \(Task execution timed out after 300 seconds\), so we used its earlier session/);
    expect(calls[0]!.targets).toEqual([0.85, 0.85, 0.4]); // 6 moves → plateau 3, capped at 2 for a 3-level pack
    expect(s.sent.find((m) => m.subject.includes("is ready"))!.text).toContain("(from our iPhone's earlier session");
  });
});
