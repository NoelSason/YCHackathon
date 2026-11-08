import assert from 'node:assert/strict';
import {test} from 'node:test';
import adapter from '../adapter/index.js';
import {initialState,move,neighbors,path,validateLevel} from '../src/engine.js';
import {SAMPLES,makeTrail} from '../src/levels.js';

test('all authored trails are valid and the exact solution wins using browser movement',()=>{
 for(let i=1;i<=100;i++){
  const level=makeTrail(i);assert.deepEqual(validateLevel(level),{ok:true});
  const solution=adapter.solve!(level);assert.equal(solution.solvable,true);
  const inputs=solution.inputs as Array<{x:number;y:number}>;
  let state=initialState(level);
  for(const point of inputs.slice(1)){
   assert.ok(neighbors(level,state.position).some(p=>p.x===point.x&&p.y===point.y));
   state=move(level,state,point);
  }
  assert.equal(state.status,'won');assert.equal(state.moves,solution.min_moves);
 }
});

test('illegal teleports and moves after finishing do not mutate the board',()=>{
 const l=SAMPLES[0]!,s=initialState(l);
 assert.equal(move(l,s,{x:12,y:0}),s);
 let state=s;for(const p of path(l)!.slice(1))state=move(l,state,p);
 assert.equal(move(l,state,{x:1,y:1}),state);
});

test('adapter bots are deterministic and share the browser route without changing the level schema',()=>{
 for(const l of SAMPLES){
  assert.deepEqual(adapter.simulate(l,'random',42),adapter.simulate(l,'random',42));
  const greedy=adapter.simulate(l,'greedy',42);assert.equal(greedy.won,true);
  assert.equal(greedy.moves_used,adapter.solve!(l).min_moves);
 }
 assert.match(adapter.level_url('test'),/\/games\/platformer\/\?level=test$/);
 assert.equal(validateLevel({...SAMPLES[0],map:['bad']}).ok,false);
});

test('collectibles cannot be counted twice on revisits and a current-position hint remains legal',()=>{
 const level=SAMPLES[0]!;let s=initialState(level);
 const route=path(level)!;
 for(const p of route.slice(1,5))s=move(level,s,p);
 const collected=s.collected.length;
 const back=route[route.findIndex(p=>p.x===s.position.x)-1]!;
 const prior=s.position;s=move(level,s,back);s=move(level,s,prior);
 assert.equal(s.collected.length,collected);
 assert.ok(path(level,s.position)?.length);
});
