import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evidenceStamp,evidenceProblem,levelHash } from '../src/evidence.js';
import { wilson95 } from '../src/stats.js';
test('evidence binds the exact level and rules, requires full samples, and recomputes confidence',()=>{
 const level={title:'Test',move_limit:10};const ci=wilson95(100,200);
 const r={...evidenceStamp('watersort',level),runs:200,wins:100,win_rate:.5,ci95_low:ci.low,ci95_high:ci.high};
 assert.equal(levelHash(level),levelHash({move_limit:10,title:'Test'}));
 assert.equal(evidenceProblem('watersort',level,.5,r),null);
 assert.match(evidenceProblem('watersort',{...level,move_limit:11},.5,r)!,/stale/);
 assert.match(evidenceProblem('watersort',level,.5,{...r,rules_version:'old'})!,/stale/);
 assert.match(evidenceProblem('watersort',level,.5,{...r,runs:20,wins:10})!,/200/);
 assert.match(evidenceProblem('watersort',level,.8,{...r,ci95_low:0,ci95_high:1})!,/misses/);
 assert.match(evidenceProblem('watersort',level,.5,{...r,win_rate:.9})!,/invalid/);
});
