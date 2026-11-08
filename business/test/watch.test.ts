import { beforeEach, describe, expect, it } from "vitest";
import Stripe from "stripe";
import type Mobilerun from "@mobilerun/sdk";
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store.js";
import { createHandler } from "../src/app.js";
import { enqueue, runPlaytestOrder } from "../src/leads/playtest-offer.js";
import { composeWatchEmail, gameNameFromUrl, newWatchToken, resetWatch } from "../src/leads/watch.js";
import type { ToolContext } from "../src/mcp/tools.js";
import type { Lead } from "../src/types.js";

// "Watch your playtest live": tokens, the two public endpoints, and the "starting now" email.
// No network: the phone, mail, and Stripe event are fakes signed or built locally.
const SECRET = "whsec_test_secret";
const stripe = new Stripe("sk_test_dummy");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const REPORT = { results: [{ level: "app", loaded: true, touchOk: true, won: null, movesUsed: null, visualIssues: ["Score overlaps the board"], stuckReason: null, notes: "Tiles slide smoothly." }] };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A phone whose task stays "running" until `release()` is called. */
function gatedPhone() {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const phone = {
    tasks: {
      run: async () => ({ id: "task_1", status: "created" }),
      getStatus: async () => {
        await gate;
        return { status: "completed", succeeded: true, message: "done", output: REPORT, steps: 9 };
      },
    },
    devices: { screenshots: { capture: () => ({ asResponse: async () => new Response(PNG, { headers: { "content-type": "image/png" } }) }) } },
  } as unknown as Mobilerun;
  return { phone, release };
}

function setup(phone: Mobilerun | null) {
  const sent: Array<{ to: string; subject: string; text: string; html?: string }> = [];
  const store = new MemoryStore();
  const ctx: ToolContext = {
    config: loadConfig({
      COMPANY_POSTAL_ADDRESS: "1752 Shattuck Avenue, Berkeley, CA 94704", MOBILERUN_DEVICE_ID: "dev_secret_1",
      PLAYTEST_PRICE_USD: "5", STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_SECRET_KEY: "sk_test_dummy",
    }),
    store, monid: null, stripe, naive: null, mobilerun: phone,
    mail: { async send(a) { sent.push(a); return { messageId: `m${sent.length}` }; }, async reply() { return { messageId: "r" }; } },
  };
  return { ctx, store, sent, handle: createHandler(ctx.config, ctx, null) };
}

const lead = (store: MemoryStore): Promise<Lead> =>
  store.upsertLead({ company: "Team Ada", appId: null, contactName: "Ada Lovelace", email: "ada@team.example", source: "inbound_form", stage: "pilot_offered", reason: null, sampleUrl: null, crmContactId: null });

const get = (handle: ReturnType<typeof setup>["handle"], path: string) => handle(new Request(`http://x${path}`));

async function waitFor(check: () => Promise<boolean>, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("timed out");
    await sleep(10);
  }
}

beforeEach(() => resetWatch());

describe("watch tokens", () => {
  it("are 43 url-safe characters (32 random bytes) and never repeat", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newWatchToken()));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("are stored with the order and found again by token", async () => {
    const store = new MemoryStore();
    const l = await lead(store);
    const token = newWatchToken();
    const o = await store.addWatchOrder({ leadId: l.id, token, appUrl: "https://play2048.co/", gameName: gameNameFromUrl("https://play2048.co/") });
    expect(o).toMatchObject({ state: "queued", gameName: "play2048.co", test: false, startedAt: null });
    expect((await store.getWatchOrderByToken(token))!.id).toBe(o.id);
    expect(await store.getWatchOrderByToken(newWatchToken())).toBeNull();
  });

  it("names the game from its link", () => {
    expect(gameNameFromUrl("https://apps.apple.com/us/app/block-blast/id1617391485")).toBe("Block Blast");
    expect(gameNameFromUrl("https://www.example.com/game")).toBe("example.com");
  });
});

