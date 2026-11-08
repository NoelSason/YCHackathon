// The sample generator's game logic: Lot Escape's own generator, solver, and movement rule
// (games/lotescape/src), wrapped in the three operations of the Level AI Generator Protocol.
// A real studio writes this part for its own game; nothing here is part of the Level AI platform.
import { legalMoves, move, type Level, type State } from "../../games/lotescape/src/engine.js";
import { generateLevel } from "../../games/lotescape/src/generate.js";
import { solveLevel } from "../../games/lotescape/src/solver.js";
import { validateLevel } from "../../games/lotescape/adapter/index.js";

/** Difficulty 0–1 picks a notch on Lot Escape's ladder (1 = easiest) and how many spare moves the limit allows. */
export const MAX_NOTCH = 8;
export const notchFor = (difficulty: number): number => 1 + Math.round(clamp01(difficulty) * (MAX_NOTCH - 1));
/** Spare moves on top of the fewest possible: generous at 0, tight at 1. */
export const slackFor = (difficulty: number, minMoves: number): number => Math.max(1, Math.round(minMoves * (0.6 - 0.55 * clamp01(difficulty))));

function clamp01(x: number): number { return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0.5; }

export interface Generated { level: Level; meta: { notch: number; min_moves: number; move_limit: number; score: number; generator: string } }

export function generate(seed: number | string, difficulty: number): Generated {
  const notch = notchFor(difficulty);
  const g = generateLevel({ seed, difficulty: notch, timeLimitMs: 4000 });
  const min = g.rating.min_moves;
  const level: Level = { ...g.level, move_limit: Math.min(300, min + slackFor(difficulty, min)) };
  return { level, meta: { notch, min_moves: min, move_limit: level.move_limit, score: g.rating.score, generator: "Lot Escape sample generator" } };
}

/** Seeded randomness for the bot, so an evaluation can be replayed from its seed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** How often the casual player makes a random move instead of the best one. */
export const SLIP_RATE = 0.3;
export const BOT = "casual-player";

/**
 * One game by the "casual player": it plays the best move most of the time and a random legal move
 * 30% of the time, then plans again from wherever that left it. It loses when it runs out of moves.
 */
export function playOnce(level: Level, seed: number): { won: boolean; moves: number } {
  const rand = rng(seed);
  let state: State = { vehicles: level.vehicles.map((v) => ({ ...v })), moves: 0, won: level.vehicles.length === 0 };
  let plan: Array<{ id: string; direction: Level["vehicles"][number]["exit"] }> = [];
  while (!state.won && state.moves < level.move_limit) {
    if (rand() < SLIP_RATE) {
      const moves = legalMoves(level, state);
      if (!moves.length) break;
      const m = moves[Math.floor(rand() * moves.length)]!;
      state = move(level, state, m.id, m.direction);
      plan = [];
      continue;
    }
    if (!plan.length) {
      const s = solveLevel({ ...level, vehicles: state.vehicles }, 60_000);
      if (!s.solvable || !s.inputs?.length) break;
      plan = s.inputs;
    }
    const next = plan.shift()!;
    const after = move(level, state, next.id, next.direction);
    if (after === state) { plan = []; continue; }
    state = after;
  }
  return { won: state.won, moves: state.moves };
}

export function evaluate(level: Level, runs: number, seed: number) {
  const exact = solveLevel(level);
  let wins = 0;
  for (let i = 0; i < runs; i++) if (playOnce(level, seed + i).won) wins++;
  return { wins, runs, solvable: exact.solvable, ...(exact.min_moves !== undefined ? { min_moves: exact.min_moves } : {}), bot: BOT };
}

export function validate(level: unknown): { ok: boolean; errors: string[] } {
  const r = validateLevel(level);
  return r.ok ? { ok: true, errors: [] } : { ok: false, errors: r.errors };
}
