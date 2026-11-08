import assert from "node:assert/strict";
import { test } from "node:test";
import { wilson95 } from "../src/stats.js";

const close = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("wilson95 matches known values", () => {
  const half = wilson95(50, 100);
  close(half.low, 0.4038);
  close(half.high, 0.5962);

  const none = wilson95(0, 10);
  assert.equal(none.low, 0);
  close(none.high, 0.2775);

  const all = wilson95(10, 10);
  close(all.low, 0.7225);
  assert.equal(all.high, 1);
});

test("wilson95 with no runs is the whole range", () => {
  assert.deepEqual(wilson95(0, 0), { low: 0, high: 1 });
});
