import assert from 'node:assert/strict';import{test}from'node:test';import{PGlite}from'@electric-sql/pglite';import{HUMAN_ATTEMPTS_CTE}from'../src/player-attempts.js';
test('human outcomes exclude orphan, engine, QA and legacy events; duplicates and conflicting endings count once',async()=>{
 const db=await PGlite.create();try{await db.exec(`create table player_events(id bigserial,game_id text,level_id uuid,session_id text,type text,ts timestamptz default now(),moves_used int,time_seconds numeric)`);const id='11111111-1111-4111-a111-111111111111';
 for(const [session,types] of [['engine:v1:a',['attempt','win']],['qa:v1:a',['attempt','win']],['legacy',['attempt','win']],['human:v1:orphan',['win']],['human:v1:good',['attempt','win','win','loss']],['human:v1:loss',['attempt','loss','win']]] as const)for(const type of types)await db.query('insert into player_events(game_id,level_id,session_id,type) values ($1,$2,$3,$4)',['racer',id,session,type]);
 const r=await db.query(`with ${HUMAN_ATTEMPTS_CTE} select type,count(*)::int n from human_outcomes group by type order by type`);assert.deepEqual(r.rows,[{type:'loss',n:1},{type:'win',n:1}]);
 }finally{await db.close();}
});
