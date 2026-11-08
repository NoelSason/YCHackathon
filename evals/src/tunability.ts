// Tunability eval: the fixed eval set (docs/agent-plan.md: "five target difficulties per
// connected game"), solved by a scripted ideal Tuner that moves only the main knob, at most
// MAX_ROUNDS solver runs per target. It answers "can this game hit every target at all?" and
// gives the baseline the LLM Tuner is compared against. Runs offline: no database, no agents.
import type { Adapter } from "../../platform/mcp/src/adapters.js";
import { getAdapter } from "../../platform/mcp/src/adapters.js";
import { runLevelSmart } from "../../solver/src/run.js";
import { SAMPLES as WATERSORT } from "../../games/watersort/src/levels.js";
import { SAMPLES as RACER } from "../../games/racer/src/levels.js";
import { MAX_ROUNDS, REFERENCE_BOTS, TOLERANCE } from "./report.js";

export const TARGETS = [0.2, 0.35, 0.5, 0.65, 0.8] as const;

export interface EvalCase {
  game_id: string;
  label: string;
  level: Record<string, unknown>;
  knob: string;                 // the integer field the Tuner moves; win rate rises with it
  bounds: [number, number];
}

export const EVAL_SET: EvalCase[] = [
  { game_id: "watersort", label: "Rainbow Rush", level: { ...WATERSORT[2]! }, knob: "move_limit", bounds: [1, 300] },
  { game_id: "watersort", label: "Deep End", level: { ...WATERSORT[3]! }, knob: "move_limit", bounds: [1, 300] },
  { game_id: "racer", label: "Rush Hour", level: { ...RACER[1]! }, knob: "time_limit", bounds: [1, 1000] },
  { game_id: "racer", label: "Neon Highway", level: { ...RACER[2]! }, knob: "time_limit", bounds: [1, 1000] },
  {
    game_id: "match3",
    label: "Eval Garden",
    level: { name: "Eval Garden", width: 7, height: 9, colour_count: 5, seed: 12345, goal: { colour: "red", target: 30 }, move_limit: 20 },
    knob: "move_limit",
    bounds: [1, 200],
  },
];

export interface TuneResult {
  target: number;
  hit: boolean;
  rounds: number;
  knob_value: number;
  win_rate: number;
  path: Array<{ knob_value: number; win_rate: number }>;
}

export interface CaseResult {
  game_id: string;
  label: string;
  bot: string;
  knob: string;
  floor: number | null;   // the solver's minimum, when the game has solve()
  results: TuneResult[];
  skipped?: string;
}

export function pickBot(a: Adapter): string {
  return REFERENCE_BOTS.find((b) => a.bots.includes(b)) ?? a.bots[0]!;
}

/** The ideal Tuner: bracket the target and interpolate, moving one integer knob. */
export async function tuneTo(
  a: Adapter, base: Record<string, unknown>, knob: string, bounds: [number, number],
  target: number, bot: string, runs: number, seed: number, budget: { maxSeconds: number; threads: number },
): Promise<TuneResult> {
  let lo = bounds[0];
  let hi = bounds[1];
  let x = Math.min(hi, Math.max(lo, Math.round(Number(base[knob]))));
  const path: TuneResult["path"] = [];
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const level = { ...base, [knob]: x };
    const out = await runLevelSmart(a, level, [bot], runs, seed, { gameId: a.game_id, ...budget });
    const rate = out.results[bot]!.win_rate;
    path.push({ knob_value: x, win_rate: rate });
    if (Math.abs(rate - target) <= TOLERANCE + 1e-9) return { target, hit: true, rounds: round, knob_value: x, win_rate: rate, path };
    if (rate < target) lo = x + 1;
    else hi = x - 1;
    if (lo > hi) break;
    // Interpolate between the nearest measurements on each side of the target, if we have both.
    const below = path.filter((p) => p.win_rate < target).sort((p, q) => q.knob_value - p.knob_value)[0];
    const above = path.filter((p) => p.win_rate > target).sort((p, q) => p.knob_value - q.knob_value)[0];
    let next: number;
    if (below && above && above.win_rate > below.win_rate) {
      next = below.knob_value + ((target - below.win_rate) * (above.knob_value - below.knob_value)) / (above.win_rate - below.win_rate);
    } else {
      // One-sided: step by a share of the knob that grows with the distance to the target.
      const step = Math.max(1, Math.round(Math.abs(target - rate) * Math.max(4, x * 0.5)));
      next = rate < target ? x + step : x - step;
    }
    x = Math.min(hi, Math.max(lo, Math.round(next)));
  }
  const last = path[path.length - 1]!;
  return { target, hit: false, rounds: path.length, knob_value: last.knob_value, win_rate: last.win_rate, path };
}

