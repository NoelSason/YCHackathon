// Scoped operation: only Pinara's Designer/Tuner prompts and the existing Designer schedule.
// Read-only plan by default. Does not run setup-team or modify business/CEO configurations.
import {readFile,writeFile}from'node:fs/promises';
import pg from 'pg';
import {naive}from'./client.js';
import {ROSTER}from'./roster.js';
import {DESIGNER_GAMES,DESIGNER_SCHEDULES}from'./designer-prompt.js';
const args=process.argv.slice(2),write=args.includes('--write'),verify=args.includes('--verify');
const option=(name:string,fallback:string)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1]??fallback;};
const output=option('--out','quality-rollout.json'),label=option('--label','pinara-quality-2026-11-08');
const team=JSON.parse(await readFile(new URL('../team.json',import.meta.url),'utf8')) as {agents:Record<string,string>};
const results:{label:string;agents:Array<{name:string;id:string;before:number;after:number;changed:boolean}>;deployments:Array<{id:string;version:number;key?:string;enabled?:boolean}>;sessions:Array<{game:string;id:string;version:number}>}={label,agents:[],deployments:[],sessions:[]};
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
try{
 const killed=await pool.query("select 1 from settings where key='kill_switch' and value='true'::jsonb");if(killed.rows.length&&write)throw Error('kill switch blocks quality rollout');
 for(const name of['designer','tuner']){
  const id=team.agents[name];if(!id)throw Error(`missing ${name} in team.json`);
  const a=await naive.agents.get(id),spec=ROSTER.find(r=>r.name===name)!;
  if(!a.budget.cap_micro_usd||!a.budget.max_task_micro_usd)throw Error(`${name} has no safe budget`);
  let version=a.current_version;
  const changed=write&&a.system!==spec.system;
  if(changed){const updated=await naive.agents.update(id,{system:spec.system,expected_version:a.current_version});version=updated.current_version;}
  results.agents.push({name,id,before:a.current_version,after:version,changed});
 }
 const designer=results.agents.find(a=>a.name==='designer')!;
 const deployments=(await naive.deployments.list({limit:100})).data.filter(d=>d.agent_id===designer.id);
 for(const schedule of DESIGNER_SCHEDULES){
  const have=deployments.find(d=>d.input_template.startsWith(`[LevelAI quality schedule:${schedule.game}]`));
  if(write){
   const patch={agent_version:designer.after,cron:schedule.expr,input_template:schedule.input,budget_micro_usd:500_000,timezone:"America/Los_Angeles",enabled:true};
   const d=have?await naive.deployments.update(have.id,patch):await naive.deployments.create({agent_id:designer.id,...patch});
   results.deployments.push({id:d.id,version:designer.after,key:schedule.key,enabled:d.enabled});
  }else results.deployments.push({id:have?.id??'to-create',version:designer.after,key:schedule.key,enabled:have?.enabled??false});
 }
 // Only legacy schedules for this same Designer are retired; all other agents are untouched.
 if(write)for(const d of deployments)if(d.enabled&&!DESIGNER_SCHEDULES.some(s=>d.input_template.startsWith(`[LevelAI quality schedule:${s.game}]`)))await naive.deployments.pause(d.id);
 if(verify){
  if(!write)throw Error('--verify requires --write; sessions are real work');
  for(const game of DESIGNER_GAMES){
   const s=await naive.sessions.create({agent_id:designer.id,agent_version:designer.after,
    message:`Human-requested quality verification ${label}. Design ONE ${game} level for target_win_rate 0.50. Keep that target unchanged. Include ${label}:${game} in notes. Use the existing adapter, no game/app/source code. Save exactly once and report the returned id.`,
    budget_micro_usd:500_000,metadata:{quality_proof:label,game}}, {idempotencyKey:`${label}:${game}`});
   results.sessions.push({game,id:s.id,version:designer.after});await writeFile(output,JSON.stringify(results,null,2));
  }
 }
 console.log(JSON.stringify({dry_run:!write,...results}));
}finally{
 await writeFile(output,JSON.stringify(results,null,2));
 if(write){
  const detail=JSON.stringify(results);
  await pool.query(`insert into interventions(who,what,why,kind,ref_kind,ref_id) values ('Pinara via Codex','Applied scoped quality-agent prompts and/or started bounded five-game verification','User requested completion of the team-plan quality pipeline; external runs are human-triggered','fix','quality',$1)`,[label]);
  await pool.query(`insert into activity_log(agent,action,reason,result,ref_kind,ref_id) values ('platform','quality.agents_rollout','Human-requested Designer/Tuner-only update; budgets, tools, business agents and CEO preserved',$1,'quality',$2)`,[detail,label]);
 }
 await pool.end();
}
