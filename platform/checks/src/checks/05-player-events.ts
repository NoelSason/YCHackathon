import type { Check } from "../types.js";
const check: Check = {
  name: "player_events", owner: "Max", path: "Publish → play (events reach Neon)",
  async run({ db, expectRunning }) {
    const r = await db.query(`select count(*) as n, count(distinct session_id) as players from player_events where ts > now() - interval '6 hours' and game_id <> 'stub'`);
    const x = r.rows[0] as { n: string; players: string };
    const detail = `${x.n} events from ${x.players} players in 6h (real games)`;
    return !expectRunning || Number(x.n) > 0 ? { ok: true, detail } : { ok: false, detail: `${detail}: games aren't posting to /events` };
  },
};
export default check;
