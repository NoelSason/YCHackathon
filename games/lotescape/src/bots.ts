import { legalMoves, move, type Level } from "./engine.js";
import { solveLevel } from "./solver.js";
export const BOTS = ["search", "random"] as const;
function random(seed: number) { return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function playOut(level: Level, bot: string, seed: number) {
  const solved = bot === "search" ? solveLevel(level) : undefined;
  if (solved?.solvable && solved.inputs) return { won: solved.min_moves! <= level.move_limit, moves_used: solved.min_moves!, detail: { bot, explored: solved.explored } };
  let state = { vehicles: level.vehicles.map((v) => ({ ...v })), moves: 0, won: level.vehicles.length === 0 };
  const rand = random(seed);
  while (!state.won && state.moves < level.move_limit) {
    const moves = legalMoves(level, state); if (!moves.length) break;
    const action = moves[Math.floor(rand() * moves.length)]!;
    state = move(level, state, action.id, action.direction);
  }
  return { won: state.won, moves_used: state.moves, detail: { bot } };
}
