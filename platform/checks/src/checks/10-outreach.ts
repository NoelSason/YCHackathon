import type { Check } from "../types.js";
const check: Check = {
  name: "outreach", owner: "Noel", path: "Outreach",
  async run({ db, expectRunning }) {
    const r = await db.query(`select
        (select count(*) from studios) as studios,
        (select count(*) from studios where stage <> 'found') as progressed,
        (select count(*) from emails e join studios s on s.studio_id = e.studio_id
          where e.direction='out' and e.ts > now() - interval '24 hours' and coalesce(s.source, '') = 'research') as sent_24h,
        (select count(*) from emails e left join studios s on s.studio_id = e.studio_id
          where e.direction='out' and e.ts > now() - interval '24 hours' and coalesce(s.source, '') <> 'research') as signup_24h,
        (select count(*) from emails where direction='in') as replies`);
    const x = r.rows[0] as Record<string, string>;
    // The 20/day cap is for cold outreach. Emails people asked for (signups, playtest reports) don't count.
    const detail = `${x.studios} studios, ${x.progressed} past 'found', ${x.sent_24h} cold emails + ${x.signup_24h} requested emails in 24h, ${x.replies} replies`;
    if (Number(x.sent_24h) > 20) return { ok: false, detail: `${detail}: over the 20/day cap` };
    return !expectRunning || Number(x.sent_24h) > 0 ? { ok: true, detail } : { ok: false, detail: `${detail}: no outreach sent since switch-on` };
  },
};
export default check;