describe("watch endpoints", () => {
  it("answer 404 for unknown and malformed tokens", async () => {
    const { handle } = setup(null);
    for (const path of ["/watch-status?o=" + newWatchToken(), "/watch-frame?o=" + newWatchToken(), "/watch-status?o=short", "/watch-frame", "/watch-status?o=../../etc"]) {
      expect((await get(handle, path)).status, path).toBe(404);
    }
  });

  it("show queued, then testing with live frames, then finished with a summary and a final frame", async () => {
    const { phone, release } = gatedPhone();
    const { ctx, store, handle } = setup(phone);
    const l = await lead(store);
    const o = await store.addWatchOrder({ leadId: l.id, token: newWatchToken(), appUrl: "https://play2048.co/", gameName: "play2048.co" });
    await store.logActivity({ at: new Date().toISOString(), agent: "billing", action: "playtest queued after payment: Team Ada", why: "https://play2048.co/", result: "payment p1 (test mode)", costUsd: null, human: false });

    const queued = await (await get(handle, `/watch-status?o=${o.token}`)).json();
    expect(queued).toMatchObject({ state: "queued", game: "play2048.co", startedAt: null, live: false, summary: null });
    expect(queued.steps).toEqual([expect.objectContaining({ text: "Test payment received. In line for the iPhone", state: "active" })]);
    expect((await get(handle, `/watch-frame?o=${o.token}`)).status).toBe(204); // not on the phone yet

    const running = runPlaytestOrder(ctx, l, "https://play2048.co/", null, { id: "pay_1", livemode: false }, o.id);
    await waitFor(async () => (await (await get(handle, `/watch-status?o=${o.token}`)).json()).steps.some((x: { text: string }) => x.text === "Playing your app on a real iPhone"));
    const testing = await (await get(handle, `/watch-status?o=${o.token}`)).json();
    expect(testing).toMatchObject({ state: "testing", test: true, live: true });
    expect(testing.startedAt).toEqual(expect.any(String));
    expect(testing.steps.at(-1)).toMatchObject({ text: "Playing your app on a real iPhone", state: "active" });

    await sleep(1000); // the rate limit is per second
    const live = await get(handle, `/watch-frame?o=${o.token}`);
    expect(live.status).toBe(200);
    expect(live.headers.get("content-type")).toBe("image/png");
    expect(live.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await live.arrayBuffer())).toEqual(PNG);

    // Another order's token gets nothing while this one is on the phone.
    const other = await store.addWatchOrder({ leadId: l.id, token: newWatchToken(), appUrl: "https://b.example", gameName: "b.example" });
    expect((await get(handle, `/watch-frame?o=${other.token}`)).status).toBe(204);

    release();
    await running;
    const done = await (await get(handle, `/watch-status?o=${o.token}`)).json();
    expect(done).toMatchObject({ state: "finished", live: false, summary: { loaded: true, touchOk: true, visualIssues: ["Score overlaps the board"], notes: "Tiles slide smoothly." } });
    expect(done.steps.map((s: { text: string }) => s.text)).toEqual([
      "Test payment received. In line for the iPhone", "Sent you this live view by email", "Playing your app on a real iPhone",
      "Finished playing. Writing your report", "Report sent to your inbox",
    ]);
    expect(done.steps.every((s: { state: string }) => s.state === "done")).toBe(true);
    // Customer wording only: no ids, device names, or vendors.
    expect(JSON.stringify(done)).not.toMatch(/mobilerun|stripe|agentmail|neon|dev_secret|task_1|pay_1|[0-9a-f]{8}-[0-9a-f]{4}-/i);

    await sleep(1000);
    const final = await get(handle, `/watch-frame?o=${o.token}`);
    expect(final.status).toBe(200);
    expect(final.headers.get("x-frame-kind")).toBe("final");
  });

  it("rate-limits frames to about 2 a second per token", async () => {
    const { store, handle } = setup(null);
    const l = await lead(store);
    const o = await store.addWatchOrder({ leadId: l.id, token: newWatchToken(), appUrl: "https://x.example", gameName: "x.example" });
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await get(handle, `/watch-frame?o=${o.token}`)).status);
    expect(codes).toEqual([204, 204, 429]);
  });

  it("marks an order failed when the phone can't play it, and never serves a frame", async () => {
    const { ctx, store, handle } = setup(null);
    const l = await lead(store);
    const o = await store.addWatchOrder({ leadId: l.id, token: newWatchToken(), appUrl: "https://x.example", gameName: "x.example" });
    await runPlaytestOrder(ctx, l, "https://x.example", null, { id: "pay_2", livemode: false }, o.id);
    const body = await (await get(handle, `/watch-status?o=${o.token}`)).json();
    expect(body).toMatchObject({ state: "failed", summary: null, live: false });
    expect(body.steps.at(-1)).toMatchObject({ state: "failed" });
    expect((await get(handle, `/watch-frame?o=${o.token}`)).status).toBe(204);
  });
});

