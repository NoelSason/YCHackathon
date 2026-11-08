import { neonQuery, type Query } from "../store.js";

/**
 * Public, read-only level API for the web player at levelai.vercel.app/play (site/play.html,
 * built from player/). The site forwards these paths to this server (see business/live.sh):
 *
 *   GET /levels/:id                          one playable level
 *   GET /packs/:id                           a published pack, levels in pack order
 *   GET /levels-latest?game=match3&limit=10  the newest pack, or the newest accepted levels
 *
 * Only levels the Tuner accepted (or the CEO published) are served, and only for match3, the one
 * game the web player runs. Drafts, rejected levels, notes, and who made them stay private.
 */

export const PLAYABLE_GAMES = ["match3"] as const;
const PLAYABLE_STATUSES = ["accepted", "published"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_LIMIT = 30;

export interface PublicLevel {
  level_id: string;
  game_id: string;
  level: Record<string, unknown>;
  target_win_rate: number;
  measured_win_rate: number | null;
}

export interface PublicPack {
  pack_id: string;
  game_id: string;
  name: string;
  published_at: string;
  levels: PublicLevel[];
}

export interface LatestLevels {
  game_id: string;
  /** The pack the levels come from, or null when they're accepted levels not yet in a pack. */
  pack: { pack_id: string; name: string } | null;
  levels: PublicLevel[];
}

type Row = Record<string, unknown>;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const levelJson = (v: unknown): Record<string, unknown> =>
  (typeof v === "string" ? JSON.parse(v) : v) as Record<string, unknown>;

function toLevel(r: Row): PublicLevel {
  return {
    level_id: String(r.level_id),
    game_id: String(r.game_id),
    level: levelJson(r.level),
    target_win_rate: Number(r.target_win_rate),
    measured_win_rate: num(r.measured_win_rate),
  };
}

const LEVEL_COLUMNS = "level_id, game_id, level, target_win_rate, measured_win_rate";

export async function getPublicLevel(q: Query, id: string): Promise<PublicLevel | null> {
  if (!UUID.test(id)) return null;
  const rows = await q(
    `select ${LEVEL_COLUMNS} from levels where level_id = $1 and game_id = any($2::text[]) and status = any($3::text[])`,
    [id, [...PLAYABLE_GAMES], PLAYABLE_STATUSES],
  );
  return rows[0] ? toLevel(rows[0]) : null;
}

async function levelsById(q: Query, ids: string[], gameId: string): Promise<PublicLevel[]> {
  const valid = ids.filter((id) => UUID.test(id));
  if (!valid.length) return [];
  const rows = await q(
    `select ${LEVEL_COLUMNS} from levels where level_id = any($1::uuid[]) and game_id = $2 and status = any($3::text[])`,
    [valid, gameId, PLAYABLE_STATUSES],
  );
  const byId = new Map(rows.map((r) => [String(r.level_id), toLevel(r)]));
  // Keep the pack's order; skip any level that was pulled after publishing.
  return valid.map((id) => byId.get(id)).filter((l): l is PublicLevel => l !== undefined);
}

function packIds(v: unknown): string[] {
  const ids = typeof v === "string" ? (JSON.parse(v) as unknown) : v;
  return Array.isArray(ids) ? ids.map(String) : [];
}

/** A published match3 pack with at least one playable level, or null. */
export async function getPublicPack(q: Query, id: string): Promise<PublicPack | null> {
  if (!UUID.test(id)) return null;
  const rows = await q(
    `select pack_id, game_id, name, level_ids, published_at from packs where pack_id = $1 and game_id = any($2::text[])`,
    [id, [...PLAYABLE_GAMES]],
  );
  const p = rows[0];
  if (!p) return null;
  const levels = await levelsById(q, packIds(p.level_ids), String(p.game_id));
  if (!levels.length) return null;
  return { pack_id: String(p.pack_id), game_id: String(p.game_id), name: String(p.name), published_at: iso(p.published_at), levels };
}

/**
 * What /play with no parameters plays: the newest published pack in its own order, or, before any
 * pack exists, the newest accepted levels ordered easiest first (highest measured win rate), so
 * the difficulty ramps up.
 */
export async function latestLevels(q: Query, gameId: string, limit = 10): Promise<LatestLevels> {
  const n = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit) || 10));
  const packs = await q(
    `select pack_id, name, level_ids from packs where game_id = $1 order by published_at desc limit 5`,
    [gameId],
  );
  for (const p of packs) {
    const levels = await levelsById(q, packIds(p.level_ids), gameId);
    if (levels.length) return { game_id: gameId, pack: { pack_id: String(p.pack_id), name: String(p.name) }, levels: levels.slice(0, n) };
  }
  const rows = await q(
    `select * from (
       select ${LEVEL_COLUMNS}, created_at from levels
       where game_id = $1 and status = any($2::text[])
       order by created_at desc limit $3
     ) newest order by measured_win_rate desc nulls last, created_at desc`,
    [gameId, PLAYABLE_STATUSES, n],
  );
  return { game_id: gameId, pack: null, levels: rows.map(toLevel) };
}

