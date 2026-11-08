import assert from "node:assert/strict";
import { test } from "node:test";
import { adapter, validateLevel } from "../adapter/index.js";
import { initialState, legalMoves, move, slide, slideLimit, type Level } from "../src/engine.js";
import { LEVELS } from "../src/levels.js";
import { solveLevel } from "../src/solver.js";

// A small lot: a horizontal car that exits right, blocked by a vertical truck that exits down.
const lot: Level = { title: "Test lot", size: 6, move_limit: 20, vehicles: [
  { id: "red", x: 0, y: 2, length: 2, axis: "h", exit: "right", color: "coral" },
  { id: "truck", x: 3, y: 0, length: 3, axis: "v", exit: "down", color: "violet" },
] };

test("vehicles move only along their own axis", () => {
  const s = initialState(lot);
  assert.equal(move(lot, s, "red", "up"), s);
  assert.equal(move(lot, s, "red", "down"), s);
  assert.equal(move(lot, s, "truck", "left"), s);
  assert.equal(move(lot, s, "truck", "right"), s);
});

test("a vehicle cannot pass through another", () => {
  let s = initialState(lot);
  s = move(lot, s, "red", "right"); // red now covers x 1-2
  assert.equal(s.vehicles.find((v) => v.id === "red")?.x, 1);
  assert.equal(move(lot, s, "red", "right"), s, "truck at x=3 blocks the red car");
  assert.deepEqual(slideLimit(lot, s, "red", "right"), { steps: 0, exits: false });
});

test("the end opposite the exit is a wall", () => {
  const s = initialState(lot);
  assert.equal(move(lot, s, "red", "left"), s, "red is at x=0 and exits right, so it cannot leave left");
  assert.equal(move(lot, s, "truck", "up"), s, "truck is at y=0 and exits down, so it cannot leave up");
});

test("a vehicle leaves through its marked exit and the lot is won when empty", () => {
  let s = initialState(lot);
  assert.deepEqual(slideLimit(lot, s, "truck", "down"), { steps: 4, exits: true });
  s = slide(lot, s, "truck", "down", 4);
  assert.equal(s.vehicles.some((v) => v.id === "truck"), false);
  assert.equal(s.moves, 4, "each cell is one move");
  assert.deepEqual(slideLimit(lot, s, "red", "right"), { steps: 5, exits: true });
  s = slide(lot, s, "red", "right", 99);
  assert.equal(s.won, true);
  assert.equal(s.moves, 9);
});

test("slide stops at a blocker and counts only the cells travelled", () => {
  const s = slide(lot, initialState(lot), "red", "right", 5);
  assert.equal(s.vehicles.find((v) => v.id === "red")?.x, 1);
  assert.equal(s.moves, 1);
});

test("the solver finds the shortest step count and its inputs replay to a win", () => {
  const solved = solveLevel(lot);
  assert.equal(solved.solvable, true);
  assert.equal(solved.min_moves, 9);
  let s = initialState(lot);
  for (const input of solved.inputs!) s = move(lot, s, input.id, input.direction);
  assert.equal(s.won, true);
});

test("the solver reports an unfinished search as truncated, not unsolvable", () => {
  const solved = solveLevel(LEVELS[1]!, 5);
  assert.equal(solved.solvable, false);
  assert.equal(solved.truncated, true);
});

test("an impossible lot is unsolvable", () => {
  // Two horizontal cars in one row, both trying to leave through each other.
  const stuck: Level = { title: "Stuck", size: 5, move_limit: 30, vehicles: [
    { id: "a", x: 0, y: 0, length: 2, axis: "h", exit: "right", color: "coral" },
    { id: "b", x: 3, y: 0, length: 2, axis: "h", exit: "left", color: "mint" },
  ] };
  const solved = solveLevel(stuck);
  assert.equal(solved.solvable, false);
  assert.equal(solved.truncated, undefined);
  assert.deepEqual(validateLevel(stuck), { ok: false, errors: ["all vehicles cannot reach an exit"] });
});

test("the authored lots still validate, solve within their limit, and replay", () => {
  for (const level of LEVELS) {
    assert.deepEqual(validateLevel(level), { ok: true }, level.title);
    const result = adapter.solve?.(level);
    assert.ok(result, "the adapter exposes solve");
    assert.equal(result.solvable, true, level.title);
    assert.ok((result.min_moves ?? Infinity) <= level.move_limit, level.title);
    let s = initialState(level);
    for (const input of result.inputs as Array<{ id: string; direction: "left" | "right" | "up" | "down" }>) s = move(level, s, input.id, input.direction);
    assert.equal(s.won, true, level.title);
  }
});

test("level JSON keeps its saved shape (a stored level round-trips through JSON)", () => {
  const stored = JSON.parse(JSON.stringify(LEVELS[0])) as unknown;
  assert.deepEqual(validateLevel(stored), { ok: true });
  assert.deepEqual(Object.keys(stored as object).sort(), ["move_limit", "size", "title", "vehicles"]);
});

test("the adapter rejects overlaps, exits off the vehicle's axis, and over-budget limits", () => {
  const overlap = { ...lot, vehicles: [...lot.vehicles, { id: "blue", x: 3, y: 1, length: 2, axis: "h", exit: "left", color: "lagoon" }] };
  assert.equal(validateLevel(overlap).ok, false);
  const offAxis = { ...lot, vehicles: [{ ...lot.vehicles[0]!, exit: "up" }, lot.vehicles[1]!] };
  assert.equal(validateLevel(offAxis).ok, false);
  assert.deepEqual(validateLevel({ ...lot, move_limit: 8 }), { ok: false, errors: ["clearing the lot needs 9 moves, above move_limit"] });
});

test("legal moves never include a move the engine rejects", () => {
  const s = initialState(LEVELS[1]!);
  for (const m of legalMoves(LEVELS[1]!, s)) assert.notEqual(move(LEVELS[1]!, s, m.id, m.direction), s);
});

test("bots: search wins the authored lots, random is deterministic per seed", () => {
  for (const level of LEVELS) assert.equal(adapter.simulate(level, "search", 1).won, true);
  assert.deepEqual(adapter.simulate(LEVELS[0]!, "random", 7), adapter.simulate(LEVELS[0]!, "random", 7));
});
