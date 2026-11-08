// Exact solver for Turbo Lanes: breadth-first search over (row, lane, cooldown, boost, stun),
// one tick per layer, using the game's own step(). The first state past the finish line gives the
// fastest possible time. Crashes are allowed (they only cost time), so every track can be finished;
// the question is whether it can be finished within the time limit.
import { type Action, buildGrid, finished, type Level, startState, step } from "./engine.js";

export interface SolveResult {
  min_ticks: number;   // fastest possible finish
  inputs: Action[];    // one fastest run, one action per tick
  crashes: number;     // crashes on that run (usually 0)
  states: number;
}

const ACTIONS: Action[] = [0, -1, 1];

export function solveLevel(level: Level): SolveResult {
  const grid = buildGrid(level);
  const key = (r: number, l: number, c: number, b: number, s: number) => ((((r * 8 + l) * 4 + c) * 8 + b) * 16 + s);
  const start = startState(level);
  type Node = { s: typeof start; parent: number; action: Action; crashes: number };
  const nodes: Node[] = [{ s: start, parent: -1, action: 0, crashes: 0 }];
  const seen = new Set<number>([key(start.row, start.lane, start.cooldown, start.boost, start.stun)]);

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    for (const a of ACTIONS) {
      if (a !== 0 && (node.s.stun > 0 || node.s.cooldown > 0)) continue; // same as 0: skip duplicate
      const { next, ev } = step(level, grid, node.s, a);
      const k = key(Math.min(next.row, level.length), next.lane, next.cooldown, next.boost, next.stun);
      if (seen.has(k)) continue;
      seen.add(k);
      nodes.push({ s: next, parent: i, action: a, crashes: node.crashes + (ev.crashed ? 1 : 0) });
      if (finished(level, next)) {
        const inputs: Action[] = [];
        for (let n = nodes.length - 1; n > 0; n = nodes[n]!.parent) inputs.push(nodes[n]!.action);
        inputs.reverse();
        return { min_ticks: next.tick, inputs, crashes: nodes[nodes.length - 1]!.crashes, states: nodes.length };
      }
    }
  }
  // Unreachable: the car always moves forward eventually.
  throw new Error("solver found no way to the finish line");
}
