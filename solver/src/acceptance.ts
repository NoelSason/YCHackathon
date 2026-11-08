// Backward-compatible quality gate for the existing MCP accept/publish contracts.
import type { Query } from './queue.js';
import { getAdapter } from '../../platform/mcp/src/adapters.js';
import { evidenceProblem, type EvidenceInput } from './evidence.js';
import { referenceBot } from './policy.js';

export interface VerifiedLevel {
  id:string; game:string; level:object; target:number; measured:number; run_id:string;
}
export async function verifiedLevel(q:Query, id:string, game?:string):Promise<VerifiedLevel> {
  const [l]=await q(`select level_id::text id,game_id,level,target_win_rate from levels where level_id=$1`,[id]);
  if(!l || (game && l.game_id!==game)) throw Error('level not found for this game');
  const a=getAdapter(String(l.game_id));if(!a)throw Error('unknown game');
  const level=l.level as object;const v=a.validate(level);if(!v.ok)throw Error('invalid level');
  const [r]=await q(`select run_id::text id,results,solvable from solver_runs where level_id=$1 and status='done'
    order by finished_at desc nulls last,created_at desc,run_id desc limit 1`,[id]);
  if(!r || r.solvable===false)throw Error('no completed, solvable solver evidence');
  const results=(typeof r.results==='string'?JSON.parse(r.results):r.results) as Record<string,EvidenceInput>;
  const evidence=results[referenceBot(a)];const target=Number(l.target_win_rate);
  const problem=evidenceProblem(a.game_id,level,target,evidence);if(problem)throw Error(problem);
  return{id,game:a.game_id,level,target,measured:evidence!.win_rate,run_id:String(r.id)};
}
export async function acceptVerified(q:Query,id:string,reported:number):Promise<VerifiedLevel> {
  const v=await verifiedLevel(q,id);
  if(!Number.isFinite(reported)||Math.abs(reported-v.measured)>0.000051)throw Error('reported rate differs from the completed reference-bot evidence');
  const rows=await q(`update levels set status='accepted',measured_win_rate=$4,updated_at=now()
    where level_id=$1 and level=$2::jsonb and target_win_rate=$3
      and exists(select 1 from solver_runs where run_id=$5 and status='done') returning level_id`,
    [id,JSON.stringify(v.level),v.target,v.measured,v.run_id]);
  if(!rows.length)throw Error('level changed while checking evidence; retry');
  return v;
}
