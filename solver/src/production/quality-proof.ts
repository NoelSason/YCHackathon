// Read-only proof collector. An idle session alone is never proof that a level was saved.
import {readFile,writeFile}from'node:fs/promises';
import pg from'pg';
import{naive}from'../../../platform/naive/src/client.js';
import{verifiedLevel}from'../acceptance.js';
const args=process.argv.slice(2),opt=(n:string,d:string)=>{const i=args.indexOf(n);return i<0?d:args[i+1]??d;};
const rollout=JSON.parse(await readFile(opt('--in','quality-rollout.json'),'utf8')) as {label:string;sessions:Array<{game:string;id:string;version:number}>};
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const q=async(sql:string,values:unknown[]=[]) => (await pool.query(sql,values)).rows;
const games=[];
try{
 for(const run of rollout.sessions){
  const session=await naive.sessions.get(run.id);let after=0;const eventData:string[]=[];
  for(;;){const page=await naive.sessions.events(run.id,{after_seq:after,limit:100});for(const e of page.data){after=Math.max(after,e.seq);if(e.type!=='message.delta')eventData.push(JSON.stringify(e.data));}if(!page.has_more)break;}
  const rows=await q(`with recursive chain as (
   select level_id,parent_level_id,game_id,status,level,target_win_rate,measured_win_rate,notes,created_at from levels where game_id=$1 and created_by='designer' and position($2 in coalesce(notes,''))>0
   union all select l.level_id,l.parent_level_id,l.game_id,l.status,l.level,l.target_win_rate,l.measured_win_rate,l.notes,l.created_at from levels l join chain p on l.parent_level_id=p.level_id
  ) select distinct on(level_id) * from chain order by level_id`,[run.game,`${rollout.label}:${run.game}`]);
  const roots=rows.filter(r=>!r.parent_level_id),eventConfirmed=roots.some(r=>eventData.some(e=>e.includes(String(r.level_id))));
  const accepted=[];const rejected=[];
  for(const row of rows){
   if(['accepted','published'].includes(row.status))try{const v=await verifiedLevel(q,String(row.level_id),run.game);accepted.push({id:row.level_id,target:v.target,measured:Number(row.measured_win_rate),run_id:v.run_id});}catch(e){rejected.push({id:row.level_id,error:e instanceof Error?e.message:String(e)});}
  }
  games.push({game:run.game,session:run.id,agent_version:run.version,status:session.status,stop_reason:session.stop_reason,consumed_micro_usd:session.consumed_micro_usd,roots:roots.map(r=>String(r.level_id)),event_confirmed:eventConfirmed,accepted,unverified:rejected,passed:eventConfirmed&&accepted.length>0});
 }
 const result={at:new Date().toISOString(),label:rollout.label,all_passed:games.length===5&&games.every(g=>g.passed),consumed_micro_usd:games.reduce((sum,g)=>sum+g.consumed_micro_usd,0),games};
 await writeFile(opt('--out','quality-proof.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await pool.end();}
