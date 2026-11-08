// The CEO's "did that decision work?" check (docs/master-plan.md, package 11).
//
// Given a decision from the `decisions` table, measure what happened after it:
//   1. Scope: the levels the decision names (any level ids in its text or cards), plus the newer
//      versions the Tuner made from them after the decision, and the games it names.
//   2. Player results on those levels before vs. after, against the same games' untouched levels
//      over the same windows (difference-in-differences), so a busier or quieter hour doesn't
//      look like an effect.
//   3. Whether an explicit expectation like "quits below 35%" was met.
//   4. What the pipeline shipped since (levels designed, accepted, rejected; packs published).
// It never writes anything. Output fields avoid person-like names (only counts and rates).

export type Row = Record<string, unknown>;
export type Query = (text: string, params?: unknown[]) => Promise<Row[]>;

export interface Rates {
  plays: number;     // attempts started
  finished: number;  // attempts that ended in a win, loss, or quit
  wins: number;
  quits: number;
  win_rate: number | null;
  quit_rate: number | null;
}

export interface Expectation {
  metric: "win_rate" | "quit_rate";
  op: "<" | ">";
  value: number; // 0..1
  text: string;  // the phrase it was read from
}

export interface DecisionCheck {
  decision_id: string;
  decided_at: string;
  hours_since: number;
  expected: string | null;
  scope: { games: string[]; levels: string[]; newer_versions: string[] };
  window_hours: number;
  changed: { before: Rates; after: Rates };
  untouched: { before: Rates; after: Rates } | null;
  effect: {
    method: "vs_untouched_levels" | "before_after_only" | "none";
    win_rate_pts: number | null;   // change attributable to the decision, in percentage points
    quit_rate_pts: number | null;
    z_win: number | null;          // |z| >= 2 is a clear change
    z_quit: number | null;
  };
  expectation: Expectation | null;
  meets_expectation: boolean | null; // null when the expectation isn't a simple threshold, or data is short
  pipeline_since: {
    levels_designed: number;
    levels_accepted: number;
    levels_rejected: number;
    packs_published: number;
    mean_target_error_pts: number | null;
  };
  enough_data: boolean;
  verdict: "changed" | "no_clear_change" | "not_enough_data";
  summary: string;
}

