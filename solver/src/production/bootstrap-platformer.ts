// Human-requested launch utility: verified drafts first, publication only after a real route exists.
import {createHash} from 'node:crypto';
import pg from 'pg';
import {isDeepStrictEqual} from 'node:util';
import platformer from '../../../games/platformer/adapter/index.js';
import {SAMPLES} from '../../../games/platformer/src/levels.js';
import {runLevel} from '../run.js';
const publish=process.argv.includes('--publish');
const site=(process.env.SITE_URL??'https://levelai.vercel.app').replace(/\/+$/,'');
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is required');
if(publish){
 const r=await fetch(`${site}/games/platformer/`,{signal:AbortSignal.timeout(15000)});
 if(!r.ok||!(await r.text()).includes('Mosslight'))throw Error('production route is not deployed; staged levels unchanged');
 const js=await fetch(`${site}/games/platformer/app.js`,{signal:AbortSignal.timeout(15000)});
 if(!js.ok||!(await js.text()).includes('mosslightTrails'))throw Error('production client not verified; staged levels unchanged');
}
const uuid=(name:string)=>{const h=createHash('sha256').update(name).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
const plans=SAMPLES.map((level,i)=>({id:uuid(`mosslight-browser-v1:${i+1}`),level,out:runLevel(platformer,level,['greedy','random'],200,1)}));
if(plans.some(p=>!p.out.solvable||p.out.results.greedy!.wins!==200))throw Error('launch trail failed shared-adapter verification');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSL==='0'?undefined:{rejectUnauthorized:true}});
const c=await pool.connect();
try{
 await c.query('begin');
 if((await c.query("select value from settings where key='kill_switch' for share")).rows[0]?.value===true)throw Error('company kill switch blocks launch');
 const ids:string[]=[];
 for(const [i,p] of plans.entries()){
  ids.push(p.id);
  const added=await c.query(`insert into levels(level_id,game_id,level,target_win_rate,measured_win_rate,status,created_by,notes)
   values ($1,'platformer',$2,1,1,$3,'browser-bootstrap',$4) on conflict(level_id) do nothing returning level_id`,
   [p.id,JSON.stringify(p.level),publish?'published':'draft',JSON.stringify({source:'human-requested original browser integration',position:i+1,reference_bot:'greedy',difficulty_claim:'exact-route reference, not human-calibrated'})]);
  if(!added.rowCount){const prior=(await c.query('select level from levels where level_id=$1',[p.id])).rows[0];if(!isDeepStrictEqual(prior?.level,p.level))throw Error('staged payload changed; bump the bootstrap version before publishing');}
  if(added.rowCount)await c.query(`insert into solver_runs(level_id,bots,runs_per_bot,status,results,solvable,min_moves,claimed_by,started_at,finished_at)
   values ($1,'["greedy","random"]',200,'done',$2,true,$3,'browser-bootstrap',now(),now())`,[p.id,JSON.stringify(p.out.results),p.out.min_moves]);
 }
 const packId=uuid('mosslight-browser-v1:opening-pack');
 if(publish){
  await c.query("update levels set status='published',updated_at=now() where level_id=any($1::uuid[]) and created_by='browser-bootstrap'",[ids]);
  await c.query("insert into packs(pack_id,game_id,name,level_ids) values ($1,'platformer','Mosslight Trails · First Five Trails',$2) on conflict(pack_id) do nothing",[packId,JSON.stringify(ids)]);
 }
 await c.query("insert into activity_log(agent,action,reason,result,ref_kind,ref_id) values ('platform',$1,'Human-requested fifth-game integration; 200 games per bot and exact route proof',$2,'game','platformer')",[publish?'platformer.publish':'platformer.staged',publish?'5 original trails published after live route check':'5 verified drafts staged; production client deployment still required']);
 await c.query("insert into interventions(who,what,why,kind,ref_kind,ref_id) values ('Pinara via Codex',$1,'User requested all five games playable in production','fix','game','platformer')",[publish?'Published Mosslight Trails after route verification':'Built original Mosslight Trails client and staged five verified drafts']);
 await c.query('commit');
 console.log(JSON.stringify({status:publish?'published':'staged_drafts',levels:ids.length,game_url:`${site}/games/platformer/`,pack_url:publish?`${site}/games/platformer/?pack=${packId}`:null,evidence:plans.map(p=>({name:p.level.name,min_moves:p.out.min_moves,greedy_wins:p.out.results.greedy!.wins,random_wins:p.out.results.random!.wins,runs_each:200}))}));
}catch(e){await c.query('rollback');throw e;}finally{c.release();await pool.end();}
