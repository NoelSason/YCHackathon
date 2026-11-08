import { randomUUID } from "node:crypto";
import { getAdapter, type Adapter } from "../../../platform/mcp/src/adapters.js";
import { CI_TOLERANCE, KNOBS, nextEase, onTarget, referenceBot } from "../../../solver/src/autotune.js";
import { firstSeedFor, runLevelSmart, type BotResult } from "../../../solver/src/run.js";
import { generateSolvableLevel } from "../../../games/watersort/src/levels.js";
import { generateTrack } from "../../../games/racer/src/levels.js";
import { PRACTICE_LEVELS, type MatchLevel } from "../../../games/match3/adapter/levels.js";
import { adapter as lotescapeAdapter } from "../../../games/lotescape/adapter/index.js";
import type { MadeLevel, MakeProgress, MakeRequest, MakeResult, PackGameId } from "./pack-types.js";

/**
 * Makes the levels for one paid pack, one slot at a time, in play order. Each slot has its own target
 * win rate (the pack's difficulty curve). The game's own generator deals a candidate, and the game's
 * own bots measure it through its platform adapter (the same rules code the solver harness and the
 * browser game run; nothing here re-implements a game). The knob moves with the solver's tuning step
 * (`nextEase`) and a level is accepted by the solver's own rule (`onTarget`). A candidate that never
 * lands is dropped and the slot gets a new one. Stops at `maxCandidates` or `maxSeconds`.
 *
 * CPU-heavy, so the server runs it in a worker thread (pack-worker.ts). Not part of the tsc build
 * (it imports the games); the server runs it with tsx.
 */
const MAX_ROUNDS = 6;
const CANDIDATES_PER_SLOT = 6;

/**
 * Games per measurement. Match-3's greedy bot takes 1-2 s a game, so its tuning rounds use a quick
 * 30-game look across the solver's worker threads, and only the accepting measurement plays 100.
 */
const QUICK_RUNS: Record<PackGameId, number> = { watersort: 200, racer: 200, match3: 30, lotescape: 1 };
const FULL_RUNS: Record<PackGameId, number> = { watersort: 200, racer: 200, match3: 100, lotescape: 1 };

/** Seeded generator for picking design parameters (not for play; the bots seed themselves). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const between = (r: () => number, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));

type Level = Record<string, unknown>;

/** One candidate for a slot, with its knob at a first guess. Null when the generator found no good deal. */
type Design = (r: () => number, slot: number, target: number) => Level | null;

const DESIGNS: Record<Exclude<PackGameId, "lotescape">, Design> = {
  // Splash Sort: more colors are harder; the knob (move_limit) starts a few pours above the minimum.
  watersort(r, slot, target) {
    const colors = target >= 0.7 ? between(r, 4, 5) : target >= 0.45 ? between(r, 5, 7) : between(r, 6, 8);
    try {
      const level = generateSolvableLevel({ colors, capacity: 4, spare: 2, move_limit: 300, seed: between(r, 1, 2 ** 31), title: `Level ${slot}` });
      const solved = getAdapter("watersort")!.solve!(level);
      if (!solved.solvable || typeof solved.min_moves !== "number") return null;
      return { ...level, move_limit: solved.min_moves + 2 + Math.round(6 * target) };
    } catch {
      return null;
    }
  },
  // Turbo Lanes: longer, faster, busier tracks are harder; the knob (time_limit) starts above the fastest finish.
  racer(r, slot, target) {
    const hard = target < 0.4;
    const easy = target >= 0.65;
    const lanes = easy ? 3 : between(r, 3, 4);
    const track = generateTrack({
      title: `Level ${slot}`, lanes, length: between(r, easy ? 60 : 80, hard ? 140 : 110),
      speed: between(r, easy ? 6 : 8, hard ? 12 : 10), gap: between(r, hard ? 4 : 5, easy ? 7 : 6),
      blocked: Math.min(lanes - 1, easy ? 1 : between(r, 1, 2)), boosts: between(r, 2, 4), coins: between(r, 4, 10),
      time_limit: 1000, seed: between(r, 1, 2 ** 31), ...(hard && r() < 0.5 ? { lane_change_cooldown: 1 } : {}),
    });
    const solved = getAdapter("racer")!.solve!(track);
    if (typeof solved.min_moves !== "number") return null;
    return { ...track, time_limit: solved.min_moves + 4 + Math.round(12 * target) } as unknown as Level;
  },
  // Gem Garden: a board shape from our practice set, a fresh seed and goal color; the knob is goal.target.
  match3(r, slot, target) {
    const shape = pick(r, PRACTICE_LEVELS);
    const colourCount = (target >= 0.6 ? 5 : pick(r, [5, 6])) as 5 | 6;
    const colour = pick(r, (["red", "blue", "green", "gold", "purple", "teal"] as const).slice(0, colourCount));
    const level: MatchLevel = {
      name: `Level ${slot}`, width: shape.width, height: shape.height, colour_count: colourCount,
      seed: `pack-${randomUUID().slice(0, 8)}`, ...(shape.mask ? { mask: [...shape.mask] } : {}),
      ...(shape.seals ? { seals: shape.seals.map((s) => ({ ...s })) } : {}),
      goal: { colour, target: Math.round(40 + 60 * (1 - target)) }, move_limit: between(r, 20, 26),
    };
    return level as unknown as Level;
  },
};

