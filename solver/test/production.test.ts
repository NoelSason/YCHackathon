import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { getAdapter } from "../../platform/mcp/src/adapters.js";
import { fingerprint, GAMES, progression, recipe } from "../src/production/catalog.js";
import { calibrate, quantileKnob } from "../src/production/calibrate.js";
import { generateOne } from "../src/production/runner.js";
import { levelId, saveAccepted } from "../src/production/store.js";
import { runLevel } from "../src/run.js";

test("all 3,000 catalog recipes use current game schemas, deterministic seeds, and bounded progression", () => {
  for (const game of GAMES) for (let i = 1; i <= 1000; i++) {
    const r = recipe(game, i);
    assert.ok(r.target >= 0.3 && r.target <= 0.9);
    assert.deepEqual(getAdapter(game)!.validate(r.level), { ok: true }, `${game} ${i}`);
  }
  assert.deepEqual(recipe("racer", 1000), recipe("racer", 1000));
  assert.notDeepEqual(recipe("match3", 50), recipe("match3", 50, 1));
  assert.throws(() => progression(1001));
  assert.ok(progression(1000).target < progression(10).target);
  assert.ok(progression(1001 - 10).target > progression(990).target, "recovery after challenge");
});

test("racer unlocks are real engine kinds and later layouts retain a playable shared schema", () => {
  const kinds = (n: number) => (recipe("racer", n).level as { objects: { kind: string }[] }).objects.map(o => o.kind);
  assert.ok(!kinds(1).includes("boost") && !kinds(1).includes("shield") && !kinds(1).includes("oil"));
  assert.ok(kinds(1000).includes("boost") && kinds(1000).includes("shield") && kinds(1000).includes("oil"));
  assert.ok(recipe("match3", 1000).features.includes("layered-seals"));
  assert.ok(recipe("watersort", 1000).features.includes("6-colors") || recipe("watersort", 1000).features.includes("5-colors"));
});

test("duplicate detection ignores sort names, allowance, tube order, and color relabeling", () => {
  const a = { title: "A", capacity: 3, move_limit: 20, tubes: [["red","blue","red"],["blue","red","blue"],[]] };
  const b = { ...a, title: "B", move_limit: 30, tubes: [[],["teal","pink","teal"],["pink","teal","pink"]] };
  assert.equal(fingerprint("watersort", a), fingerprint("watersort", b));
});

test("quantile proposals respect each game's allowance direction and exact-solver floor", () => {
  assert.equal(quantileKnob([5,6,7,8], .5, 5, 10, true), 6);
  assert.equal(quantileKnob([5,6,7,8], .5, 1, 10, false), 7);
  assert.ok(quantileKnob([1,2,3], .5, 8, 10, true) >= 8);
});

test("accepted difficulty is an independent actual replay, not an estimated distribution", () => {
  const accepted = calibrate(recipe("watersort", 1));
  const a = getAdapter("watersort")!;
  const replay = runLevel(a, accepted.level, [accepted.bot], 200, accepted.evidence.first_seed);
  assert.deepEqual(replay.results[accepted.bot], accepted.evidence);
  assert.equal(replay.solvable, true);
  assert.ok(accepted.evidence.runs >= 200);
  assert.throws(() => calibrate(recipe("watersort",1), { verificationRuns: 10 }), /200/);
});

test("a hard deadline stops a production job without accepting incomplete evidence", async () => {
  const out = await generateOne("match3", 1000, 1, 1);
  assert.equal(out.ok, false);
});

test("LevelOps import is atomic/idempotent, keeps evidence, honors kill switch, and never publishes", async () => {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  try {
    await db.exec(await readFile(new URL("../../platform/db/schema.sql", import.meta.url), "utf8"));
    await db.exec("insert into games(game_id,name) values ('watersort','Splash Sort')");
    const q = async (sql: string, params: unknown[] = []) => (await db.query<Record<string,unknown>>(sql, params)).rows;
    const accepted = calibrate(recipe("watersort", 1));
    const id = await saveAccepted(q, accepted, 1);
    assert.equal(await saveAccepted(q, accepted, 1), id);
    for (const table of ["levels", "solver_runs", "activity_log"]) assert.equal((await q(`select count(*)::int as n from ${table}`))[0]!.n, 1);
    assert.equal((await q("select count(*)::int as n from packs"))[0]!.n, 0);
    assert.equal((await q("select status from levels"))[0]!.status, "accepted");
    assert.notEqual(id, levelId("watersort",1,2));
    await db.exec("update settings set value='true' where key='kill_switch'");
    await assert.rejects(saveAccepted(q, accepted, 2), /kill switch/);
    assert.equal((await q("select count(*)::int as n from levels"))[0]!.n, 1);
  } finally { await db.close(); }
});

test("checkpoint ownership prevents duplicate writers and a torn tail can resume without losing complete records", async () => {
  const { mkdtemp, writeFile, readdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { lockOutput, readCheckpoint } = await import("../src/production/checkpoint.js");
  const dir = await mkdtemp(join(tmpdir(), "production-checkpoint-"));
  try {
    const file = join(dir, "levels.jsonl"), release = await lockOutput(file);
    await assert.rejects(lockOutput(file), /another production process/);
    await writeFile(file, '{"ok":true}\n{"partial":');
    assert.equal(await readCheckpoint(file), '{"ok":true}\n');
    assert.ok((await readdir(dir)).some(f => f.includes(".partial-")));
    await release();
    const releaseAgain = await lockOutput(file);
    await releaseAgain();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
