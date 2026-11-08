import { DIRECTIONS, initialState, move, stateKey, type Direction, type Level, type State } from "./engine.js";
export interface Solution { solvable: boolean; min_moves?: number; inputs?: Array<{ id: string; direction: Direction }>; explored: number; /** True when the search hit `maxStates` before finishing, so "not solvable" is unproven. */ truncated?: boolean }
export function solveLevel(level: Level, maxStates = 250_000): Solution {
  const start = initialState(level), startKey = stateKey(start);
  if (start.won) return { solvable: true, min_moves: 0, inputs: [], explored: 1 };
  const states: State[] = [start], keys = [startKey], seen = new Set([startKey]);
  const previous = new Map<string, { key: string; id: string; direction: Direction }>();
  let found: string | undefined;
  for (let i = 0; i < states.length && states.length <= maxStates; i++) {
    const state = states[i]!, key = keys[i]!;
    for (const vehicle of state.vehicles) for (const direction of DIRECTIONS) {
      const next = move(level, state, vehicle.id, direction);
      if (next === state) continue;
      const nextKey = stateKey(next);
      if (seen.has(nextKey)) continue;
      seen.add(nextKey); previous.set(nextKey, { key, id: vehicle.id, direction });
      if (next.won) { found = nextKey; break; }
      keys.push(nextKey); states.push(next);
    }
    if (found !== undefined) break;
  }
  if (found === undefined) return states.length > maxStates ? { solvable: false, explored: seen.size, truncated: true } : { solvable: false, explored: seen.size };
  const inputs: Array<{ id: string; direction: Direction }> = [];
  for (let at = found; previous.has(at);) { const edge = previous.get(at)!; inputs.push({ id: edge.id, direction: edge.direction }); at = edge.key; }
  inputs.reverse(); return { solvable: true, min_moves: inputs.length, inputs, explored: seen.size };
}
