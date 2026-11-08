import assert from 'node:assert/strict';
import {test} from 'node:test';
import adapter from '../adapter/index.js';
import {initialState,move,neighbors,path,validateLevel} from '../src/engine.js';
import {SAMPLES,makeTrail} from '../src/levels.js';
import {generateTrail} from '../src/generate.js';

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

test('move_limit: optional, never below the shortest route, and running out of steps loses the trail',()=>{
 const l=SAMPLES[0]!,min=adapter.solve!(l).min_moves!;
 assert.deepEqual(validateLevel({...l,move_limit:min}),{ok:true});
 assert.equal(validateLevel({...l,move_limit:min-1}).ok,false);
 assert.equal(validateLevel({...l,move_limit:0}).ok,false);
 const tight={...l,move_limit:min};let s=initialState(tight);
 const wrong=neighbors(tight,s.position).find(p=>p.x<s.position.x||p.y!==path(tight)![1]!.y);
 if(wrong){s=move(tight,s,wrong);for(let i=0;i<min&&s.status==='playing';i++){const next=path(tight,s.position)?.[1];if(!next)break;s=move(tight,s,next);}assert.equal(s.status,'lost');}
 const won=path(tight)!.slice(1).reduce((st,p)=>move(tight,st,p),initialState(tight));assert.equal(won.status,'won');
});

test('human bot: deterministic per seed, wins more as move_limit loosens, never beats the shortest route',()=>{
 const l=generateTrail({seed:42,difficulty:6,name:'Test trail'}),min=adapter.solve!(l).min_moves!;
 assert.deepEqual(adapter.simulate({...l,move_limit:min+8},'human',3),adapter.simulate({...l,move_limit:min+8},'human',3));
 const rate=(extra:number)=>{let w=0;for(let s=1;s<=200;s++)w+=Number(adapter.simulate({...l,move_limit:min+extra},'human',s).won);return w/200;};
 const rates=[0,6,12,25,60].map(rate);
 for(let i=1;i<rates.length;i++)assert.ok(rates[i]!>=rates[i-1]!,`win rate fell: ${rates.join(', ')}`);
 assert.ok(rates[0]!<0.3&&rates.at(-1)!>0.7,`human bot should span hard to easy: ${rates.join(', ')}`);
 for(let s=1;s<=50;s++){const out=adapter.simulate({...l,move_limit:min+60},'human',s);if(out.won)assert.ok(out.moves_used>=min);}
});

test('generator: seeded, valid at every notch, and harder notches need more steps',()=>{
 assert.deepEqual(generateTrail({seed:9,difficulty:5}),generateTrail({seed:9,difficulty:5}));
 let easy=0,hard=0;
 for(let i=0;i<20;i++){
  for(let d=1;d<=12;d++)assert.deepEqual(validateLevel(generateTrail({seed:i*31+d,difficulty:d})),{ok:true});
  easy+=adapter.solve!(generateTrail({seed:i,difficulty:1})).min_moves!;hard+=adapter.solve!(generateTrail({seed:i,difficulty:12})).min_moves!;
 }
 assert.ok(hard>easy*1.8,`top notch trails should be much longer: ${easy/20} vs ${hard/20}`);
});
