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
  budget_hit?: true;      // the run's time budget ended play early; `runs` is what was played
  runs_requested?: number;
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

// ---------- fast path: parallel play with a time budget ----------

export interface SmartOptions {
  gameId: string;      // workers look the adapter up by id in the same registry
  maxSeconds?: number; // whole-run budget; each bot gets a fair share of what's left
  threads?: number;    // worker threads for slow games
  minGames?: number;   // per bot, played even past the budget
}

export interface SmartOutput extends RunOutput {
  budget_hit: boolean;
}

interface Tally {
  wins: number;
  moves: number;
  done: number;
}

const PARALLEL_ABOVE_MS = 2000; // go parallel when the remaining games would take longer than this
const PROBE_GAMES = 3;

function playOne(a: Adapter, level: object, bot: string, seed: number, t: Tally): void {
  const out = a.simulate(level, bot, seed);
  if (typeof out?.won !== "boolean" || typeof out.moves_used !== "number" || !Number.isFinite(out.moves_used)) {
    throw new RunError(`simulate(bot=${bot}, seed=${seed}) returned a malformed result`);
  }
  if (out.won) t.wins++;
  t.moves += out.moves_used;
  t.done++;
}

async function playMany(
  a: Adapter, gameId: string, level: object, bot: string, firstSeed: number, count: number,
  deadline: number, threads: number, minGames: number,
): Promise<Tally> {
  const t: Tally = { wins: 0, moves: 0, done: 0 };
  // Probe a few games to see how slow this game is.
  const probe = Math.min(PROBE_GAMES, count);
  const t0 = performance.now();
  for (let i = 0; i < probe; i++) playOne(a, level, bot, (firstSeed + i) >>> 0, t);
  const perGame = (performance.now() - t0) / Math.max(1, probe);
  const rest = count - probe;
  if (rest <= 0) return t;

  if (threads <= 1 || perGame * rest < PARALLEL_ABOVE_MS) {
    for (let i = probe; i < count; i++) {
      if (t.done >= minGames && Date.now() > deadline) break;
      playOne(a, level, bot, (firstSeed + i) >>> 0, t);
    }
    return t;
  }

  // Slow game: split the remaining seeds across worker threads.
  const { Worker } = await import("node:worker_threads");
  const n = Math.min(threads, rest);
  const size = Math.ceil(rest / n);
  const workerUrl = new URL(`./sim-worker${import.meta.url.endsWith(".ts") ? ".ts" : ".js"}`, import.meta.url);
  const execArgv = import.meta.url.endsWith(".ts") ? ["--import", "tsx"] : [];
  const slices = await Promise.all(
    Array.from({ length: n }, (_, k) => {
      const start = probe + k * size;
      const len = Math.max(0, Math.min(size, count - start));
      return new Promise<Tally>((resolve, reject) => {
        if (!len) return resolve({ wins: 0, moves: 0, done: 0 });
        const w = new Worker(workerUrl, {
          execArgv,
          workerData: {
            gameId, level, bot, start: (firstSeed + start) >>> 0, count: len,
            minGames: Math.ceil(Math.max(0, minGames - probe) / n), deadline,
          },
        });
        w.once("message", (m: Tally & { error?: string }) => {
          void w.terminate();
          if (m.error) reject(new RunError(m.error));
          else resolve(m);
        });
        w.once("error", reject);
      });
    }),
  );
  for (const s of slices) {
    t.wins += s.wins;
    t.moves += s.moves;
    t.done += s.done;
  }
  return t;
}

/**
 * Like runLevel, but plays slow games across worker threads and stops at a time budget, so a
 * slow bot can't block the queue. When the budget isn't hit, the results are identical to
 * runLevel's (same seeds). When it is, each bot's `runs` is the number actually played and
 * `budget_hit` is true.
 */
export async function runLevelSmart(
  adapter: Adapter, level: unknown, bots: string[], runsPerBot: number, firstSeed: number, opts: SmartOptions,
): Promise<SmartOutput> {
  if (!Number.isInteger(runsPerBot) || runsPerBot < 1) throw new RunError(`runs_per_bot must be a positive integer, got ${runsPerBot}`);
  if (bots.length === 0) throw new RunError("no bots requested");
  const unknownBots = bots.filter((b) => !adapter.bots.includes(b));
  if (unknownBots.length) {
    throw new RunError(`unknown bots for ${adapter.game_id}: ${unknownBots.join(", ")}; valid: ${adapter.bots.join(", ")}`);
  }
  const v = adapter.validate(level);
  if (!v.ok) throw new RunError(`invalid level: ${v.errors.join("; ")}`);
  const lvl = level as object;
  const end = Date.now() + (opts.maxSeconds ?? 240) * 1000;
  const minGames = Math.min(runsPerBot, opts.minGames ?? 20);
  const threads = Math.max(1, opts.threads ?? 1);

  const results: Results = {};
  let budgetHit = false;
  for (let i = 0; i < bots.length; i++) {
    const bot = bots[i]!;
    const deadline = Date.now() + Math.max(0, end - Date.now()) / (bots.length - i); // fair share of what's left
    const t = await playMany(adapter, opts.gameId, lvl, bot, firstSeed, runsPerBot, deadline, threads, minGames);
    if (t.done < runsPerBot) budgetHit = true;
    const ci = wilson95(t.wins, t.done);
    results[bot] = {
      runs: t.done,
      wins: t.wins,
      win_rate: r4(t.wins / t.done),
      avg_moves: r4(t.moves / t.done),
      ci95_low: r4(ci.low),
      ci95_high: r4(ci.high),
      first_seed: firstSeed,
      ...(t.done < runsPerBot ? { budget_hit: true as const, runs_requested: runsPerBot } : {}),
    };
  }

  let solvable: boolean | null = null;
  let min_moves: number | null = null;
  if (adapter.solve) {
    const s = adapter.solve(lvl);
    solvable = s.solvable;
    min_moves = s.min_moves ?? null;
  }
  return { results, solvable, min_moves, budget_hit: budgetHit };
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
