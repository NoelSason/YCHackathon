import assert from "node:assert/strict";
import { test } from "node:test";
import adapter from "../adapter/index.js";
import { drive } from "../src/bots.js";
import { BOOST_TICKS, buildGrid, finished, type Level, startState, step, validateLevel } from "../src/engine.js";
import { SAMPLES } from "../src/levels.js";
import { solveLevel } from "../src/solver.js";
import { runLevel } from "../../../solver/src/run.js";

const base: Level = { lanes: 3, length: 20, speed: 8, time_limit: 40, crash_penalty: 3, lane_change_cooldown: 0, objects: [] };

test("samples are valid and beatable within their time limits", () => {
  for (const s of SAMPLES) {
    assert.deepEqual(validateLevel(s), { ok: true }, s.title);
    assert.ok(solveLevel(s).min_ticks <= s.time_limit, `${s.title} is impossible`);
  }
});

test("validation explains what is wrong", () => {
  const bad = (level: unknown, re: RegExp) => {
    const v = validateLevel(level);
    assert.equal(v.ok, false);
    assert.ok(!v.ok && v.errors.some((e) => re.test(e)), `expected ${re} in ${JSON.stringify(v)}`);
  };
  bad({ ...base, objects: [{ row: 5, lane: 3, kind: "car" }] }, /lane must be/);
  bad({ ...base, objects: [{ row: 25, lane: 0, kind: "car" }] }, /row must be/);
  bad({ ...base, objects: [{ row: 5, lane: 0, kind: "truck" }] }, /kind must be/);
  bad({ ...base, objects: [{ row: 5, lane: 0, kind: "car" }, { row: 5, lane: 0, kind: "coin" }] }, /share row 5/);
  bad({ ...base, lanes: 7 }, /lanes/);
  bad({ ...base, nitro: true }, /unknown field "nitro"/);
});

test("a crash costs crash_penalty ticks, a boost doubles speed, coins count once", () => {
  const level: Level = {
    ...base,
    objects: [{ row: 2, lane: 1, kind: "coin" }, { row: 3, lane: 1, kind: "boost" }, { row: 10, lane: 1, kind: "car" }],
  };
  const grid = buildGrid(level);
  let s = startState(level);
  let coins = 0;
  const log: string[] = [];
  while (!finished(level, s) && s.tick < 50) {
    const { next, ev } = step(level, grid, s, 0);
    coins += ev.coins;
    if (ev.boosted) log.push(`boost@${next.row}`);
    if (ev.crashed) log.push(`crash@${next.row}`);
    s = next;
  }
  assert.equal(coins, 1);
  assert.deepEqual(log, ["boost@3", "crash@10"]);
  // 3 ticks to the boost, BOOST_TICKS ticks at 2 rows (rows 4-11) but the car crashes at row 10.
  assert.ok(BOOST_TICKS === 4);
  assert.equal(s.tick, 3 + 4 + 3 + 10, "rows 1-3, rows 4-10 in 4 ticks, 3 stunned, rows 11-20");
});

test("steering respects the cooldown and the road edges", () => {
  const level: Level = { ...base, lane_change_cooldown: 2 };
  const grid = buildGrid(level);
  let s = startState(level); // lane 1
  s = step(level, grid, s, -1).next;
  assert.equal(s.lane, 0);
  s = step(level, grid, s, 1).next;
  assert.equal(s.lane, 0, "cooldown blocks steering");
  s = step(level, grid, s, 1).next;
  assert.equal(s.lane, 0, "still cooling down");
  s = step(level, grid, s, -1).next;
  assert.equal(s.lane, 0, "can't leave the road");
});

test("the solver finds the fastest run, crashing only when that is faster", () => {
  // A wall with one gap: steer around it, no time lost.
  const gap: Level = { ...base, objects: [{ row: 5, lane: 1, kind: "car" }, { row: 5, lane: 2, kind: "cone" }] };
  const r = solveLevel(gap);
  assert.equal(r.min_ticks, 20);
  assert.equal(r.crashes, 0);
  // Replaying the inputs reaches the finish in exactly min_ticks.
  const grid = buildGrid(gap);
  let s = startState(gap);
  for (const a of r.inputs) s = step(gap, grid, s, a).next;
  assert.ok(finished(gap, s) && s.tick === r.min_ticks);

  // A full wall must be crashed through: one crash penalty.
  const wall: Level = { ...base, objects: [0, 1, 2].map((lane) => ({ row: 8, lane, kind: "cone" as const })) };
  const w = solveLevel(wall);
  assert.deepEqual([w.min_ticks, w.crashes], [20 + 3, 1]);
});

test("bots are reproducible and rank sensibly", () => {
  const level = SAMPLES[1]!;
  assert.deepEqual(drive(level, "human", 9), drive(level, "human", 9));
  const wins = (bot: string) => {
    let w = 0;
    for (let s = 0; s < 120; s++) if (drive(level, bot, s).won) w++;
    return w;
  };
  const human = wins("human");
  assert.ok(human > wins("random"), "human should beat random");
  assert.ok(wins("greedy") >= human, "the mistake-free bot should do at least as well as the human one");
  assert.throws(() => drive(level, "search", 1), /unknown bot/);
});

test("higher speed makes the human bot lose more", () => {
  const level = SAMPLES[1]!;
  const min = solveLevel(level).min_ticks;
  const rate = (speed: number) => {
    let w = 0;
    for (let s = 0; s < 150; s++) if (drive({ ...level, speed, time_limit: min + 10 }, "human", s).won) w++;
    return w;
  };
  assert.ok(rate(5) > rate(14), "a faster track should be harder for a person");
});

test("adapter follows platform/CONTRACTS.md §1 and runs in the solver harness", () => {
  assert.equal(adapter.game_id, "racer");
  assert.deepEqual(adapter.bots, ["human", "greedy", "random"]);
  assert.match(adapter.level_url("abc"), /\/racer\/\?level=abc$/);
  const s = adapter.solve(SAMPLES[0]!);
  assert.equal(s.solvable, true);
  assert.equal(adapter.solve({ ...SAMPLES[0]!, time_limit: s.min_moves - 1 }).solvable, false);

  const t0 = Date.now();
  const out = runLevel(adapter, SAMPLES[3] as Level, adapter.bots, 200, 3);
  assert.ok(Date.now() - t0 < 4000, `200 runs of 3 bots took ${Date.now() - t0} ms`);
  for (const bot of adapter.bots) assert.equal(out.results[bot]!.runs, 200);
  assert.equal(out.solvable, true);
});
