import assert from "node:assert/strict";
import { test } from "node:test";
import { checkDecision, parseExpectation } from "../src/decision-check.js";
import { addDecision, addGame, addLevel, addPlays, freshDb, hoursAfter } from "./helpers.js";

const T0 = new Date("2026-11-08T10:00:00Z"); // the decision
const NOW = hoursAfter(T0, 2);

test("a retune that cut quits shows up as the decision's own effect, against untouched levels", async () => {
  const q = await freshDb();
  await addGame(q, "watersort");
  const before = hoursAfter(T0, -2);
  const parent = await addLevel(q, { game_id: "watersort", created_at: hoursAfter(T0, -5) });
  const other = await addLevel(q, { game_id: "watersort", created_at: hoursAfter(T0, -5) });
  const child = await addLevel(q, { game_id: "watersort", parent, created_at: hoursAfter(T0, 0.1) });
  // Before: the named level is hard (20% wins, 50% quits); the untouched one is fine.
  await addPlays(q, "watersort", parent, before, T0, { attempts: 40, wins: 8, quits: 20 });
  await addPlays(q, "watersort", other, before, T0, { attempts: 40, wins: 20, quits: 8 });
  // After: the retuned version is easier; the untouched level is unchanged.
  await addPlays(q, "watersort", child, hoursAfter(T0, 0.2), NOW, { attempts: 40, wins: 18, quits: 8 });
  await addPlays(q, "watersort", other, T0, NOW, { attempts: 40, wins: 20, quits: 8 });
  const id = await addDecision(q, {
    ts: T0, chose: "retune the hard level", cards: [`tune:${parent}`], expected: "Quits on that level below 35% within 2 hours",
  });

  const r = (await checkDecision(q, id, { now: NOW }))!;
  assert.deepEqual(r.scope, { games: ["watersort"], levels: [parent], newer_versions: [child] });
  assert.equal(r.window_hours, 2);
  assert.deepEqual([r.changed.before.win_rate, r.changed.after.win_rate], [0.2, 0.45]);
  assert.deepEqual([r.changed.before.quit_rate, r.changed.after.quit_rate], [0.5, 0.2]);
  assert.equal(r.effect.method, "vs_untouched_levels");
  assert.equal(r.effect.win_rate_pts, 25);
  assert.equal(r.effect.quit_rate_pts, -30);
  // With 40 plays per group, +25 pts of win rate is suggestive (z 1.66) but -30 pts of quits is clear.
  assert.equal(r.effect.z_win, 1.66);
  assert.equal(r.effect.z_quit, -2.22);
  assert.equal(r.verdict, "changed");
  assert.equal(r.enough_data, true);
  assert.deepEqual(r.expectation && [r.expectation.metric, r.expectation.op, r.expectation.value], ["quit_rate", "<", 0.35]);
  assert.equal(r.meets_expectation, true);
  assert.match(r.summary, /effect is \+25 pts win rate/);
  assert.equal(r.pipeline_since.levels_designed, 1);
  // Nothing in the output names a person.
  assert.doesNotMatch(JSON.stringify(r), /email|player|name"|phone|contact/i);
});

test("too few plays gives not_enough_data, with the counts", async () => {
  const q = await freshDb();
  await addGame(q, "racer");
  const lvl = await addLevel(q, { game_id: "racer", created_at: hoursAfter(T0, -5) });
  await addPlays(q, "racer", lvl, hoursAfter(T0, -1), T0, { attempts: 6, wins: 3, quits: 1 });
  await addPlays(q, "racer", lvl, T0, NOW, { attempts: 4, wins: 1, quits: 2 });
  const id = await addDecision(q, { ts: T0, chose: `make ${lvl} easier`, expected: "win rate above 50%" });
  const r = (await checkDecision(q, id, { now: NOW }))!;
  assert.equal(r.verdict, "not_enough_data");
  assert.equal(r.enough_data, false);
  assert.equal(r.meets_expectation, null);
  assert.match(r.summary, /Not enough plays yet: 6 finished before and 4 after \(need 15 each\)/);
});

test("a decision made minutes ago is too early to judge", async () => {
  const q = await freshDb();
  await addGame(q, "racer");
  const id = await addDecision(q, { ts: T0, chose: "order a new racer pack" });
  const r = (await checkDecision(q, id, { now: hoursAfter(T0, 0.05) }))!;
  assert.equal(r.verdict, "not_enough_data");
  assert.match(r.summary, /Decided 3 minutes ago; too early to measure/);
});

test("a decision with no game or level says player results can't judge it", async () => {
  const q = await freshDb();
  const id = await addDecision(q, { ts: T0, chose: "pitch three more studios" });
  const r = (await checkDecision(q, id, { now: NOW }))!;
  assert.deepEqual(r.scope.games, []);
  assert.match(r.summary, /names no game or level/);
});

test("a game-wide decision compares the game before and after, with no untouched group", async () => {
  const q = await freshDb();
  await addGame(q, "racer");
  const a = await addLevel(q, { game_id: "racer", created_at: hoursAfter(T0, -5) });
  await addPlays(q, "racer", a, hoursAfter(T0, -2), T0, { attempts: 30, wins: 6, quits: 6 });
  await addPlays(q, "racer", a, T0, NOW, { attempts: 30, wins: 15, quits: 3 });
  const id = await addDecision(q, { ts: T0, chose: "slow racer down: lower speed on every track" });
  const r = (await checkDecision(q, id, { now: NOW }))!;
  assert.deepEqual(r.scope.games, ["racer"]);
  assert.equal(r.effect.method, "before_after_only");
  assert.equal(r.effect.win_rate_pts, 30);
  assert.equal(r.untouched, null);
});

test("unknown decision id returns null", async () => {
  const q = await freshDb();
  assert.equal(await checkDecision(q, "00000000-0000-0000-0000-000000000000", { now: NOW }), null);
});

test("expectations are read only when they are simple thresholds", () => {
  assert.deepEqual(parseExpectation("Quits at level 34 below 35% within 3 hours"), {
    metric: "quit_rate", op: "<", value: 0.35, text: "Quits at level 34 below 35%",
  });
  assert.equal(parseExpectation("win rate above 40% by tonight")?.op, ">");
  assert.equal(parseExpectation("win rate above 40% by tonight")?.metric, "win_rate");
  assert.equal(parseExpectation("retune toward 45%"), null);
  assert.equal(parseExpectation(null), null);
});


test("inclusive expectations accept the exact boundary and reject impossible percentages", async () => {
  assert.equal(parseExpectation("quits at most 50%")?.op, "<=");
  assert.equal(parseExpectation("wins at least 50%")?.op, ">=");
  assert.equal(parseExpectation("wins above 101%"), null);
  const q = await freshDb();
  await addGame(q, "watersort");
  const lvl = await addLevel(q, { game_id: "watersort", created_at: hoursAfter(T0, -5) });
  await addPlays(q, "watersort", lvl, T0, NOW, { attempts: 20, wins: 10, quits: 10 });
  for (const expected of ["wins at least 50%", "quits at most 50%", "wins above 50%", "quits below 50%"] as const) {
    const id = await addDecision(q, { ts: T0, chose: `retune ${lvl}`, expected });
    const result = (await checkDecision(q, id, { now: NOW }))!;
    assert.equal(result.meets_expectation, expected.includes("at "));
  }
});

test("later retunes are found through versions made before the decision", async () => {
  const q = await freshDb();
  await addGame(q, "racer");
  const parent = await addLevel(q, { game_id: "racer", created_at: hoursAfter(T0, -5) });
  const middle = await addLevel(q, { game_id: "racer", parent, created_at: hoursAfter(T0, -1) });
  const child = await addLevel(q, { game_id: "racer", parent: middle, created_at: hoursAfter(T0, 0.1) });
  const id = await addDecision(q, { ts: T0, chose: `retune ${parent}` });
  const result = (await checkDecision(q, id, { now: NOW }))!;
  assert.deepEqual(result.scope.newer_versions, [child]);
});
