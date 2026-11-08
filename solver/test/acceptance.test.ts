import assert from 'node:assert/strict';import{test}from'node:test';import{readFile}from'node:fs/promises';
import{PGlite}from'@electric-sql/pglite';import{pgcrypto}from'@electric-sql/pglite/contrib/pgcrypto';
import{acceptVerified}from'../src/acceptance.js';import{evidenceStamp}from'../src/evidence.js';import{wilson95}from'../src/stats.js';import{SAMPLES}from'../../games/watersort/src/levels.js';
test('acceptance rejects absent, stale, partial and caller-invented evidence; accepts the real completed result',async()=>{
const db=await PGlite.create({extensions:{pgcrypto}});try{await db.exec(await readFile(new URL('../../platform/db/schema.sql',import.meta.url),'utf8'));const q=async(s:string,p:unknown[]=[]) => (await db.query<Record<string,unknown>>(s,p)).rows;
await q("insert into games(game_id,name) values ('watersort','Sort')");const level=SAMPLES[0]!;
const[l]=await q("insert into levels(game_id,level,target_win_rate) values ('watersort',$1,.5) returning level_id::text id",[JSON.stringify(level)]);const id=String(l!.id);
await assert.rejects(acceptVerified(q,id,.5),/completed/);const ci=wilson95(100,200);const result={...evidenceStamp('watersort',level),runs:200,wins:100,win_rate:.5,avg_moves:5,ci95_low:ci.low,ci95_high:ci.high,first_seed:1};
const[r]=await q("insert into solver_runs(level_id,bots,status,results,solvable,finished_at) values ($1,'[\"human\"]','done',$2,true,now()) returning run_id::text id",[id,JSON.stringify({human:result})]);
await assert.rejects(acceptVerified(q,id,.9),/differs/);await acceptVerified(q,id,.5);
await q("update solver_runs set results=$2 where run_id=$1",[r!.id,JSON.stringify({human:{...result,rules_version:'old'}})]);await assert.rejects(acceptVerified(q,id,.5),/stale/);
await q("update solver_runs set results=$2 where run_id=$1",[r!.id,JSON.stringify({human:{...result,runs:20,wins:10}})]);await assert.rejects(acceptVerified(q,id,.5),/200/);
}finally{await db.close()}});