const getAt = (level: Level, path: string[]): number => Number(path.reduce<unknown>((o, k) => (o as Level)?.[k], level));
function setAt(level: Level, path: string[], v: number): Level {
  const out = structuredClone(level);
  let o = out;
  for (const k of path.slice(0, -1)) o = o[k] as Level;
  o[path[path.length - 1]!] = v;
  return out;
}

async function measure(a: Adapter, level: Level, bot: string, runs: number, threads: number) {
  const runId = randomUUID();
  const out = await runLevelSmart(a, level, [bot], runs, firstSeedFor(runId), { gameId: a.game_id, threads, maxSeconds: 120, minGames: runs });
  return { runId, out, r: out.results[bot]! as BotResult };
}

/** Tunes one candidate toward its slot's target. The accepted level, or null with why it missed. */
async function tune(a: Adapter, start: Level, slot: number, target: number, threads: number): Promise<{ made: Omit<MadeLevel, "candidates"> } | { reason: string }> {
  const knob = KNOBS[a.game_id]!;
  const bot = referenceBot(a);
  const game = a.game_id as PackGameId;
  let lo = knob.dir === 1 ? knob.lo : -knob.hi;
  const hi = knob.dir === 1 ? knob.hi : -knob.lo;
  let level = start;
  let e = knob.dir * getAt(level, knob.path);
  const seen: Array<{ e: number; rate: number }> = [];
  let measurements = 0;
  let last = "";
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    if (!a.validate(level).ok) return { reason: "the knob left the game's valid range" };
    let m = await measure(a, level, bot, QUICK_RUNS[game], threads);
    measurements++;
    if (knob.solverFloor && typeof m.out.min_moves === "number") lo = Math.max(lo, m.out.min_moves);
    // A quick look that's close gets the full count before it can be accepted.
    if (FULL_RUNS[game] > QUICK_RUNS[game] && Math.abs(m.r.win_rate - target) <= CI_TOLERANCE + 0.04) {
      m = await measure(a, level, bot, FULL_RUNS[game], threads);
      measurements++;
    }
    seen.push({ e, rate: m.r.win_rate });
    last = `${bot} won ${m.r.wins}/${m.r.runs} = ${Math.round(m.r.win_rate * 100)}% at ${knob.path.join(".")} ${getAt(level, knob.path)}`;
    if (m.r.runs >= FULL_RUNS[game] && onTarget(m.r, target) && m.out.solvable !== false) {
      return {
        made: {
          slot, target, level, bot, runs: m.r.runs, wins: m.r.wins, measured_win_rate: m.r.win_rate, ci95: [m.r.ci95_low, m.r.ci95_high],
          min_moves: m.out.min_moves, solvable: m.out.solvable, run_id: m.runId, results: m.out.results, rounds: measurements,
        },
      };
    }
    const next = Math.round(Math.min(hi, Math.max(lo, nextEase(seen, e, m.r.win_rate, target))));
    if (next === e || seen.some((s) => s.e === next)) return { reason: `the knob can't get closer (${last})` };
    e = next;
    level = setAt(level, knob.path, knob.dir * e);
  }
  return { reason: `not on target after ${MAX_ROUNDS} rounds (${last})` };
}

