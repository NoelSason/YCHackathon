import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto}from'@electric-sql/pglite/contrib/pgcrypto';
import {restoreTargets,inspectTargets}from'../src/production/repair-targets.js';
test('incident repair restores the whole chain without changing payloads, claims once, and logs intervention',async()=>{
 const db=await PGlite.create({extensions:{pgcrypto}});try{
 await db.exec(await readFile(new URL('../../platform/db/schema.sql',import.meta.url),'utf8'));
 const q=async(s:string,p:unknown[]=[]) => (await db.query<Record<string,unknown>>(s,p)).rows;
 await q("insert into games(game_id,name) values ('watersort','Sort')");
 const [root]=await q("insert into levels(game_id,level,target_win_rate,status) values ('watersort','{\"move_limit\":10}',.35,'rejected') returning level_id::text id");
 const [child]=await q("insert into levels(game_id,level,target_win_rate,status,parent_level_id) values ('watersort','{\"move_limit\":9}',.35,'accepted',$1) returning level_id::text id",[root!.id]);
 const before=await inspectTargets(q,[String(root!.id)]);const claims=await restoreTargets(q,[String(root!.id)]);
 assert.equal(claims.length,1);assert.equal(claims[0]!.level_id,child!.id);assert.equal(claims[0]!.target,.30);
 const after=await inspectTargets(q,[String(root!.id)]);assert.deepEqual(after.map(r=>r.level),before.map(r=>r.level));assert.ok(after.every(r=>Number(r.target_win_rate)===.30));
 assert.equal((await restoreTargets(q,[String(root!.id)])).length,0);
 assert.equal((await q("select count(*)::int n from interventions"))[0]!.n,1);
 }finally{await db.close();}
});
