import type { Check } from "../types.js";
const check: Check = {
  name: "ceo_decision", owner: "Abhinav", path: "CEO decision",
  async run({ db, expectRunning }) {
    const r = await db.query(`select
        count(*) filter (where ts > now() - interval '2 hours') as recent,
        count(*) filter (where resolved_at is not null) as resolved,
        count(*) filter (where matched_expectation) as matched,
        max(ts) as last
      from decisions where agent = 'ceo'`);
    const x = r.rows[0] as { recent: string; resolved: string; matched: string; last: string | null };
    const detail = `${x.recent} decisions in 2h, ${x.resolved} resolved, ${x.matched} matched expectation; last ${x.last ?? "never"}`;
    if (!expectRunning) return { ok: true, detail: `${detail} (not required before switch-on)` };
    return Number(x.recent) > 0 ? { ok: true, detail } : { ok: false, detail: `${detail}: the CEO cron isn't producing decisions` };
  },
};
export default check;
