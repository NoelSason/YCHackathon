// Re-measure a game's production levels after its rules changed, and record the new evidence.
//
//   node --env-file=.env --import tsx src/production/remeasure.ts --game racer           # dry run
//   node --env-file=.env --import tsx src/production/remeasure.ts --game racer --write   # record
//
// Each accepted/published production level is replayed with the game's reference bot, 200 times,
// with fresh seeds derived from the level id and --label (so a rerun gives the same numbers). With
// --write, in one transaction: a new done solver_runs row per level (claimed_by "remeasure:<label>"),
// the level's measured_win_rate set to the new measurement, and one activity_log summary row.
// Level content, status, ids, and every older solver run stay exactly as they were: old evidence is
// never relabeled. Levels now off target are reported (not retuned or hidden); the CEO or Tuner
// decides what to do with them. Honors the kill switches.
import { createHash } from "node:crypto";
import pg from "pg";
import { getAdapter } from "../../../platform/mcp/src/adapters.js";
import { onTarget, referenceBot } from "../autotune.js";
import type { Query } from "../queue.js";
import { runLevel, type Results } from "../run.js";

export interface Remeasured {
  level_id: string;
  title: string;
  target: number;
  stored: number | null;
  results: Results;
  solvable: boolean | null;
  min_moves: number | null;
  measured: number;
  on_target: boolean;
}

export const RUNS = 200;

/** Fresh, reproducible seeds per level: disjoint from production's own (they derive from the recipe). */
export function remeasureSeed(label: string, levelId: string): number {
  return createHash("sha256").update(`remeasure:${label}:${levelId}`).digest().readUInt32LE(0);
}

export async function remeasure(q: Query, game: string, label: string): Promise<Remeasured[]> {
  const a = getAdapter(game);
  if (!a) throw new Error(`no adapter for ${game}`);
  const bot = referenceBot(a);
  const rows = await q(
    `select level_id::text as level_id, level, target_win_rate, measured_win_rate from levels
      where game_id = $1 and created_by = 'production' and status in ('accepted', 'published')
      order by level_id`,
    [game],
  );
  return rows.map((r) => {
    const level = (typeof r.level === "string" ? JSON.parse(r.level) : r.level) as Record<string, unknown>;
    const target = Number(r.target_win_rate);
    const out = runLevel(a, level, [bot], RUNS, remeasureSeed(label, String(r.level_id)));
    const x = out.results[bot]!;
    return {
      level_id: String(r.level_id),
      title: String(level.title ?? level.name ?? r.level_id),
      target,
      stored: r.measured_win_rate === null ? null : Number(r.measured_win_rate),
      results: out.results,
      solvable: out.solvable,
      min_moves: out.min_moves,
      measured: x.win_rate,
      on_target: onTarget(x, target),
    };
  });
}

/** Records the evidence in one transaction. Returns how many levels were written. */
export async function record(q: Query, game: string, label: string, reason: string, items: Remeasured[]): Promise<number> {
  await q("begin");
  try {
    const killed = await q("select 1 from settings where key in ('kill_switch','production_kill_switch') and value = 'true'::jsonb");
    if (killed.length) throw new Error("kill switch is on; nothing recorded");
    for (const r of items) {
      const bots = Object.keys(r.results);
      await q(
        `insert into solver_runs(level_id, bots, runs_per_bot, status, results, solvable, min_moves, claimed_by, started_at, finished_at)
         values ($1, $2, $3, 'done', $4, $5, $6, $7, now(), now())`,
        [r.level_id, JSON.stringify(bots), RUNS, JSON.stringify(r.results), r.solvable, r.min_moves, `remeasure:${label}`],
      );
      await q(
        `update levels set measured_win_rate = $2, updated_at = now()
          where level_id = $1 and game_id = $3 and created_by = 'production'`,
        [r.level_id, r.measured, game],
      );
    }
    const off = items.filter((r) => !r.on_target).map((r) => r.title);
    await q(
      `insert into activity_log(agent, action, reason, result, ref_kind, ref_id) values ('platform', 'production.remeasured', $1, $2, 'game', $3)`,
      [reason, `${items.length} levels remeasured (${RUNS} fresh replays each, label ${label}); ${items.length - off.length} on target; off target: ${off.join(", ") || "none"}`, game],
    );
    await q("commit");
    return items.length;
  } catch (e) {
    await q("rollback");
    throw e;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const game = opt("--game");
  const label = opt("--label") ?? `rules-${new Date().toISOString().slice(0, 10)}`;
  const reason = opt("--reason") ?? `${game} rules changed; production levels replayed under the current rules (old evidence kept)`;
  if (!game) throw new Error("usage: remeasure.ts --game <id> [--label <name>] [--reason <text>] [--write]");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, ssl: process.env.PGSSL === "0" ? undefined : { rejectUnauthorized: true } });
  const client = await pool.connect();
  const q: Query = async (text, params = []) => (await client.query(text, params)).rows;
  try {
    const items = await remeasure(q, game, label);
    const off = items.filter((r) => !r.on_target);
    const shift = items.reduce((s, r) => s + (r.stored === null ? 0 : Math.abs(r.measured - r.stored)), 0) / Math.max(1, items.length);
    console.log(JSON.stringify({ game, label, levels: items.length, on_target: items.length - off.length, mean_abs_change_pts: Math.round(shift * 1000) / 10, written: false }));
    for (const r of off) console.log(JSON.stringify({ off_target: r.title, target: r.target, stored: r.stored, now: r.measured }));
    if (args.includes("--write")) console.log(JSON.stringify({ written: await record(q, game, label, reason, items) }));
    else console.log("dry run: add --write to record the evidence");
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
