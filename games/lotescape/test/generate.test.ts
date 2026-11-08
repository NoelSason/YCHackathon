import assert from "node:assert/strict";
import { test } from "node:test";
import { generateValidLevel, validateLevel } from "../adapter/index.js";
import { initialState, legalMoves, move, stateKey, type Direction, type Level, type Vehicle } from "../src/engine.js";
import { difficultyProfile, generateLevel, moveLimitFor, rateLevel } from "../src/generate.js";
import { BUILT_IN_BEST, LEVELS } from "../src/levels.js";
import { solveLevel } from "../src/solver.js";

function replay(level: Level, inputs: Array<{ id: string; direction: Direction }>) {
  let s = initialState(level);
  for (const input of inputs) { const next = move(level, s, input.id, input.direction); assert.notEqual(next, s, `illegal input ${input.id} ${input.direction}`); s = next; }
  return s;
}
/** Plain breadth-first search straight over `move`: slow, but an independent check on the solver. */
function referenceMinMoves(level: Level, cap = 400_000): number | undefined {
  let frontier = [initialState(level)]; const seen = new Set([stateKey(frontier[0]!)]);
  for (let depth = 0; frontier.length && seen.size < cap; depth++) {
    const next = [];
    for (const s of frontier) {
      if (s.won) return depth;
      for (const m of legalMoves(level, s)) { const t = move(level, s, m.id, m.direction), k = stateKey(t); if (!seen.has(k)) { seen.add(k); next.push(t); } }
    }
    frontier = next;
  }
  return undefined;
}

test("the solver's best matches a plain breadth-first search on small random lots", () => {
  let seed = 11; const rand = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let compared = 0;
  for (let k = 0; k < 60; k++) {
    const taken = new Set<string>(), vehicles: Vehicle[] = [];
    for (let tries = 0; vehicles.length < 5 && tries < 200; tries++) {
      const axis = rand() < 0.5 ? "h" : "v", length = rand() < 0.3 ? 3 : 2;
      const x = Math.floor(rand() * (axis === "h" ? 7 - length : 6)), y = Math.floor(rand() * (axis === "v" ? 7 - length : 6));
      const cells = Array.from({ length }, (_, i) => `${x + (axis === "h" ? i : 0)},${y + (axis === "v" ? i : 0)}`);
      if (cells.some((c) => taken.has(c))) continue; cells.forEach((c) => taken.add(c));
      vehicles.push({ id: `v${vehicles.length}`, x, y, length, axis, exit: axis === "h" ? (rand() < 0.5 ? "left" : "right") : rand() < 0.5 ? "up" : "down", color: "coral" });
    }
    const level: Level = { title: "random", size: 6, vehicles, move_limit: 300 };
    const expected = referenceMinMoves(level), solved = solveLevel(level);
    if (expected === undefined && !solved.solvable) continue;
    assert.equal(solved.min_moves, expected, JSON.stringify(vehicles));
    assert.equal(replay(level, solved.inputs!).won, true);
    compared++;
  }
  assert.ok(compared >= 30, `compared ${compared} solvable lots`);
});

test("the built-in lots: at least 6, recorded best is exact, limits are best + 15-25%, and they ramp up", () => {
  assert.ok(LEVELS.length >= 6);
  assert.equal(BUILT_IN_BEST.length, LEVELS.length);
  let previous = -Infinity;
  LEVELS.forEach((level, i) => {
    assert.deepEqual(validateLevel(level), { ok: true }, level.title);
    const solved = solveLevel(level);
    assert.equal(solved.min_moves, BUILT_IN_BEST[i], level.title);
    assert.equal(replay(level, solved.inputs!).won, true, level.title);
    const slack = level.move_limit / solved.min_moves! - 1;
    assert.ok(slack >= 0.15 && slack <= 0.25, `${level.title}: limit ${level.move_limit} is ${(slack * 100).toFixed(0)}% over ${solved.min_moves}`);
    const rating = rateLevel(level, solved)!;
    assert.ok(rating.score > previous, `${level.title} should be harder than the lot before it`);
    assert.ok(rating.blocking_depth >= 3, `${level.title} needs a chain of blockers`);
    previous = rating.score;
  });
  assert.ok(BUILT_IN_BEST[0]! > 16, "the first lot is harder than the old practice lots (14 and 16 moves)");
});

test("the generator is deterministic for a seed and difficulty", () => {
  for (const [seed, difficulty] of [["alpha", 3], [42, 7]] as const) {
    const a = generateLevel({ seed, difficulty, timeLimitMs: 60_000 }), b = generateLevel({ seed, difficulty, timeLimitMs: 60_000 });
    assert.notEqual(a.stopped, "time");
    assert.deepEqual(a, b);
  }
  assert.notDeepEqual(generateLevel({ seed: "alpha", difficulty: 3 }).level, generateLevel({ seed: "beta", difficulty: 3 }).level);
});

test("every generated lot validates, solves within its limit, and replays", () => {
  for (const difficulty of [1, 2, 4, 6, 8, 10, 12, 20]) for (const seed of ["s1", "s2"]) {
    const made = generateValidLevel({ seed, difficulty, timeLimitMs: 60_000 });
    const { level, rating } = made;
    assert.deepEqual(Object.keys(level).sort(), ["move_limit", "size", "title", "vehicles"], "standard level JSON");
    assert.deepEqual(validateLevel(JSON.parse(JSON.stringify(level))), { ok: true });
    const solved = solveLevel(level);
    assert.equal(solved.min_moves, rating.min_moves);
    assert.equal(level.move_limit, moveLimitFor(rating.min_moves));
    assert.equal(replay(level, made.inputs).won, true, `inputs replay at difficulty ${difficulty}`);
    assert.ok(made.inputs.length <= level.move_limit);
    const [lo, hi] = difficultyProfile(difficulty).score;
    if (made.stopped === "target") assert.ok(rating.score >= lo && rating.score <= hi, `score ${rating.score} in [${lo}, ${hi}]`);
  }
});

test("difficulty rises with the target notch", () => {
  const notches = [1, 4, 7, 10];
  const means = notches.map((difficulty) => {
    const scores = ["r1", "r2", "r3"].map((seed) => generateLevel({ seed, difficulty, timeLimitMs: 60_000 }));
    for (const made of scores) assert.equal(made.stopped, "target", `difficulty ${difficulty} seed ${made.seed} reached its band`);
    return { scores: scores.map((m) => m.rating.score), moves: scores.reduce((sum, m) => sum + m.rating.min_moves, 0) / 3, backups: scores.reduce((sum, m) => sum + m.rating.backups, 0) / 3 };
  });
  for (let i = 1; i < means.length; i++) {
    assert.ok(Math.min(...means[i]!.scores) > Math.max(...means[i - 1]!.scores), `every lot at notch ${notches[i]} outscores every lot at notch ${notches[i - 1]}`);
    assert.ok(means[i]!.moves > means[i - 1]!.moves, "and needs more moves on average");
    assert.ok(means[i]!.backups >= means[i - 1]!.backups, "and at least as many back-steps");
  }
  assert.ok(means[3]!.backups >= 3, "notch 10 lots make you back up several times");
});

test("difficulty profiles climb, then hold at the top", () => {
  for (let d = 1; d < 12; d++) assert.ok(difficultyProfile(d + 1).score[0] > difficultyProfile(d).score[0]);
  assert.deepEqual(difficultyProfile(30).score, difficultyProfile(12).score);
  assert.equal(difficultyProfile(0).difficulty, 1);
});
