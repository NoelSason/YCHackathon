// Evals (docs/master-plan.md, package 11): how well the level pipeline is doing, from the database.
//
// Per game:
//   - Tuner outcome per design: each root level (no parent) and the versions tuned from it.
//     A design "hits" when a version in its chain is accepted within MAX_ROUNDS versions and
//     within TOLERANCE of its target.
//   - Error of accepted levels against their target.
//   - Solver runs done / failed.
//   - Calibration: for accepted or published levels with enough finished plays, the reference
//     bot's predicted win rate vs. the real win rate. This is the number that shows the bots
//     predict people.
//   - Cost per accepted level, from activity_log cost_usd of the Designer and Tuner (0 when the
//     agents didn't report cost).
// Read-only.
import type { Query, Row } from "./decision-check.js";

export const MAX_ROUNDS = 4;
export const TOLERANCE = 0.05;
export const REFERENCE_BOTS = ["human", "search", "greedy"] as const;

export interface CalibrationPoint {
  level_id: string;
  bot: string;
  predicted: number;
  actual: number;
  finished: number;
}

export interface GameEval {
  game_id: string;
  designs: number;
  accepted: number;
  rejected: number;
  pending: number;
  hits: number;                 // accepted within MAX_ROUNDS versions and TOLERANCE of target
  hit_rate: number | null;      // hits / (accepted + rejected)
  mean_rounds_to_accept: number | null;
  mean_abs_error_pts: number | null;
  solver_runs: { done: number; failed: number; queued_or_running: number };
  calibration: { points: CalibrationPoint[]; mean_abs_gap_pts: number | null; bias_pts: number | null };
}

export interface EvalReport {
  generated_at: string;
  since: string | null;
  games: GameEval[];
  totals: {
    designs: number;
    accepted: number;
    hit_rate: number | null;
    mean_abs_error_pts: number | null;
    calibration_gap_pts: number | null;
    cost_usd: number;
    cost_per_accepted_usd: number | null;
  };
}

/** The bot whose win rate stands in for people: the first of human, search, greedy; else the first. */
export function referenceBot(results: Record<string, unknown>): string | null {
  const bots = Object.keys(results);
  return REFERENCE_BOTS.find((b) => bots.includes(b)) ?? bots[0] ?? null;
}

