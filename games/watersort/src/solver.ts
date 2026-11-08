// Exact solver for Splash Sort: breadth-first search over positions, so the first solution
// found uses the fewest pours. Positions that differ only by tube order count as one.
import { applyPour, isSolved, type Level, stateKey, toTubes, type Tubes, usefulPours } from "./engine.js";

export interface SolveResult {
  solvable: boolean;
  min_moves?: number;
  inputs?: Array<[from: number, to: number]>; // one shortest solution, as tube indexes
  states: number;                             // positions explored
}

export class SolverLimitError extends Error {}

export const DEFAULT_MAX_STATES = 400_000;

// Positions are stored as compact strings (one char per unit, "|" between tubes) to keep memory low.
const encode = (t: Tubes): string => t.map((tube) => String.fromCharCode(...tube.map((c) => 97 + c))).join("|");
const decode = (s: string): Tubes => s.split("|").map((tube) => Array.from(tube, (ch) => ch.charCodeAt(0) - 97));

export function solveLevel(level: Level, maxStates = DEFAULT_MAX_STATES): SolveResult {
  const cap = level.capacity;
  const start = toTubes(level);
  if (isSolved(start, cap)) return { solvable: true, min_moves: 0, inputs: [], states: 1 };

  const nodes: string[] = [encode(start)];
  const parent: number[] = [-1];
  const moves: number[] = [-1]; // from * 64 + to
  const seen = new Set<string>([stateKey(start)]);

  for (let i = 0; i < nodes.length; i++) {
    const tubes = decode(nodes[i]!);
    for (const p of usefulPours(tubes, cap)) {
      const next = applyPour(tubes, p.from, p.to, p.amount);
      const key = stateKey(next);
      if (seen.has(key)) continue;
      seen.add(key);
      nodes.push(encode(next));
      parent.push(i);
      moves.push(p.from * 64 + p.to);
      if (isSolved(next, cap)) {
        const inputs: Array<[number, number]> = [];
        for (let n = nodes.length - 1; n > 0; n = parent[n]!) inputs.push([Math.floor(moves[n]! / 64), moves[n]! % 64]);
        inputs.reverse();
        return { solvable: true, min_moves: inputs.length, inputs, states: nodes.length };
      }
      if (nodes.length >= maxStates) {
        throw new SolverLimitError(
          `solver stopped after ${maxStates} positions without an answer; use fewer colors or tubes`,
        );
      }
    }
  }
  return { solvable: false, states: nodes.length };
}
