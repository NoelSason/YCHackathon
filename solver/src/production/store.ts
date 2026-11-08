import { getAdapter } from "../../../platform/mcp/src/adapters.js";
import { onTarget } from "../autotune.js";
import { fingerprint, progression } from "./catalog.js";
import { readBuffer, BufferFullError } from "./buffer.js";
import { createHash } from "node:crypto";
import type { Query } from "../queue.js";
import type { AcceptedLevel } from "./calibrate.js";
import { RECIPE_VERSION } from "./catalog.js";

export function levelId(game: string, position: number, series: number): string {
  const hex = createHash("sha256").update(`${RECIPE_VERSION}:${series}:${game}:${position}`).digest("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

/** Atomic, idempotent import into the existing LevelOps contracts. Never auto-publishes.
 * Replaying a checkpoint cannot add a second level, simulation row, or audit entry. */
export async function saveAccepted(q: Query, result: AcceptedLevel, series: number): Promise<string> {
  progression(result.position);
  const validation = getAdapter(result.game_id)?.validate(result.level);
  const ev = result.evidence;
  if (!validation?.ok || result.status !== "accepted" || !Number.isInteger(ev.runs) || ev.runs < 200 || !Number.isInteger(ev.wins) || ev.wins < 0 || ev.wins > ev.runs || Math.abs(ev.wins / ev.runs - ev.win_rate) > 0.0001 || result.measured !== ev.win_rate || !onTarget(ev, result.target) || fingerprint(result.game_id, result.level) !== result.fingerprint) throw new Error("checkpoint lacks valid accepted-level evidence");
  const inventory = await readBuffer(q, result.game_id, series);
  if (!inventory.ready.includes(result.position) && !inventory.needed.includes(result.position)) throw new BufferFullError(`buffer full: ${result.game_id} has stock through its ${inventory.target_through} target; preserving existing levels`);
  const id = levelId(result.game_id, result.position, series);
  const notes = JSON.stringify({ producer: RECIPE_VERSION, series, position: result.position, chapter: result.chapter, slot: result.slot, features: result.features, fingerprint: result.fingerprint, elapsed_ms: result.elapsed_ms, training_runs: result.training_runs, verification_rounds: result.verification_rounds });
  const rows = await q(`with allowed as (
      select 1 where not exists (select 1 from settings where key in ('kill_switch','production_kill_switch') and value = 'true'::jsonb)
    ), added as (
      insert into levels(level_id,game_id,level,target_win_rate,measured_win_rate,status,created_by,notes)
      select $1::uuid,$2,$3::jsonb,$4,$5,'accepted','production',$6 from allowed
      on conflict (level_id) do nothing returning level_id
    ), evidence as (
      insert into solver_runs(level_id,bots,runs_per_bot,status,results,solvable,min_moves,claimed_by,started_at,finished_at)
      select level_id,$7::jsonb,$8,'done',$9::jsonb,$10::boolean,$11::int,'production',now(),now() from added
      returning run_id
    ), audit as (
      insert into activity_log(agent,action,reason,result,ref_kind,ref_id)
      select 'platform','production.level_accepted',$12,$13,'level',level_id::text from added returning id
    ) select level_id::text as id from added
      union all select level_id::text as id from levels where level_id=$1::uuid and exists(select 1 from allowed)`,
    [id, result.game_id, JSON.stringify(result.level), result.target, result.measured, notes,
      JSON.stringify([result.bot]), result.evidence.runs, JSON.stringify({ [result.bot]: result.evidence }),
      result.min_moves === null ? null : true, result.min_moves,
      `deterministic content compiler; ${result.game_id} position ${result.position}, target ${result.target}; ${result.evidence.runs} independent ${result.bot} replays; features ${result.features.join(', ')}`,
      `measured ${result.measured}; ${result.elapsed_ms}ms; accepted, awaiting CEO publication`]);
  if (!rows.length) throw new Error("production stopped by kill switch");
  return String(rows[0]!.id);
}
