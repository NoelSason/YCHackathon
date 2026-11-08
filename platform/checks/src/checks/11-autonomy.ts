import type { Check } from "../types.js";
const check: Check = {
  name: "autonomy", owner: "Abhinav", path: "Dashboard (the number comes from the logs)",
  async run({ db }) {
    const r = await db.query(`select
        (select count(*) from activity_log where agent <> 'platform' and ts > now() - interval '12 hours') as agent_actions,
        (select count(*) from interventions where ts > now() - interval '12 hours') as interventions`);
    const x = r.rows[0] as { agent_actions: string; interventions: string };
    const a = Number(x.agent_actions), h = Number(x.interventions);
    const pct = a + h ? Math.round((100 * a) / (a + h)) : 0;
    return { ok: true, detail: `last 12h: ${a} agent actions, ${h} human step-ins → ${pct}% autonomous` };
  },
};
export default check;
