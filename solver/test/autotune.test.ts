// The automatic Tuner against the real platform schema in PGlite.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { Adapter } from "../../platform/mcp/src/adapters.js";
import { getAdapter } from "../../platform/mcp/src/adapters.js";
import { SAMPLES as WATERSORT } from "../../games/watersort/src/levels.js";
import { SAMPLES as RACER } from "../../games/racer/src/levels.js";
import { claimDesign, MAX_ROUNDS, TOLERANCE, tuneNextDesign } from "../src/autotune.js";
import type { Query } from "../src/queue.js";

const schema = await readFile(new URL("../../platform/db/schema.sql", import.meta.url), "utf8");
let q: Query;

beforeEach(async () => {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(schema);
  q = async (text, params = []) => (await db.query<Record<string, unknown>>(text, params)).rows;
  await q(`insert into games(game_id, name) values ('watersort','Splash Sort'), ('racer','Turbo Lanes'), ('match3','Gem Garden'), ('platformer','Mosslight Trails')`);
});

async function design(game: string, level: object, target: number, by = "designer"): Promise<string> {
  const [r] = await q(
    `insert into levels(game_id, level, target_win_rate, created_by, created_at) values ($1, $2, $3, $4, now() - interval '1 minute') returning level_id::text as id`,
    [game, JSON.stringify(level), target, by],
  );
  return String(r!.id);
}

// A fast stand-in for match-3: a bigger goal makes it harder (the knob runs downward).
const fakeMatch3: Adapter = {
  game_id: "match3", name: "Gem Garden (test)", schema: {}, bots: ["random", "greedy"],
  validate: (l) => {
    const t = (l as { goal?: { target?: number } }).goal?.target;
    return Number.isInteger(t) && t! >= 1 && t! <= 1000 ? { ok: true } : { ok: false, errors: ["goal.target must be 1-1000"] };
  },
  simulate: (l, _bot, seed) => {
    const p = Math.max(0, Math.min(1, 1 - (l as { goal: { target: number } }).goal.target / 60));
    const x = Math.sin(seed * 12.9898) * 43758.5453;
    return { won: x - Math.floor(x) < p, moves_used: 10 };
  },
  level_url: (id) => id,
};
const withFake = (id: string) => (id === "match3" ? fakeMatch3 : getAdapter(id));

/** Every version of a design, oldest first, by following parent links from the root. */
async function chain(rootId: string) {
  return q(
    `with recursive t as (select level_id, parent_level_id, status, level, measured_win_rate, 0 as depth from levels where level_id = $1
       union all select l.level_id, l.parent_level_id, l.status, l.level, l.measured_win_rate, t.depth + 1 from levels l join t on l.parent_level_id = t.level_id)
     select level_id::text as level_id, status, level, measured_win_rate, depth from t order by depth`,
    [rootId],
  );
}

async function checkOutcome(rootId: string, target: number, out: Awaited<ReturnType<typeof tuneNextDesign>>) {
  const versions = await chain(rootId);
  assert.ok(versions.length >= 1 && versions.length <= MAX_ROUNDS, `${versions.length} versions`);
  assert.equal(versions.filter((v) => v.status === "solving" || v.status === "draft").length, 0, "nothing left mid-tune");
  const last = versions[versions.length - 1]!;
  assert.ok(out.kind === "accepted" || out.kind === "rejected");
  assert.equal(out.kind === "accepted" ? "accepted" : "rejected", last.status);
  for (const v of versions.slice(0, -1)) assert.equal(v.status, "rejected", "superseded versions are retired");
  if (out.kind === "accepted") assert.ok(Math.abs(Number(last.measured_win_rate) - target) <= TOLERANCE + 1e-9);
  const runs = await q(`select status from solver_runs`);
  assert.equal(runs.length, versions.length, "one measurement per version");
  assert.ok(runs.every((r) => r.status === "done"));
  const acts = await q(`select agent, action from activity_log where agent = 'tuner'`);
  assert.ok(acts.some((a) => a.action === (out.kind === "accepted" ? "accept_level" : "reject_level")));
  return versions;
}

test("a Splash Sort design is tuned on move_limit and accepted or rejected, with every step recorded", async () => {
  const root = await design("watersort", { ...WATERSORT[2]!, move_limit: 40 }, 0.5);
  const out = await tuneNextDesign(q, "test-worker", getAdapter, { games: ["watersort"], threads: 1, maxSeconds: 30 });
  const versions = await checkOutcome(root, 0.5, out);
  if (versions.length > 1) {
    const limits = versions.map((v) => (v.level as { move_limit: number }).move_limit);
    assert.ok(limits[1]! < limits[0]!, `a too-easy level gets fewer pours: ${limits.join(" → ")}`);
  }
});

test("a Turbo Lanes design is tuned on time_limit", async () => {
  const root = await design("racer", { ...RACER[1]!, time_limit: 140 }, 0.5);
  const out = await tuneNextDesign(q, "test-worker", getAdapter, { games: ["racer"], threads: 1, maxSeconds: 30 });
  await checkOutcome(root, 0.5, out);
});

test("match-3 tunes goal.target downward-easier: a too-easy level gets a bigger goal", async () => {
  const root = await design("match3", { name: "Test", goal: { colour: "red", target: 6 }, move_limit: 20 }, 0.5);
  const out = await tuneNextDesign(q, "test-worker", withFake, { games: ["match3"], threads: 1, maxSeconds: 30 });
  const versions = await checkOutcome(root, 0.5, out);
  const goals = versions.map((v) => (v.level as { goal: { target: number } }).goal.target);
  assert.ok(goals.length > 1 && goals[1]! > goals[0]!, `goal grows when the level is too easy: ${goals.join(" → ")}`);
  assert.equal(out.kind, "accepted", `the stand-in's curve is smooth, so it should be hit: ${goals.join(" → ")}`);
});

test("only fresh Designer roots for tunable games are claimed, and each only once", async () => {
  await design("platformer", { name: "p" }, 0.5);            // no knob for this game
  await design("watersort", WATERSORT[2]!, 0.5, "tuner");    // not a Designer root
  const mine = await design("watersort", WATERSORT[2]!, 0.5);
  const a = await claimDesign(q, ["watersort", "platformer", "racer"]);
  assert.equal(a?.level_id, mine);
  assert.equal(await claimDesign(q, ["watersort", "platformer", "racer"]), null);
  const [row] = await q(`select status from levels where level_id = $1`, [mine]);
  assert.equal(row!.status, "solving");
});

test("an invalid design is rejected with the reason, not left hanging", async () => {
  const root = await design("watersort", { capacity: 4, tubes: [["red"]], move_limit: 10 }, 0.5);
  const out = await tuneNextDesign(q, "w", getAdapter, { games: ["watersort"], threads: 1 });
  assert.equal(out.kind, "rejected");
  assert.match(out.kind === "rejected" ? out.reason : "", /invalid level/);
  const [row] = await q(`select status from levels where level_id = $1`, [root]);
  assert.equal(row!.status, "rejected");
});

test("nothing to tune is idle", async () => {
  assert.deepEqual(await tuneNextDesign(q, "w", getAdapter, { games: ["watersort"] }), { kind: "idle" });
});
