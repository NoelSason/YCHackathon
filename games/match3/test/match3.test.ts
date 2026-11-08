// Rule tests for the match-3 engine and adapter. Run from solver/ (it has tsx):
//   cd solver && node --import tsx --test ../games/match3/test/*.test.ts
// See games/match3/RULES.md for the rules these check.
import assert from "node:assert/strict";
import { test } from "node:test";
import { adapter, levelOptions, PRACTICE_LEVELS } from "../adapter/index.js";
import { advanceTicks, applyAction, createGame, legalActions, statusOf } from "../engine/houseki-gem-swap/gem-swap/engine.js";
import { findMatches, listLegalSwaps } from "../engine/houseki-gem-swap/gem-swap/board.js";
import type { GameState } from "../engine/houseki-gem-swap/gem-swap/types-state.js";
import type { Gem, GemColour } from "../engine/houseki-gem-swap/gem-swap/types-pieces.js";

const C: Record<string, GemColour> = { r: "red", b: "blue", g: "green", y: "gold" };

/** A 4×4 board with no match and no legal swap: every adjacent swap leaves all runs below three. */
const DEAD = ["rrbb", "ggyy", "bbrr", "yygg"];

function deadState(moveLimit: number, swapCount = 0): GameState {
  const base = createGame({ width: 4, height: 4, colourCount: 4, seed: "dead", tools: false, mode: "challenge", challenge: { goals: [{ kind: "collect", colour: "red", target: 99 }], moveLimit } });
  const board: Gem[] = DEAD.join("").split("").map((k, i) => Object.freeze({ id: 1000 + i, colour: C[k]! }));
  // Hand the engine the dead board as the result of a refill, so the next tick runs its end-of-move checks.
  return Object.freeze({ ...base, board: Object.freeze(board), phase: "refill" as const, wave: 1, swapCount });
}

function settle(s: GameState): { state: GameState; types: string[] } {
  const types: string[] = [];
  for (let i = 0; i < 3600 && s.phase !== "ready" && s.phase !== "finished"; i++) {
    const t = advanceTicks(s, 1);
    types.push(...t.events.map((e) => e.type));
    s = t.state;
  }
  return { state: s, types };
}

const colours = (s: GameState) => s.board.flatMap((g) => (g ? [g.colour] : [])).sort();

test("the test board really is dead", () => {
  const s = { ...deadState(10), phase: "ready" as const };
  assert.equal(findMatches(s.board, s.settings).length, 0);
  assert.equal(listLegalSwaps(s).length, 0);
});

test("a dead board with moves left is reshuffled, not lost (Level AI engine change)", () => {
  const before = deadState(10);
  const { state, types } = settle(before);
  assert.equal(state.phase, "ready");
  assert.equal(state.outcome, null);
  assert.ok(types.includes("board-reshuffled"));
  assert.equal(state.assisted, false, "an automatic shuffle is not player assistance");
  assert.deepEqual(colours(state), colours(before), "a shuffle keeps the same tiles");
  assert.equal(findMatches(state.board, state.settings).length, 0, "no free matches after a shuffle");
  assert.ok(listLegalSwaps(state).length > 0, "the shuffled board has a legal swap");
  assert.equal(statusOf(state).remainingMoves, 10, "a shuffle costs no move");
});

test("the move limit still ends the level when the last move leaves a dead board", () => {
  const { state } = settle(deadState(5, 5));
  assert.equal(state.outcome, "lost");
});

test("the automatic shuffle is deterministic for a seed", () => {
  const a = settle(deadState(10)).state.board.map((g) => g?.id);
  const b = settle(deadState(10)).state.board.map((g) => g?.id);
  assert.deepEqual(a, b);
});

test("a swap that makes no match is rejected and changes nothing", () => {
  const s = settle(createGame(levelOptions(PRACTICE_LEVELS[0]!, 1))).state;
  const legal = new Set(legalActions(s).flatMap((a) => (a.kind === "swap" ? [`${a.from}-${a.to}`] : [])));
  const w = s.settings.width;
  let tried = 0;
  for (let i = 0; i < s.board.length; i++) {
    for (const j of [i + 1, i + w]) {
      if (j >= s.board.length || (j === i + 1 && j % w === 0) || legal.has(`${i}-${j}`)) continue;
      if (!s.settings.mask[i] || !s.settings.mask[j]) continue;
      const t = applyAction(s, { kind: "swap", from: i, to: j });
      assert.equal(t.accepted, false);
      assert.equal(t.state, s, "rejected swaps keep the same state object");
      tried++;
    }
  }
  assert.ok(tried > 0);
});

test("a legal swap costs one move and the board settles with no leftover matches", () => {
  let s = settle(createGame(levelOptions(PRACTICE_LEVELS[0]!, 2))).state;
  const swap = legalActions(s).find((a) => a.kind === "swap")!;
  const t = applyAction(s, swap);
  assert.equal(t.accepted, true);
  s = settle(t.state).state;
  assert.equal(s.swapCount, 1);
  assert.equal(statusOf(s).remainingMoves, PRACTICE_LEVELS[0]!.move_limit - 1);
  assert.equal(findMatches(s.board, s.settings).length, 0);
  assert.ok(s.board.every((g, i) => (s.settings.mask[i] ? g !== null : g === null)), "every playable cell is refilled");
});

test("practice levels are valid adapter levels and the bots can win them", () => {
  for (const { id, ...level } of PRACTICE_LEVELS) {
    assert.deepEqual(adapter.validate(level), { ok: true }, id);
    let wins = 0;
    for (let seed = 0; seed < 10; seed++) if (adapter.simulate(level, "greedy", seed).won) wins++;
    assert.ok(wins >= 8, `${id}: greedy won ${wins}/10`);
  }
});

test("level JSON without mask or seals still maps to the same engine settings", () => {
  const level = { name: "Eval Garden", width: 7, height: 9, colour_count: 5 as const, seed: 12345, goal: { colour: "red" as const, target: 30 }, move_limit: 20 };
  assert.deepEqual(adapter.validate(level), { ok: true });
  assert.deepEqual(levelOptions(level, 7), {
    width: 7, height: 9, colourCount: 5, seed: "12345:7", tools: false, mode: "challenge",
    challenge: { goals: [{ kind: "collect", colour: "red", target: 30 }], moveLimit: 20 },
  });
});
