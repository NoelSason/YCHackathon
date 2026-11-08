// Built-client regression. All telemetry transports are intercepted inside the browser.
// GAME_QA_BASE_URL=http://127.0.0.1:4183 node scripts/check-game-telemetry.cjs
const assert=require('node:assert/strict');
const{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.GAME_QA_BASE_URL||'http://127.0.0.1:4183';
const id='11111111-1111-4111-a111-111111111111';
const fixtures={
 watersort:{title:'Telemetry QA',capacity:4,tubes:[['red','red','red','blue'],['blue','blue','blue','green'],['green','green','green','red'],[],[]],move_limit:80},
 racer:{title:'Telemetry QA',lanes:3,length:40,speed:6,time_limit:100,crash_penalty:2,lane_change_cooldown:0,objects:[]},
 lotescape:{title:'Telemetry QA',size:6,move_limit:20,vehicles:[{id:'a',x:1,y:2,length:2,axis:'h',exit:'right',color:'coral'}]},
 platformer:{name:'Telemetry QA',map:['########','#......#','#......#','#S.C..G#','########'],jump_height:2,fall_limit:4,move_limit:40}
};
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{})});
try{
 const c=await browser.newContext({viewport:{width:390,height:844}});
 await c.addInitScript(()=>{
  window.__qaEvents=[];const original=window.fetch.bind(window);
  const save=async body=>{window.__qaEvents.push(JSON.parse(body instanceof Blob?await body.text():String(body)));};
  window.fetch=async(input,init)=>{const url=typeof input==='string'?input:input.url;if(/\/events(?:\?|$)/.test(url)){await save(init?.body);return new Response(null,{status:204});}return original(input,init);};
  navigator.sendBeacon=(url,body)=>{if(/\/events(?:\?|$)/.test(String(url))){void save(body);return true;}return false;};
 });
 await c.route('**/events',r=>r.fulfill({status:204})); // fallback guard: no production writes
 for(const[game,level]of Object.entries(fixtures)){
  const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.route(`**/levels/${id}`,r=>r.fulfill({json:{game_id:game,level,status:'accepted'}}));
  await p.clock.install();await p.goto(`${base}/games/${game}/?level=${id}`);
  const api={watersort:'splashSort',racer:'turboLanes',lotescape:'lotEscape',platformer:'mosslightTrails'}[game];
  await p.waitForFunction(key=>!!window[key],api);
  await p.waitForFunction(()=>document.body.textContent.includes('Telemetry QA'));
  assert.deepEqual(await p.evaluate(()=>window.__qaEvents),[],`${game}: loading is not an attempt`);
  if(game==='watersort')await p.evaluate(()=>{window.splashSort.tap(0);window.splashSort.tap(3);});
  if(game==='racer')await p.evaluate(()=>window.turboLanes.start());
  if(game==='lotescape')await p.locator('[data-dir="right"]').click();
  if(game==='platformer')await p.locator('.landing').first().click();
  await p.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  await p.waitForFunction(()=>window.__qaEvents.length>=2);
  const first=await p.evaluate(()=>window.__qaEvents);assert.equal(first.length,2,`${game}: exactly one start and end`);assert.equal(first[0].type,'attempt');assert.match(first[0].session_id,/^human:v1:/);assert.equal(first[0].session_id,first[1].session_id);assert.equal(first[0].level_id,id);
  // A restart gets a new attempt; replay remains automation even after manual takeover.
  if(game==='lotescape'){await p.locator('#reset').click();await p.evaluate(()=>window.lotEscape.autoplay());}
  else await p.evaluate(key=>{window[key].restart();window[key].autoplay();},api);
  await p.clock.runFor(2000);
  const automated=await p.evaluate(()=>window.__qaEvents.filter(e=>e.type==='attempt'&&e.session_id.startsWith('engine:v1:')));
  assert.equal(automated.length,1,`${game}: replay gets its own engine attempt`);assert.notEqual(automated[0].session_id,first[0].session_id);
  assert.deepEqual(errors,[]);console.log(`PASS ${game}: idle load, paired manual attempt, restart identity, engine isolation`);await p.close();
 }
 await c.close();
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
