import type { Check } from "../types.js";

// The harness drains the queue, a worker is alive, and it knows every game that has queued runs.
// Workers write a heartbeat to settings ('solver_worker:<id>', see solver/src/queue.ts) every 30 s
// with the games their adapter registry had at start.
const HEARTBEAT_FRESH_MIN = 3;

interface Heartbeat { worker: string; games: string[]; at: string; stopped?: boolean }

const check: Check = {
  name: "solver_queue", owner: "Pinara", path: "Design → tune → solve",
  async run({ db, expectRunning }) {
    const r = await db.query(`select
        count(*) filter (where status='queued' and created_at < now() - interval '10 minutes') as stale_queued,
        count(*) filter (where status='running' and started_at < now() - interval '15 minutes') as stuck_running,
        count(*) filter (where status='done' and finished_at > now() - interval '2 hours') as done_2h,
        count(*) filter (where status='failed' and finished_at > now() - interval '2 hours') as failed_2h
      from solver_runs`);
    const x = r.rows[0] as Record<string, string>;
    const stale = Number(x.stale_queued), stuck = Number(x.stuck_running);

    const hb = await db.query(`select value from settings where key like 'solver_worker:%'`);
    const live = (hb.rows as Array<{ value: Heartbeat }>)
      .map((row) => row.value)
      .filter((v) => !v.stopped && Date.now() - new Date(v.at).getTime() < HEARTBEAT_FRESH_MIN * 60_000);
    const known = [...new Set(live.flatMap((v) => v.games))].sort();
    const queued = await db.query(
      `select l.game_id, count(*)::int as n from solver_runs r join levels l on l.level_id = r.level_id
        where r.status = 'queued' group by l.game_id order by l.game_id`);
    const unplayable = (queued.rows as Array<{ game_id: string; n: number }>).filter((q) => !known.includes(q.game_id));

    const workers = live.length
      ? `${live.length} live worker(s) (${live.map((v) => v.worker).join(", ")}) knowing ${known.join(", ")}`
      : "no live worker heartbeat";
    const detail = `${workers}; done ${x.done_2h}, failed ${x.failed_2h} in 2h; stale queued ${stale}; stuck running ${stuck}`;

    const problems: string[] = [];
    if (unplayable.length) {
      problems.push(`queued runs no live worker can play: ${unplayable.map((u) => `${u.game_id} ${u.n}`).join(", ")} (cd solver && git pull && restart the worker)`);
    }
    if (stale || stuck) problems.push("the harness isn't draining the queue");
    if (!live.length && expectRunning) problems.push("start the worker: cd solver && caffeinate -i npm run worker");
    if (problems.length) return { ok: false, detail: `${detail}. ${problems.join("; ")}` };
    return { ok: true, detail: live.length || expectRunning ? detail : `${detail} (not required before switch-on)` };
  },
};
export default check;
