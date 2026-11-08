import { DIRECTIONS, initialState, legalMoves, move, stateKey, type Direction, type Level } from "./engine.js";
import { solveFrom, solveLevel } from "./solver.js";

export const BOTS = ["human", "solver", "random"] as const;
function randomFor(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) | 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function playOut(level: Level, bot: string, seed: number) {
  if (bot === "solver") { const solution = solveLevel(level); return { won: solution.solvable && (solution.min_moves ?? Infinity) <= level.move_limit, moves_used: Math.min(solution.min_moves ?? level.move_limit, level.move_limit), detail: { seed, explored: solution.explored } }; }
  if (bot !== "random" && bot !== "human") throw new Error(`unknown bot: ${bot}`);
  const random = randomFor(seed), state = initialState(level);
  let current = state;
  const seen = new Set([stateKey(current)]);
  let plan = bot === "human" ? solveFrom(level, current) : undefined;
  let slips = 0;
  while (!current.won && current.moves < level.move_limit) {
    if (bot === "human" && (!plan?.solvable || (plan.min_moves ?? Infinity) + current.moves > level.move_limit)) break;
    const choices = DIRECTIONS.map((d) => ({ d, s: move(level, current, d) })).filter((x) => x.s !== current && (bot === "human" || !seen.has(stateKey(x.s))));
    if (!choices.length) break;
    const planned = bot === "human" ? plan!.inputs![0] : undefined;
    const slip = bot === "human" && choices.length > 1 && random() < 0.08;
    const chosen = slip ? choices.filter((x) => x.d !== planned)[Math.floor(random() * (choices.length - 1))]! : choices.find((x) => x.d === planned) ?? choices[Math.floor(random() * choices.length)]!;
    current = chosen.s; seen.add(stateKey(current));
    if (slip) { slips++; plan = solveFrom(level, current); }
    else if (plan?.inputs) { plan = { ...plan, inputs: plan.inputs.slice(1), min_moves: (plan.min_moves ?? 1) - 1 }; }
  }
  return { won: current.won, moves_used: current.moves, detail: { seed, visited: seen.size, slips: bot === "human" ? slips : undefined } };
}
