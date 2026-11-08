// Catalog addressing only; no gameplay rules. Versioned repairs preserve original level URLs.
export type CatalogGame='watersort'|'racer'|'match3'|'lotescape'|'platformer';
export type Overrides=Partial<Record<CatalogGame,Record<string,string>>>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function originalCatalogId(game:CatalogGame,n:number):Promise<string>{
 if(!Number.isInteger(n)||n<1||n>1000)throw Error('catalog position must be 1–1000');
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`production-v1:1:${game}:${n}`));
 const h=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
 return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
export function checkedOverrides(value:unknown):Overrides{
 if(!value||typeof value!=='object')throw Error('invalid catalog override manifest');
 const v=value as {version?:unknown;games?:unknown};if(v.version!==1||!v.games||typeof v.games!=='object')throw Error('invalid manifest version');
 const out:Overrides={};for(const game of ['watersort','racer','match3','lotescape','platformer'] as const){
  const rows=(v.games as Record<string,unknown>)[game];if(rows===undefined)continue;
  if(!rows||typeof rows!=='object'||Array.isArray(rows))throw Error('invalid override game');
  const map:Record<string,string>={};for(const[k,id]of Object.entries(rows)){const n=Number(k);if(!Number.isInteger(n)||n<1||n>1000||String(n)!==k||typeof id!=='string'||!UUID.test(id))throw Error('invalid override position/id');map[k]=id;}out[game]=map;
 }return out;
}
let cached:Promise<Overrides>|undefined;
async function browserOverrides():Promise<Overrides>{
 if(typeof window==='undefined')return{};
 return cached??=(async()=>{const c=new AbortController(),timer=setTimeout(()=>c.abort(),2500);try{const r=await fetch('/games/catalog-overrides.json',{signal:c.signal,cache:'no-cache'});if(!r.ok)return{};return checkedOverrides(await r.json());}catch{return{}}finally{clearTimeout(timer)}})();
}
export async function catalogLevelId(game:CatalogGame,n:number,overrides?:Overrides):Promise<string>{
 const original=await originalCatalogId(game,n);const map=overrides??await browserOverrides();return map[game]?.[String(n)]??original;
}
