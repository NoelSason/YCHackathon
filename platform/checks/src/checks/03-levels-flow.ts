import type { Check } from "../types.js";
const check: Check = {
  name: "levels_flow", owner: "Pinara", path: "Design → tune → solve",
  async run({ db, expectRunning }) {
    const r = await db.query(`select
        count(*) filter (where created_at > now() - interval '3 hours') as designed_3h,
        count(*) filter (where status in ('accepted','published') and updated_at > now() - interval '3 hours') as accepted_3h,
        count(*) filter (where status in ('accepted','published') and measured_win_rate is not null
                         and abs(measured_win_rate - target_win_rate) <= 0.05) as on_target
      from levels where game_id <> 'stub'`);
    const x = r.rows[0] as Record<string, string>;
    const detail = `real-game levels: ${x.designed_3h} designed, ${x.accepted_3h} accepted in 3h; ${x.on_target} accepted within 5 pts of target`;
    if (!expectRunning) return { ok: true, detail: `${detail} (not required before switch-on)` };
    return Number(x.accepted_3h) > 0 ? { ok: true, detail } : { ok: false, detail: `${detail}: no level accepted in the last 3 hours` };
  },
};
export default check;
