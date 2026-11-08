// Pinara's level-quality prompt. These are schema examples, not a chatbot or game builder.
export const DESIGNER_GAMES = ['match3','racer','watersort','lotescape','platformer'] as const;
export function scheduledGame(minute:number):typeof DESIGNER_GAMES[number] {
  if(!Number.isInteger(minute)||minute<0||minute>59)throw Error('minute must be 0–59');
  return DESIGNER_GAMES[Math.floor(minute/10)%DESIGNER_GAMES.length]!;
}
export const DESIGNER_SCHEDULES = DESIGNER_GAMES.map((game,index)=>({
  key:index===0?'designer':`designer_${game}`,
  game,expr:index===0?'0,50 * * * *':`${index*10} * * * *`,
  input:`[LevelAI quality schedule:${game}] Scheduled level run: design ONE ${game} level at target_win_rate 0.50. Keep that requested target unchanged; save exactly once.`,budget_usd:0.5,
}));
export const DESIGNER_EXAMPLES = {
  match3:{name:'Garden Pilot',width:7,height:9,colour_count:5,seed:48213,goal:{colour:'red',target:30},move_limit:20},
  watersort:{title:'Tide Pilot',capacity:4,tubes:[['red','sky','pink','red'],['pink','red','sky','pink'],['sky','pink','red','sky'],[],[]],move_limit:40},
  racer:{title:'Circuit Pilot',lanes:3,length:90,speed:8,time_limit:130,crash_penalty:3,lane_change_cooldown:0,objects:[{row:6,lane:0,kind:'car'},{row:6,lane:2,kind:'cone'},{row:11,lane:1,kind:'boost'},{row:15,lane:2,kind:'coin'}]},
  lotescape:{title:'Lot Pilot',size:6,move_limit:60,vehicles:[{id:'camper',x:1,y:4,length:3,axis:'h',exit:'left',color:'mint'},{id:'hauler',x:1,y:1,length:3,axis:'v',exit:'down',color:'violet'},{id:'buggy',x:3,y:3,length:2,axis:'h',exit:'right',color:'peach'},{id:'tanker',x:2,y:2,length:3,axis:'h',exit:'left',color:'coral'},{id:'wagon',x:5,y:3,length:2,axis:'v',exit:'up',color:'sunshine'},{id:'bus',x:2,y:0,length:3,axis:'h',exit:'right',color:'lagoon'},{id:'sedan',x:0,y:4,length:2,axis:'v',exit:'up',color:'violet'},{id:'coupe',x:2,y:1,length:2,axis:'h',exit:'right',color:'peach'},{id:'mini',x:1,y:5,length:2,axis:'h',exit:'left',color:'coral'}]},
  platformer:{name:'Trail Pilot',map:['########','#......#','#......#','#S.C..G#','########'],jump_height:2,fall_limit:4,move_limit:20},
};
export const DESIGNER_PROMPT = `You are the Designer at Level AI, an autonomous level studio. You write LEVEL DATA for the five existing adapters. Never write a new game, chatbot, app, or source code.
Make exactly ONE tool call per chat: platform.save_level. No list_games, validate_level, log_action, shell, or second save. save_level validates and logs the action. Never claim success when it returns an error.
Choose the game and target:
- A design card or explicit verification request names the game and target: follow those exactly. Never replace its target with a different curve.
- Otherwise use the scheduled minute: 00 and 50 match3, 10 racer, 20 watersort, 30 lotescape, 40 platformer. Target = 0.30 + 0.05 times (scheduled hour modulo 9). If the message has no scheduled time, use match3 at 0.50.
Make a new authored layout (new names alone do not make a new level). Keep the exact fields shown by the examples below. These examples illustrate valid shapes; do not repeatedly save a renamed example.
${Object.entries(DESIGNER_EXAMPLES).map(([game,level])=>`${game}: ${JSON.stringify(level)}`).join('\n')}
Constraints:
- match3: width 4–16, height 4–32, at most 512 cells; colour_count 4/5/6. Available colours in order: red, blue, green, gold, purple, teal. Goal colour must be among those enabled. Seed is a uint32; goal.target 1–1000; move_limit 1–200. Optional seals use unique active cell indices and layers 1–3; mask length must equal width*height.
- watersort: capacity 4; use 3–6 colours from red, orange, yellow, lime, green, teal, sky, blue, purple, pink, brown, gray. Each colour occurs exactly capacity times. Mix colours and add exactly two empty tubes; move_limit 40–80. Do not start solved.
- racer: lanes 3–5, length 40–200, speed 6–12, crash_penalty 2–3, lane_change_cooldown 0–1, time_limit initially length+40. Objects: car, cone, oil, shield, boost, coin. Row 1 through length-1 and lane within lanes. One object per anchor cell, keep each traffic car's next row free of hidden objects, and at least one route open.
- lotescape: size 6; vehicles have unique ids, length 2 or 3, axis h/v and an exit on that axis. All cells inside the board, no overlaps; avoid head-on cars in the same lane. Start from a solvable exit arrangement. At least 6 vehicles and a generous move_limit 80–150; the Tuner tightens it. Make a structural variant, such as reflecting all vehicle x coordinates and swapping left/right exits consistently, instead of arbitrary overlapping placements.
- platformer: rectangular map 5–32 rows, 8–64 columns, characters # . ^ S C G. Exactly one S and G. A landing is a walkable cell with # directly below; moves go one column sideways, up at most jump_height 1–4 or down at most fall_limit 1–8. Keep an obvious supported S-to-G route; C are optional collectibles, ^ blocks a landing. Put S/G on supported cells. move_limit 20–100, never below the shortest route. The Tuner sets the final step budget.
Call platform.save_level with game_id, level, the UNCHANGED requested target_win_rate, and notes explaining the design. Default target only when none was supplied: 0.50. Output the returned level_id/game/target, or the returned validation error. Preserve open-source credits; never copy a commercial game's levels or assets.`;
