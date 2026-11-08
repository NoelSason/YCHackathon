import { type PlatformLevel, type PlayState, type Pos, cell, find, initialState, move, neighbors, path, validateLevel } from "../src/engine.js";
import { SAMPLES } from "../src/levels.js";
declare const __PLATFORM_URL__: string;
const params=new URLSearchParams(location.search);
const API=(params.get("api")??__PLATFORM_URL__).replace(/\/+$/,"");
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const session=crypto.randomUUID();
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
let level:PlatformLevel,state:PlayState,levelId:string|null=null,sample:number|null=null;
let playlist:Array<{level_id:string;level:PlatformLevel}>=[],playlistIndex=0;
let started=false,hinted:Pos|null=null,selection=0,auto:number|undefined;
let generation=0;
function event(type:"attempt"|"win"|"quit",beacon=false):void{
  if(!levelId)return;
  const blob=new Blob([JSON.stringify({game_id:"platformer",level_id:levelId,session_id:session,type,...(type==="attempt"?{}:{moves_used:state.moves})})],{type:"text/plain;charset=UTF-8"});
  if(beacon&&navigator.sendBeacon?.(`${API}/events`,blob))return;
  void fetch(`${API}/events`,{method:"POST",body:blob,keepalive:true}).catch(()=>undefined);
}
function checked(value:unknown):PlatformLevel{const v=validateLevel(value);if(!v.ok)throw Error(v.errors[0]);return value as PlatformLevel;}
function notice(text:string):void{el("notice").textContent=text;el("notice").classList.remove("hidden");}
function load(next:PlatformLevel,id:string|null=null,practice:number|null=null):void{
  if(state?.status==="playing"&&started)event("quit");
  window.clearInterval(auto);generation++;
  level=checked(next);state=initialState(level);levelId=id;sample=practice;started=false;hinted=null;selection=0;
  el("overlay").classList.add("hidden");el("app").inert=false;
  el<HTMLButtonElement>("restart").disabled=false;
  el("title").textContent=level.name;
  el("mode").textContent=practice?`PRACTICE ${practice} OF ${SAMPLES.length}`:playlist.length?`LIVE TRAIL ${playlistIndex+1} OF ${playlist.length}`:"LIVE TRAIL";
  el("hint").textContent="Tap a glowing landing spot, or use the arrow buttons.";
  renderSamples();render();
}
function targets():Pos[]{return neighbors(level,state.position);}
function render(previous?:Pos):void{
  const options=state.status==="playing"?targets():[];
  const world=el("world");world.style.gridTemplateColumns=`repeat(${level.map[0]!.length},var(--tile))`;
  world.replaceChildren(...level.map.flatMap((row,y)=>[...row].map((tile,x)=>{
    const legal=options.some(p=>p.x===x&&p.y===y),node=document.createElement(legal?"button":"div");
    node.className="tile";
    if(tile==="#")node.classList.add("soil");
    if(tile==="^"){node.classList.add("spike");node.textContent="▲";}
    if(tile==="C"&&!state.collected.includes(`${x},${y}`)){node.classList.add("firefly");node.textContent="✦";}
    if(tile==="G"){node.classList.add("goal");node.textContent="◈";}
    if(tile==="S")node.classList.add("start");
    if(legal){(node as HTMLButtonElement).type="button";node.classList.add("landing");node.setAttribute("aria-label",`Land at column ${x+1}, row ${y+1}${tile==="G"?", goal":tile==="C"?", firefly":""}`);node.dataset.x=String(x);node.dataset.y=String(y);node.onclick=()=>take({x,y});}
    if(hinted?.x===x&&hinted.y===y)node.classList.add("hinted");
    if(options[selection]?.x===x&&options[selection]?.y===y)node.classList.add("selected");
    return node;
  })));
  const hero=document.createElement("div");hero.className="hero";hero.setAttribute("aria-label","Your forest guide");hero.innerHTML='<div class="sprite"></div>';
  const from=previous??state.position;hero.style.setProperty("--x",String(from.x));hero.style.setProperty("--y",String(from.y));world.append(hero);
  const current=state;requestAnimationFrame(()=>{if(state!==current)return;hero.style.setProperty("--x",String(state.position.x));hero.style.setProperty("--y",String(state.position.y));const viewport=el("viewport");const tileSize=world.clientWidth/level.map[0]!.length;viewport.scrollTo({left:Math.max(0,(state.position.x+.5)*tileSize-viewport.clientWidth/2),behavior:"smooth"});});
  el("moves").textContent=String(state.moves);el("coins").textContent=`${state.collected.length} / ${find(level.map,"C").length}`;el("limits").textContent=`${level.jump_height} / ${level.fall_limit}`;
  for(const dir of [-1,1])el<HTMLButtonElement>(dir<0?"left":"right").disabled=!options.some(p=>p.x===state.position.x+dir);
  el<HTMLButtonElement>("guide").disabled=state.status!=="playing";
}
function take(target:Pos):void{
  const next=move(level,state,target);if(next===state)return;
  if(!started){started=true;event("attempt");}
  const prev=state.position;state=next;hinted=null;selection=0;render(prev);
  if(state.status==="won"){
    event("win");window.clearInterval(auto);
    el("ov-text").textContent=`${state.moves} steps · ${state.collected.length} of ${find(level.map,"C").length} fireflies found. Take a breath. There’s another trail ahead.`;
    const g=generation;window.setTimeout(()=>{if(g!==generation)return;el("overlay").classList.remove("hidden");el("app").inert=true;el("ov-next").focus();},300);
  }else el("hint").textContent=targets().length?"Keep following the glowing landing spots.":"This route ends here. Restart and try a different landing.";
}
function steer(dir:number):void{const choice=targets().filter(p=>p.x===state.position.x+dir).sort((a,b)=>Math.abs(a.y-state.position.y)-Math.abs(b.y-state.position.y))[0];if(choice)take(choice);}
function guide():void{const route=path(level,state.position);if(!route?.[1])return notice("No route from this ledge. Restart to try another path.");hinted=route[1];render();el("hint").textContent=`Next safe landing: column ${hinted.x+1}, row ${hinted.y+1}.`;}
function autoplay():void{window.clearInterval(auto);if(state.status==="won")load(level,levelId,sample);const route=path(level,state.position);if(!route)return notice("No route from this ledge.");let n=1;const g=generation;auto=window.setInterval(()=>{if(g!==generation||state.status!=="playing"||!route[n])return window.clearInterval(auto);take(route[n++]!);},330);}
function renderSamples():void{el("samples").replaceChildren(...SAMPLES.map((s,i)=>{const b=document.createElement("button");b.type="button";const number=document.createElement("b");number.textContent=`TRAIL ${String(i+1).padStart(2,"0")}`;b.append(number,document.createTextNode(s.name));if(sample===i+1)b.setAttribute("aria-current","true");b.onclick=()=>{playlist=[];load(s,null,i+1);};return b;}));}
async function json(url:string):Promise<Record<string,unknown>>{
  const controller=new AbortController(),timer=window.setTimeout(()=>controller.abort(),8000);
  try{const r=await fetch(url,{signal:controller.signal});if(!r.ok)throw Error(`server answered ${r.status}`);return await r.json() as Record<string,unknown>;}finally{window.clearTimeout(timer);}
}
async function loadPack(id:string):Promise<void>{const body=await json(`${location.origin}/api/packs/${encodeURIComponent(id)}`);if(body.game_id!=="platformer"||!Array.isArray(body.levels)||!body.levels.length)throw Error("not a Mosslight Trails pack");playlist=(body.levels as Array<{level_id:string;level:unknown}>).map(r=>({level_id:r.level_id,level:checked(r.level)}));playlistIndex=Math.max(0,Math.min(playlist.length-1,Math.floor(Number(params.get("n")??1))-1||0));load(playlist[playlistIndex]!.level,playlist[playlistIndex]!.level_id);}
async function boot():Promise<void>{
  el("left").onclick=()=>steer(-1);el("right").onclick=()=>steer(1);el("guide").onclick=guide;el("restart").onclick=()=>load(level,levelId,sample);
  el("ov-replay").onclick=()=>load(level,levelId,sample);
  el("ov-next").onclick=()=>{if(playlist[playlistIndex+1]){playlistIndex++;const next=playlist[playlistIndex]!;load(next.level,next.level_id);}else if(sample!==null){const i=sample%SAMPLES.length;load(SAMPLES[i]!,null,i+1);}else load(level,levelId,sample);};
  document.addEventListener("keydown",e=>{if(!state)return;if(!el("overlay").classList.contains("hidden")){if(e.key==="Tab"){e.preventDefault();(document.activeElement===el("ov-next")?el("ov-replay"):el("ov-next")).focus();}return;}if(e.metaKey||e.ctrlKey||e.altKey)return;
    if(e.key==="ArrowLeft"||e.key==="ArrowRight"){e.preventDefault();if(!e.repeat)steer(e.key==="ArrowLeft"?-1:1);}else if(e.key==="ArrowUp"||e.key==="ArrowDown"){e.preventDefault();const n=targets().length;if(n){selection=(selection+(e.key==="ArrowUp"?-1:1)+n)%n;render();}}else if(e.key==="Enter"||e.key===" "){if((document.activeElement as HTMLElement)?.tagName==="BUTTON")return;e.preventDefault();const next=targets()[selection];if(next)take(next);}else if(e.key.toLowerCase()==="r")load(level,levelId,sample);
  });
  try{
    if(params.get("pack")){await loadPack(params.get("pack")!);}
    else if(params.get("level")){const id=params.get("level")!;const body=await json(`${API}/levels/${encodeURIComponent(id)}`);if(body.game_id&&body.game_id!=="platformer")throw Error("level belongs to another game");load(checked(body.level??body),UUID.test(id)?id:null);}
    else if(params.has("sample")){const n=Math.max(1,Math.min(SAMPLES.length,Number(params.get("sample"))||1));load(SAMPLES[n-1]!,null,n);}
    else {const body=await json(`${location.origin}/levels-latest?game=platformer&limit=30`);if(!Array.isArray(body.levels)||!body.levels.length)throw Error("no live trails yet");playlist=(body.levels as Array<{level_id:string;level:unknown}>).map(r=>({level_id:r.level_id,level:checked(r.level)}));load(playlist[0]!.level,playlist[0]!.level_id);}
  }catch(e){load(SAMPLES[0]!,null,1);notice(`Live trail unavailable (${e instanceof Error?e.message:String(e)}). This is a labeled practice trail.`);}
  if(params.get("autoplay")==="1")autoplay();
}
window.addEventListener("pagehide",()=>{if(started&&state?.status==="playing")event("quit",true);});
declare global{interface Window{mosslightTrails:{state():(PlayState&{level_id:string|null})|null;step(p:Pos):void;steer(dir:number):void;autoplay():void;restart():void;};}}
window.mosslightTrails={state:()=>state?({...state,position:{...state.position},collected:[...state.collected],level_id:levelId}):null,step:take,steer,autoplay,restart:()=>load(level,levelId,sample)};
void boot();
