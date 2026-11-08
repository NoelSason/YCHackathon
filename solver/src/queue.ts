// The solver_runs queue (platform/db/schema.sql, platform/CONTRACTS.md §2).
// solve_level inserts a row with status 'queued'. The harness claims it ('running', claimed_by,
// started_at), runs the adapter, and writes results, solvable, and min_moves ('done') or an
// error ('failed'). The Tuner polls get_solver_run. Levels are never changed here: the Tuner
// accepts or rejects them.
import type { Adapter } from "../../platform/mcp/src/adapters.js";
import { firstSeedFor, runLevelSmart, summarize } from "./run.js";

export type Row = Record<string, unknown>;
export type Query = (text: string, params?: unknown[]) => Promise<Row[]>;
export type GetAdapter = (game_id: string) => Adapter | undefined;

export interface ClaimedRun {
  run_id: string;
  level_id: string;
  bots: string[];
  runs_per_bot: number;
  game_id: string;
  level: unknown;
}

export type Outcome =
  | { kind: "idle" }
  | { kind: "done"; run_id: string; summary: string; ms: number }
  | { kind: "failed"; run_id: string; error: string; ms: number }
  | { kind: "lost"; run_id: string }; // marked stale by another worker before we finished

const asJson = (v: unknown): unknown => (typeof v === "string" ? JSON.parse(v) : v);

/**
 * Atomically claim the oldest queued run. Safe with several workers (SKIP LOCKED).
 * With `games`, only runs for those games are claimed: a worker started before a game's adapter
 * was added leaves that game's runs queued for an up-to-date worker, instead of failing them
 * (a failed run makes the Tuner reject a level that was fine).
 */
export async function claimNext(q: Query, workerId: string, games?: string[]): Promise<ClaimedRun | null> {
  const run = (
    await q(
      `update solver_runs
          set status = 'running', claimed_by = $1, started_at = now()
        where run_id = (select r.run_id from solver_runs r
                          join levels l on l.level_id = r.level_id
                         where r.status = 'queued'
                           and ($2::text[] is null or l.game_id = any($2::text[]))
                         order by r.created_at
                         for update of r skip locked
                         limit 1)
        returning run_id, level_id, bots, runs_per_bot`,
      [workerId, games ?? null],
    )
  )[0];
  if (!run) return null;
  const lvl = (await q(`select game_id, level from levels where level_id = $1`, [run.level_id]))[0];
  return {
    run_id: String(run.run_id),
    level_id: String(run.level_id),
    bots: (asJson(run.bots) as string[]) ?? [],
    runs_per_bot: Number(run.runs_per_bot),
    game_id: String(lvl?.game_id ?? ""),
    level: asJson(lvl?.level),
  };
}

async function logActivity(q: Query, action: string, result: string, runId: string): Promise<void> {
  // Same pattern as the platform's own audit rows (agent 'platform'), so the autonomy number,
  // which counts agent != 'platform', is unaffected.
  await q(
    `insert into activity_log(agent, action, result, ref_kind, ref_id) values ('platform', $1, $2, 'solver_run', $3)`,
    [action, result, runId],
  );
}

export interface ProcessOptions {
  maxSeconds?: number; // time budget per run (default 240 s, well under the 15-minute stale rule)
  threads?: number;    // worker threads for slow games (default 1)
  games?: string[];    // claim only runs for these games (the worker passes its adapter registry)
}

/** Claim one run and finish it. Returns what happened; never throws for a bad run. */
export async function processNext(q: Query, workerId: string, getAdapter: GetAdapter, opts: ProcessOptions = {}): Promise<Outcome> {
  const run = await claimNext(q, workerId, opts.games);
  if (!run) return { kind: "idle" };
  const t0 = Date.now();

  let error: string;
  try {
    const adapter = getAdapter(run.game_id);
    if (!adapter) {
      throw new Error(`no adapter for game ${run.game_id || "(unknown)"} in this worker; pull and restart the worker`);
    }
    const out = await runLevelSmart(adapter, run.level, run.bots, run.runs_per_bot, firstSeedFor(run.run_id), {
      gameId: run.game_id,
      maxSeconds: opts.maxSeconds,
      threads: opts.threads,
    });
    const done = await q(
      `update solver_runs
          set status = 'done', results = $3, solvable = $4, min_moves = $5, error = null, finished_at = now()
        where run_id = $1 and status = 'running' and claimed_by = $2
        returning run_id`,
      [run.run_id, workerId, JSON.stringify(out.results), out.solvable, out.min_moves],
    );
    if (!done.length) return { kind: "lost", run_id: run.run_id };
    const summary = summarize(out);
    await logActivity(q, "solver_run.done", summary, run.run_id);
    return { kind: "done", run_id: run.run_id, summary, ms: Date.now() - t0 };
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const failed = await q(
    `update solver_runs set status = 'failed', error = $3, finished_at = now()
      where run_id = $1 and status = 'running' and claimed_by = $2
      returning run_id`,
    [run.run_id, workerId, error.slice(0, 2000)],
  );
  if (!failed.length) return { kind: "lost", run_id: run.run_id };
  await logActivity(q, "solver_run.failed", error.slice(0, 500), run.run_id);
  return { kind: "failed", run_id: run.run_id, error, ms: Date.now() - t0 };
}

/**
 * Runs left 'running' for too long (a worker crashed or was stopped) are marked failed, so the
 * Tuner sees an error instead of polling forever. It can queue the level again.
 */
export async function failStale(q: Query, minutes: number): Promise<string[]> {
  const rows = await q(
    `update solver_runs
        set status = 'failed', finished_at = now(),
            error = 'harness stopped before finishing (claimed by ' || coalesce(claimed_by, 'unknown') || ')'
      where status = 'running' and started_at < now() - ($1::int * interval '1 minute')
      returning run_id`,
    [minutes],
  );
  const ids = rows.map((r) => String(r.run_id));
  for (const id of ids) await logActivity(q, "solver_run.failed", "harness stopped before finishing", id);
  return ids;
}

export interface Heartbeat {
  worker: string;
  games: string[];     // the game ids this worker can play (its adapter registry at start)
  started_at: string;
  at: string;          // last write; readers treat a worker as gone when this is old
  stopped?: true;      // written on a clean stop
}

/**
 * Writes this worker's heartbeat to settings under 'solver_worker:<worker id>', so the readiness
 * check and teammates can see that a worker is alive and which games it knows. Only this key.
 */
export async function writeHeartbeat(q: Query, hb: Heartbeat): Promise<void> {
  await q(
    `insert into settings(key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value`,
    [`solver_worker:${hb.worker}`, JSON.stringify(hb)],
  );
}

/** Queued runs for games none of `games` covers, per game. The worker warns about these. */
export async function unplayableQueued(q: Query, games: string[]): Promise<Record<string, number>> {
  const rows = await q(
    `select l.game_id, count(*)::int as n from solver_runs r join levels l on l.level_id = r.level_id
      where r.status = 'queued' and not (l.game_id = any($1::text[]))
      group by l.game_id order by l.game_id`,
    [games],
  );
  return Object.fromEntries(rows.map((r) => [String(r.game_id), Number(r.n)]));
}
