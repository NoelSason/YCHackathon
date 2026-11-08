import assert from "node:assert/strict";
import { test } from "node:test";
import type { Adapter } from "../../platform/mcp/src/adapters.js";
import { stubAdapter } from "../../platform/mcp/src/adapters.js";
import { firstSeedFor, RunError, runLevel, summarize } from "../src/run.js";

// A fake game whose outcome is a plain function of the seed, so counts can be checked exactly.
const seen: Record<string, number[]> = {};
const fake: Adapter = {
  game_id: "fake",
  name: "Fake",
  schema: {},
  bots: ["even", "always"],
  validate: (level) =>
    level && typeof level === "object" ? { ok: true } : { ok: false, errors: ["level must be an object"] },
  simulate: (_level, bot, seed) => {
    (seen[bot] ??= []).push(seed);
    return { won: bot === "always" || seed % 2 === 0, moves_used: seed % 10 };
  },
  solve: () => ({ solvable: true, min_moves: 7 }),
  level_url: (id) => `https://example.test/fake/?level=${id}`,
};

test("counts wins and moves per bot, with the same seeds for every bot", () => {
  const out = runLevel(fake, {}, ["even", "always"], 10, 100);
  assert.deepEqual(out.results.even, {
    runs: 10, wins: 5, win_rate: 0.5, avg_moves: 4.5, ci95_low: 0.2366, ci95_high: 0.7634, first_seed: 100,
  });
  assert.equal(out.results.always?.wins, 10);
  assert.deepEqual(seen.even, seen.always);
  assert.equal(out.solvable, true);
  assert.equal(out.min_moves, 7);
  assert.equal(summarize(out), "even 50% (5/10); always 100% (10/10); solvable, min 7 moves");
});

test("rejects unknown bots, invalid levels, and bad run counts", () => {
  assert.throws(() => runLevel(fake, {}, ["search"], 10, 1), RunError);
  assert.throws(() => runLevel(fake, null, ["even"], 10, 1), /invalid level/);
  assert.throws(() => runLevel(fake, {}, ["even"], 0, 1), RunError);
  assert.throws(() => runLevel(fake, {}, [], 10, 1), RunError);
});

test("rejects malformed adapter output", () => {
  const broken: Adapter = { ...fake, simulate: () => ({ won: "yes", moves_used: 3 }) as never };
  assert.throws(() => runLevel(broken, {}, ["even"], 3, 1), /malformed/);
});

test("the platform's stub game is reproducible and lands near its built-in odds", () => {
  // Stub: win probability = moves / (width * height) = 10 / 25 = 0.4.
  const level = { width: 5, height: 5, moves: 10 };
  const a = runLevel(stubAdapter, level, ["random"], 400, 12345);
  const b = runLevel(stubAdapter, level, ["random"], 400, 12345);
  assert.deepEqual(a, b);
  const r = a.results.random!;
  assert.ok(r.ci95_low <= 0.4 && 0.4 <= r.ci95_high, `0.4 outside [${r.ci95_low}, ${r.ci95_high}]`);
  assert.equal(a.solvable, null); // the stub has no solve()
});

test("seeds come from the run id", () => {
  assert.equal(firstSeedFor("0000002a-0000-0000-0000-000000000000"), 42);
  assert.equal(firstSeedFor("ffffffff-1111-2222-3333-444444444444"), 4294967295);
});
