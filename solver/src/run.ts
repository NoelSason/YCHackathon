// Plays one level with each requested bot through the game's adapter. Pure: no database here.
// The adapter shape is platform/CONTRACTS.md §1, and the registry is the platform's own, so the
// harness and the MCP server always run the same copy of each game's rules.
import type { Adapter } from "../../platform/mcp/src/adapters.js";
import { r4, wilson95 } from "./stats.js";

/**
 * One bot's results. `runs`, `wins`, `win_rate`, and `avg_moves` are the shape in
 * platform/CONTRACTS.md §2 (`get_solver_run`). The other fields are additive.
 */
export interface BotResult {
  runs: number;
  wins: number;
  win_rate: number;
  avg_moves: number;
  ci95_low: number;   // 95% Wilson interval for win_rate
  ci95_high: number;
  first_seed: number; // seeds used: first_seed, first_seed + 1, ... (the same for every bot)
}

export type Results = Record<string, BotResult>;

export interface RunOutput {
  results: Results;
  solvable: boolean | null;
  min_moves: number | null;
}

/** A problem with the run's input (bad bot, invalid level, malformed adapter output). */
export class RunError extends Error {}

/** Seeds come from the run id, so anyone can replay a run exactly. */
export function firstSeedFor(runId: string): number {
  const n = Number.parseInt(runId.replace(/-/g, "").slice(0, 8), 16);
  return Number.isFinite(n) ? n >>> 0 : 1;
}

export function runLevel(
  adapter: Adapter,
  level: unknown,
  bots: string[],
  runsPerBot: number,
  firstSeed: number,
): RunOutput {
  if (!Number.isInteger(runsPerBot) || runsPerBot < 1) {
    throw new RunError(`runs_per_bot must be a positive integer, got ${runsPerBot}`);
  }
  if (bots.length === 0) throw new RunError("no bots requested");
  const unknownBots = bots.filter((b) => !adapter.bots.includes(b));
  if (unknownBots.length) {
    throw new RunError(
      `unknown bots for ${adapter.game_id}: ${unknownBots.join(", ")}; valid: ${adapter.bots.join(", ")}`,
    );
  }
  const v = adapter.validate(level);
  if (!v.ok) throw new RunError(`invalid level: ${v.errors.join("; ")}`);
  const lvl = level as object;

  const results: Results = {};
  for (const bot of bots) {
    let wins = 0;
    let moves = 0;
    for (let i = 0; i < runsPerBot; i++) {
      // Every bot gets the same seeds (common random numbers), so bots are compared on equal luck.
      const seed = (firstSeed + i) >>> 0;
      const out = adapter.simulate(lvl, bot, seed);
      if (typeof out?.won !== "boolean" || typeof out.moves_used !== "number" || !Number.isFinite(out.moves_used)) {
        throw new RunError(`simulate(bot=${bot}, seed=${seed}) returned a malformed result`);
      }
      if (out.won) wins++;
      moves += out.moves_used;
    }
    const ci = wilson95(wins, runsPerBot);
    results[bot] = {
      runs: runsPerBot,
      wins,
      win_rate: r4(wins / runsPerBot),
      avg_moves: r4(moves / runsPerBot),
      ci95_low: r4(ci.low),
      ci95_high: r4(ci.high),
      first_seed: firstSeed,
    };
  }

  let solvable: boolean | null = null;
  let min_moves: number | null = null;
  if (adapter.solve) {
    const s = adapter.solve(lvl);
    solvable = s.solvable;
    min_moves = s.min_moves ?? null;
  }
  return { results, solvable, min_moves };
}

/** One line for the activity log, e.g. "random 41% (82/200); solvable, min 14 moves". */
export function summarize(out: RunOutput): string {
  const parts = Object.entries(out.results).map(
    ([bot, r]) => `${bot} ${Math.round(r.win_rate * 1000) / 10}% (${r.wins}/${r.runs})`,
  );
  if (out.solvable !== null) {
    parts.push(out.solvable ? `solvable${out.min_moves !== null ? `, min ${out.min_moves} moves` : ""}` : "unsolvable");
  }
  return parts.join("; ");
}
