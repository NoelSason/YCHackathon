import type { Check } from "../types.js";
const check: Check = {
  name: "solver_queue", owner: "Pinara", path: "Design → tune → solve",
  async run({ db }) {
    const r = await db.query(`select
        count(*) filter (where status='queued' and created_at < now() - interval '10 minutes') as stale_queued,
        count(*) filter (where status='running' and started_at < now() - interval '15 minutes') as stuck_running,
        count(*) filter (where status='done' and finished_at > now() - interval '2 hours') as done_2h,
        count(*) filter (where status='failed' and finished_at > now() - interval '2 hours') as failed_2h
      from solver_runs`);
    const x = r.rows[0] as Record<string, string>;
    const stale = Number(x.stale_queued), stuck = Number(x.stuck_running);
    const detail = `done ${x.done_2h}, failed ${x.failed_2h} in 2h; stale queued ${stale}; stuck running ${stuck}`;
    return stale === 0 && stuck === 0 ? { ok: true, detail } : { ok: false, detail: `${detail} (the harness isn't draining the queue)` };
  },
};
export default check;
