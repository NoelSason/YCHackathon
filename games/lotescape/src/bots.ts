import { axisDirections, legalMoves, move, type Level, type State } from "./engine.js";
import { solveLevel, type Solution } from "./solver.js";

//   human   follows a shortest solution, but now and then backs a car up one cell by mistake and
//           then undoes it. Each mistake costs exactly two moves (the solver's own cost model:
//           a back-step and its undo), so the win rate falls smoothly as move_limit tightens.
//           Crowded lots cause more mistakes. This is the reference bot for tuning.
//   search  the exact solver: wins whenever move_limit >= the fewest moves. Always 0% or 100%.
//   random  slides random cars
export const BOTS = ["human", "search", "random"] as const;

function random(seed: number) { return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// One exact solve per lot, reused across seeds: the solver harness plays the same lot hundreds of
// times. Keyed by the lot's layout only (the title and move_limit don't change the solution).
const solved = new Map<string, Solution>();
function shortest(level: Level): Solution {
  const key = `${level.size}|${JSON.stringify(level.vehicles)}`;
  let s = solved.get(key);
  if (!s) {
    s = solveLevel(level);
    if (solved.size >= 64) solved.delete(solved.keys().next().value!);
    solved.set(key, s);
  }
  return s;
}

/** Chance of a mistake before each planned move: more cars, more ways to misread the lot. */
export function mistakeChance(level: Level): number {
  return Math.min(0.25, 0.03 + 0.01 * level.vehicles.length);
}

/** A legal one-cell back-step (away from the car's exit) and its undo, or null if none exists. */
function backStep(level: Level, state: State, rand: () => number): State | null {
  const options: State[] = [];
  for (const v of state.vehicles) {
    const [a, b] = axisDirections(v);
    const away = v.exit === a ? b : a;
    const out = move(level, state, v.id, away);
    if (out === state) continue;
    const back = move(level, out, v.id, v.exit);
    if (back !== out && back.vehicles.length === state.vehicles.length) options.push(back);
  }
  return options.length ? options[Math.floor(rand() * options.length)]! : null;
}

export function playOut(level: Level, bot: string, seed: number) {
  if (bot === "search") {
    const s = shortest(level);
    if (s.solvable && s.inputs) return { won: s.min_moves! <= level.move_limit, moves_used: s.min_moves!, detail: { bot, explored: s.explored } };
  }
  const rand = random(seed);
  if (bot === "human") {
    const s = shortest(level);
    let state: State = { vehicles: level.vehicles.map((v) => ({ ...v })), moves: 0, won: level.vehicles.length === 0 };
    if (!s.solvable || !s.inputs) return { won: false, moves_used: 0, detail: { bot, unsolvable: true } };
    const chance = mistakeChance(level);
    let mistakes = 0;
    for (const step of s.inputs) {
      // A mistake leaves the lot exactly as it was, so the plan stays valid; it only costs moves.
      // At most one mistake per planned move. A person doesn't know the budget while playing, so
      // mistakes don't depend on the moves left.
      if (!state.won && state.moves < level.move_limit && rand() < chance) {
        const detour = backStep(level, state, rand);
        if (detour) { state = detour; mistakes++; }
      }
      if (state.moves >= level.move_limit) break;
      state = move(level, state, step.id, step.direction);
    }
    return { won: state.won && state.moves <= level.move_limit, moves_used: state.moves, detail: { bot, mistakes } };
  }
  let state: State = { vehicles: level.vehicles.map((v) => ({ ...v })), moves: 0, won: level.vehicles.length === 0 };
  while (!state.won && state.moves < level.move_limit) {
    const moves = legalMoves(level, state); if (!moves.length) break;
    const action = moves[Math.floor(rand() * moves.length)]!;
    state = move(level, state, action.id, action.direction);
  }
  return { won: state.won, moves_used: state.moves, detail: { bot } };
}
