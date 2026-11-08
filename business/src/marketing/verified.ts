import type { Query } from "../store.js";
import { fitForX, type Post } from "./posts.js";

/**
 * "Verified by Level AI" posts on X. Every number comes from our test records: how many simulated
 * bot games a set of levels went through, and how close each level's measured win rate came to its
 * target. A customer's pack is posted once, when it's delivered, without naming the studio: a
 * customer hasn't agreed to be named. Between those, the post covers one of our own games.
 */
export interface VerifiedStats {
  levels: number;
  botGames: number;
  /** Average distance between measured and target win rate, in percentage points. */
  gapPoints: number;
}
export interface VerifiedGame extends VerifiedStats { gameId: string; name: string }
export interface VerifiedPack extends VerifiedStats { packId: string }
export interface VerifiedState { lastVerified?: boolean; verifiedTurn?: number; announcedPacks?: string[] }

const MIN_LEVELS = 10;
const round = (n: number) => n.toLocaleString("en-US");
const summary = (s: VerifiedStats, target: string) =>
  `${round(s.botGames)} simulated bot games, with win rates averaging within ${s.gapPoints.toFixed(1)} points of ${target}.`;

export function customerPackPost(p: VerifiedPack, site: string): Post {
  const content = `Verified by Level AI: a studio's new ${p.levels}-level pack just passed testing. ${summary(p, "what they ordered")} Want your levels verified? ${site.replace(/\/$/, "")}/pricing`;
  return { title: "Verified by Level AI", content: fitForX(content), platforms: ["x"] };
}

export function catalogPost(g: VerifiedGame, site: string): Post {
  const content = `Verified by Level AI: ${g.name}. ${g.levels} levels, ${summary(g, "target")} Every level is tested before a player sees it. Play them: ${site.replace(/\/$/, "")}/games`;
  return { title: "Verified by Level AI", content: fitForX(content), platforms: ["x"] };
}

const stats = (r: Record<string, unknown>): VerifiedStats => ({ levels: Number(r.levels), botGames: Number(r.games), gapPoints: Number(r.gap) });

/** Our own games with enough measured levels to report on, biggest first. */
export async function verifiedCatalog(q: Query): Promise<VerifiedGame[]> {
  const rows = await q(
    `select g.game_id, g.name, count(distinct l.level_id)::int as levels,
            sum(r.runs_per_bot * jsonb_array_length(r.bots))::int as games,
            avg(abs(l.measured_win_rate - l.target_win_rate)) * 100 as gap
       from levels l
       join games g on g.game_id = l.game_id
       join solver_runs r on r.level_id = l.level_id and r.status = 'done'
      where l.status = 'published' and l.measured_win_rate is not null and l.target_win_rate is not null
        and l.created_by is distinct from 'pack-delivery'
      group by 1, 2
     having count(distinct l.level_id) >= $1
      order by levels desc, g.game_id`,
    [MIN_LEVELS],
  );
  return rows.map((r) => ({ ...stats(r), gameId: String(r.game_id), name: String(r.name) }));
}

/** The newest paid, delivered customer pack we haven't posted about. Test and demo orders never count. */
export async function nextCustomerPack(q: Query, announced: string[]): Promise<VerifiedPack | null> {
  const rows = await q(
    `select d.pack_id, count(distinct l.level_id)::int as levels,
            sum(r.runs_per_bot * jsonb_array_length(r.bots))::int as games,
            avg(abs(l.measured_win_rate - l.target_win_rate)) * 100 as gap
       from biz_pack_deliveries d
       join packs p on p.pack_id = d.pack_id
       join levels l on l.level_id::text in (select jsonb_array_elements_text(p.level_ids))
       join solver_runs r on r.level_id = l.level_id and r.status = 'done'
      where d.state = 'delivered' and not d.test_order and not d.demo and d.pack_id is not null
        and l.measured_win_rate is not null and l.target_win_rate is not null
        and not (d.pack_id::text = any($1::text[]))
      group by d.pack_id, d.created_at
      order by d.created_at desc
      limit 1`,
    [announced],
  );
  const r = rows[0];
  return r ? { ...stats(r), packId: String(r.pack_id) } : null;
}

/** The verified post due now, if any, and the state to save once it's out. */
export async function nextVerifiedPost(q: Query, state: VerifiedState, site: string): Promise<{ post: Post; state: VerifiedState } | null> {
  const announced = state.announcedPacks ?? [];
  const pack = await nextCustomerPack(q, announced);
  if (pack) return { post: customerPackPost(pack, site), state: { lastVerified: true, announcedPacks: [...announced, pack.packId] } };
  if (state.lastVerified) return null;
  const games = await verifiedCatalog(q);
  if (!games.length) return null;
  const turn = state.verifiedTurn ?? 0;
  return { post: catalogPost(games[turn % games.length]!, site), state: { lastVerified: true, verifiedTurn: turn + 1 } };
}