export async function runTunability(
  opts: { runs?: number; cases?: EvalCase[]; targets?: readonly number[]; seed?: number; maxSeconds?: number; threads?: number } = {},
): Promise<CaseResult[]> {
  const runs = opts.runs ?? 200;
  const budget = { maxSeconds: opts.maxSeconds ?? 10, threads: opts.threads ?? 1 };
  const seed = opts.seed ?? 20261107;
  const out: CaseResult[] = [];
  for (const c of opts.cases ?? EVAL_SET) {
    const a = getAdapter(c.game_id);
    if (!a) {
      out.push({ game_id: c.game_id, label: c.label, bot: "", knob: c.knob, floor: null, results: [], skipped: "no adapter registered" });
      continue;
    }
    const v = a.validate(c.level);
    if (!v.ok) {
      out.push({ game_id: c.game_id, label: c.label, bot: "", knob: c.knob, floor: null, results: [], skipped: `eval level invalid: ${v.errors[0]}` });
      continue;
    }
    // Below the solver's minimum the win rate is 0, so the minimum is the floor of the knob.
    let floor: number | null = null;
    let bounds = c.bounds;
    if (a.solve) {
      const s = a.solve(c.level);
      if (typeof s.min_moves === "number") {
        floor = s.min_moves;
        bounds = [Math.max(c.bounds[0], s.min_moves), c.bounds[1]];
      }
    }
    const bot = pickBot(a);
    const results: TuneResult[] = [];
    for (const t of opts.targets ?? TARGETS) results.push(await tuneTo(a, c.level, c.knob, bounds, t, bot, runs, seed, budget));
    out.push({ game_id: c.game_id, label: c.label, bot, knob: c.knob, floor, results });
  }
  return out;
}

export function formatTunability(rs: CaseResult[]): string {
  const lines = [
    `Tunability eval: ideal Tuner, ${MAX_ROUNDS} rounds max, hit = within ${TOLERANCE * 100} pts of target`,
    "",
    "game       level          bot     knob        min  " + TARGETS.map((t) => `${Math.round(t * 100)}%`.padStart(14)).join(""),
  ];
  const byGame = new Map<string, { hits: number; total: number }>();
  for (const r of rs) {
    if (r.skipped) {
      lines.push(`${r.game_id.padEnd(10)} ${r.label.padEnd(14)} skipped: ${r.skipped}`);
      continue;
    }
    const cells = r.results.map((x) => `${x.hit ? "✓" : "✗"} ${r.knob === "time_limit" ? "t" : "m"}=${x.knob_value} ${Math.round(x.win_rate * 100)}%/${x.rounds}r`.padStart(14));
    lines.push(`${r.game_id.padEnd(10)} ${r.label.padEnd(14)} ${r.bot.padEnd(7)} ${r.knob.padEnd(11)} ${String(r.floor ?? "–").padStart(4)}  ${cells.join("")}`);
    const g = byGame.get(r.game_id) ?? { hits: 0, total: 0 };
    g.hits += r.results.filter((x) => x.hit).length;
    g.total += r.results.length;
    byGame.set(r.game_id, g);
  }
  lines.push("");
  lines.push(`Hits: ${[...byGame].map(([g, x]) => `${g} ${x.hits}/${x.total}`).join(", ")}`);
  return lines.join("\n");
}
