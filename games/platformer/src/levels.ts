import type { PlatformLevel } from "./engine.js";

/** New original terrain, not a fork or copied game layout. Every column has a reachable ledge. */
export function makeTrail(index: number): PlatformLevel {
  const width = 14 + (index % 4) * 2, height = 10;
  const ground = Array.from({length:width},(_,x) => x < 2 || x >= width-2 ? 7 : 4 + ((Math.floor(x / (2+index%2))+index+Math.floor(index/4)*(x%3)) % 4));
  const map = Array.from({length:height},()=>Array<string>(width).fill("."));
  for (let x=0;x<width;x++) for(let y=ground[x]!+1;y<height;y++) map[y]![x]="#";
  for (let x=3;x<width-2;x+=3) map[ground[x]!]![x]="C";
  map[ground[1]!]![1]="S";
  map[ground[width-2]!]![width-2]="G";
  // Thorns sit on a separate upper ledge; legal landing tiles remain governed by neighbors().
  if (index>=2) { const x=5; map[1]![x]="^"; map[2]![x]="#"; }
  const names=["Lantern Meadow","Fernstep Crossing","The Moss Stair","Moonstone Rise","Firefly Hollow"];
  return {name:names[index-1]??`Mosslight Trail ${String(index).padStart(3,"0")}`,map:map.map(r=>r.join("")),jump_height:3,fall_limit:4};
}
export const SAMPLES = Array.from({length:5},(_,i)=>makeTrail(i+1));
