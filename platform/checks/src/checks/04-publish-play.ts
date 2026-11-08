import type { Check } from "../types.js";

// The newest pack the company published (CEO's publish_pack), not a pack made for a paying studio
// (business/src/levels/deliver-pack.ts, levels created_by 'pack-delivery'). Its first level must open
// where players play it: match3 at /play?level=<id> (site/play.html), the other games at
// /games/<id>/?level=<id> (site/build-games.sh). Those pages are static, so also check that the level
// itself loads from the platform's /levels/:id, which the game pages fetch.
const playUrl = (base: string, game: string, id: string) =>
  game === "match3" ? `${base}/play?level=${id}` : `${base}/games/${game}/?level=${id}`;

const check: Check = {
  name: "publish_play", owner: "Max", path: "Publish → play",
  async run({ db, env, platformUrl }) {
    const p = await db.query(`
      select p.pack_id, p.game_id, p.level_ids, g.base_url from packs p join games g using (game_id)
       where not exists (select 1 from levels l
                          where l.level_id::text in (select jsonb_array_elements_text(p.level_ids))
                            and l.created_by = 'pack-delivery')
       order by published_at desc limit 1`);
    if (!p.rows.length) return { ok: false, detail: "no pack published yet (customer pack deliveries don't count)" };
    const pack = p.rows[0] as { pack_id: string; game_id: string; level_ids: string[]; base_url: string | null };
    const base = (env.GAMES_BASE_URL ?? env.SITE_URL ?? pack.base_url ?? "https://levelai.vercel.app").replace(/\/+$/, "");
    const id = pack.level_ids[0];
    const url = playUrl(base, pack.game_id, id!);
    const page = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!page.ok) return { ok: false, detail: `${url} → ${page.status}` };
    const lvl = await fetch(`${platformUrl}/levels/${id}`, { signal: AbortSignal.timeout(30_000) });
    if (!lvl.ok) return { ok: false, detail: `${url} → ${page.status}, but its level ${platformUrl}/levels/${id} → ${lvl.status}` };
    return { ok: true, detail: `pack ${pack.pack_id.slice(0, 8)} (${pack.game_id}): ${url} → ${page.status}, level data → ${lvl.status}` };
  },
};
export default check;
