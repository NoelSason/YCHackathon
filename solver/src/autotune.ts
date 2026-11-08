// The automatic Tuner (package 10). Why it is a program and not an LLM session:
// Naïve flags a chat after its first MCP read, and from then on every MCP call waits for a person,
// even at "allow" (Naïve docs, tools.md, "Once a chat has read people's data"). An LLM Tuner needs
// solve → read → adjust → save → accept, so it can't run unattended. The Designer saves one level
// per run (a single MCP call), and this program tunes it with the same harness: it measures the
// game's reference bot, moves the game's knob, and accepts within TOLERANCE of the target in at most
// MAX_ROUNDS measurements, or rejects with the reason. Every step lands in levels, solver_runs and
// activity_log, so the run is as inspectable as an agent's.
import type { Adapter } from "../../platform/mcp/src/adapters.js";
import type { GetAdapter, Query, Row } from "./queue.js";
import { firstSeedFor, runLevelSmart, summarize } from "./run.js";

// Up to 6 measurements: rounds cost under a second for most games (a minute for match-3), and steep
// curves near a game's minimum need a couple more than a straight-line guess.
export const MAX_ROUNDS = 6;
export const TOLERANCE = 0.05;
export const REFERENCE_BOTS = ["human", "search", "greedy"] as const;

/** The integer field the tuner moves. dir +1: a higher value makes the level easier. */
export interface Knob {
  path: string[];
  dir: 1 | -1;
  lo: number;
  hi: number;
  solverFloor: boolean; // the solver's min_moves is the easiest-possible bound (below it nobody wins)
}

export const KNOBS: Record<string, Knob> = {
  watersort: { path: ["move_limit"], dir: 1, lo: 1, hi: 300, solverFloor: true },
  racer: { path: ["time_limit"], dir: 1, lo: 1, hi: 1000, solverFloor: true },
  // Measured: goal.target moves the greedy win rate about 3-5 points per gem; move_limit 10-15.
  match3: { path: ["goal", "target"], dir: -1, lo: 1, hi: 1000, solverFloor: false },
};

const RUNS: Record<string, number> = { match3: 100 }; // match-3's greedy bot is slow (~1.7 s a game)

export const referenceBot = (a: Adapter): string => REFERENCE_BOTS.find((b) => a.bots.includes(b)) ?? a.bots[0]!;

const getKnob = (level: Record<string, unknown>, path: string[]): number =>
  Number(path.reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], level));

