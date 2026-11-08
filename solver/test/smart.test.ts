import assert from "node:assert/strict";
import { test } from "node:test";
import { getAdapter, stubAdapter } from "../../platform/mcp/src/adapters.js";
import { SAMPLES } from "../../games/racer/src/levels.js";
import { runLevel, runLevelSmart } from "../src/run.js";

test("parallel play gives exactly the same numbers as single-threaded play", async () => {
  const racer = getAdapter("racer")!;
  const level = SAMPLES[1]!;
  // ~2-3 ms per game for the human bot, so 1,200 games projects past the 2 s parallel threshold.
  const seq = runLevel(racer, level, ["human"], 1200, 777);
  const par = await runLevelSmart(racer, level, ["human"], 1200, 777, { gameId: "racer", threads: 4, maxSeconds: 120 });
  assert.equal(par.budget_hit, false);
  assert.deepEqual(par.results, seq.results);
  assert.equal(par.solvable, seq.solvable);
  assert.equal(par.min_moves, seq.min_moves);
});

test("fast games stay single-threaded and match runLevel exactly", async () => {
  const level = { width: 5, height: 5, moves: 10 };
  const seq = runLevel(stubAdapter, level, ["random"], 300, 42);
  const smart = await runLevelSmart(stubAdapter, level, ["random"], 300, 42, { gameId: "stub", threads: 6 });
  assert.deepEqual(smart.results, seq.results);
});

test("a run stops at its time budget and says so, after a minimum number of games", async () => {
  const racer = getAdapter("racer")!;
  const out = await runLevelSmart(racer, SAMPLES[3]!, ["human"], 50_000, 1, { gameId: "racer", threads: 1, maxSeconds: 0.3, minGames: 20 });
  const r = out.results.human!;
  assert.equal(out.budget_hit, true);
  assert.equal(r.budget_hit, true);
  assert.equal(r.runs_requested, 50_000);
  assert.ok(r.runs >= 20 && r.runs < 50_000, `played ${r.runs}`);
  assert.ok(r.win_rate >= 0 && r.win_rate <= 1);
});

test("bad input is still refused before anything runs", async () => {
  await assert.rejects(runLevelSmart(stubAdapter, { width: 5 }, ["random"], 10, 1, { gameId: "stub" }), /invalid level/);
  await assert.rejects(runLevelSmart(stubAdapter, { width: 5, height: 5, moves: 3 }, ["search"], 10, 1, { gameId: "stub" }), /unknown bots/);
});
