// Runs the queue against the real platform schema (platform/db/schema.sql) in an in-process
// Postgres. No network, no shared database touched.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { getAdapter } from "../../platform/mcp/src/adapters.js";
import { claimNext, failStale, processNext, type Query } from "../src/queue.js";

const schema = await readFile(new URL("../../platform/db/schema.sql", import.meta.url), "utf8");

let q: Query;

beforeEach(async () => {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(schema);
  q = async (text, params = []) => (await db.query<Record<string, unknown>>(text, params)).rows;
});

// What platform/mcp's save_level and solve_level write.
async function queueStubRun(level: object, bots: string[] = ["random"], runs = 200): Promise<string> {
  const [lvl] = await q(
    `insert into levels(game_id, level, target_win_rate, created_by) values ('stub', $1, 0.4, 'designer') returning level_id`,
    [JSON.stringify(level)],
  );
  const [run] = await q(`insert into solver_runs(level_id, bots, runs_per_bot) values ($1, $2, $3) returning run_id`, [
    lvl!.level_id,
    JSON.stringify(bots),
    runs,
  ]);
  return String(run!.run_id);
}

test("a queued stub run is claimed, played, and written back in the contract's shape", async () => {
  const runId = await queueStubRun({ width: 5, height: 5, moves: 10 });
  const out = await processNext(q, "test-worker", getAdapter);
  assert.equal(out.kind, "done");

  const [row] = await q(`select * from solver_runs where run_id = $1`, [runId]);
  assert.equal(row!.status, "done");
  assert.equal(row!.claimed_by, "test-worker");
  assert.ok(row!.started_at && row!.finished_at);
  const results = row!.results as Record<string, Record<string, number>>;
  const r = results.random!;
  assert.equal(r.runs, 200);
  for (const k of ["wins", "win_rate", "avg_moves"]) assert.equal(typeof r[k], "number");
  assert.ok(r.win_rate! > 0.25 && r.win_rate! < 0.55, `stub win rate ${r.win_rate}`);
  assert.equal(row!.solvable, null);

  const logs = await q(`select agent, action, result, ref_kind, ref_id from activity_log`);
  assert.deepEqual(
    logs.map((l) => [l.agent, l.action, l.ref_kind, l.ref_id]),
    [["platform", "solver_run.done", "solver_run", runId]],
  );
  assert.match(String(logs[0]!.result), /^random \d+(\.\d)?% \(\d+\/200\)$/);
});

test("an empty queue is idle", async () => {
  assert.deepEqual(await processNext(q, "w", getAdapter), { kind: "idle" });
});

test("a game with no adapter fails with a readable error", async () => {
  await q(`insert into games(game_id, name) values ('nogame', 'No adapter yet')`);
  const [lvl] = await q(
    `insert into levels(game_id, level, target_win_rate) values ('nogame', '{}', 0.4) returning level_id`,
  );
  const [run] = await q(`insert into solver_runs(level_id, bots) values ($1, '["random"]') returning run_id`, [
    lvl!.level_id,
  ]);
  const out = await processNext(q, "w", getAdapter);
  assert.equal(out.kind, "failed");
  const [row] = await q(`select status, error from solver_runs where run_id = $1`, [run!.run_id]);
  assert.equal(row!.status, "failed");
  assert.match(String(row!.error), /no adapter for game nogame/);
});

test("an invalid level or an unknown bot fails the run instead of crashing the worker", async () => {
  const badLevel = await queueStubRun({ width: 5 });
  const badBot = await queueStubRun({ width: 5, height: 5, moves: 10 }, ["search"]);
  assert.equal((await processNext(q, "w", getAdapter)).kind, "failed");
  assert.equal((await processNext(q, "w", getAdapter)).kind, "failed");
  const rows = await q(`select run_id, error from solver_runs order by created_at`);
  assert.match(String(rows.find((r) => r.run_id === badLevel)!.error), /invalid level/);
  assert.match(String(rows.find((r) => r.run_id === badBot)!.error), /unknown bots for stub: search/);
});

test("runs are claimed oldest first, and a claimed run isn't claimed twice", async () => {
  const first = await queueStubRun({ width: 4, height: 4, moves: 5 });
  const second = await queueStubRun({ width: 4, height: 4, moves: 5 });
  assert.equal((await claimNext(q, "a"))?.run_id, first);
  assert.equal((await claimNext(q, "b"))?.run_id, second);
  assert.equal(await claimNext(q, "c"), null);
});

test("a run left 'running' too long is failed once, with a readable reason", async () => {
  const runId = await queueStubRun({ width: 5, height: 5, moves: 10 });
  await q(`update solver_runs set status = 'running', claimed_by = 'crashed', started_at = now() - interval '30 minutes' where run_id = $1`, [runId]);
  assert.deepEqual(await failStale(q, 15), [runId]);
  const [row] = await q(`select status, error from solver_runs where run_id = $1`, [runId]);
  assert.equal(row!.status, "failed");
  assert.match(String(row!.error), /harness stopped before finishing \(claimed by crashed\)/);
  assert.deepEqual(await failStale(q, 15), []);
});
