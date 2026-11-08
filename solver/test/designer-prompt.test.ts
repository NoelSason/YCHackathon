import assert from 'node:assert/strict';import{test}from'node:test';
import{DESIGNER_EXAMPLES,DESIGNER_GAMES,DESIGNER_PROMPT,scheduledGame}from'../../platform/naive/src/designer-prompt.js';
import{getAdapter}from'../../platform/mcp/src/adapters.js';
test('Designer covers all five adapters with valid examples and preserves one-call and target rules',()=>{
 assert.deepEqual([...new Set([0,10,20,30,40,50].map(scheduledGame))].sort(),[...DESIGNER_GAMES].sort());
 for(const[game,level]of Object.entries(DESIGNER_EXAMPLES))assert.deepEqual(getAdapter(game)!.validate(level),{ok:true},game);
 assert.match(DESIGNER_PROMPT,/exactly ONE tool call/);assert.match(DESIGNER_PROMPT,/UNCHANGED requested target_win_rate/);
 assert.throws(()=>scheduledGame(60));
});
