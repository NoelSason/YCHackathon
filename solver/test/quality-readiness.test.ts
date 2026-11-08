import assert from'node:assert/strict';import{test}from'node:test';import{readFile}from'node:fs/promises';import{PGlite}from'@electric-sql/pglite';import{pgcrypto}from'@electric-sql/pglite/contrib/pgcrypto';import check from'../../platform/checks/src/checks/15-design-tune-solve.js';import{runLevel}from'../src/run.js';import{stubAdapter}from'../../platform/mcp/src/adapters.js';
test('readiness excludes compiler and legacy authored acceptances; requires current 200-game authored evidence',async()=>{
 const d=await PGlite.create({extensions:{pgcrypto}});try{await d.exec(await readFile(new URL('../../platform/db/schema.sql',import.meta.url),'utf8'));await d.exec("insert into games(game_id,name)values('watersort','Sort')");
 const level={title:'Ready',capacity:4,tubes:[['red','blue','red','blue'],['blue','red','blue','red'],[],[]],move_limit:20};
 const {getAdapter}=await import('../../platform/mcp/src/adapters.js');const a=getAdapter('watersort')!;const out=runLevel(a,level,['human'],200,1);const rate=out.results.human!.win_rate;
 const r=await d.query<{id:string}>("insert into levels(game_id,level,target_win_rate,measured_win_rate,status,created_by)values('watersort',$1,$2,$2,'accepted','production')returning level_id::text id",[JSON.stringify(level),rate]);const id=r.rows[0]!.id;
 const ctx={db:{query:(s:string,v:unknown[]=[])=>d.query(s,v)},expectRunning:true} as unknown as Parameters<typeof check.run>[0];
 assert.equal((await check.run(ctx)).ok,false,'compiler does not prove a Designer agent ran');
 await d.query("update levels set created_by='designer' where level_id=$1",[id]);await d.query("insert into activity_log(agent,action,ref_kind,ref_id)values('designer','save_level','level',$1)",[id]);assert.equal((await check.run(ctx)).ok,false,'missing evidence excluded');
 await d.query("insert into solver_runs(level_id,bots,runs_per_bot,status,results,solvable,finished_at)values($1,'[\"human\"]',200,'done',$2,true,now())",[id,JSON.stringify(out.results)]);assert.equal((await check.run(ctx)).ok,true);
 }finally{await d.close();}
});