/**
 * The link for the welcome email's "Play your free levels" button: the newest pack, or /play when
 * accepted levels exist but no pack does. Null when there's nothing real to play yet, so the email
 * keeps its "reply for your free levels" wording. Never throws: a failed lookup must not stop the email.
 */
export async function freeLevelsUrl(q: Query | null, siteUrl: string): Promise<string | null> {
  if (!q) return null;
  try {
    const latest = await latestLevels(q, "match3", 1);
    if (!latest.levels.length) return null;
    const site = siteUrl.replace(/\/+$/, "");
    return latest.pack ? `${site}/play?pack=${latest.pack.pack_id}` : `${site}/play`;
  } catch {
    return null;
  }
}

const respond = (status: number, body: unknown, maxAge = 30): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": status === 200 ? `public, max-age=${maxAge}` : "no-store",
      // Public read-only data; lets the player run from a local or preview origin too.
      "access-control-allow-origin": "*",
    },
  });

/**
 * Route handler. Returns null for paths it doesn't own, so the server's router falls through.
 * `q` is null when the server has no database; then these routes answer 503.
 */
export function publicLevelRoutes(q: Query | null): (request: Request, url: URL) => Promise<Response | null> {
  return async (request, url) => {
    const level = url.pathname.match(/^\/levels\/([^/]+)\/?$/);
    const pack = url.pathname.match(/^\/packs\/([^/]+)\/?$/);
    const latest = url.pathname === "/levels-latest";
    if (!level && !pack && !latest) return null;
    if (request.method !== "GET") return respond(405, { error: "method not allowed" });
    if (!q) return respond(503, { error: "levels unavailable" });

    if (level) {
      if (!UUID.test(level[1]!)) return respond(400, { error: "invalid level id" });
      const found = await getPublicLevel(q, level[1]!);
      return found ? respond(200, found, 300) : respond(404, { error: "level not found" });
    }
    if (pack) {
      if (!UUID.test(pack[1]!)) return respond(400, { error: "invalid pack id" });
      const found = await getPublicPack(q, pack[1]!);
      return found ? respond(200, found, 300) : respond(404, { error: "pack not found" });
    }
    const game = url.searchParams.get("game") ?? "match3";
    if (!(PLAYABLE_GAMES as readonly string[]).includes(game)) return respond(400, { error: "only match3 levels are playable on the web" });
    return respond(200, await latestLevels(q, game, Number(url.searchParams.get("limit") ?? 10)));
  };
}

/** The server's database (the platform's Neon), or null without one. */
export const levelsQuery = (databaseUrl: string | undefined): Query | null => (databaseUrl ? neonQuery(databaseUrl) : null);
