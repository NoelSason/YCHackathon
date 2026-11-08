import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStats, isSetupNoise, normalizeRow, type StageEvent } from "../src/events.ts";
import { cleanResult, momentFor, type MomentKind } from "../src/moments.ts";
import { gameFrom, sampleOutreach, sampleStageStudios } from "../src/outreach.ts";
import { REHEARSAL_STORY, RehearsalFeed } from "../src/feeds.ts";

// Rows shaped exactly as the business server writes them (business/src/...).
const row = (agent: string, action: string, extra: Record<string, unknown> = {}): StageEvent =>
  normalizeRow({ id: action, ts: "2026-11-08T01:00:00Z", agent, action, ...extra }, "activity_log")!;

test("each business action string maps to its moment", () => {
  const cases: Array<[StageEvent, MomentKind, string]> = [
    [row("sales-sender", "outreach sent to Loop Games", { why: "7 of the 86 newest reviews…", result: "message <abc@x>" }), "email_sent", "Email sent to Loop Games"],
    [row("sales-inbox", "reply from Rotatelab", { result: "sent to the Sales Reader" }), "reply", "Rotatelab replied"],
    [row("sales-reader", "read reply from Rotatelab", { why: "Interested" }), "reply_read", "Read the reply from Rotatelab"],
    [row("intake", "new inbound lead: Pixel Pals", { why: "signed up through the table QR code" }), "signup", "Someone just signed up: Pixel Pals"],
    [row("sales", "playtest ordered by Team Nine", { why: "https://nine.example" }), "playtest_ordered", "New playtest order from Team Nine"],
    [row("playtest_lead", "playtesting Team Nine's app on the iPhone", { why: "https://nine.example" }), "playtest_started", "Now testing Team Nine's app"],
    [row("playtest_lead", "playtested Team Nine's app", { result: "completed" }), "playtest_done", "Playtest finished for Team Nine"],
    [row("playtest_lead", "emailed the playtest report to Team Nine", { result: "message <x>" }), "report_sent", "Playtest report sent to Team Nine"],
    [row("research", "audited Parking Loop", { why: "7 of 86…" }), "audit", "Read the reviews of Parking Loop"],
    [row("research", "found a public contact for Oakever Games"), "contact", "Found a contact at Oakever Games"],
  ];
  for (const [e, kind, title] of cases) {
    const m = momentFor(e);
    assert.equal(m?.kind, kind, e.action);
    assert.equal(m?.title, title, e.action);
  }
  assert.equal(momentFor(row("playtest_lead", "playtesting Team Nine's app on the iPhone", { why: "https://nine.example" }))?.app, "https://nine.example");
});

test("payments say test when the row says test mode, and only then", () => {
  const t = momentFor(row("billing", "payment received: pilot_pack", { result: "49.00 USD (test mode)" }));
  assert.equal(t?.test, true);
  assert.match(t!.title, /^Test payment/);
  assert.match(t!.detail!, /test mode/);
  const l = momentFor(row("billing", "payment received: pilot_pack", { result: "49.00 USD" }));
  assert.equal(l?.test, false);
  assert.equal(l?.title, "Payment received: pilot_pack");
  assert.equal(l?.detail, "49.00 USD");
});

test("decisions are moments; step-ins, ordinary rows, and unknown senders aren't big moments", () => {
  const d = normalizeRow({ id: "d", ts: "2026-11-08T02:00:00Z", agent: "ceo", saw: "quits", chose: "retune", why: "bots beat people" }, "decisions")!;
  assert.equal(momentFor(d)?.kind, "decision");
  assert.equal(momentFor(d)?.title, "retune");
  const s = normalizeRow({ id: "i", ts: "2026-11-08T03:00:00Z", who: "noel", what: "outreach sent to X" }, "interventions", { forceHuman: true })!;
  assert.equal(momentFor(s), null);
  assert.equal(momentFor(row("research", "scanning the top free puzzle games for unhappy players")), null);
  assert.equal(momentFor(row("sales-inbox", "reply from an unknown sender"))?.tier, "small");
  assert.equal(momentFor(row("sales-inbox", "Loop Games opted out")), null);
});

