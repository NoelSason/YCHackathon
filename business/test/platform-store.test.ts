import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { PlatformStore, type Query } from "../src/store.js";

/**
 * Runs the store against the real platform schema (platform/db/schema.sql) plus our additions,
 * in an in-process Postgres. No network, no shared database touched.
 */
const platformSchema = await readFile(new URL("../../platform/db/schema.sql", import.meta.url), "utf8");
const businessSchema = await readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8");

async function freshStore(): Promise<{ store: PlatformStore; q: Query }> {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(platformSchema);
  await db.exec(businessSchema);
  await db.exec(businessSchema); // the additions must be safe to re-run
  const q: Query = async (text, params = []) => (await db.query<Record<string, unknown>>(text, params)).rows;
  return { store: new PlatformStore(q), q };
}

const baseLead = {
  company: "Loop Games A.S.", appId: "com.loop.packedloop", contactName: "Ada", email: "Biz@Loop.example",
  source: "research" as const, stage: "found" as const, reason: "7 of 86 reviews say too easy.", sampleUrl: null, crmContactId: null,
};

describe("PlatformStore on the platform schema", () => {
  let store: PlatformStore;
  let q: Query;
  beforeEach(async () => ({ store, q } = await freshStore()));

  it("stores leads as studios, dedupes by email, and never moves a stage backwards on re-save", async () => {
    const a = await store.upsertLead(baseLead);
    await store.setStage(a.id, "emailed");
    const again = await store.upsertLead({ ...baseLead, email: "biz@loop.example", sampleUrl: "https://x.example/s" });
    expect(again.id).toBe(a.id);
    expect(again.stage).toBe("emailed");
    expect(again.sampleUrl).toBe("https://x.example/s");
    const rows = await q("select name, contact_email, source, stage from studios");
    expect(rows).toEqual([{ name: "Loop Games A.S.", contact_email: "biz@loop.example", source: "research", stage: "emailed" }]);
  });

  it("maps the table QR source and accepts the added stages", async () => {
    const l = await store.upsertLead({ ...baseLead, email: "qr@x.example", source: "inbound_form" });
    expect((await q("select source from studios where studio_id = $1", [l.id]))[0]!.source).toBe("inbound_qr");
    expect((await store.getLead(l.id))!.source).toBe("inbound_form");
    for (const stage of ["pilot_offered", "lost", "opted_out"] as const) expect((await store.setStage(l.id, stage))!.stage).toBe(stage);
  });

  it("records only sent emails in emails, and counts them for the daily cap", async () => {
    const l = await store.upsertLead(baseLead);
    await store.addOutreach({ leadId: l.id, to: "biz@loop.example", subject: "s", body: "b", status: "drafted", blockedReason: null, providerMessageId: null });
    await store.addOutreach({ leadId: l.id, to: "biz@loop.example", subject: "s", body: "b", status: "sent", blockedReason: null, providerMessageId: "m1" });
    expect(await store.countSentSince(new Date(Date.now() - 60_000).toISOString())).toBe(1);
    expect(await q("select direction, external_id from emails")).toEqual([{ direction: "out", external_id: "m1" }]);
  });

  it("records a Stripe event once, then marks it delivered", async () => {
    const l = await store.upsertLead(baseLead);
    const input = { leadId: l.id, provider: "stripe" as const, providerEventId: "evt_1", amountMinor: 4900, currency: "usd", livemode: false, product: "pilot_pack" as const };
    const p = await store.recordPayment(input);
    expect(p).not.toBeNull();
    expect(await store.recordPayment(input)).toBeNull();
    await store.addDelivery({ paymentId: p!.id, leadId: l.id, status: "delivered", detail: "sent" });
    expect(await q("select amount_usd::float as usd, mode, status from payments")).toEqual([{ usd: 49, mode: "test", status: "delivered" }]);
    expect((await store.listPayments())[0]).toMatchObject({ amountMinor: 4900, livemode: false, product: "pilot_pack" });
  });

  it("writes agent activity to activity_log and human step-ins to interventions", async () => {
    await store.logActivity({ at: new Date().toISOString(), agent: "sales-sender", action: "outreach sent", why: "evidence", result: "m1", costUsd: null, human: false });
    await store.logActivity({ at: new Date().toISOString(), agent: "noel", action: "restarted the phone", why: "it froze", result: null, costUsd: null, human: true });
    expect(await q("select agent, action, reason, cost_usd::float as c from activity_log")).toEqual([{ agent: "sales-sender", action: "outreach sent", reason: "evidence", c: 0 }]);
    expect(await q("select who, what, kind from interventions")).toEqual([{ who: "noel", what: "restarted the phone", kind: "manual" }]);
  });

  it("stores the team's own signups as internal tests that never count as research or signups", async () => {
    const team = new PlatformStore(q, new Set(["noel@team.example"]));
    const l = await team.upsertLead({ ...baseLead, email: "Noel@Team.example", source: "inbound_form" });
    expect((await q("select source from studios where studio_id = $1", [l.id]))[0]!.source).toBe("internal_test");
    expect((await team.getLead(l.id))!.source).toBe("manual");
  });

  it("suppresses opt-outs case-insensitively", async () => {
    await store.suppress("Stop@X.example", "replied stop");
    expect(await store.isSuppressed("stop@x.example")).toBe(true);
  });

  it("stores playtest watch orders, finds them by token, and updates state and summary", async () => {
    const l = await store.upsertLead({ ...baseLead, email: "w@x.example", source: "inbound_form" });
    const token = "a".repeat(43);
    const o = await store.addWatchOrder({ leadId: l.id, token, appUrl: "https://play2048.co/", gameName: "play2048.co" });
    expect(o).toMatchObject({ leadId: l.id, token, state: "queued", test: false, startedAt: null, finishedAt: null, summary: null });
    expect((await store.getWatchOrderByToken(token))!.id).toBe(o.id);
    expect(await store.getWatchOrderByToken("b".repeat(43))).toBeNull();
    const started = await store.updateWatchOrder(o.id, { state: "testing", test: true, startedAt: "2026-11-08T03:00:00.000Z" });
    expect(started).toMatchObject({ state: "testing", test: true, startedAt: "2026-11-08T03:00:00.000Z" });
    const summary = { loaded: true, touchOk: true, visualIssues: ["x"], stuckReason: null, notes: "ok" };
    const done = await store.updateWatchOrder(o.id, { state: "finished", finishedAt: "2026-11-08T03:05:00.000Z", summary });
    expect(done).toMatchObject({ state: "finished", summary });
    await expect(q(`update biz_playtest_orders set state = 'paused' where id = $1`, [o.id])).rejects.toThrow();
    await store.logActivity({ at: "2026-11-08T03:01:00.000Z", agent: "playtest-lead", action: "a", why: null, result: null, costUsd: null, human: false });
    await store.logActivity({ at: "2026-11-08T04:00:00.000Z", agent: "playtest-lead", action: "b", why: null, result: null, costUsd: null, human: false });
    expect((await store.listActivityBetween("2026-11-08T02:59:00.000Z", "2026-11-08T03:30:00.000Z")).map((a) => a.action)).toEqual(["a"]);
    expect((await store.listActivityBetween("2026-11-08T02:59:00.000Z", null)).map((a) => a.action)).toEqual(["a", "b"]);
  });
});
