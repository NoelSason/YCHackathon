import { getAdapter } from "../../../platform/mcp/src/adapters.js";
// Versioned repairs: existing public ids, payloads and old packs are never deleted or overwritten.
import pg from 'pg';
import {Worker}from'node:worker_threads';
import{createHash}from'node:crypto';
import{readFile,writeFile,appendFile}from'node:fs/promises';
import{pathToFileURL}from'node:url';
import type{Query}from'../queue.js';
import{evidenceProblem,evidenceStamp,levelHash,RULES_VERSION}from'../evidence.js';
import{verifiedLevel}from'../acceptance.js';
import{calibrate,type AcceptedLevel}from'./calibrate.js';
import{recipe,RECIPE_VERSION,type ProductionGame}from'./catalog.js';
import{levelId}from'./store.js';
export interface Parent {id:string;game:ProductionGame;position:number;level:object;target:number}
export function retuneCandidate(parent:Parent,maxMs=55_000):AcceptedLevel {
 const validation=getAdapter(parent.game)?.validate(parent.level);if(!validation?.ok)throw Error("parent payload does not match its game adapter");
 const deadlineMs=Date.now()+maxMs;const errors:string[]=[];
 for(let attempt=0;attempt<40&&Date.now()<deadlineMs;attempt++){
  const r=recipe(parent.game,parent.position,512+attempt,1);
  r.target=parent.target;
  if(attempt===0)r.level=parent.level;
  // At early racer challenges, integer times may have no middle quantile. Try another real
  // layout/speed, never another target or a synthetic estimated win rate.
  if(parent.game==='racer'&&attempt>0){const level=r.level as {speed:number};level.speed=Math.min(12,level.speed+(attempt%3));}
  try{return calibrate(r,{deadlineMs});}catch(e){errors.push(e instanceof Error?e.message:String(e));}
 }
 throw Error(`no verified repair for ${parent.game} ${parent.position}: ${errors.slice(-3).join('; ')}`);
}
function uuid(text:string):string{const h=createHash('sha256').update(text).digest('hex');return`${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
export async function saveRepair(q:Query,parent:Parent,made:AcceptedLevel,label:string):Promise<string>{
 const problem=evidenceProblem(parent.game,made.level,parent.target,made.evidence);if(problem||made.target!==parent.target)throw Error(problem??'repair changed target');
 const id=uuid(`quality-repair:${parent.id}:${RULES_VERSION[parent.game]}:${levelHash(made.level)}`);
 await q('begin');try{
  if((await q("select 1 from settings where key in ('kill_switch','production_kill_switch') and value='true'::jsonb")).length)throw Error('kill switch blocks catalog repair');
  const [old]=await q('select game_id,level,target_win_rate,notes from levels where level_id=$1 for update',[parent.id]);
  if(!old||old.game_id!==parent.game||Number(old.target_win_rate)!==parent.target||levelHash(old.level as object)!==levelHash(parent.level))throw Error('parent changed since repair was measured');
  const notes={producer:RECIPE_VERSION,series:1,position:parent.position,chapter:made.chapter,slot:made.slot,features:made.features,fingerprint:made.fingerprint,elapsed_ms:made.elapsed_ms,repair_of:parent.id,repair_label:label,quality:{...evidenceStamp(parent.game,made.level),on_target:true}};
  const added=await q(`insert into levels(level_id,game_id,level,target_win_rate,measured_win_rate,status,parent_level_id,created_by,notes)
   values($1,$2,$3,$4,$5,'accepted',$6,'production',$7) on conflict(level_id)do nothing returning level_id`,[id,parent.game,JSON.stringify(made.level),parent.target,made.measured,parent.id,JSON.stringify(notes)]);
  if(added.length){
   await q(`insert into solver_runs(level_id,bots,runs_per_bot,status,results,solvable,min_moves,claimed_by,started_at,finished_at)
    values($1,$2,$3,'done',$4,true,$5,$6,now(),now())`,[id,JSON.stringify([made.bot]),made.evidence.runs,JSON.stringify({[made.bot]:made.evidence}),made.min_moves,`catalog-repair:${label}`]);
   await q(`insert into activity_log(agent,action,reason,result,ref_kind,ref_id) values('platform','quality.catalog_repaired',$1,$2,'level',$3)`,[`Program repair after rules change; target ${parent.target} preserved; original ${parent.id} retained`,`${parent.game} ${parent.position}: ${made.evidence.wins}/${made.evidence.runs}, rules ${RULES_VERSION[parent.game]}`,id]);
  }else{const[saved]=await q('select level,target_win_rate from levels where level_id=$1',[id]);if(!saved||levelHash(saved.level as object)!==levelHash(made.level)||Number(saved.target_win_rate)!==parent.target)throw Error('repair id conflicts with existing content');}
  let oldNotes:Record<string,unknown>;try{oldNotes=JSON.parse(String(old.notes));}catch{oldNotes={legacy_note:old.notes};}
  oldNotes.quality={...((oldNotes.quality as object)??{}),superseded_by:id};
  await q('update levels set notes=$2 where level_id=$1',[parent.id,JSON.stringify(oldNotes)]);
  await q('commit');return id;
 }catch(e){await q('rollback');throw e;}
}
function inWorker(parent:Parent):Promise<AcceptedLevel>{return new Promise((resolve,reject)=>{
 const w=new Worker(new URL(`./repair-catalog-worker${import.meta.url.endsWith('.ts')?'.ts':'.js'}`,import.meta.url),{execArgv:import.meta.url.endsWith('.ts')?['--import','tsx']:[],workerData:parent});
 let done=false;const finish=(error:Error|null,value?:AcceptedLevel)=>{if(done)return;done=true;clearTimeout(timer);void w.terminate();if(error)reject(error);else resolve(value!);};
 const timer=setTimeout(()=>finish(Error('repair exceeded 55 seconds; no level accepted')),55_000);
 w.once('message',(r:{ok:boolean;result?:AcceptedLevel;error?:string})=>finish(r.ok?null:Error(r.error),r.result));w.once('error',e=>finish(e));w.once('exit',code=>{if(!done)finish(Error(`repair worker exited ${code} without evidence`));});
});}
async function main(){
 const args=process.argv.slice(2),opt=(name:string,fallback:string)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1]??fallback;};
 const game=opt('--game','racer') as ProductionGame;if(game!=='racer')throw Error('this audited repair release is scoped to racer');
 const write=args.includes('--write'),publish=args.includes('--publish'),label=opt('--label','racer-v2-2026-11-08');
 const out=opt('--out',`production/${label}-repairs.jsonl`),manifestOut=opt('--manifest-out',`production/${label}-catalog.json`);
 const completed=new Map<string,AcceptedLevel>();try{for(const line of(await readFile(out,'utf8')).split('\n').filter(Boolean)){const r=JSON.parse(line);completed.set(r.parent_id,r.result);}}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL}),c=await pool.connect();const q:Query=async(s,p=[]) => (await c.query(s,p)).rows;
 try{
  const rows=await q("select level_id::text id,level,target_win_rate,notes from levels where game_id=$1 and created_by='production' and parent_level_id is null and status in ('accepted','published')",[game]);
  const parents:Parent[]=rows.flatMap(r=>{let n;try{n=JSON.parse(String(r.notes));}catch{return [];}return n.producer===RECIPE_VERSION&&n.series===1&&n.position>=1&&n.position<=100&&r.id===levelId(game,n.position,1)?[{id:String(r.id),game,position:Number(n.position),level:r.level as object,target:Number(r.target_win_rate)}]:[];}).sort((a,b)=>a.position-b.position);
  if(parents.length!==100)throw Error('opening catalog must contain all 100 canonical positions');
  const overrides:Record<string,string>={},ids:string[]=[];let repaired=0;
  for(const parent of parents){
   const row=rows.find(r=>r.id===parent.id)!;let replacement:string|undefined;
   try{replacement=JSON.parse(String(row.notes))?.quality?.superseded_by;}catch{ /* legacy notes */ }
   if(replacement){
    try{const [child]=await q("select parent_level_id::text parent,status from levels where level_id=$1",[replacement]);const v=await verifiedLevel(q,replacement,game);
     if(child?.parent===parent.id&&['accepted','published'].includes(String(child.status))&&v.target===parent.target){ids.push(replacement);overrides[String(parent.position)]=replacement;repaired++;continue;}
    }catch{ /* obsolete revision: prepare a fresh verified child */ }
   }
   try{await verifiedLevel(q,parent.id,game);ids.push(parent.id);continue;}catch{ /* remeasure/retune below; never weaken target */ }
   let made=completed.get(parent.id);
   if(!made||evidenceProblem(game,made.level,parent.target,made.evidence)){
    made=await inWorker(parent);await appendFile(out,JSON.stringify({parent_id:parent.id,parent_hash:levelHash(parent.level),result:made})+'\n');
   }
   const id=write?await saveRepair(q,parent,made,label):uuid(`quality-repair:${parent.id}:${RULES_VERSION[game]}:${levelHash(made.level)}`);
   overrides[String(parent.position)]=id;ids.push(id);repaired++;
   console.log(JSON.stringify({event:'verified_repair',position:parent.position,id,target:parent.target,measured:made.measured,runs:made.evidence.runs,written:write}));
  }
  await writeFile(manifestOut,JSON.stringify({version:1,games:{racer:overrides}},null,2)+'\n');
  const packId=uuid(`${label}:verified-opening-pack`);
  if(publish){
   if(!write)throw Error('--publish requires --write');
   const site=opt('--site','https://levelai.vercel.app').replace(/\/$/,'');const r=await fetch(`${site}/games/racer/app.js`,{signal:AbortSignal.timeout(15000)});
   if(!r.ok||!(await r.text()).includes(RULES_VERSION.racer!))throw Error('corrected racer client is not deployed; verified revisions stay accepted and unpublished');
   for(const id of ids)await verifiedLevel(q,id,game);
   await q('begin');try{
    if((await q("select 1 from settings where key in ('kill_switch','production_kill_switch') and value='true'::jsonb")).length)throw Error('kill switch blocks publication');
    const inserted=await q("insert into packs(pack_id,game_id,name,level_ids) values ($1,$2,'Turbo Lanes · Verified 1–100 · rules v2',$3) on conflict(pack_id)do nothing returning pack_id",[packId,game,JSON.stringify(ids)]);
    if(inserted.length){await q("update levels set status='published',updated_at=now() where level_id=any($1::uuid[])",[ids]);await q("insert into activity_log(agent,action,reason,result,ref_kind,ref_id) values ('platform','quality.repair_pack_published','Human-requested catalog repair; deployed client version verified',$1,'pack',$2)",[`${ids.length} current-rule on-target levels; all old versions/packs retained`,packId]);}
    await q('commit');
   }catch(e){await q('rollback');throw e;}
  }
  if(write)await q("insert into interventions(who,what,why,kind,ref_kind,ref_id) values ('Pinara via Codex',$1,'User requested completion of rules-change difficulty repair; existing levels and targets preserved','fix','quality',$2)",[`Prepared ${repaired} versioned racer repairs${publish?' and verified publication':''}`,label]);
  console.log(JSON.stringify({game,repaired,verified_positions:ids.length,manifest:manifestOut,published:publish,pack_id:packId}));
 }finally{c.release();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
