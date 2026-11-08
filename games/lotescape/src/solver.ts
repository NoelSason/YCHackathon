import { axisDirections, EXITS, BLOCKED, stepAlongLane, type Direction, type Level } from "./engine.js";
export interface Solution { solvable: boolean; min_moves?: number; inputs?: Array<{ id: string; direction: Direction }>; explored: number; /** True when the search hit `maxStates` before finishing, so "not solvable" is unproven. */ truncated?: boolean }

/**
 * Exact shortest-move search. Each vehicle must travel a fixed net distance to its exit, so every
 * solution costs that distance plus two moves for each step a vehicle takes away from its exit
 * (one out, one to undo it). Minimising moves is therefore minimising those back-steps, which a
 * 0-1 breadth-first search does exactly: states are settled in layers by back-steps used, a step
 * toward the exit stays in the current layer, and a step back opens the next one. The first cleared
 * lot it reaches is optimal, and it only has to look at states with fewer back-steps than the
 * answer, not every state within the answer's move count.
 *
 * A state is each vehicle's position along its own axis (its lane never changes), packed into one
 * number at 4 bits per vehicle, 0 meaning "already left". Legality goes through the engine's
 * `stepAlongLane`, the same rule the browser uses.
 */
export function solveLevel(level: Level, maxStates = 250_000): Solution {
  const size = level.size, vehicles = level.vehicles, n = vehicles.length;
  if (n === 0) return { solvable: true, min_moves: 0, inputs: [], explored: 1 };
  const horizontal = vehicles.map((v) => v.axis === "h");
  const directions = vehicles.map((v) => axisDirections(v));
  // Index (0 or 1) of the direction that heads toward each vehicle's exit.
  const towardExit = vehicles.map((v, j) => (directions[j]![1] === v.exit ? 1 : 0));
  const probes = vehicles.map((v) => ({ ...v }));
  const packed = n <= 13; // 4 bits × 13 = 52 bits, exact in a double.
  const pow = Array.from({ length: n }, (_, i) => 16 ** i);
  const keyOf = (pos: Int8Array): number | string => {
    if (!packed) return pos.join(",");
    let key = 0; for (let i = 0; i < n; i++) key += (pos[i]! + 1) * pow[i]!; return key;
  };

  // Every state seen: positions (n per state, -1 = left), best back-steps so far, and the move
  // that reached it with that cost.
  let pool = new Int8Array(n * 1024), cost = new Int16Array(1024), parent = new Int32Array(1024), via = new Int16Array(1024);
  let count = 0;
  const add = (pos: Int8Array) => {
    if (count === cost.length) {
      const grow = cost.length * 2;
      const p2 = new Int8Array(n * grow); p2.set(pool); pool = p2;
      const c2 = new Int16Array(grow); c2.set(cost); cost = c2;
      const a2 = new Int32Array(grow); a2.set(parent); parent = a2;
      const v2 = new Int16Array(grow); v2.set(via); via = v2;
    }
    pool.set(pos, count * n); return count++;
  };
  const start = new Int8Array(vehicles.map((v) => (v.axis === "h" ? v.x : v.y)));
  const first = add(start); cost[first] = 0; parent[first] = -1; via[first] = -1;
  const index = new Map<number | string, number>([[keyOf(start), first]]);
  const grid = new Int16Array(size * size), cur = new Int8Array(n);
  const occupied = (x: number, y: number) => grid[y * size + x] !== 0;
  let layer = [first], next: number[] = [], backSteps = 0, found = -1;

  while (layer.length && found < 0 && count <= maxStates) {
    while (layer.length && found < 0 && count <= maxStates) {
      const i = layer.pop()!;
      if (cost[i] !== backSteps) continue; // already settled more cheaply
      for (let j = 0; j < n; j++) cur[j] = pool[i * n + j]!;
      grid.fill(0);
      for (let j = 0; j < n; j++) {
        const at = cur[j]!; if (at < 0) continue;
        const v = vehicles[j]!, lane = horizontal[j] ? v.y : v.x;
        for (let k = 0; k < v.length; k++) grid[horizontal[j] ? lane * size + at + k : (at + k) * size + lane] = j + 1;
      }
      for (let j = 0; j < n && found < 0; j++) {
        const at = cur[j]!; if (at < 0) continue;
        const probe = probes[j]!; if (horizontal[j]) probe.x = at; else probe.y = at;
        for (let d = 0; d < 2; d++) {
          const to = stepAlongLane(size, probe, directions[j]![d]!, occupied);
          if (to === BLOCKED) continue;
          const c = backSteps + (d === towardExit[j] ? 0 : 1);
          cur[j] = to === EXITS ? -1 : to;
          const key = keyOf(cur);
          let s = index.get(key);
          if (s === undefined) { s = add(cur); index.set(key, s); cost[s] = 32767; }
          if (c < cost[s]!) {
            cost[s] = c; parent[s] = i; via[s] = j * 2 + d;
            (c === backSteps ? layer : next).push(s);
            if (to === EXITS && cur.every((p) => p < 0)) { found = s; cur[j] = at; break; }
          }
          cur[j] = at;
        }
      }
    }
    if (found < 0) { layer = next; next = []; backSteps++; }
  }
  if (found < 0) return count > maxStates ? { solvable: false, explored: index.size, truncated: true } : { solvable: false, explored: index.size };
  const inputs: Array<{ id: string; direction: Direction }> = [];
  for (let at = found; parent[at]! >= 0; at = parent[at]!) {
    const edge = via[at]!, j = edge >> 1;
    inputs.push({ id: vehicles[j]!.id, direction: directions[j]![edge & 1]! });
  }
  inputs.reverse();
  return { solvable: true, min_moves: inputs.length, inputs, explored: index.size };
}
