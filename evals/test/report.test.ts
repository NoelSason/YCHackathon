import assert from "node:assert/strict";
import { test } from "node:test";
import { evalReport, formatReport, referenceBot } from "../src/report.js";
import { addGame, addLevel, addPlays, freshDb, hoursAfter } from "./helpers.js";

const T = new Date("2026-11-08T08:00:00Z");

test("hit rate, rounds, error, solver runs, calibration, and cost per game", async () => {
  const q = await freshDb();
  await addGame(q, "watersort");
  // Design A: accepted on its 2nd version, 2 pts off target -> a hit.
  const a1 = await addLevel(q, { game_id: "watersort", target: 0.4, status: "rejected", created_at: T });
  const a2 = await addLevel(q, { game_id: "watersort", target: 0.4, status: "accepted", measured: 0.42, parent: a1, created_at: hoursAfter(T, 0.1) });
  // Design B: four versions, all rejected.
  let p = await addLevel(q, { game_id: "watersort", target: 0.3, status: "rejected", created_at: T });
  for (let i = 0; i < 3; i++) p = await addLevel(q, { game_id: "watersort", target: 0.3, status: "rejected", parent: p, created_at: hoursAfter(T, 0.1 * (i + 1)) });
  // Design C: accepted on target, but only on its 5th version -> accepted, not a hit.
  p = await addLevel(q, { game_id: "watersort", target: 0.6, status: "draft", created_at: T });
  for (let i = 0; i < 4; i++) {
    p = await addLevel(q, { game_id: "watersort", target: 0.6, status: i === 3 ? "accepted" : "draft", measured: i === 3 ? 0.6 : null, parent: p, created_at: hoursAfter(T, 0.1 * (i + 1)) });
  }
  // Design D: still pending.
  await addLevel(q, { game_id: "watersort", target: 0.5, created_at: T });

  // Solver runs: one done on a2 (human predicts 42%), one failed.
  await q(`insert into solver_runs(level_id, bots, status, results, finished_at) values ($1, '["human","random"]', 'done', $2, now())`, [
    a2, JSON.stringify({ random: { runs: 200, wins: 20, win_rate: 0.1, avg_moves: 9 }, human: { runs: 200, wins: 84, win_rate: 0.42, avg_moves: 12 } }),
  ]);
  await q(`insert into solver_runs(level_id, bots, status, error, finished_at) values ($1, '["human"]', 'failed', 'x', now())`, [a1]);
  // Real players on a2: 9 wins in 20 finished -> 45%.
  await addPlays(q, "watersort", a2, hoursAfter(T, 1), hoursAfter(T, 2), { attempts: 20, wins: 9, quits: 3 });
  // Cost reported by the agents.
  await q(`insert into activity_log(agent, action, cost_usd) values ('designer','save_level',0.30), ('tuner','accept_level',0.20), ('sales_sender','email',5)`);

  const r = await evalReport(q);
  const g = r.games.find((x) => x.game_id === "watersort")!;
  assert.deepEqual([g.designs, g.accepted, g.rejected, g.pending, g.hits], [4, 2, 1, 1, 1]);
  assert.equal(g.hit_rate, 0.333);
  assert.equal(g.mean_rounds_to_accept, 3.5);
  assert.equal(g.mean_abs_error_pts, 1);
  assert.deepEqual(g.solver_runs, { done: 1, failed: 1, queued_or_running: 0 });
  assert.equal(g.calibration.points.length, 1);
  assert.deepEqual(
    [g.calibration.points[0]!.bot, g.calibration.points[0]!.predicted, g.calibration.points[0]!.actual],
    ["human", 0.42, 0.45],
  );
  assert.equal(g.calibration.mean_abs_gap_pts, 3);
  assert.equal(g.calibration.bias_pts, 3);
  assert.equal(r.totals.cost_usd, 0.5, "only the Designer and Tuner count");
  assert.equal(r.totals.cost_per_accepted_usd, 0.25);
  assert.match(formatReport(r), /watersort\s+4\s+2\s+1\s+1\s+33%/);
});

test("an empty database gives an empty report, not an error", async () => {
  const q = await freshDb();
  const r = await evalReport(q);
  assert.deepEqual(r.games, []);
  assert.equal(r.totals.hit_rate, null);
  assert.match(formatReport(r), /no real-game levels yet/);
});

test("the reference bot is the most person-like one the game has", () => {
  assert.equal(referenceBot({ random: {}, greedy: {}, human: {} }), "human");
  assert.equal(referenceBot({ random: {}, greedy: {} }), "greedy");
  assert.equal(referenceBot({ random: {} }), "random");
});


test("current quality uses the verified replacement while preserving the legacy root",async()=>{
 const q=await freshDb();await addGame(q,"racer");
 const parent=await addLevel(q,{game_id:"racer",target:.5,status:"published",measured:.9});
 const child=await addLevel(q,{game_id:"racer",target:.5,status:"accepted",measured:.5,parent});
 await q("update levels set notes=$2 where level_id=$1",[parent,JSON.stringify({quality:{superseded_by:child}})]);
 const r=await evalReport(q);assert.equal(r.games[0]!.accepted,1);assert.equal(r.games[0]!.mean_abs_error_pts,0);assert.equal(r.games[0]!.mean_rounds_to_accept,2);
});
