import assert from'node:assert/strict';import{test}from'node:test';import{readFile}from'node:fs/promises';import{PGlite}from'@electric-sql/pglite';import{pgcrypto}from'@electric-sql/pglite/contrib/pgcrypto';
import{saveRepair,retuneCandidate,type Parent}from'../src/production/repair-catalog.js';import{recipe}from'../src/production/catalog.js';import{calibrate}from'../src/production/calibrate.js';import{evidenceProblem}from'../src/evidence.js';
test('versioned repair keeps the parent payload/id/status, preserves target and evidence, and resumes once',async()=>{
 const db=await PGlite.create({extensions:{pgcrypto}});try{await db.exec(await readFile(new URL('../../platform/db/schema.sql',import.meta.url),'utf8'));const q=async(s:string,p:unknown[]=[]) =>(await db.query<Record<string,unknown>>(s,p)).rows;await q("insert into games(game_id,name)values('watersort','Sort')");
 const made=calibrate(recipe('watersort',1));const[row]=await q("insert into levels(game_id,level,target_win_rate,measured_win_rate,status,created_by,notes) values('watersort',$1,$2,0,'published','production','{}')returning level_id::text id",[JSON.stringify(made.level),made.target]);
 const parent:Parent={id:String(row!.id),game:'watersort',position:1,level:made.level,target:made.target};
 const id=await saveRepair(q,parent,made,'test');assert.notEqual(id,parent.id);assert.equal(await saveRepair(q,parent,made,'test'),id);
 const [old]=await q('select level,status,target_win_rate,notes from levels where level_id=$1',[parent.id]);assert.deepEqual(old!.level,parent.level);assert.equal(old!.status,'published');assert.equal(Number(old!.target_win_rate),parent.target);assert.equal(JSON.parse(String(old!.notes)).quality.superseded_by,id);
 assert.equal((await q('select count(*)::int n from solver_runs'))[0]!.n,1);assert.equal((await q('select count(*)::int n from levels'))[0]!.n,2);
 await assert.rejects(saveRepair(q,parent,{...made,target:.1},'bad'),/target/);
 }finally{await db.close();}
});
test('the early racer challenge can be repaired with real layouts and an unchanged target',()=>{
 const r=recipe('racer',10);const parent:Parent={id:'11111111-1111-4111-a111-111111111111',game:'racer',position:10,level:r.level,target:r.target};
 const made=retuneCandidate(parent,55_000);assert.equal(made.target,parent.target);assert.equal(evidenceProblem('racer',made.level,parent.target,made.evidence),null);assert.equal(made.evidence.runs,200);
});
