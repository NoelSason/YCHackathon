import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { record, remeasure, remeasureSeed } from "../src/production/remeasure.js";
import { recipe } from "../src/production/catalog.js";
import { calibrate } from "../src/production/calibrate.js";

async function db() {
  const pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec(await readFile(new URL("../../platform/db/schema.sql", import.meta.url), "utf8"));
  await pg.exec("insert into games(game_id, name) values ('racer', 'Turbo Lanes')");
  const q = async (sql: string, values: unknown[] = []) => (await pg.query<Record<string, unknown>>(sql, values)).rows;
  return { pg, q };
}

async function seedLevels(q: Awaited<ReturnType<typeof db>>["q"]) {
  const ids: string[] = [];
  for (const position of [1, 12]) {
    let made: ReturnType<typeof calibrate> | undefined;
    for (let attempt = 0; attempt < 8 && !made; attempt++) { try { made = calibrate(recipe("racer", position, attempt)); } catch { /* next layout */ } }
    assert.ok(made);
    const [row] = await q(
      "insert into levels(game_id, level, target_win_rate, measured_win_rate, status, created_by, notes) values ('racer', $1, $2, 0.123, 'published', 'production', '{}') returning level_id::text as id",
      [JSON.stringify(made.level), made.target],
    );
    await q("insert into solver_runs(level_id, bots, runs_per_bot, status, results, claimed_by) values ($1, '[\"human\"]', 200, 'done', '{\"old\":true}', 'production')", [row!.id]);
    ids.push(String(row!.id));
  }
  return ids;
}

test("remeasure is reproducible, writes new evidence and the measured rate, and keeps content, status and old evidence", async () => {
  const { pg, q } = await db();
  try {
    const ids = await seedLevels(q);
    const before = await q("select level_id::text as id, level, status from levels order by level_id");
    const a = await remeasure(q, "racer", "test");
    const b = await remeasure(q, "racer", "test");
    assert.deepEqual(a, b, "same label, same seeds, same numbers");
    assert.notEqual(remeasureSeed("test", ids[0]!), remeasureSeed("other", ids[0]!));
    assert.equal(a.length, 2);
    for (const r of a) assert.equal(r.results.human!.runs, 200);

    assert.equal(await record(q, "racer", "test", "unit test", a), 2);
    const after = await q("select level_id::text as id, level, status, measured_win_rate from levels order by level_id");
    for (let i = 0; i < after.length; i++) {
      assert.deepEqual(after[i]!.level, before[i]!.level, "content unchanged");
      assert.equal(after[i]!.status, "published", "status unchanged");
      assert.equal(Number(after[i]!.measured_win_rate), a.find((r) => r.level_id === after[i]!.id)!.measured);
    }
    const runs = await q("select claimed_by, results from solver_runs order by claimed_by");
    assert.equal(runs.filter((r) => r.claimed_by === "production").length, 2, "old evidence kept");
    assert.deepEqual(runs.filter((r) => r.claimed_by === "production").map((r) => r.results), [{ old: true }, { old: true }]);
    assert.equal(runs.filter((r) => r.claimed_by === "remeasure:test").length, 2);
    const log = await q("select agent, action, result from activity_log where action = 'production.remeasured'");
    assert.equal(log.length, 1);
    assert.match(String(log[0]!.result), /^2 levels remeasured/);
  } finally { await pg.close(); }
});

test("the kill switch records nothing", async () => {
  const { pg, q } = await db();
  try {
    await seedLevels(q);
    const items = await remeasure(q, "racer", "test");
    await q("update settings set value = 'true'::jsonb where key = 'kill_switch'");
    await assert.rejects(record(q, "racer", "test", "unit test", items), /kill switch/);
    assert.equal((await q("select count(*)::int as n from solver_runs where claimed_by like 'remeasure:%'"))[0]!.n, 0);
    assert.deepEqual((await q("select distinct measured_win_rate::float as m from levels")).map((r) => r.m), [0.123]);
  } finally { await pg.close(); }
});