export interface CheckOptions {
  now?: Date;
  minFinished?: number;   // finished attempts needed in each compared group
  maxWindowHours?: number;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const pct = (x: number | null): string => (x === null ? "n/a" : `${Math.round(x * 1000) / 10}%`);
const pts = (x: number): string => `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x * 10) / 10)} pts`;
const round = (x: number, d = 4): number => Math.round(x * 10 ** d) / 10 ** d;

function rates(row: Row | undefined): Rates {
  const plays = num(row?.plays);
  const wins = num(row?.wins);
  const losses = num(row?.losses);
  const quits = num(row?.quits);
  const finished = wins + losses + quits;
  return {
    plays,
    finished,
    wins,
    quits,
    win_rate: finished ? round(wins / finished) : null,
    quit_rate: finished ? round(quits / finished) : null,
  };
}

/** Read "quit(s) ... below 35%" or "win rate ... above 40%" style expectations. */
export function parseExpectation(text: string | null): Expectation | null {
  if (!text) return null;
  const re = /\b(quit(?:s|ting)?(?:\s+rate)?|win(?:s|ning)?(?:\s+rate)?)\b[^.;%]*?\b(below|under|less than|lower than|fewer than|at most|above|over|more than|higher than|at least)\s+(\d+(?:\.\d+)?)\s*%/i;
  const m = re.exec(text);
  if (!m) return null;
  const metric = /^quit/i.test(m[1]!) ? "quit_rate" : "win_rate";
  const op = /below|under|less|lower|fewer|at most/i.test(m[2]!) ? "<" : ">";
  return { metric, op, value: Number(m[3]) / 100, text: m[0] };
}

async function windowRates(q: Query, levelIds: string[], from: Date, to: Date): Promise<Rates> {
  if (!levelIds.length) return rates(undefined);
  const [row] = await q(
    `select count(*) filter (where type = 'attempt') as plays,
            count(*) filter (where type = 'win')     as wins,
            count(*) filter (where type = 'loss')    as losses,
            count(*) filter (where type = 'quit')    as quits
       from player_events
      where level_id = any($1::uuid[]) and ts >= $2 and ts < $3`,
    [levelIds, from.toISOString(), to.toISOString()],
  );
  return rates(row);
}

/** Change in a rate between two groups' before/after, with a z-score from binomial variances. */
function diff(
  tb: Rates, ta: Rates, cb: Rates | null, ca: Rates | null, key: "win_rate" | "quit_rate",
): { pts: number | null; z: number | null } {
  const groups = cb && ca ? [tb, ta, cb, ca] : [tb, ta];
  if (groups.some((g) => g[key] === null)) return { pts: null, z: null };
  const p = (g: Rates) => g[key]!;
  const d = cb && ca ? p(ta) - p(tb) - (p(ca) - p(cb)) : p(ta) - p(tb);
  // Variance with a small floor so 0% or 100% groups don't claim infinite certainty.
  const variance = groups.reduce((s, g) => s + Math.max(p(g) * (1 - p(g)), 0.0025) / g.finished, 0);
  return { pts: round(d * 100, 1), z: round(d / Math.sqrt(variance), 2) };
}

export async function checkDecision(q: Query, decisionId: string, opts: CheckOptions = {}): Promise<DecisionCheck | null> {
  const now = opts.now ?? new Date();
  const minFinished = opts.minFinished ?? 15;
  const maxWindowHours = opts.maxWindowHours ?? 6;

  const [d] = await q(`select id, ts, saw, chose, why, expected, cards from decisions where id = $1`, [decisionId]);
  if (!d) return null;
  const decidedAt = new Date(String(d.ts instanceof Date ? d.ts.toISOString() : d.ts));
  const cards = typeof d.cards === "string" ? d.cards : JSON.stringify(d.cards ?? []);
  const text = [d.saw, d.chose, d.why, d.expected, cards].map((x) => (x == null ? "" : String(x))).join(" \n ");
  const expected = d.expected == null ? null : String(d.expected);

  // ---- scope ----
  const mentioned = [...new Set((text.match(UUID) ?? []).map((s) => s.toLowerCase()))];
  const named = mentioned.length
    ? await q(`select level_id::text as level_id, game_id from levels where level_id = any($1::uuid[])`, [mentioned])
    : [];
  const levelIds = named.map((r) => String(r.level_id));
  const newer = levelIds.length
    ? await q(
        `with recursive tree as (
           select level_id, game_id from levels where parent_level_id = any($1::uuid[]) and created_at >= $2
           union
           select l.level_id, l.game_id from levels l join tree t on l.parent_level_id = t.level_id
         )
         select level_id::text as level_id, game_id from tree`,
        [levelIds, decidedAt.toISOString()],
      )
    : [];
  const newerIds = newer.map((r) => String(r.level_id));
  const allGames = (await q(`select game_id from games`)).map((r) => String(r.game_id));
  const games = [
    ...new Set([
      ...named.map((r) => String(r.game_id)),
      ...allGames.filter((g) => g !== "stub" && new RegExp(`\\b${g}\\b`, "i").test(text)),
    ]),
  ].sort();

  // ---- windows ----
  const hoursSince = (now.getTime() - decidedAt.getTime()) / 3_600_000;
  const windowHours = Math.max(0, Math.min(hoursSince, maxWindowHours));
  const beforeFrom = new Date(decidedAt.getTime() - windowHours * 3_600_000);
  const afterTo = new Date(decidedAt.getTime() + windowHours * 3_600_000);

  // The "changed" group: named levels (and their newer versions). With no level named, the
  // whole named game(s) — then there's no untouched group to compare against.
  let changedBefore: string[] = levelIds;
  let changedAfter: string[] = [...levelIds, ...newerIds];
  let untouchedIds: string[] = [];
  if (!levelIds.length && games.length) {
    const all = (await q(`select level_id::text as level_id from levels where game_id = any($1)`, [games])).map((r) => String(r.level_id));
    changedBefore = all;
    changedAfter = all;
  } else if (levelIds.length) {
    const exclude = new Set([...levelIds, ...newerIds]);
    untouchedIds = (await q(`select level_id::text as level_id from levels where game_id = any($1)`, [games]))
      .map((r) => String(r.level_id))
      .filter((id) => !exclude.has(id));
  }

  const tb = await windowRates(q, changedBefore, beforeFrom, decidedAt);
  const ta = await windowRates(q, changedAfter, decidedAt, afterTo);
  const cb = untouchedIds.length ? await windowRates(q, untouchedIds, beforeFrom, decidedAt) : null;
  const ca = untouchedIds.length ? await windowRates(q, untouchedIds, decidedAt, afterTo) : null;
  const controlOk = !!(cb && ca && cb.finished >= minFinished && ca.finished >= minFinished);
  const enough = windowHours >= 0.25 && tb.finished >= minFinished && ta.finished >= minFinished;

  const method: DecisionCheck["effect"]["method"] = !enough ? "none" : controlOk ? "vs_untouched_levels" : "before_after_only";
  const w = enough ? diff(tb, ta, controlOk ? cb : null, controlOk ? ca : null, "win_rate") : { pts: null, z: null };
  const qd = enough ? diff(tb, ta, controlOk ? cb : null, controlOk ? ca : null, "quit_rate") : { pts: null, z: null };

  // ---- expectation ----
  const expectation = parseExpectation(expected);
  let meets: boolean | null = null;
  if (expectation && ta.finished >= minFinished) {
    const v = ta[expectation.metric];
    if (v !== null) meets = expectation.op === "<" ? v < expectation.value : v > expectation.value;
  }

  // ---- pipeline since the decision ----
  const scopeGames = games.length ? games : allGames.filter((g) => g !== "stub");
  const [pipe] = await q(
    `select count(*) filter (where created_at >= $2) as designed,
            count(*) filter (where status in ('accepted','published') and updated_at >= $2) as accepted,
            count(*) filter (where status = 'rejected' and updated_at >= $2) as rejected,
            avg(abs(measured_win_rate - target_win_rate)) filter (
              where status in ('accepted','published') and updated_at >= $2 and measured_win_rate is not null) as err
       from levels where game_id = any($1)`,
    [scopeGames, decidedAt.toISOString()],
  );
  const [packs] = await q(`select count(*) as n from packs where game_id = any($1) and published_at >= $2`, [scopeGames, decidedAt.toISOString()]);

  // ---- verdict and summary ----
  const clear = (z: number | null) => z !== null && Math.abs(z) >= 2;
  const verdict: DecisionCheck["verdict"] = !enough ? "not_enough_data" : clear(w.z) || clear(qd.z) ? "changed" : "no_clear_change";
  const parts: string[] = [];
  if (!games.length && !levelIds.length) {
    parts.push("This decision names no game or level, so player results can't judge it; see pipeline_since.");
  } else if (windowHours < 0.25) {
    parts.push(`Decided ${Math.round(hoursSince * 60)} minutes ago; too early to measure.`);
  } else if (!enough) {
    parts.push(
      `Not enough plays yet: ${tb.finished} finished before and ${ta.finished} after (need ${minFinished} each) over ${round(windowHours, 1)} h windows.`,
    );
  } else {
    const where = levelIds.length ? `the ${levelIds.length} level(s) it changed` : `${games.join(", ")}`;
    parts.push(
      `On ${where}: win rate ${pct(tb.win_rate)} → ${pct(ta.win_rate)}, quit rate ${pct(tb.quit_rate)} → ${pct(ta.quit_rate)} (${tb.finished} vs ${ta.finished} finished plays).`,
    );
    if (method === "vs_untouched_levels") {
      parts.push(
        `Untouched levels moved ${pct(cb!.win_rate)} → ${pct(ca!.win_rate)} (win), so the decision's own effect is ${pts(w.pts!)} win rate (z ${w.z}) and ${pts(qd.pts!)} quit rate (z ${qd.z}).`,
      );
    } else {
      parts.push(`No untouched levels with enough plays to compare against; this is before vs. after only (z ${w.z} win, ${qd.z} quit).`);
    }
    parts.push(verdict === "changed" ? "That is a clear change." : "That is within noise.");
  }
  if (expectation) {
    parts.push(
      meets === null
        ? `Expectation "${expectation.text}" can't be judged yet.`
        : `Expectation "${expectation.text}": ${meets ? "met" : "not met"} (now ${pct(ta[expectation.metric])}).`,
    );
  }

  return {
    decision_id: String(d.id),
    decided_at: decidedAt.toISOString(),
    hours_since: round(hoursSince, 2),
    expected,
    scope: { games, levels: levelIds, newer_versions: newerIds },
    window_hours: round(windowHours, 2),
    changed: { before: tb, after: ta },
    untouched: cb && ca ? { before: cb, after: ca } : null,
    effect: { method, win_rate_pts: w.pts, quit_rate_pts: qd.pts, z_win: w.z, z_quit: qd.z },
    expectation,
    meets_expectation: meets,
    pipeline_since: {
      levels_designed: num(pipe?.designed),
      levels_accepted: num(pipe?.accepted),
      levels_rejected: num(pipe?.rejected),
      packs_published: num(packs?.n),
      mean_target_error_pts: pipe?.err == null ? null : round(Number(pipe.err) * 100, 1),
    },
    enough_data: enough,
    verdict,
    summary: parts.join(" "),
  };
}