const n = (v: unknown) => Number(v ?? 0);
const r1 = (x: number) => Math.round(x * 10) / 10;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export async function evalReport(q: Query, opts: { since?: Date; minFinished?: number } = {}): Promise<EvalReport> {
  const since = opts.since ?? null;
  const minFinished = opts.minFinished ?? 15;
  const sinceIso = since ? since.toISOString() : null;

  const levels = await q(
    `select level_id::text as level_id, game_id, parent_level_id::text as parent_level_id, status,
            target_win_rate, measured_win_rate, created_at
       from levels
      where game_id <> 'stub' and ($1::timestamptz is null or created_at >= $1::timestamptz)
      order by created_at`,
    [sinceIso],
  );
  const byId = new Map(levels.map((l) => [String(l.level_id), l]));
  const children = new Map<string, Row[]>();
  for (const l of levels) {
    const p = l.parent_level_id ? String(l.parent_level_id) : null;
    if (p && byId.has(p)) children.set(p, [...(children.get(p) ?? []), l]);
  }

  const runs = await q(
    `select l.game_id, r.status, count(*) as n
       from solver_runs r join levels l using (level_id)
      where l.game_id <> 'stub' and ($1::timestamptz is null or r.created_at >= $1::timestamptz)
      group by 1, 2`,
    [sinceIso],
  );

  // Latest done run per level, for calibration.
  const lastRuns = await q(
    `select distinct on (r.level_id) r.level_id::text as level_id, r.results
       from solver_runs r join levels l using (level_id)
      where r.status = 'done' and l.status in ('accepted','published') and l.game_id <> 'stub'
      order by r.level_id, r.finished_at desc nulls last`,
  );
  const played = await q(
    `select level_id::text as level_id,
            count(*) filter (where type = 'win') as wins,
            count(*) filter (where type in ('win','loss','quit')) as finished
       from player_events where level_id is not null group by 1`,
  );
  const playedBy = new Map(played.map((p) => [String(p.level_id), p]));

  const games = [...new Set(levels.map((l) => String(l.game_id)))].sort();
  const out: GameEval[] = [];
  const allErr: number[] = [];
  for (const g of games) {
    const roots = levels.filter((l) => l.game_id === g && (!l.parent_level_id || !byId.has(String(l.parent_level_id))));
    let accepted = 0, rejected = 0, pending = 0, hits = 0;
    const rounds: number[] = [];
    const errors: number[] = [];
    for (const root of roots) {
      // Walk the chain breadth-first, tracking each version's depth (root = round 1).
      const queue: Array<{ l: Row; depth: number }> = [{ l: root, depth: 1 }];
      let acceptedAt: { l: Row; depth: number } | null = null;
      let anyRejected = false;
      while (queue.length) {
        const cur = queue.shift()!;
        const st = String(cur.l.status);
        if ((st === "accepted" || st === "published") && (!acceptedAt || cur.depth < acceptedAt.depth)) acceptedAt = cur;
        if (st === "rejected") anyRejected = true;
        for (const c of children.get(String(cur.l.level_id)) ?? []) queue.push({ l: c, depth: cur.depth + 1 });
      }
      if (acceptedAt) {
        accepted++;
        rounds.push(acceptedAt.depth);
        const m = acceptedAt.l.measured_win_rate;
        const t = n(acceptedAt.l.target_win_rate);
        if (m !== null && m !== undefined) {
          const err = Math.abs(n(m) - t);
          errors.push(err * 100);
          allErr.push(err * 100);
          if (acceptedAt.depth <= MAX_ROUNDS && err <= TOLERANCE + 1e-9) hits++;
        }
      } else if (anyRejected) rejected++;
      else pending++;
    }

    const runRows = runs.filter((r) => r.game_id === g);
    const runCount = (s: string[]) => runRows.filter((r) => s.includes(String(r.status))).reduce((a, r) => a + n(r.n), 0);

    const points: CalibrationPoint[] = [];
    for (const lr of lastRuns) {
      const lvl = byId.get(String(lr.level_id));
      if (!lvl || lvl.game_id !== g) continue;
      const p = playedBy.get(String(lr.level_id));
      if (!p || n(p.finished) < minFinished) continue;
      const results = (typeof lr.results === "string" ? JSON.parse(lr.results) : lr.results) as Record<string, { win_rate?: number }>;
      const bot = referenceBot(results);
      if (!bot || typeof results[bot]?.win_rate !== "number") continue;
      points.push({
        level_id: String(lr.level_id),
        bot,
        predicted: results[bot]!.win_rate!,
        actual: Math.round((n(p.wins) / n(p.finished)) * 10_000) / 10_000,
        finished: n(p.finished),
      });
    }
    const gaps = points.map((p) => Math.abs(p.actual - p.predicted) * 100);
    const bias = points.map((p) => (p.actual - p.predicted) * 100);
    const resolved = accepted + rejected;
    const mr = mean(rounds);
    const me = mean(errors);
    const mg = mean(gaps);
    const mb = mean(bias);
    out.push({
      game_id: g,
      designs: roots.length,
      accepted,
      rejected,
      pending,
      hits,
      hit_rate: resolved ? Math.round((hits / resolved) * 1000) / 1000 : null,
      mean_rounds_to_accept: mr === null ? null : r1(mr),
      mean_abs_error_pts: me === null ? null : r1(me),
      solver_runs: { done: runCount(["done"]), failed: runCount(["failed"]), queued_or_running: runCount(["queued", "running"]) },
      calibration: { points, mean_abs_gap_pts: mg === null ? null : r1(mg), bias_pts: mb === null ? null : r1(mb) },
    });
  }

  const [cost] = await q(
    `select coalesce(sum(cost_usd), 0) as usd from activity_log
      where agent in ('designer','tuner') and ($1::timestamptz is null or ts >= $1::timestamptz)`,
    [sinceIso],
  );
  const totalAccepted = out.reduce((a, g) => a + g.accepted, 0);
  const totalResolved = out.reduce((a, g) => a + g.accepted + g.rejected, 0);
  const totalHits = out.reduce((a, g) => a + g.hits, 0);
  const allGaps = out.flatMap((g) => g.calibration.points.map((p) => Math.abs(p.actual - p.predicted) * 100));
  const usd = n(cost?.usd);
  const e = mean(allErr);
  const cg = mean(allGaps);
  return {
    generated_at: new Date().toISOString(),
    since: sinceIso,
    games: out,
    totals: {
      designs: out.reduce((a, g) => a + g.designs, 0),
      accepted: totalAccepted,
      hit_rate: totalResolved ? Math.round((totalHits / totalResolved) * 1000) / 1000 : null,
      mean_abs_error_pts: e === null ? null : r1(e),
      calibration_gap_pts: cg === null ? null : r1(cg),
      cost_usd: Math.round(usd * 10_000) / 10_000,
      cost_per_accepted_usd: totalAccepted && usd > 0 ? Math.round((usd / totalAccepted) * 10_000) / 10_000 : null,
    },
  };
}

/** A plain-text table for the terminal and the log. */
export function formatReport(r: EvalReport): string {
  const lines: string[] = [];
  const v = (x: number | null, suffix = "") => (x === null ? "–" : `${x}${suffix}`);
  lines.push(`Level pipeline evals${r.since ? ` since ${r.since}` : ""} (generated ${r.generated_at})`);
  lines.push("");
  lines.push("game       designs  accepted  rejected  pending  hit rate  rounds  error  solver done/failed  calibration gap (n)");
  for (const g of r.games) {
    lines.push(
      [
        g.game_id.padEnd(10),
        String(g.designs).padStart(7),
        String(g.accepted).padStart(9),
        String(g.rejected).padStart(9),
        String(g.pending).padStart(8),
        (g.hit_rate === null ? "–" : `${Math.round(g.hit_rate * 100)}%`).padStart(9),
        v(g.mean_rounds_to_accept).padStart(7),
        v(g.mean_abs_error_pts, " pts").padStart(6),
        `${g.solver_runs.done}/${g.solver_runs.failed}`.padStart(19),
        `${v(g.calibration.mean_abs_gap_pts, " pts")} (${g.calibration.points.length})`.padStart(20),
      ].join(" "),
    );
  }
  if (!r.games.length) lines.push("(no real-game levels yet)");
  const t = r.totals;
  lines.push("");
  lines.push(
    `Total: ${t.designs} designs, ${t.accepted} accepted, hit rate ${t.hit_rate === null ? "–" : `${Math.round(t.hit_rate * 100)}%`} ` +
      `(within ${MAX_ROUNDS} versions and ${TOLERANCE * 100} pts), mean error ${v(t.mean_abs_error_pts, " pts")}, ` +
      `bots vs. real win rate gap ${v(t.calibration_gap_pts, " pts")}, Designer+Tuner cost $${t.cost_usd}` +
      `${t.cost_per_accepted_usd === null ? "" : ` ($${t.cost_per_accepted_usd} per accepted level)`}.`,
  );
  return lines.join("\n");
}