test("plumbing results are hidden, real results kept", () => {
  assert.equal(cleanResult("message <010001a1b8724328@email>"), null);
  assert.equal(cleanResult("lead ab547561-7158-4f26-bcbb-39ae991c7b22"), null);
  assert.equal(cleanResult("completed"), "completed");
});

test("setup noise (probe, approval_test) is hidden, human step-ins never are", () => {
  assert.equal(isSetupNoise(row("probe", "approval_test")), true);
  assert.equal(isSetupNoise(row("research", "approval_test run")), true);
  assert.equal(isSetupNoise(row("research", "audited X")), false);
  const s = normalizeRow({ id: "i", ts: "2026-11-08T03:00:00Z", who: "probe", what: "approval_test" }, "interventions", { forceHuman: true })!;
  assert.equal(isSetupNoise(s), false);
});

test("actionsSinceStepIn counts agent actions after the last step-in", () => {
  const rows = [
    { at: "2026-11-08T01:00:00Z", agent: "ceo", action: "a" },
    { at: "2026-11-08T02:00:00Z", agent: "noel", action: "fixed a key", human: true },
    { at: "2026-11-08T03:00:00Z", agent: "ceo", action: "b" },
    { at: "2026-11-08T04:00:00Z", agent: "tuner", action: "c" },
  ];
  const s = computeStats(rows.map((r, i) => normalizeRow({ id: i, ...r }, "t")!));
  assert.equal(s.actionsSinceStepIn, 2);
  assert.equal(computeStats([normalizeRow({ id: 1, ...rows[0] }, "t")!]).actionsSinceStepIn, 1);
});

test("gameFrom reads the game out of a studio's reason", () => {
  assert.equal(gameFrom("6 of the 150 newest Google Play reviews of Colony Flow! say a level is too hard or impossible."), "Colony Flow!");
  assert.equal(gameFrom("1 of the 150 newest Google Play reviews of Meowdoku: Brain Puzzle Games says the levels are too easy."), "Meowdoku: Brain Puzzle Games");
  assert.equal(gameFrom("Signed up at our table for free levels for Cozy Hex."), "Cozy Hex");
  assert.equal(gameFrom(null), null);
});

test("the rehearsal story fires every moment the stage celebrates, and its numbers agree", async () => {
  const kinds = new Set(REHEARSAL_STORY.map((s) => momentFor({ id: "x", at: "2026-11-08T00:00:00Z", why: null, result: null, saw: null, expected: null, costUsd: null, human: false, kind: "action", source: "t", ...s } as StageEvent)?.kind));
  for (const k of ["email_sent", "reply", "signup", "playtest_started", "report_sent", "payment", "decision", "audit", "contact"]) assert.ok(kinds.has(k as MomentKind), k);
  const loop = REHEARSAL_STORY.reduce((sum, s) => sum + s.after, 0);
  assert.ok(loop >= 150 && loop <= 210, `loop is ${loop}s`);
  const feed = new RehearsalFeed();
  const history = await feed.tick();
  assert.ok(history.filter((e) => e.human).length >= 1 && history.filter((e) => e.human).length <= 2);
  assert.equal(feed.banner.startsWith("REHEARSAL DATA"), true);
  const board = sampleOutreach();
  assert.equal(board.totals.studios, board.rows.length);
  assert.equal(sampleStageStudios("pilot_paid").length, board.totals.won);
});

test("market studies read as studies, not a customer's app", async () => {
  const { momentFor } = await import("../src/moments.ts");
  const ev = (action: string, why: string | null = null) => ({ id: "x", at: "2026-11-07T00:00:00Z", agent: "playtest-lead", action, why, result: null, saw: null, expected: null, costUsd: null, human: false, kind: "action", source: "activity_log" }) as never;
  const start = momentFor(ev("playtesting 2048 (web game, market study) on the iPhone", "2048 (free web game)"));
  assert.equal(start?.title, "Now playtesting 2048, a web puzzle game");
  assert.equal(start?.app, "2048");
  assert.equal(start?.market, true);
  const done = momentFor(ev("playtested 2048 (web game): played in 15 moves"));
  assert.equal(done?.kind, "playtest_done");
  assert.equal(done?.title, "Finished studying 2048");
});
