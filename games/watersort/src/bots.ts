// Splash Sort bots. Each plays one level from a seed and reports won/lost and pours used.
// The same seed always gives the same game, so the solver harness can replay any run.
//
//   human   plays like a person: looks one pour ahead and remembers only recent positions, but
//           about 3 pours in 10 are wasted on a random legal pour (pouring back and forth,
//           emptying into a spare tube). Measured on our samples, this spreads the pours a
//           player needs over several moves, so each extra allowed pour changes the win rate by
//           about 20 points instead of 30-50, and players sometimes get stuck, as people do.
//   greedy  always takes the best-scoring pour now, and never repeats a position
//   random  picks any useful pour at random
import {
  applyPour, isComplete, isSolved, type Level, type Pour, pourAmount, stateKey, toTubes, top, topRun, type Tubes, usefulPours,
} from "./engine.js";

export const BOTS = ["human", "greedy", "random"] as const;
export type BotName = (typeof BOTS)[number];

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How good a pour looks right now, from a player's point of view. */
export function scorePour(tubes: Tubes, cap: number, p: Pour): number {
  const before = tubes[p.from]!;
  const target = tubes[p.to]!;
  const next = applyPour(tubes, p.from, p.to, p.amount);
  const after = next[p.from]!;
  let s = 0;
  if (isComplete(next[p.to]!, cap)) s += 100;           // finishes a tube
  if (target.length) s += 20 + 3 * p.amount;             // stacks onto the same color
  else s -= 12;                                          // spends an empty tube
  if (!after.length) s += 15;                            // frees a tube
  else if (top(after) !== top(before)) s += 4;           // uncovers a new color
  if (p.amount < topRun(before)) s -= 6;                 // splits a run of one color
  return s;
}

interface Memory {
  has(key: string): boolean;
  add(key: string): void;
}

function fullMemory(): Memory {
  const seen = new Set<string>();
  return { has: (k) => seen.has(k), add: (k) => void seen.add(k) };
}

/** Remembers only the last `size` positions, like a person does. */
function shortMemory(size: number): Memory {
  const seen = new Set<string>();
  const order: string[] = [];
  return {
    has: (k) => seen.has(k),
    add: (k) => {
      if (seen.has(k)) return;
      seen.add(k);
      order.push(k);
      if (order.length > size) seen.delete(order.shift()!);
    },
  };
}

const REPEAT_PENALTY = 60;
export const HUMAN_WASTE = 0.3;

/** Every legal pour, including ones that can't help. */
function anyPour(tubes: Tubes, cap: number): Pour[] {
  const out: Pour[] = [];
  for (let from = 0; from < tubes.length; from++) {
    for (let to = 0; to < tubes.length; to++) {
      const amount = pourAmount(tubes, cap, from, to);
      if (amount > 0) out.push({ from, to, amount });
    }
  }
  return out;
}

function pick(tubes: Tubes, cap: number, bot: BotName, rnd: () => number, memory: Memory): Pour | null {
  if (bot === "human" && rnd() < HUMAN_WASTE) {
    const all = anyPour(tubes, cap);
    if (all.length) return all[Math.floor(rnd() * all.length)]!;
  }
  const moves = usefulPours(tubes, cap);
  if (!moves.length) return null;
  if (bot === "random") return moves[Math.floor(rnd() * moves.length)]!;

  const scored = moves.map((p) => {
    const next = applyPour(tubes, p.from, p.to, p.amount);
    let s = scorePour(tubes, cap, p);
    if (memory.has(stateKey(next))) s -= REPEAT_PENALTY;
    if (bot === "human") {
      // One pour of lookahead, discounted: people plan a little, not a lot.
      if (isSolved(next, cap)) s += 200;
      else {
        const follow = usefulPours(next, cap);
        let best = -Infinity;
        for (const q of follow) best = Math.max(best, scorePour(next, cap, q));
        if (best > -Infinity) s += 0.5 * best;
        else s -= 80; // a dead end
      }
    }
    return { p, s: s + rnd() * 0.01 }; // tiny noise breaks ties reproducibly
  });
  scored.sort((a, b) => b.s - a.s);
  return scored[0]!.p;
}

export interface PlayResult {
  won: boolean;
  moves_used: number;
  detail: { stuck: boolean; out_of_moves: boolean };
}

export function playOut(level: Level, bot: string, seed: number): PlayResult {
  if (!(BOTS as readonly string[]).includes(bot)) throw new Error(`unknown bot "${bot}" (use: ${BOTS.join(", ")})`);
  const cap = level.capacity;
  const rnd = mulberry32(seed);
  const memory = bot === "human" ? shortMemory(40) : fullMemory();
  let tubes = toTubes(level);
  memory.add(stateKey(tubes));
  let moves = 0;
  while (moves < level.move_limit) {
    const p = pick(tubes, cap, bot as BotName, rnd, memory);
    if (!p) return { won: false, moves_used: moves, detail: { stuck: true, out_of_moves: false } };
    tubes = applyPour(tubes, p.from, p.to, p.amount);
    moves++;
    memory.add(stateKey(tubes));
    if (isSolved(tubes, cap)) return { won: true, moves_used: moves, detail: { stuck: false, out_of_moves: false } };
  }
  return { won: false, moves_used: moves, detail: { stuck: false, out_of_moves: true } };
}
