// Recover explicitly named unpublished Designer/Tuner acceptances made by an old worker.
// No content/target rewrite, published levels or running jobs. Read-only by default.
import pg from'pg';import{pathToFileURL}from'node:url';
import type{Query}from'../queue.js';import{verifiedLevel}from'../acceptance.js';
import{tuneDesign,type Design}from'../autotune.js';import{getAdapter}from'../../../platform/mcp/src/adapters.js';
export async function claimLegacyAcceptance(q:Query,id:string):Promise<Design|null>{
 await q('begin');try{
  if((await q("select 1 from settings where key='kill_switch' and value='true'::jsonb")).length)throw Error('kill switch blocks reverification');
  const [l]=await q(`select level_id::text id,game_id,level,target_win_rate,status,created_by from levels where level_id=$1 for update`,[id]);
  if(!l||l.status!=='accepted'||!['designer','tuner'].includes(String(l.created_by)))throw Error('only an unpublished accepted Designer/Tuner leaf can be reverified');
  if((await q("select 1 from levels where parent_level_id=$1 union all select 1 from solver_runs where level_id=$1 and status in ('queued','running')",[id])).length)throw Error('level has a child or active measurement');
  try{await verifiedLevel(q,id);await q('commit');return null;}catch{ /* current evidence genuinely missing/off target */ }
  await q("update levels set status='solving',updated_at=now() where level_id=$1",[id]);
  await q(`insert into interventions(who,what,why,kind,ref_kind,ref_id) values ('Pinara via Codex','Claimed legacy unpublished acceptance for current 200-game tuning','Concurrent older worker supplied incomplete/unversioned evidence during requested quality verification','fix','level',$1)`,[id]);
  await q('commit');return{level_id:id,game_id:String(l.game_id),level:l.level as Record<string,unknown>,target:Number(l.target_win_rate),resumed:false};
 }catch(e){await q('rollback');throw e;}
}
async function main(){
 const args=process.argv.slice(2),at=args.indexOf('--ids'),ids=(args[at+1]??'').split(',');
 if(at<0||!ids.length||ids.some(id=>!/^[-a-f0-9]{36}$/.test(id)))throw Error('explicit --ids <uuid,uuid> required');
 const p=new pg.Pool({connectionString:process.env.DATABASE_URL}),c=await p.connect(),q:Query=async(s,v=[]) =>(await c.query(s,v)).rows;
 try{for(const id of ids){if(!args.includes('--write')){console.log(JSON.stringify({id,dry_run:true}));continue;}const d=await claimLegacyAcceptance(q,id);console.log(JSON.stringify(d?await tuneDesign(q,'pinara-legacy-reverification',getAdapter,d,{threads:4,maxSeconds:120}):{id,current_evidence:true}));}}
 finally{c.release();await p.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
