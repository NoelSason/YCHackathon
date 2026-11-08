import type { Check } from '../types.js';
import { verifiedLevel } from '../../../../solver/src/acceptance.js';
// Pinara's demo path: actual authored drafts, not the fast compiler or stale solver evidence.
const check:Check={
 name:'design_tune_solve',owner:'Pinara',path:'Design → tune → solve',
 async run({db,expectRunning}){
  const q=async(sql:string,p:unknown[]=[]) => (await db.query(sql,p)).rows;
  const games=await q("select g.game_id,count(l.*)::int ever from games g left join levels l using(game_id) where g.game_id<>'stub' group by g.game_id order by g.game_id");
  const candidates=await q(`with recursive ancestry as (
   select level_id as leaf,level_id,parent_level_id,game_id,created_by from levels
    where status in ('accepted','published') and updated_at>now()-interval '3 hours' and created_by in ('designer','tuner')
   union all select a.leaf,p.level_id,p.parent_level_id,p.game_id,p.created_by from levels p join ancestry a on p.level_id=a.parent_level_id
  ) select distinct a.leaf::text id,a.game_id from ancestry a where a.parent_level_id is null and a.created_by='designer'
   and exists(select 1 from activity_log l where l.ref_id=a.level_id::text and l.agent='designer' and l.action='save_level')`);
  const counts=new Map<string,number>(),invalid=new Map<string,number>();
  for(const row of candidates)try{await verifiedLevel(q,String(row.id),String(row.game_id));counts.set(String(row.game_id),(counts.get(String(row.game_id))??0)+1);}catch{invalid.set(String(row.game_id),(invalid.get(String(row.game_id))??0)+1);}
  const live=games.filter(g=>Number(g.ever)>0),missing=live.filter(g=>!counts.get(String(g.game_id))).map(g=>String(g.game_id));
  const detail=`Designer-authored acceptances with current on-target 200-game evidence in 3h: ${live.map(g=>`${g.game_id} ${counts.get(String(g.game_id))??0} (stale/incomplete excluded ${invalid.get(String(g.game_id))??0})`).join(', ')||'none'}. Compiler stock is excluded.`;
  if(!expectRunning)return{ok:true,detail:`${detail} Not required before switch-on.`};
  return {ok:live.length>0&&missing.length===0,detail:missing.length?`${detail} Missing: ${missing.join(', ')}. Deploy missing adapters/update old workers; generate and verify real authored levels.`:detail};
 }
};export default check;