describe("the watch email", () => {
  it("goes out when a paid order starts, with the order's watch link, before the report", async () => {
    const { phone, release } = gatedPhone();
    release();
    const { store, sent, handle } = setup(phone);
    const l = await lead(store);
    const o = await store.addWatchOrder({ leadId: l.id, token: newWatchToken(), appUrl: "https://play2048.co/", gameName: "play2048.co" });
    const payload = JSON.stringify({
      id: "evt_w1", object: "event", type: "checkout.session.completed", livemode: false, api_version: "2024-06-20", created: 1, data: {
        object: { id: "cs_w1", object: "checkout.session", payment_status: "paid", amount_total: 500, currency: "usd",
          metadata: { product: "playtest", lead_id: l.id, app_url: "https://play2048.co/", focus: "", order_id: o.id } },
      },
    });
    const res = await handle(new Request("http://x/webhooks/stripe", {
      method: "POST", body: payload, headers: { "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET }) },
    }));
    expect(res.status).toBe(200);
    await enqueue(async () => undefined);

    expect(sent).toHaveLength(2);
    const link = `https://levelai.vercel.app/watch?o=${o.token}`;
    expect(sent[0]!.subject).toBe("[Test order] Your playtest is starting: watch it live");
    expect(sent[0]!.text).toContain(link);
    expect(sent[0]!.html).toContain(link);
    expect(sent[0]!.text).toContain("This is a test order, so no money was charged.");
    expect(sent[0]!.text).toContain("a real iPhone in the cloud");
    expect(sent[0]!.text).toContain("1752 Shattuck Avenue");
    expect(sent[0]!.text).toContain(`Reply "stop"`);
    expect(sent[0]!.text + sent[0]!.html).not.toMatch(/mobilerun|stripe|agentmail|neon|dev_secret/i);
    expect(sent[1]!.subject).toBe("[Test order] Your iPhone playtest report: Team Ada");
    expect((await store.getWatchOrder(o.id))!.state).toBe("finished");
  });

  it("drops the test label for a real order", () => {
    const e = composeWatchEmail({ name: null, team: "T", gameName: "g", watchUrl: "https://levelai.vercel.app/watch?o=x", test: false, companyName: "Level AI", postalAddress: "A" });
    expect(e.subject).toBe("Your playtest is starting: watch it live");
    expect(e.body).not.toContain("test order");
  });
});

describe("resume after restart", () => {
  it("lists only paid, unfinished orders", async () => {
    const { MemoryStore } = await import("../src/store.js");
    const store = new MemoryStore();
    const lead = await store.upsertLead({ company: "Ada Games", appId: null, contactName: null, email: "ada@x.example", source: "inbound_form", stage: "emailed", reason: null, sampleUrl: null, crmContactId: null });
    const unpaid = await store.addWatchOrder({ leadId: lead.id, token: "t1", appUrl: "https://a.example", gameName: "A" });
    const paid = await store.addWatchOrder({ leadId: lead.id, token: "t2", appUrl: "https://b.example", gameName: "B" });
    const done = await store.addWatchOrder({ leadId: lead.id, token: "t3", appUrl: "https://c.example", gameName: "C" });
    await store.updateWatchOrder(paid.id, { paymentId: "p1", focus: "first 5 min" });
    await store.updateWatchOrder(done.id, { paymentId: "p2", state: "finished" });
    const list = await store.listUnfinishedPaidOrders();
    expect(list.map((o) => o.id)).toEqual([paid.id]);
    expect(list[0]!.focus).toBe("first 5 min");
    expect(unpaid.paymentId).toBeNull();
  });
});
