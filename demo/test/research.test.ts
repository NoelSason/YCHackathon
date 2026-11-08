import { test } from "node:test";
import assert from "node:assert/strict";
import { loadResearch, sampleResearch, totalsOf } from "../src/feeds.ts";

test("rehearsal research is newest first, totalled, and stable within a 20-minute slot", () => {
  const now = Date.parse("2026-11-08T02:14:00Z");
  const a = sampleResearch(now);
  const b = sampleResearch(now + 60_000);
  assert.deepEqual(a, b);
  assert.equal(a.runs.length, 18);
  assert.ok(a.runs.every((r, i) => i === 0 || r.at < a.runs[i - 1]!.at));
  assert.ok(Date.parse(a.runs[0]!.at) <= now);
  assert.deepEqual(a.totals, totalsOf(a.runs));
  for (const r of a.runs) {
    assert.equal(r.topGame === null, r.gamesWithEvidence === 0);
    if (r.topReason) assert.match(r.topReason, /^\d+ of the \d+ newest Google Play reviews of .+\.$/);
  }
});

test("research without a database is marked unavailable", async () => {
  const r = await loadResearch(undefined);
  assert.equal(r.available, false);
  assert.equal(r.totals.passes, 0);
  assert.deepEqual(r.runs, []);
});
