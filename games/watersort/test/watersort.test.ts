import assert from "node:assert/strict";
import { test } from "node:test";
import adapter from "../adapter/index.js";
import { playOut } from "../src/bots.js";
import { applyPour, isSolved, type Level, pourAmount, toTubes, usefulPours, validateLevel } from "../src/engine.js";
import { generateLevel, SAMPLES } from "../src/levels.js";
import { solveLevel } from "../src/solver.js";
import { runLevel } from "../../../solver/src/run.js";

const firstSplash = SAMPLES[0]!;

test("samples are valid and solvable within their move limits", () => {
  for (const s of SAMPLES) {
    assert.deepEqual(validateLevel(s), { ok: true }, s.title);
    const r = solveLevel(s);
    assert.ok(r.solvable && r.min_moves! <= s.move_limit, `${s.title}: min ${r.min_moves} > limit ${s.move_limit}`);
  }
});

test("validation explains what is wrong", () => {
  const bad = (level: unknown, re: RegExp) => {
    const v = validateLevel(level);
    assert.equal(v.ok, false);
    assert.ok(!v.ok && v.errors.some((e) => re.test(e)), `expected ${re} in ${JSON.stringify(v)}`);
  };
  bad({ capacity: 4, move_limit: 10, tubes: [["red", "red", "red"], ["blue", "blue", "blue", "blue", "red"], []] }, /more than capacity/);
  bad({ capacity: 4, move_limit: 10, tubes: [["red", "red", "blue", "blue"], ["blue", "blue", "red", "red"]] }, /more tube than colors/);
  bad({ capacity: 4, move_limit: 10, tubes: [["red", "red", "red"], ["blue", "blue", "blue", "blue"], []] }, /appears 3 times/);
  bad({ capacity: 2, move_limit: 10, tubes: [["red", "magenta"], ["magenta", "red"], []] }, /unknown color/);
  bad({ capacity: 2, move_limit: 10, tubes: [["red", "red"], ["blue", "blue"], []] }, /already solved/);
  bad({ ...firstSplash, speed: 3 }, /unknown field "speed"/);
  bad({ ...firstSplash, move_limit: 0 }, /move_limit/);
});

test("pours follow the rules", () => {
  const t = toTubes({ capacity: 4, move_limit: 9, tubes: [["red", "blue", "blue"], ["blue"], ["red"], []] });
  assert.equal(pourAmount(t, 4, 0, 1), 2);  // both blues fit on a blue
  assert.equal(pourAmount(t, 4, 0, 2), 0);  // blue can't go on red
  assert.equal(pourAmount(t, 4, 0, 3), 2);  // into an empty tube
  assert.equal(pourAmount(t, 4, 3, 0), 0);  // nothing to pour
  const after = applyPour(t, 0, 1, 2);
  assert.deepEqual(after[0], [0]);
  assert.deepEqual(after[1], [7, 7, 7]);
  assert.deepEqual(t[0], [0, 7, 7], "applyPour must not change its input");
});

test("the solver finds the shortest solution and proves unsolvable levels", () => {
  const r = solveLevel(firstSplash);
  assert.equal(r.min_moves, 7);
  let tubes = toTubes(firstSplash);
  for (const [from, to] of r.inputs!) tubes = applyPour(tubes, from, to, pourAmount(tubes, 4, from, to));
  assert.ok(isSolved(tubes, 4), "replaying the solution must solve the level");

  const stuck = generateLevel({ colors: 7, capacity: 4, spare: 1, move_limit: 50, seed: 1 });
  assert.equal(solveLevel(stuck).solvable, false);
});

test("bots are reproducible, and a person-like bot beats random play", () => {
  const level = { ...SAMPLES[3]!, move_limit: 27 };
  assert.deepEqual(playOut(level, "human", 42), playOut(level, "human", 42));
  const wins = (bot: string) => {
    let w = 0;
    for (let s = 0; s < 120; s++) if (playOut(level, bot, s).won) w++;
    return w;
  };
  assert.ok(wins("human") > wins("random"), "human should beat random");
  const r = playOut(firstSplash, "greedy", 1);
  assert.equal(typeof r.won, "boolean");
  assert.ok(r.moves_used >= 1 && r.moves_used <= firstSplash.move_limit);
  assert.throws(() => playOut(firstSplash, "search", 1), /unknown bot/);
});

test("useful pours never include pointless ones", () => {
  const t = toTubes({ capacity: 2, move_limit: 9, tubes: [["red", "red"], ["blue"], ["blue"], []] });
  const moves = usefulPours(t, 2);
  assert.ok(!moves.some((m) => m.from === 0), "a finished tube is never poured from");
  assert.ok(!moves.some((m) => m.to === 3 && (m.from === 1 || m.from === 2)), "a one-color tube is not poured into an empty tube");
});

test("adapter follows platform/CONTRACTS.md §1 and runs in the solver harness", () => {
  assert.equal(adapter.game_id, "watersort");
  assert.deepEqual(adapter.bots, ["human", "greedy", "random"]);
  assert.match(adapter.level_url("abc"), /\/watersort\/\?level=abc$/);
  assert.equal(typeof adapter.schema, "object");
  const s = adapter.solve(firstSplash);
  assert.deepEqual([s.solvable, s.min_moves], [true, 7]);
  assert.equal(adapter.solve({ ...firstSplash, move_limit: 6 }).solvable, false, "7 pours can't fit in 6");

  const out = runLevel(adapter, SAMPLES[2] as Level, adapter.bots, 200, 1);
  for (const bot of adapter.bots) {
    const r = out.results[bot]!;
    assert.equal(r.runs, 200);
    assert.ok(r.win_rate >= 0 && r.win_rate <= 1);
  }
  assert.equal(out.solvable, true);
});

test("200 runs of every bot on the hardest sample take under 3 seconds", () => {
  const t0 = Date.now();
  runLevel(adapter, SAMPLES[3] as Level, adapter.bots, 200, 7);
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
});
