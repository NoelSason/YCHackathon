import type { Check } from "../types.js";

// docs/master-plan.md, "Demo readiness": "A new level for each live game reaches its target and is
// saved." Per game, not overall: every real game must have an accepted level within 5 pts of its
// target in the last 3 hours. Also reports when the solver harness last finished a run.
const check: Check = {
  name: "design_tune_solve", owner: "Pinara", path: "Design → tune → solve",
  async run({ db, expectRunning }) {
    const games = await db.query(`
      select g.game_id,
             count(l.*) filter (where l.status in ('accepted','published') and l.updated_at > now() - interval '3 hours'
                                  and l.measured_win_rate is not null
                                  and abs(l.measured_win_rate - l.target_win_rate) <= 0.05) as on_target_3h,
             max(l.updated_at) filter (where l.status in ('accepted','published')) as last_accepted
        from games g left join levels l on l.game_id = g.game_id
       where g.game_id <> 'stub'
       group by g.game_id order by g.game_id`);
    const harness = await db.query(`
      select claimed_by, finished_at from solver_runs
       where status in ('done','failed') and finished_at is not null
       order by finished_at desc limit 1`);
    const h = harness.rows[0] as { claimed_by: string | null; finished_at: Date } | undefined;
    const harnessNote = h
      ? `harness last finished a run ${Math.round((Date.now() - new Date(h.finished_at).getTime()) / 60000)} min ago (${h.claimed_by ?? "unknown worker"})`
      : "harness has never finished a run";

    const rows = games.rows as Array<{ game_id: string; on_target_3h: string; last_accepted: Date | null }>;
    if (!rows.length) {
      const detail = `no real games in the games table (only stub); ${harnessNote}`;
      return expectRunning ? { ok: false, detail: `${detail}: redeploy the platform so it seeds a row per adapter` } : { ok: true, detail: `${detail} (not required before switch-on)` };
    }
    const per = rows.map((r) => `${r.game_id} ${r.on_target_3h}`);
    const missing = rows.filter((r) => Number(r.on_target_3h) === 0).map((r) => r.game_id);
    const detail = `levels accepted on target in 3h: ${per.join(", ")}; ${harnessNote}`;
    if (!expectRunning) return { ok: true, detail: `${detail} (not required before switch-on)` };
    return missing.length
      ? { ok: false, detail: `${detail}. No on-target level yet for: ${missing.join(", ")}` }
      : { ok: true, detail };
  },
};
export default check;