function setKnob(level: Record<string, unknown>, path: string[], v: number): Record<string, unknown> {
  const out = structuredClone(level);
  let o = out as Record<string, unknown>;
  for (const k of path.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[path[path.length - 1]!] = v;
  return out;
}

const asJson = (v: unknown): unknown => (typeof v === "string" ? JSON.parse(v) : v);

async function log(q: Query, agent: string, action: string, reason: string, result: string, kind: string, id: string): Promise<void> {
  await q(`insert into activity_log(agent, action, reason, result, ref_kind, ref_id) values ($1,$2,$3,$4,$5,$6)`, [agent, action, reason, result, kind, id]);
}

export interface Design {
  level_id: string;
  game_id: string;
  level: Record<string, unknown>;
  target: number;
  resumed: boolean; // an earlier tune of this version stopped mid-way (worker stopped or crashed)
}

/** A version left mid-tune is picked up again this long after its last change. */
export const RESUME_AFTER_MINUTES = 20;

/**
 * Atomically take the oldest level to tune, for a game this worker can tune: a new Designer level,
 * or a version whose tune stopped mid-way. That one is still 'solving' RESUME_AFTER_MINUTES after
 * its last change, with no queued or running measurement and no newer version. A live tune always
 * has a running measurement or saves a new version within seconds, so it is never taken.
 */
export async function claimDesign(q: Query, games: string[]): Promise<Design | null> {
  const tunable = games.filter((g) => KNOBS[g]);
  if (!tunable.length) return null;
  const [r] = await q(
    `with pick as (
       select l.level_id, l.status as was from levels l
        where l.game_id = any($1)
          and ((l.status = 'draft' and l.parent_level_id is null and l.created_by = 'designer'
                and l.created_at < now() - interval '15 seconds')
            or (l.status = 'solving' and l.created_by in ('designer', 'tuner')
                and l.updated_at < now() - make_interval(mins => $2::int)
                and not exists (select 1 from solver_runs r where r.level_id = l.level_id and r.status in ('queued', 'running'))
                and not exists (select 1 from levels c where c.parent_level_id = l.level_id)))
        order by l.created_at
        for update of l skip locked
        limit 1)
     update levels set status = 'solving', updated_at = now()
       from pick where levels.level_id = pick.level_id
     returning levels.level_id::text as level_id, levels.game_id, levels.level, levels.target_win_rate, pick.was`,
    [tunable, RESUME_AFTER_MINUTES],
  );
  if (!r) return null;
  return {
    level_id: String(r.level_id), game_id: String(r.game_id), level: asJson(r.level) as Record<string, unknown>,
    target: Number(r.target_win_rate), resumed: r.was === "solving",
  };
}

/** One measurement, recorded as a solver_runs row like any other, with the same seeds. */
async function measure(q: Query, a: Adapter, levelId: string, level: object, bot: string, runs: number, workerId: string, budget: { threads: number; maxSeconds: number }) {
  const [run] = (await q(
    `insert into solver_runs(level_id, bots, runs_per_bot, status, claimed_by, started_at) values ($1, $2, $3, 'running', $4, now()) returning run_id::text as run_id`,
    [levelId, JSON.stringify([bot]), runs, workerId],
  )) as Row[];
  const runId = String(run!.run_id);
  const out = await runLevelSmart(a, level, [bot], runs, firstSeedFor(runId), { gameId: a.game_id, ...budget });
  await q(`update solver_runs set status = 'done', results = $2, solvable = $3, min_moves = $4, finished_at = now() where run_id = $1`, [
    runId, JSON.stringify(out.results), out.solvable, out.min_moves,
  ]);
  await log(q, "platform", "solver_run.done", "", summarize(out), "solver_run", runId);
  return { runId, out, r: out.results[bot]! };
}

/**
 * The next knob value, in ease coordinates (higher = easier):
 * - measurements on both sides of the target: interpolate between the nearest two;
 * - two or more on one side: extrapolate along their slope, at most 4x the last step;
 * - one measurement: step proportionally to the knob's size and the distance to the target.
 */
export function nextEase(seen: Array<{ e: number; rate: number }>, e: number, rate: number, target: number): number {
  const below = seen.filter((s) => s.rate < target).sort((x, y) => y.e - x.e)[0];
  const above = seen.filter((s) => s.rate > target).sort((x, y) => x.e - y.e)[0];
  if (below && above && above.rate > below.rate) {
    // Blend straight-line interpolation with the midpoint: curves are steep near a game's minimum,
    // so interpolation alone keeps landing on the same side.
    const interp = below.e + ((target - below.rate) * (above.e - below.e)) / (above.rate - below.rate);
    return (interp + (below.e + above.e) / 2) / 2;
  }
  const prev = seen.length >= 2 ? seen[seen.length - 2]! : null;
  if (prev && prev.e !== e && (rate - prev.rate) / (e - prev.e) > 0) {
    const slope = (rate - prev.rate) / (e - prev.e);
    const jump = (target - rate) / slope;
    const cap = 4 * Math.abs(e - prev.e);
    return e + Math.max(-cap, Math.min(cap, jump));
  }
  const step = Math.max(1, Math.round(Math.abs(target - rate) * Math.max(4, Math.abs(e)) * 2));
  return rate < target ? e + step : e - step;
}

export type TuneOutcome =
  | { kind: "idle" }
  | { kind: "accepted"; level_id: string; game_id: string; target: number; measured: number; rounds: number; resumed: boolean }
  | { kind: "rejected"; level_id: string; game_id: string; target: number; reason: string; rounds: number; resumed: boolean };

export async function tuneNextDesign(
  q: Query, workerId: string, getAdapter: GetAdapter, opts: { games: string[]; threads?: number; maxSeconds?: number },
): Promise<TuneOutcome> {
  const d = await claimDesign(q, opts.games);
  if (!d) return { kind: "idle" };
  const a = getAdapter(d.game_id)!;
  const knob = KNOBS[d.game_id]!;
  const bot = referenceBot(a);
  const runs = RUNS[d.game_id] ?? 200;
  const budget = { threads: opts.threads ?? 1, maxSeconds: opts.maxSeconds ?? 120 };
  const reject = async (levelId: string, reason: string, rounds: number): Promise<TuneOutcome> => {
    await q(`update levels set status = 'rejected', updated_at = now() where level_id = $1`, [levelId]);
    await log(q, "tuner", "reject_level", `auto-tuner (program): ${reason}`, "rejected", "level", levelId);
    return { kind: "rejected", level_id: levelId, game_id: d.game_id, target: d.target, reason, rounds, resumed: d.resumed };
  };

  let level = d.level;
  let levelId = d.level_id;
  const v0 = a.validate(level);
  if (!v0.ok) return reject(levelId, `invalid level: ${v0.errors[0]}`, 0);
  if (d.resumed) {
    // A measurement that never finished is marked failed (failStale). Two of them on one version
    // means it may be what stops the harness, so it isn't retried again.
    const [f] = await q(`select count(*)::int as n from solver_runs where level_id = $1 and status = 'failed'`, [levelId]);
    if (Number(f!.n) >= 2) return reject(levelId, "tuning stopped mid-way twice on this version, so it isn't retried", 0);
  }

  // Work in "ease" coordinates e = dir * value, so a higher e always means an easier level.
  let lo = knob.dir === 1 ? knob.lo : -knob.hi;
  let hi = knob.dir === 1 ? knob.hi : -knob.lo;
  let e = Math.min(hi, Math.max(lo, knob.dir * getKnob(level, knob.path)));
  const seen: Array<{ e: number; rate: number }> = [];

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    let m;
    try {
      m = await measure(q, a, levelId, level, bot, runs, workerId, budget);
    } catch (err) {
      return reject(levelId, `solver error: ${err instanceof Error ? err.message : String(err)}`, round);
    }
    if (knob.solverFloor && typeof m.out.min_moves === "number" && knob.dir === 1) lo = Math.max(lo, m.out.min_moves);
    seen.push({ e, rate: m.r.win_rate });
    const why = `${bot} ${m.r.wins}/${m.r.runs} = ${Math.round(m.r.win_rate * 100)}% (95% ${Math.round(m.r.ci95_low * 100)}-${Math.round(m.r.ci95_high * 100)}%), ${knob.path.join(".")} = ${getKnob(level, knob.path)}, target ${Math.round(d.target * 100)}%, round ${round}${d.resumed ? " (resumed after the tune stopped mid-way)" : ""}`;
    if (Math.abs(m.r.win_rate - d.target) <= TOLERANCE + 1e-9 && m.out.solvable !== false) {
      await q(`update levels set status = 'accepted', measured_win_rate = $2, updated_at = now() where level_id = $1`, [levelId, m.r.win_rate]);
      await log(q, "tuner", "accept_level", `auto-tuner (program): ${why}`, `measured ${m.r.win_rate}`, "level", levelId);
      return { kind: "accepted", level_id: levelId, game_id: d.game_id, target: d.target, measured: m.r.win_rate, rounds: round, resumed: d.resumed };
    }
    if (round === MAX_ROUNDS) return reject(levelId, `not within ${TOLERANCE * 100} pts after ${MAX_ROUNDS} rounds: ${why}`, round);

    if (m.r.win_rate < d.target) lo = Math.max(lo, e + 1);
    else hi = Math.min(hi, e - 1);
    if (lo > hi) return reject(levelId, `no ${knob.path.join(".")} value reaches the target: ${why}`, round);
    const next = nextEase(seen, e, m.r.win_rate, d.target);
    e = Math.min(hi, Math.max(lo, Math.round(next)));
    const nextLevel = setKnob(level, knob.path, knob.dir * e);
    const v = a.validate(nextLevel);
    if (!v.ok) return reject(levelId, `retuned level invalid: ${v.errors[0]}`, round);

    // Save the new version (status 'solving' so nothing else picks it up) and retire the old one,
    // in one statement so a stop between the two can't leave the old one 'solving'.
    const [child] = await q(
      `with child as (
         insert into levels(game_id, level, target_win_rate, status, parent_level_id, created_by, notes)
         values ($1, $2, $3, 'solving', $4, 'tuner', $5) returning level_id),
       retired as (update levels set status = 'rejected', updated_at = now() where level_id = $4 returning level_id)
       select child.level_id::text as level_id from child, retired`,
      [d.game_id, JSON.stringify(nextLevel), d.target, levelId, `auto-tune round ${round + 1}: ${knob.path.join(".")} ${getKnob(level, knob.path)} → ${knob.dir * e}`],
    );
    await log(q, "tuner", "save_level", `auto-tuner (program): ${why}; trying ${knob.path.join(".")} = ${knob.dir * e}`, "retuned version saved", "level", String(child!.level_id));
    levelId = String(child!.level_id);
    level = nextLevel;
  }
  return reject(levelId, "unreachable", MAX_ROUNDS);
}
