import assert from "node:assert/strict";
import { test } from "node:test";
import adapter from "../adapter/index.js";
import { mulberry32, playOut } from "../src/bots.js";
import {
  applyPour, canPourFrom, isComplete, isSolved, isStuck, type Level, legalPours, pourAmount, pourBlock, toTubes, usefulPours,
  validateLevel,
} from "../src/engine.js";
import { generateLevel, generateSolvableLevel, SAMPLES } from "../src/levels.js";
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

// Genre rules (RULES.md): whole top run moves, as much as fits; finished tubes are sealed;
// solved = every tube empty or full of one color; stuck = no legal pour left.
test("a pour moves the whole top run of one color, or as much as fits", () => {
  const t = toTubes({ capacity: 4, move_limit: 9, tubes: [["red", "blue", "blue", "blue"], ["blue", "blue"], []] });
  assert.equal(pourAmount(t, 4, 0, 2), 3, "the whole run of three blues goes into an empty tube");
  assert.equal(pourAmount(t, 4, 0, 1), 2, "only two blues fit on the two already there");
  const after = applyPour(t, 0, 1, 2);
  assert.deepEqual(after[0], [0, 7], "the blue that didn't fit stays behind");
  assert.deepEqual(after[1], [7, 7, 7, 7]);
});

test("a finished tube is sealed: nothing pours out of it", () => {
  const t = toTubes({ capacity: 4, move_limit: 9, tubes: [["red", "red", "red", "red"], ["blue", "blue"], ["blue", "blue"], []] });
  assert.ok(isComplete(t[0]!, 4));
  assert.equal(canPourFrom(t, 4, 0), false);
  assert.equal(pourBlock(t, 4, 0, 3), "finished-source");
  assert.equal(pourAmount(t, 4, 0, 3), 0);
  assert.ok(!legalPours(t, 4).some((p) => p.from === 0));
  assert.equal(canPourFrom(t, 4, 3), false, "an empty tube can't be picked either");
  assert.equal(canPourFrom(t, 4, 1), true);
});

test("pourBlock names why a pour isn't allowed", () => {
  const t = toTubes({ capacity: 3, move_limit: 9, tubes: [["red", "blue"], ["blue", "red", "red"], ["red"], []] });
  assert.equal(pourBlock(t, 3, 0, 0), "same-tube");
  assert.equal(pourBlock(t, 3, 3, 0), "empty-source");
  assert.equal(pourBlock(t, 3, 0, 1), "full-target");
  assert.equal(pourBlock(t, 3, 0, 2), "color-mismatch");
  assert.equal(pourBlock(t, 3, 2, 0), "color-mismatch");
  assert.equal(pourBlock(t, 3, 1, 2), null);
  assert.equal(pourAmount(t, 3, 1, 2), 2);
});

test("solved means every tube is empty or full of one color", () => {
  assert.ok(isSolved(toTubes({ capacity: 2, move_limit: 1, tubes: [["red", "red"], [], ["blue", "blue"]] }), 2));
  assert.ok(!isSolved(toTubes({ capacity: 2, move_limit: 1, tubes: [["red"], ["red"], ["blue", "blue"]] }), 2), "split color");
  assert.ok(!isSolved(toTubes({ capacity: 2, move_limit: 1, tubes: [["red", "blue"], ["blue", "red"], []] }), 2));
});

test("stuck means not solved and no legal pour left", () => {
  const stuck = toTubes({ capacity: 2, move_limit: 9, tubes: [["red", "blue"], ["blue", "red"]] });
  assert.equal(legalPours(stuck, 2).length, 0);
  assert.ok(isStuck(stuck, 2));
  assert.ok(!isStuck(toTubes({ capacity: 2, move_limit: 9, tubes: [["red", "blue"], ["blue", "red"], []] }), 2), "an empty tube is a move");
  assert.ok(!isStuck(toTubes({ capacity: 2, move_limit: 9, tubes: [["red", "red"], ["blue", "blue"]] }), 2), "solved is not stuck");
  // The bots call a board stuck when no useful pour is left; the game, when no legal pour is
  // left. Check on random walks that the two always agree.
  const rnd = mulberry32(5);
  for (let walk = 0; walk < 200; walk++) {
    let t = toTubes(SAMPLES[3]!);
    for (let step = 0; step < 40; step++) {
      const legal = legalPours(t, 4);
      assert.equal(usefulPours(t, 4).length === 0, legal.length === 0, `walk ${walk} step ${step}`);
      if (!legal.length) break;
      const p = legal[Math.floor(rnd() * legal.length)]!;
      t = applyPour(t, p.from, p.to, p.amount);
    }
  }
});

test("generateSolvableLevel deals only levels the solver proves solvable", () => {
  const opts = { colors: 5, capacity: 4, spare: 2, move_limit: 20, seed: 7 };
  assert.deepEqual(generateSolvableLevel(opts), generateLevel(opts), "a good seed gives the same deal as generateLevel");
  const oneSpare = { colors: 4, capacity: 4, spare: 1, move_limit: 60, seed: 3 };
  const level = generateSolvableLevel(oneSpare);
  assert.deepEqual(validateLevel(level), { ok: true });
  const r = solveLevel(level);
  assert.ok(r.solvable && r.min_moves! <= level.move_limit);
  assert.ok(!toTubes(level).some((t) => isComplete(t, level.capacity)), "no tube starts finished");
  assert.throws(() => generateSolvableLevel({ ...opts, move_limit: 1 }), /no solvable deal/);
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
