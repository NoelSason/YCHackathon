// Turbo Lanes bots. Each drives one run from a seed and reports won/lost and ticks used.
// The same seed always gives the same run, so the solver harness can replay any run.
//
//   human   looks a limited distance ahead (less at higher speed), reacts late now and then,
//           and sometimes doesn't notice an obstacle
//   greedy  looks only two rows ahead, but never makes mistakes
//   random  steers at random
import { type Action, buildGrid, canSteer, cellKey, type CarState, finished, type Grid, isObstacle, type Level, startState, step, type StepEvents } from "./engine.js";

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

interface Driver {
  horizon: number;    // ticks of lookahead used for planning
  lateChance: number; // chance a planned steer happens one tick late
  missChance: number; // chance of not noticing an obstacle at all
}

/** How a person drives at this speed: faster tracks leave less time to plan and react. */
export function humanDriver(level: Level): Driver {
  return {
    horizon: Math.max(3, Math.min(9, Math.round(13 - level.speed * 0.6))),
    lateChance: Math.min(0.45, 0.04 + level.speed * 0.022),
    missChance: 0.04,
  };
}

const GREEDY: Driver = { horizon: 2, lateChance: 0, missChance: 0 };

const reward = (from: CarState, to: CarState, ev: StepEvents): number =>
  (ev.crashed ? -100 : 0) + (ev.boosted ? 6 : 0) + (ev.shielded ? 4 : 0) + ev.coins * 2 + (to.row - from.row);

function choices(level: Level, s: CarState): Action[] {
  if (!canSteer(s)) return [0];
  const out: Action[] = [0]; // straight first: it wins ties
  if (s.lane > 0) out.push(-1);
  if (s.lane < level.lanes - 1) out.push(1);
  return out;
}

/**
 * One number per (state, depth), with no collisions inside the level limits (engine LIMITS: lanes
 * up to 5, cooldown up to 3, boost up to BOOST_TICKS = 4, stun up to 10, depth up to 9, row up to
 * 400 plus a boost). A number key is several times cheaper than the string it replaces.
 */
function stateKey(st: CarState, depth: number): number {
  let k = st.row;
  k = k * 8 + st.lane;
  k = k * 4 + st.cooldown;
  k = k * 8 + st.boost;
  k = k * 16 + st.stun;
  k = k * 2 + st.shield;
  k = k * 8 + (st.rear + 1);
  return k * 16 + depth;
}

/**
 * Best first action over the next `horizon` ticks, by dynamic programming over the car states
 * the driver can reach (memoized, so it stays cheap). `view` is the track as this driver sees it.
 * `memo` lives for a whole run: a state's value depends only on the state, the depth, and `view`,
 * which is fixed for the run, so keeping it across ticks gives the same plans with far less work.
 */
function plan(level: Level, view: Grid, s: CarState, horizon: number, memo: Map<number, number>): Action {
  const value = (st: CarState, depth: number): number => {
    if (depth === 0 || finished(level, st)) return 0;
    const k = stateKey(st, depth);
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    let top = -Infinity;
    for (const a of choices(level, st)) {
      const { next, ev } = step(level, view, st, a);
      top = Math.max(top, reward(st, next, ev) + 0.95 * value(next, depth - 1));
    }
    memo.set(k, top);
    return top;
  };
  let best: Action = 0;
  let bestScore = -Infinity;
  for (const a of choices(level, s)) {
    const { next, ev } = step(level, view, s, a);
    const score = reward(s, next, ev) + 0.95 * value(next, horizon - 1);
    if (score > bestScore + 1e-9) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

export interface DriveResult {
  won: boolean;
  moves_used: number; // ticks
  detail: { finished: boolean; ticks: number; crashes: number; coins: number };
}

export function drive(level: Level, bot: string, seed: number): DriveResult {
  if (!(BOTS as readonly string[]).includes(bot)) throw new Error(`unknown bot "${bot}" (use: ${BOTS.join(", ")})`);
  const grid = buildGrid(level);
  const rnd = mulberry32(seed);
  const driver = bot === "human" ? humanDriver(level) : GREEDY;

  // The track as this driver sees it on this run: some obstacles go unnoticed.
  let view = grid;
  if (driver.missChance > 0) {
    view = new Map(grid);
    for (const o of level.objects) {
      if (isObstacle(o.kind) && rnd() < driver.missChance) view.delete(cellKey(o.row, o.lane));
    }
  }

  let s = startState(level);
  let crashes = 0;
  let coins = 0;
  let pending: Action = 0; // a steer the driver meant to make last tick but reacted late on
  const memo = new Map<number, number>(); // planner values for this run's view (see plan)
  while (!finished(level, s) && s.tick < level.time_limit) {
    let a: Action;
    if (bot === "random") {
      a = rnd() < 0.3 ? (rnd() < 0.5 ? -1 : 1) : 0;
    } else if (pending !== 0 && canSteer(s)) {
      a = pending;
      pending = 0;
    } else {
      pending = 0;
      a = plan(level, view, s, driver.horizon, memo);
      if (a !== 0 && rnd() < driver.lateChance) {
        pending = a;
        a = 0;
      }
    }
    const { next, ev } = step(level, grid, s, a); // the real track decides what happens
    if (ev.crashed) crashes++;
    coins += ev.coins;
    s = next;
  }
  const done = finished(level, s);
  return {
    won: done && s.tick <= level.time_limit,
    moves_used: s.tick,
    detail: { finished: done, ticks: s.tick, crashes, coins },
  };
}
