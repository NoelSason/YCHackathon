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
import { evidenceStamp } from "../evidence.js";
import { wilson95 } from "../stats.js";
import { readFile, writeFile } from "node:fs/promises";
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

export async function remeasure(q: Query, game: string, label: string, opts: { onProgress?: (done: number, total: number) => void } = {}): Promise<Remeasured[]> {
  const a = getAdapter(game);
  if (!a) throw new Error(`no adapter for ${game}`);
  const bot = referenceBot(a);
  const rows = await q(
    `select level_id::text as level_id, level, target_win_rate, measured_win_rate from levels
      where game_id = $1 and created_by = 'production' and status in ('accepted', 'published')
      order by level_id`,
    [game],
  );
  return rows.map((r,index) => {
    const level = (typeof r.level === "string" ? JSON.parse(r.level) : r.level) as Record<string, unknown>;
    const target = Number(r.target_win_rate);
    const out = runLevel(a, level, [bot], RUNS, remeasureSeed(label, String(r.level_id)));
    const x = out.results[bot]!;
    opts.onProgress?.(index+1,rows.length);
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
    let written = 0;
    for (const r of items) {
      const [level] = await q("select game_id,level,target_win_rate,notes from levels where level_id=$1 and created_by='production' for update", [r.level_id]);
      if (!level || level.game_id !== game || Math.abs(Number(level.target_win_rate)-r.target)>1e-9) throw Error("level or target changed since remeasurement");
      const stamp=evidenceStamp(game,level.level as object);
      const adapter=getAdapter(game);
      if(!adapter)throw Error('unknown remeasurement adapter');
      const reference=r.results[referenceBot(adapter)];
      if(!reference || !Number.isFinite(r.measured) || Math.abs(reference.win_rate-r.measured)>1e-9 || r.on_target!==onTarget(reference,r.target))throw Error('remeasurement summary disagrees with reference evidence');
      for (const result of Object.values(r.results)) {
        if (!Number.isInteger(result.runs) || !Number.isInteger(result.wins) || result.wins<0 || result.wins>result.runs || result.runs<RUNS || result.level_hash!==stamp.level_hash || result.rules_version!==stamp.rules_version || Math.abs(result.wins/result.runs-result.win_rate)>.000051) throw Error("stale or incomplete remeasurement");
        const interval=wilson95(result.wins,result.runs);
        if(Math.abs(interval.low-result.ci95_low)>.000051 || Math.abs(interval.high-result.ci95_high)>.000051)throw Error('remeasurement confidence interval disagrees with completed games');
      }
      const prior=await q("select results from solver_runs where level_id=$1 and claimed_by=$2 and status='done'",[r.level_id,`remeasure:${label}`]);
      if (prior.length) {
        const same=await q("select 1 from solver_runs where level_id=$1 and claimed_by=$2 and results=$3::jsonb",[r.level_id,`remeasure:${label}`,JSON.stringify(r.results)]);
        if(!same.length)throw Error("label already recorded with different evidence; use a new label");
        continue;
      }
      const bots=Object.keys(r.results);
      await q(`insert into solver_runs(level_id,bots,runs_per_bot,status,results,solvable,min_moves,claimed_by,started_at,finished_at)
        values ($1,$2,$3,'done',$4,$5,$6,$7,now(),now())`,[r.level_id,JSON.stringify(bots),RUNS,JSON.stringify(r.results),r.solvable,r.min_moves,`remeasure:${label}`]);
      let notes:Record<string,unknown>;
      try { notes=JSON.parse(String(level.notes)); if(!notes || typeof notes!=='object' || Array.isArray(notes))notes={legacy_note:level.notes}; } catch { notes={legacy_note:level.notes}; }
      notes.quality={rules_version:stamp.rules_version,level_hash:stamp.level_hash,remeasure_label:label,on_target:r.on_target};
      // Remeasurement is not new content: keep updated_at so readiness cannot be inflated.
      await q("update levels set measured_win_rate=$2,notes=$3 where level_id=$1",[r.level_id,r.measured,JSON.stringify(notes)]);
      written++;
    }
    const off = items.filter((r) => !r.on_target).map((r) => r.title);
    if (written) await q(
      `insert into activity_log(agent, action, reason, result, ref_kind, ref_id) values ('platform', 'production.remeasured', $1, $2, 'game', $3)`,
      [reason, `${items.length} levels remeasured (${RUNS} fresh replays each, label ${label}); ${items.length - off.length} on target; off target: ${off.join(", ") || "none"}`, game],
    );
    await q("commit");
    return written;
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
    const input=opt("--in"),output=opt("--out");
    const items: Remeasured[]=input ? JSON.parse(await readFile(input,"utf8")) : await remeasure(q, game, label, { onProgress:(done,total)=>{ if(done%5===0 || done===total)console.log(JSON.stringify({event:"remeasure_progress",game,done,total})); } });
    if(output)await writeFile(output,JSON.stringify(items));
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
