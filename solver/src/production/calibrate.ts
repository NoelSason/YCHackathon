import { getAdapter } from "../../../platform/mcp/src/adapters.js";
import { onTarget, referenceBot } from "../autotune.js";
import { r4, wilson95 } from "../stats.js";
import type { BotResult } from "../run.js";
import { type Recipe, fingerprint } from "./catalog.js";

export interface AcceptedLevel extends Recipe {
  status: "accepted";
  fingerprint: string;
  measured: number;
  evidence: BotResult;
  training_runs: number;
  verification_rounds: number;
  min_moves: number | null;
  elapsed_ms: number;
  bot: string;
}

function allowance(r: Recipe, value: number): object {
  const level = structuredClone(r.level) as Record<string, unknown>;
  if (r.game_id === "match3") level.goal = { ...(level.goal as object), target: value };
  else level[r.game_id === "racer" ? "time_limit" : "move_limit"] = value;
  return level;
}

/** A distribution suggests a knob. Only independent actual replays can accept it. */
export function quantileKnob(values: number[], target: number, lo: number, hi: number, biggerIsEasier: boolean): number {
  const possible = [...new Set([lo, hi, ...values.flatMap(v => [v - 1, v, v + 1])])].filter(v => Number.isInteger(v) && v >= lo && v <= hi);
  let best = lo, distance = Infinity;
  for (const candidate of possible.sort((a,b) => a-b)) {
    const rate = values.filter(v => biggerIsEasier ? v <= candidate : v >= candidate).length / values.length;
    const d = Math.abs(rate - target);
    if (d < distance) { distance = d; best = candidate; }
  }
  return best;
}

/** Same adapters and bots as the browser/harness. No inferred rate is accepted as evidence. */
export function calibrate(r: Recipe, opts: { trainingRuns?: number; verificationRuns?: number; deadlineMs?: number } = {}): AcceptedLevel {
  const t0 = performance.now();
  const a = getAdapter(r.game_id)!;
  const valid = a.validate(r.level);
  if (!valid.ok) throw new Error(valid.errors.join("; "));
  const bot = referenceBot(a);
  const trainingRuns = opts.trainingRuns ?? 64, verificationRuns = opts.verificationRuns ?? 200;
  if (!Number.isInteger(trainingRuns) || trainingRuns < 16 || !Number.isInteger(verificationRuns) || verificationRuns < 200) throw new Error("need >=16 training runs and >=200 independent verification runs");
  const checkTime = () => { if (Date.now() > (opts.deadlineMs ?? Infinity)) throw new Error("per-level deadline reached; not accepted"); };
  let minimum: number | null = null;
  if (a.solve) {
    checkTime();
    const solution = a.solve(r.level);
    if (!solution.solvable) throw new Error("exact solver rejected the recipe");
    minimum = solution.min_moves ?? null;
  }
  // move_limit games have a 300 cap in their schemas; a generous ceiling above the exact minimum.
  const ceiling = r.game_id === "watersort" || r.game_id === "lotescape" ? Math.min(300, (minimum ?? 20) + 40) : 1000;
  const probe = allowance(r, ceiling), values: number[] = [];
  const firstSeed = (r.seed ^ 0x91e10da5) >>> 0;
  for (let i = 0; i < trainingRuns; i++) {
    checkTime();
    const play = a.simulate(probe, bot, (firstSeed + i) >>> 0);
    if (r.game_id === "match3") {
      const collected = (play.detail as { collected?: number } | undefined)?.collected;
      if (!Number.isFinite(collected)) throw new Error("match3 adapter did not report collected gems");
      values.push(collected!);
    } else values.push(play.won ? play.moves_used : Infinity);
  }
  const lo = minimum ?? 1;
  let desired = r.target;
  const seen = new Set<number>();
  for (let round = 1; round <= 3; round++) {
    const value = quantileKnob(values, desired, lo, ceiling, r.game_id !== "match3");
    if (seen.has(value)) throw new Error("integer knob cannot reach the target on this layout");
    seen.add(value);
    const level = allowance(r, value), v = a.validate(level);
    if (!v.ok) throw new Error(v.errors.join("; "));
    let wins = 0, moves = 0;
    // Each correction gets fresh seeds, disjoint from training and prior verification.
    const validationSeed = (firstSeed + 0x100000 + round * 0x10000) >>> 0;
    for (let i = 0; i < verificationRuns; i++) {
      checkTime();
      const play = a.simulate(level, bot, (validationSeed + i) >>> 0);
      if (typeof play.won !== "boolean" || !Number.isFinite(play.moves_used)) throw new Error("malformed adapter simulation");
      wins += Number(play.won); moves += play.moves_used;
    }
    const ci = wilson95(wins, verificationRuns);
    const evidence: BotResult = { runs: verificationRuns, wins, win_rate: r4(wins / verificationRuns), avg_moves: r4(moves / verificationRuns), ci95_low: r4(ci.low), ci95_high: r4(ci.high), first_seed: validationSeed };
    if (onTarget(evidence, r.target)) {
      if (minimum !== null && value < minimum) throw new Error("tuned allowance is below exact minimum");
      return { ...r, level, status: "accepted", fingerprint: fingerprint(r.game_id, level), measured: evidence.win_rate, evidence, training_runs: trainingRuns, verification_rounds: round, min_moves: minimum, elapsed_ms: Math.round(performance.now() - t0), bot };
    }
    desired = Math.min(0.99, Math.max(0.01, desired + r.target - evidence.win_rate));
  }
  throw new Error("independent verification missed the target after 3 quantile choices");
}