/**
 * Parking puzzles have one exact answer (the search bot always wins within the limit), so there's
 * no win rate to tune. A slot's target picks a notch on Lot Escape's own difficulty ladder
 * (games/lotescape/src/generate.ts: notch 1 is easiest, 12 the top), and a level passes when the
 * generator's solver-rated lot lands in that notch's band. Loaded at run time because the generator
 * is newer than this file; if it's missing, `lotescapeGenerator()` is null and the order is left
 * for a person.
 */
export function lotescapeNotch(target: number): number {
  return Math.max(1, Math.min(12, Math.round(1 + ((0.85 - target) / 0.6) * 11)));
}

interface LotGenerated { level: Record<string, unknown>; rating: { min_moves: number; score: number }; stopped: string }
type LotGenerate = (opts: { seed: number | string; difficulty: number; title?: string }) => LotGenerated;
let lotGen: LotGenerate | null | undefined;
export async function lotescapeGenerator(): Promise<LotGenerate | null> {
  if (lotGen !== undefined) return lotGen;
  try {
    const mod = (await import("../../../games/lotescape/src/" + "generate.js")) as Record<string, unknown>;
    const fn = [mod.generateLevel, mod.generate, mod.default].find((f) => typeof f === "function");
    lotGen = (fn as LotGenerate | undefined) ?? null;
  } catch {
    lotGen = null;
  }
  return lotGen;
}

export async function makePack(req: MakeRequest, onProgress?: (p: MakeProgress) => void | Promise<void>): Promise<MakeResult> {
  const t0 = Date.now();
  const deadline = t0 + req.maxSeconds * 1000;
  const r = rng(req.seed);
  const threads = Math.max(1, req.threads ?? 1);
  const of = req.targets.length;
  const levels: MadeLevel[] = [];
  let candidates = 0;
  const a = req.gameId === "lotescape" ? lotescapeAdapter : getAdapter(req.gameId);
  if (!a) throw new Error(`no adapter for ${req.gameId}`);
  const lot = req.gameId === "lotescape" ? await lotescapeGenerator() : null;
  if (req.gameId === "lotescape" && !lot) return result(req, levels, candidates, t0, deadline);

  for (let slot = 1; slot <= of; slot++) {
    const target = req.targets[slot - 1]!;
    let made: MadeLevel | null = null;
    for (let tries = 1; tries <= CANDIDATES_PER_SLOT && !made; tries++) {
      if (candidates >= req.maxCandidates || Date.now() >= deadline) return result(req, levels, candidates, t0, deadline);
      candidates++;
      if (lot) {
        const notch = lotescapeNotch(target);
        const g = lot({ seed: between(r, 1, 2 ** 31), difficulty: notch, title: `Level ${slot}` });
        const raw = { ...g.level, title: `Level ${slot}` };
        // The adapter's own validation re-solves the lot exactly; the fewest moves is the measurement.
        const s = a.validate(raw).ok ? a.solve!(raw) : { solvable: false };
        if (g.stopped === "target" && s.solvable && typeof s.min_moves === "number") {
          made = {
            slot, target, level: raw, bot: "search", runs: 1, wins: 1, measured_win_rate: null, ci95: [0, 1], min_moves: s.min_moves, solvable: true,
            run_id: randomUUID(), results: { notch, score: g.rating.score }, rounds: 1, candidates: tries,
          };
        } else {
          await onProgress?.({ kind: "retry", slot, target, reason: `the lot missed notch ${notch}'s band (${g.stopped})` });
        }
        continue;
      }
      const start = DESIGNS[req.gameId as Exclude<PackGameId, "lotescape">](r, slot, target);
      if (!start || !a.validate(start).ok) continue;
      const t = await tune(a, start, slot, target, threads);
      if ("made" in t) made = { ...t.made, candidates: tries };
      else await onProgress?.({ kind: "retry", slot, target, reason: t.reason });
    }
    if (!made) return result(req, levels, candidates, t0, deadline);
    levels.push(made);
    await onProgress?.({ kind: "accepted", level: made, of });
  }
  return result(req, levels, candidates, t0, deadline);
}

function result(req: MakeRequest, levels: MadeLevel[], candidates: number, t0: number, deadline: number): MakeResult {
  const stoppedBy = levels.length >= req.targets.length ? "done" : Date.now() >= deadline ? "time" : "attempts";
  return { gameId: req.gameId, levels, candidates, elapsedMs: Date.now() - t0, stoppedBy, measuredBy: req.gameId === "lotescape" ? "min_moves" : "win_rate" };
}
