import assert from'node:assert/strict';import{test}from'node:test';import{readFile}from'node:fs/promises';import{PGlite}from'@electric-sql/pglite';import{pgcrypto}from'@electric-sql/pglite/contrib/pgcrypto';import{claimLegacyAcceptance}from'../src/production/reverify-designs.js';
test('legacy acceptance is claimed once with its original target; published versions and active jobs are protected',async()=>{
 const d=await PGlite.create({extensions:{pgcrypto}});try{await d.exec(await readFile(new URL('../../platform/db/schema.sql',import.meta.url),'utf8'));const q=async(s:string,p:unknown[]=[]) =>(await d.query<Record<string,unknown>>(s,p)).rows;await q("insert into games(game_id,name)values('stub','Stub') on conflict do nothing");
 const [a]=await q("insert into levels(game_id,level,target_win_rate,status,created_by)values('stub','{}',0.3,'accepted','tuner')returning level_id::text id");const id=String(a!.id);
 assert.equal((await claimLegacyAcceptance(q,id))!.target,.3);await assert.rejects(claimLegacyAcceptance(q,id),/unpublished accepted/);
 await q("update levels set status='published' where level_id=$1",[id]);await assert.rejects(claimLegacyAcceptance(q,id),/unpublished accepted/);
 await q("update levels set status='accepted' where level_id=$1",[id]);await q("insert into solver_runs(level_id,bots,runs_per_bot,status)values($1,'[]',200,'running')",[id]);await assert.rejects(claimLegacyAcceptance(q,id),/active measurement/);
 assert.equal((await q('select count(*)::int n from interventions'))[0]!.n,1);
 }finally{await d.close();}
});
