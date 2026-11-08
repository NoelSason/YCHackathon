import assert from 'node:assert/strict';import{test}from'node:test';import{PlayerAttempt,sourceFor,type AttemptEvent}from'../../games/shared/attempt.js';
test('telemetry requires first input, emits one paired completion, and cannot relabel an automated attempt',()=>{
 const events:AttemptEvent[]=[];const a=new PlayerAttempt(e=>events.push(e));a.end('win');assert.equal(events.length,0);
 a.start('engine');a.start('human');a.end('win');a.end('quit');assert.equal(events.length,2);
 assert.match(events[0]!.session_id,/^engine:v1:/);assert.equal(events[0]!.session_id,events[1]!.session_id);
 const b=new PlayerAttempt(e=>events.push(e));b.start('human');assert.notEqual(events[2]!.session_id,events[0]!.session_id);
 assert.equal(sourceFor('?qa=1',true),'qa');assert.equal(sourceFor('',true),'engine');assert.equal(sourceFor(''),'human');
});
