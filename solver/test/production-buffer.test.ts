import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { bufferState, readBuffer, BufferFullError } from "../src/production/buffer.js";
import { recipe, RECIPE_VERSION } from "../src/production/catalog.js";
import { calibrate } from "../src/production/calibrate.js";
import { saveAccepted } from "../src/production/store.js";

test("50 completed means stock through 150, with only missing future levels requested", () => {
  const state = bufferState(50, Array.from({length:100},(_,i)=>i+1));
  assert.equal(state.target_through,150);
  assert.deepEqual(state.needed,Array.from({length:50},(_,i)=>i+101));
  assert.deepEqual(bufferState(50,Array.from({length:150},(_,i)=>i+1)).needed,[]);
});

test("existing excess stock is retained; fill holes ahead of player; retain the 1000 cap", () => {
  const ready=Array.from({length:550},(_,i)=>i+1);
  const state=bufferState(0,ready);
  assert.deepEqual(state.ready,ready);
  assert.deepEqual(state.needed,[]);
  assert.deepEqual(bufferState(50,[...ready.filter(p=>p!==75&&p!==20)]).needed,[75]);
  assert.equal(bufferState(950,[]).needed.length,50);
  assert.deepEqual(bufferState(1000,ready).needed,[]);
});

test("actual wins advance the matching game/series; buffer blocks new excess imports without deleting stock", async () => {
  const db=await PGlite.create({extensions:{pgcrypto}});
  try {
    await db.exec(await readFile(new URL("../../platform/db/schema.sql",import.meta.url),"utf8"));
    const q=async(sql:string,values:unknown[]=[]) => (await db.query<Record<string,unknown>>(sql,values)).rows;
    await db.exec("insert into games(game_id,name) values ('watersort','Splash Sort'),('racer','Turbo Lanes')");
    const accepted=calibrate(recipe("watersort",1));
    for(const position of [...Array.from({length:51},(_,i)=>i+1),101,550]) {
      const [row]=await q("insert into levels(game_id,level,status,created_by,notes,target_win_rate) values ('watersort',$1,'accepted','production',$2,0.85) returning level_id::text as id",[JSON.stringify(accepted.level),JSON.stringify({producer:RECIPE_VERSION,series:1,position})]);
      if(position<50) await q("insert into player_events(game_id,level_id,session_id,type) values ('watersort',$1,'human:v1:win','attempt'),('watersort',$1,'human:v1:win','win')",[row!.id]);
      if(position===50) {
        await q("insert into player_events(game_id,level_id,session_id,type) values ('watersort',$1,'human:v1:loss','attempt'),('watersort',$1,'human:v1:loss','loss')",[row!.id]);
        assert.equal((await readBuffer(q,'watersort',1)).played_through,49);
        await q("insert into player_events(game_id,level_id,session_id,type) values ('watersort',$1,'human:v1:win','attempt'),('watersort',$1,'human:v1:win','win')",[row!.id]);
      }
    }
    const state=await readBuffer(q,'watersort',1);
    assert.equal(state.played_through,50);
    assert.equal(state.target_through,150);
    assert.ok(!state.needed.includes(101));
    assert.equal((await readBuffer(q,'racer',1)).played_through,0);
    assert.equal((await readBuffer(q,'watersort',2)).played_through,0);
    const [late]=await q("select level_id from levels where notes like '%550%'");
    await q("insert into player_events(game_id,level_id,session_id,type) values ('watersort',$1,'phone-check','win')",[late!.level_id]);
    assert.equal((await readBuffer(q,'watersort',1)).played_through,50,"late playtest must not jump progress");
    const beyond={...accepted,position:151};
    await assert.rejects(saveAccepted(q,beyond,1),BufferFullError);
    assert.equal((await q("select count(*)::int as n from levels"))[0]!.n,53);
    assert.equal((await q("select count(*)::int as n from levels where notes like '%550%'"))[0]!.n,1);
  } finally {await db.close();}
});

test("lotescape and platformer follow the same rule: winning 1-50 in order asks for 101-150, and saving fills it", async () => {
  const db=await PGlite.create({extensions:{pgcrypto}});
  try {
    await db.exec(await readFile(new URL("../../platform/db/schema.sql",import.meta.url),"utf8"));
    const q=async(sql:string,values:unknown[]=[]) => (await db.query<Record<string,unknown>>(sql,values)).rows;
    await db.exec("insert into games(game_id,name) values ('lotescape','Lot Escape'),('platformer','Mosslight Trails')");
    for (const game of ["lotescape","platformer"] as const) {
      for (let position=1; position<=100; position++) {
        const [row]=await q("insert into levels(game_id,level,status,created_by,notes,target_win_rate) values ($1,'{}','accepted','production',$2,0.75) returning level_id::text as id",[game,JSON.stringify({producer:RECIPE_VERSION,series:1,position})]);
        if (position<=50) await q("insert into player_events(game_id,level_id,session_id,type) values ($1,$2,'human:v1:win','attempt'),($1,$2,'human:v1:win','win')",[game,row!.id]);
      }
      const state=await readBuffer(q,game,1);
      assert.equal(state.played_through,50,game);
      assert.equal(state.target_through,150,game);
      assert.deepEqual(state.needed,Array.from({length:50},(_,i)=>i+101),game);
    }
    // A real production level for the next slot is accepted into the buffer; one past it is refused.
    let made: ReturnType<typeof calibrate> | undefined;
    for (let attempt=0; attempt<8 && !made; attempt++) { try { made=calibrate(recipe("platformer",101,attempt)); } catch { /* next layout */ } }
    assert.ok(made);
    await saveAccepted(q,made,1);
    assert.equal((await readBuffer(q,"platformer",1)).needed.length,49);
    await assert.rejects(saveAccepted(q,{...made,position:151},1),BufferFullError);
  } finally {await db.close();}
});
