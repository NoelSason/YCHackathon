import type { Check } from "../types.js";
const check: Check = {
  name: "publish_play", owner: "Max", path: "Publish → play",
  async run({ db, env }) {
    const p = await db.query(`select p.pack_id, p.game_id, p.level_ids, g.base_url from packs p join games g using (game_id) order by published_at desc limit 1`);
    if (!p.rows.length) return { ok: false, detail: "no pack published yet" };
    const pack = p.rows[0] as { pack_id: string; game_id: string; level_ids: string[]; base_url: string | null };
    const base = env.GAMES_BASE_URL ?? pack.base_url;
    if (!base) return { ok: false, detail: `pack ${pack.pack_id} exists but no GAMES_BASE_URL / games.base_url to open it` };
    const url = `${base}/${pack.game_id}/?level=${pack.level_ids[0]}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    return r.ok ? { ok: true, detail: `${url} → ${r.status}` } : { ok: false, detail: `${url} → ${r.status}` };
  },
};
export default check;
