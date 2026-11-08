import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStats, normalizeRow } from "../src/events.ts";
import { parseTables } from "../src/feeds.ts";

test("normalizes a biz_activity row", () => {
  const e = normalizeRow(
    { id: 7, at: new Date("2026-11-08T02:14:00Z"), agent: "Sales Sender", action: "Emailed a studio", why: "Fresh lead", result: "sent", cost_usd: "0.02", human: false },
    "biz_activity",
  );
  assert.ok(e);
  assert.equal(e.id, "biz_activity:7");
  assert.equal(e.agent, "sales_sender");
  assert.equal(e.kind, "action");
  assert.equal(e.costUsd, 0.02);
  assert.equal(e.at, "2026-11-08T02:14:00.000Z");
});

test("normalizes a decision record, including one nested in a payload column", () => {
  const e = normalizeRow(
    { id: "d1", created_at: "2026-11-08T02:14:00-08:00", payload: { agent: "ceo", saw: "Quits at level 34", chose: "retune levels 30-40", why: "bots beat people", expected: "quits < 35%", cost_estimate_usd: 0.9 } },
    "activity_log",
  );
  assert.ok(e);
  assert.equal(e.kind, "decision");
  assert.equal(e.agent, "ceo");
  assert.equal(e.action, "retune levels 30-40");
  assert.equal(e.saw, "Quits at level 34");
  assert.equal(e.costUsd, 0.9);
});

test("rows from a step-in table are human, and rows with no time are dropped", () => {
  const s = normalizeRow({ at: "2026-11-08T03:00:00Z", reason: "phone froze", action: "Restarted the phone" }, "step_ins", { forceHuman: true });
  assert.equal(s?.kind, "step_in");
  assert.equal(s?.agent, "human");
  assert.equal(s?.why, "phone froze");
  assert.equal(normalizeRow({ agent: "ceo", action: "x" }, "t"), null);
});

test("stats count agents and people separately and start the unattended clock at the last step-in", () => {
  const rows = [
    { at: "2026-11-08T01:00:00Z", agent: "ceo", action: "a", cost_usd: 0.5 },
    { at: "2026-11-08T02:00:00Z", agent: "noel", action: "fixed a key", human: true },
    { at: "2026-11-08T03:00:00Z", agent: "ceo", chose: "b", saw: "c" },
    { at: "2026-11-08T04:00:00Z", agent: "tuner", action: "d", cost_usd: 0.25 },
  ];
  const s = computeStats(rows.map((r, i) => normalizeRow({ id: i, ...r }, "t")!));
  assert.equal(s.agentActions, 3);
  assert.equal(s.decisions, 1);
  assert.equal(s.stepIns, 1);
  assert.equal(s.spendUsd, 0.75);
  assert.equal(s.unattendedSince, "2026-11-08T02:00:00.000Z");
  assert.deepEqual(s.perAgent.map((a) => [a.agent, a.count]), [["ceo", 2], ["tuner", 1]]);
});

test("table specs reject anything but plain identifiers", () => {
  assert.deepEqual(parseTables("biz_activity:at, public.activity_log:time", false), [
    { table: "biz_activity", timeColumn: "at", stepIns: false },
    { table: "public.activity_log", timeColumn: "time", stepIns: false },
  ]);
  assert.throws(() => parseTables('x"; drop table y; --', false));
});

test("reads the shared platform tables' columns (activity_log, decisions, interventions)", () => {
  const a = normalizeRow({ id: "a1", ts: "2026-11-08T01:00:00Z", agent: "tuner", action: "tuned l31", reason: "3% win rate", result: "41%", cost_usd: "0.04" }, "activity_log");
  assert.equal(a?.why, "3% win rate");
  assert.equal(a?.costUsd, 0.04);
  const d = normalizeRow({ id: "d1", ts: "2026-11-08T02:00:00Z", agent: "ceo", saw: "quits", chose: "retune", why: "bots beat people", expected: "fewer quits" }, "decisions");
  assert.equal(d?.kind, "decision");
  const i = normalizeRow({ id: "i1", ts: "2026-11-08T03:00:00Z", who: "noel", what: "approved a send", why: "Naïve asked", kind: "approval" }, "interventions", { forceHuman: true });
  assert.equal(i?.kind, "step_in");
  assert.equal(i?.agent, "noel");
  assert.equal(i?.action, "approved a send");
});
