// The automatic Tuner handles the two newer games like the first three: a Designer draft is claimed,
// measured with the game's human bot, and accepted or rejected with every step recorded.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { getAdapter } from "../../platform/mcp/src/adapters.js";
import { LEVELS } from "../../games/lotescape/src/levels.js";
import { generateTrail } from "../../games/platformer/src/generate.js";
import { KNOBS, onTarget, tuneNextDesign } from "../src/autotune.js";
import type { Query } from "../src/queue.js";

const schema = await readFile(new URL("../../platform/db/schema.sql", import.meta.url), "utf8");
let q: Query;

beforeEach(async () => {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(schema);
  q = async (text, params = []) => (await db.query<Record<string, unknown>>(text, params)).rows;
  await q(`insert into games(game_id, name) values ('lotescape', 'Lot Escape'), ('platformer', 'Mosslight Trails')`);
});

async function design(game: string, level: object, target: number): Promise<string> {
  const [r] = await q(
    `insert into levels(game_id, level, target_win_rate, created_by, created_at) values ($1, $2, $3, 'designer', now() - interval '1 minute') returning level_id::text as id`,
    [game, JSON.stringify(level), target],
  );
  return String(r!.id);
}

async function tuneAll(games: string[]) {
  const outcomes = [];
  for (let i = 0; i < 10; i++) {
    const out = await tuneNextDesign(q, "test-worker", getAdapter, { games });
    if (out.kind === "idle") break;
    outcomes.push(out);
  }
  return outcomes;
}

test("lotescape and platformer have tuner knobs on move_limit with the exact minimum as the floor", () => {
  for (const g of ["lotescape", "platformer"]) {
    assert.deepEqual(KNOBS[g]!.path, ["move_limit"]);
    assert.equal(KNOBS[g]!.dir, 1);
    assert.equal(KNOBS[g]!.solverFloor, true);
  }
});

test("a Lot Escape draft is tuned on move_limit and accepted on target, never below the fewest moves", async () => {
  const lot = LEVELS[0]!;
  const min = getAdapter("lotescape")!.solve!(lot).min_moves!;
  const id = await design("lotescape", { ...lot, move_limit: min + 40 }, 0.6);
  const [out] = await tuneAll(["lotescape"]);
  assert.ok(out, "the tuner claimed the draft");
  assert.equal(out.kind, "accepted", JSON.stringify(out));
  const [row] = await q(`select level, measured_win_rate::float as m, target_win_rate::float as t from levels where level_id = $1`, [out.level_id]);
  const limit = (row!.level as { move_limit: number }).move_limit;
  assert.ok(limit >= min, `move_limit ${limit} below the fewest moves ${min}`);
  const [run] = await q(`select results from solver_runs where level_id = $1 and status = 'done' order by finished_at desc limit 1`, [out.level_id]);
  assert.ok(onTarget((run!.results as Record<string, { win_rate: number; ci95_low: number; ci95_high: number }>).human!, 0.6));
  const [orig] = await q(`select status from levels where level_id = $1`, [id]);
  assert.notEqual(orig!.status, "draft", "the draft was claimed");
});

test("a Mosslight draft without move_limit starts at the easy end and gets a tuned step budget", async () => {
  const trail = generateTrail({ seed: 77, difficulty: 4, name: "Test trail" });
  assert.equal("move_limit" in trail, false);
  const min = getAdapter("platformer")!.solve!(trail).min_moves!;
  await design("platformer", trail, 0.6);
  const [out] = await tuneAll(["platformer"]);
  assert.ok(out, "the tuner claimed the draft");
  const log = await q(`select reason from activity_log where agent = 'tuner' order by ts`);
  assert.ok(log.length >= 1);
  assert.ok(log.every((r) => !/NaN|solver error|invalid level/.test(String(r.reason))), log.map((r) => r.reason).join("\n"));
  if (out.kind === "accepted") {
    const [row] = await q(`select level from levels where level_id = $1`, [out.level_id]);
    const limit = (row!.level as { move_limit?: number }).move_limit;
    assert.ok(Number.isInteger(limit) && limit! >= min && limit! <= 500, `tuned move_limit ${limit}`);
  }
});
