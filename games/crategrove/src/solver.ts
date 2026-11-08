import { DIRECTIONS, initialState, move, stateKey, type Direction, type Level } from "./engine.js";

export interface Solution { solvable: boolean; min_moves?: number; inputs?: Direction[]; explored: number }
export function solveFrom(level: Level, start: ReturnType<typeof initialState>, maxStates = 500_000): Solution {
  if (start.won) return { solvable: true, min_moves: 0, inputs: [], explored: 1 };
  const keys = [stateKey(start)], states = [start];
  const previous = new Map<string, { key: string; direction: Direction }>();
  const seen = new Set(keys);
  let found: string | undefined;
  for (let i = 0; i < states.length && states.length <= maxStates; i++) {
    const state = states[i]!, key = keys[i]!;
    for (const direction of DIRECTIONS) {
      const next = move(level, state, direction);
      if (next === state) continue;
      const nextKey = stateKey(next);
      if (seen.has(nextKey)) continue;
      seen.add(nextKey); previous.set(nextKey, { key, direction });
      if (next.won) { found = nextKey; break; }
      keys.push(nextKey); states.push(next);
    }
    if (found) break;
  }
  if (!found) return { solvable: false, explored: states.length };
  const inputs: Direction[] = [];
  let at = found;
  while (previous.has(at)) { const edge = previous.get(at)!; inputs.push(edge.direction); at = edge.key; }
  inputs.reverse();
  return { solvable: true, min_moves: inputs.length, inputs, explored: seen.size };
}
export function solveLevel(level: Level, maxStates = 500_000): Solution {
  return solveFrom(level, initialState(level), maxStates);
}
