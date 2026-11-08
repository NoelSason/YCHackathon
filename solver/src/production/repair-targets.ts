// Surgical repair of the two documented Nov 8 target incidents. Default is a dry run.
import pg from "pg";
import { pathToFileURL } from "node:url";
import { getAdapter } from "../../../platform/mcp/src/adapters.js";
import type { Query } from "../queue.js";
import { tuneDesign, type Design } from "../autotune.js";

export const INCIDENT_ROOTS = [
  "864e5e4d-a989-4a61-8d00-312cf38051bd",
  "1d584cf0-0e2c-4012-8d9a-f6c8dc06066b",
];
export async function inspectTargets(q: Query, roots = INCIDENT_ROOTS) {
  return q(`with recursive tree as (
    select level_id,parent_level_id,game_id,level,status,target_win_rate,measured_win_rate from levels where level_id=any($1::uuid[])
    union all select l.level_id,l.parent_level_id,l.game_id,l.level,l.status,l.target_win_rate,l.measured_win_rate from levels l join tree t on l.parent_level_id=t.level_id
  ) select *,level_id::text as id from tree order by game_id,id`, [roots]);
}
/** All changes and the human intervention are atomic; original payloads and evidence stay intact. */
export async function restoreTargets(q: Query, roots = INCIDENT_ROOTS): Promise<Design[]> {
  await q("begin");
  try {
    if ((await q("select 1 from settings where key in ('kill_switch','production_kill_switch') and value='true'::jsonb")).length) throw Error("kill switch blocks target repair");
    const claimed: Design[] = [];
    for (const root of roots) {
      await q("select level_id from levels where level_id=$1 for update",[root]);
      if ((await q("select 1 from activity_log where action='quality.target_restored' and ref_id=$1",[root])).length) continue;
      const rows=await inspectTargets(q,[root]);
      if (!rows.length || rows.some(r=>![0.30,0.35].includes(Number(r.target_win_rate)))) throw Error(`incident target changed unexpectedly: ${root}`);
      const ids=rows.map(r=>String(r.id));
      if ((await q("select 1 from solver_runs where level_id=any($1::uuid[]) and status in ('queued','running')",[ids])).length) throw Error("incident has an active measurement; retry after it finishes");
      await q("update levels set target_win_rate=0.30 where level_id=any($1::uuid[])",[ids]);
      const leaves=rows.filter(r=>!rows.some(c=>String(c.parent_level_id)===String(r.id)) && ['accepted','published'].includes(String(r.status)));
      if (leaves.length!==1 || leaves[0]!.status==='published') throw Error("incident requires exactly one accepted, unpublished leaf");
      const leaf=leaves[0]!;
      await q("update levels set status='solving',updated_at=now() where level_id=$1",[leaf.id]);
      claimed.push({level_id:String(leaf.id),game_id:String(leaf.game_id),level:leaf.level as Record<string,unknown>,target:0.30,resumed:false});
      await q(`insert into activity_log(agent,action,reason,result,ref_kind,ref_id) values ('platform','quality.target_restored',$1,$2,'level',$3)`,[
        "Human-requested repair of documented uncommitted-runtime incident; original Designer target is 30%, not 35%",
        JSON.stringify({before:rows.map(r=>({id:r.id,status:r.status,target:r.target_win_rate,measured:r.measured_win_rate})),target:0.30,claimed:leaf.id,content_unchanged:true,older_evidence_preserved:true}),root]);
    }
    if (claimed.length) await q(`insert into interventions(who,what,why,kind,ref_kind,ref_id) values ('Pinara via Codex','Restored original 30% targets and claimed affected versions for fresh tuning','User requested completion of Pinara quality repairs; incident documented in log.md','fix','quality','target-incident-2026-11-08')`);
    await q("commit");return claimed;
  } catch(e) { await q("rollback");throw e; }
}
async function main() {
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});const c=await pool.connect();
  const q:Query=async(s,p=[]) => (await c.query(s,p)).rows;
  try {
    if(!process.argv.includes('--write')) { console.log(JSON.stringify({dry_run:true,levels:(await inspectTargets(q)).map(r=>({id:r.id,game:r.game_id,status:r.status,target:r.target_win_rate,measured:r.measured_win_rate}))}));return; }
    const designs=await restoreTargets(q);
    for(const d of designs) console.log(JSON.stringify(await tuneDesign(q,'target-repair-2026-11-08',getAdapter,d,{threads:4,maxSeconds:120})));
    console.log(JSON.stringify({repaired_roots:designs.length,remaining:await inspectTargets(q)}));
  }finally{c.release();await pool.end();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) await main();
