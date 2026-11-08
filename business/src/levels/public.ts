import { neonQuery, type Query } from "../store.js";

/**
 * Public, read-only level API, for the web player at levelai.vercel.app/play (site/play.html,
 * built from player/) and for studios' own tools (documented in docs/developers.md). The site
 * forwards these paths to this server (see business/live.sh), at the root and under /api:
 *
 *   GET /games                                every public game and how many levels it has
 *   GET /levels?game=<id>&limit=20&since=iso  the newest accepted levels (all games without `game`)
 *   GET /levels/:id                           one level
 *   GET /packs/:id                            a published pack, levels in pack order
 *   GET /levels-latest?game=match3&limit=10   the newest pack, or the newest accepted levels
 *   GET /levels-latest?game=match3&made_by=agents   the Designer agent's newest accepted levels
 *
 * Only levels the Tuner accepted (or the CEO published) are served, for any game in the platform's
 * games table except the internal `stub` test game. Drafts, rejected levels, notes, and which agent
 * made them stay private. Levels made for a customer's paid pack (created_by 'pack-delivery') open by
 * id (/levels/:id, /packs/:id) but stay out of the public lists, so one studio's pack isn't our free set. The key-authenticated studio view (`studioLevels`) lives here too.
 */

/** The one game the web player at /play runs. /levels-latest defaults to it. */
export const PLAYABLE_GAMES = ["match3"] as const;
/** Who made a customer's pack levels (levels/deliver-pack.ts); kept out of the public lists. */
export const CUSTOMER_PACK_MAKER = "pack-delivery";
const NOT_CUSTOMER = `created_by is distinct from '${CUSTOMER_PACK_MAKER}'`;
/** In the games table for smoke tests only; never public. */
const HIDDEN_GAMES = ["stub"];
const PLAYABLE_STATUSES = ["accepted", "published"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_LIMIT = 30;
const MAX_LIST_LIMIT = 100;

/** The genre of each game, for GET /games. The games table has no genre column; unknown is null. */
const GENRES: Record<string, string> = {
  match3: "match-3",
  platformer: "platformer",
  racer: "lane racer",
  watersort: "sort puzzle",
  lotescape: "sliding-block puzzle",
};

export interface PublicLevel {
  level_id: string;
  game_id: string;
  level: Record<string, unknown>;
  target_win_rate: number;
  measured_win_rate: number | null;
  status: "accepted" | "published";
  created_at: string;
  /** When the level was last accepted or published. */
  updated_at: string;
}

export interface PublicGame {
  game_id: string;
  name: string;
  genre: string | null;
  /** Accepted or published levels this API serves for the game. */
  levels_available: number;
}

export interface LevelList {
  game_id: string | null;
  levels: PublicLevel[];
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
    status: String(r.status) as PublicLevel["status"],
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

const LEVEL_COLUMNS = "level_id, game_id, level, target_win_rate, measured_win_rate, status, created_at, updated_at";

export async function getPublicLevel(q: Query, id: string): Promise<PublicLevel | null> {
  if (!UUID.test(id)) return null;
  const rows = await q(
    `select ${LEVEL_COLUMNS} from levels where level_id = $1 and game_id <> all($2::text[]) and status = any($3::text[])`,
    [id, HIDDEN_GAMES, PLAYABLE_STATUSES],
  );
  return rows[0] ? toLevel(rows[0]) : null;
}

async function levelsById(q: Query, ids: string[], gameId: string, publicOnly = false): Promise<PublicLevel[]> {
  const valid = ids.filter((id) => UUID.test(id));
  if (!valid.length) return [];
  const rows = await q(
    `select ${LEVEL_COLUMNS} from levels where level_id = any($1::uuid[]) and game_id = $2 and status = any($3::text[])${publicOnly ? ` and ${NOT_CUSTOMER}` : ""}`,
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

/** A published pack with at least one servable level, or null. */
export async function getPublicPack(q: Query, id: string): Promise<PublicPack | null> {
  if (!UUID.test(id)) return null;
  const rows = await q(
    `select pack_id, game_id, name, level_ids, published_at from packs where pack_id = $1 and game_id <> all($2::text[])`,
    [id, HIDDEN_GAMES],
  );
  const p = rows[0];
  if (!p) return null;
  const levels = await levelsById(q, packIds(p.level_ids), String(p.game_id));
  if (!levels.length) return null;
  return { pack_id: String(p.pack_id), game_id: String(p.game_id), name: String(p.name), published_at: iso(p.published_at), levels };
}

/** Levels our Designer agent made (created_by 'designer', its Tuner versions 'tuner'). */
const BY_DESIGNER = `coalesce(created_by in ('designer', 'tuner'), false)`;

/**
 * What /play with no parameters plays: the newest published pack in its own order, or, before any
 * pack exists, the newest accepted levels ordered easiest first (highest measured win rate), so
 * the difficulty ramps up. Levels the Designer agent made come before the production compiler's
 * (solver/PRODUCTION.md), which imports hundreds at a time and would otherwise bury them. The
 * phone loop (mobile/loop.ts) plays the first of these too. Customers' packs never count as "the
 * newest pack": their levels are private, so the choice doesn't shift as paid orders land.
 *
 * With `madeBy: "agents"` (`?made_by=agents`), only the Designer agent's accepted levels and their
 * Tuner versions, newest first, ignoring packs. /play?made_by=agents shows these.
 */
export async function latestLevels(q: Query, gameId: string, limit = 10, opts: { madeBy?: "agents" } = {}): Promise<LatestLevels> {
  const n = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit) || 10));
  if (opts.madeBy === "agents") {
    const rows = await q(
      `select ${LEVEL_COLUMNS} from levels
       where game_id = $1 and status = any($2::text[]) and ${BY_DESIGNER}
       order by created_at desc limit $3`,
      [gameId, PLAYABLE_STATUSES, n],
    );
    return { game_id: gameId, pack: null, levels: rows.map(toLevel) };
  }
  // Only packs holding at least one public (non-customer) level, in SQL, so a run of customer
  // packs can't push the public pack out of the window.
  const packs = await q(
    `select p.pack_id, p.name, p.level_ids from packs p
     where p.game_id = $1 and exists (
       select 1 from levels l
       where l.level_id::text in (select jsonb_array_elements_text(p.level_ids::jsonb))
         and l.status = any($2::text[]) and l.${NOT_CUSTOMER}
     )
     order by p.published_at desc limit 5`,
    [gameId, PLAYABLE_STATUSES],
  );
  for (const p of packs) {
    const levels = await levelsById(q, packIds(p.level_ids), gameId, true);
    if (levels.length) return { game_id: gameId, pack: { pack_id: String(p.pack_id), name: String(p.name) }, levels: levels.slice(0, n) };
  }
  const rows = await q(
    `select ${LEVEL_COLUMNS} from (
       select ${LEVEL_COLUMNS}, ${BY_DESIGNER} as by_designer from levels
       where game_id = $1 and status = any($2::text[]) and ${NOT_CUSTOMER}
       order by by_designer desc, created_at desc limit $3
     ) newest order by by_designer desc, measured_win_rate desc nulls last, created_at desc`,
    [gameId, PLAYABLE_STATUSES, n],
  );
  return { game_id: gameId, pack: null, levels: rows.map(toLevel) };
}

/** Every public game, with how many accepted or published levels it has. */
export async function listGames(q: Query): Promise<PublicGame[]> {
  const rows = await q(
    `select g.game_id, g.name, count(l.level_id)::int as levels_available
       from games g left join levels l on l.game_id = g.game_id and l.status = any($2::text[]) and l.${NOT_CUSTOMER}
      where g.game_id <> all($1::text[])
      group by g.game_id, g.name order by g.game_id`,
    [HIDDEN_GAMES, PLAYABLE_STATUSES],
  );
  return rows.map((r) => ({ game_id: String(r.game_id), name: String(r.name), genre: GENRES[String(r.game_id)] ?? null, levels_available: Number(r.levels_available) }));
}

/** Whether a game is public (in the games table and not hidden). */
export async function isPublicGame(q: Query, gameId: string): Promise<boolean> {
  if (HIDDEN_GAMES.includes(gameId) || !/^[a-z0-9_-]{1,40}$/.test(gameId)) return false;
  return (await q(`select 1 from games where game_id = $1`, [gameId])).length > 0;
}

/**
 * Accepted and published levels, newest first (by when they were last accepted or published).
 * With `since`, only levels updated after it, oldest first, so a client can page forward by passing
 * the last `updated_at` it saw.
 */
export async function listLevels(q: Query, opts: { gameId?: string | null; limit?: number; since?: string | null } = {}): Promise<LevelList> {
  const raw = Math.floor(opts.limit ?? 20);
  const n = Number.isFinite(raw) ? Math.max(1, Math.min(MAX_LIST_LIMIT, raw)) : 20;
  const rows = await q(
    `select ${LEVEL_COLUMNS} from levels
      where status = any($1::text[]) and game_id <> all($2::text[]) and ${NOT_CUSTOMER}
        and ($3::text is null or game_id = $3) and ($4::timestamptz is null or updated_at > $4)
      order by ${opts.since ? "updated_at asc" : "updated_at desc"}, level_id limit $5`,
    [PLAYABLE_STATUSES, HIDDEN_GAMES, opts.gameId ?? null, opts.since ?? null, n],
  );
  return { game_id: opts.gameId ?? null, levels: rows.map(toLevel) };
}

/** What GET /studio/levels and the studio MCP's list_my_levels return. */
export interface StudioLevels {
  studio: string;
  /** The sample pack or level we sent this studio, when its record links one; otherwise null. */
  sample: { pack_id: string | null; name: string | null; url: string } | null;
  levels: PublicLevel[];
  note: string;
}

export const STUDIO_LEVELS_NOTE =
  "Levels aren't linked to studio accounts yet: our agents design levels for our own games, not for yours. " +
  "This lists the sample levels we've sent you, if any. Every public level is also at GET /api/levels.";

/**
 * The levels a studio can see with its key. Levels and packs have no studio column, so the only
 * real link is the studio's own record: the sample link an agent set on it (`/play?pack=<id>` or
 * `/play?level=<id>`). Without one, the list is empty and the note says why.
 */
export async function studioLevels(q: Query | null, studio: { company: string; sampleUrl: string | null }): Promise<StudioLevels> {
  const out: StudioLevels = { studio: studio.company, sample: null, levels: [], note: STUDIO_LEVELS_NOTE };
  if (!studio.sampleUrl) return out;
  let params: URLSearchParams;
  try {
    params = new URL(studio.sampleUrl).searchParams;
  } catch {
    return out;
  }
  const packId = params.get("pack");
  const levelId = params.get("level");
  if (q && packId && UUID.test(packId)) {
    const pack = await getPublicPack(q, packId);
    if (pack) return { ...out, sample: { pack_id: pack.pack_id, name: pack.name, url: studio.sampleUrl }, levels: pack.levels };
  }
  if (q && levelId && UUID.test(levelId)) {
    const level = await getPublicLevel(q, levelId);
    if (level) return { ...out, sample: { pack_id: null, name: null, url: studio.sampleUrl }, levels: [level] };
  }
  return { ...out, sample: { pack_id: null, name: null, url: studio.sampleUrl } };
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
    const games = url.pathname === "/games";
    const list = url.pathname === "/levels" || url.pathname === "/levels/";
    if (!level && !pack && !latest && !games && !list) return null;
    if (request.method !== "GET") return respond(405, { error: "method not allowed" });
    if (!q) return respond(503, { error: "levels unavailable" });

    if (games) return respond(200, { games: await listGames(q) }, 60);
    if (list) {
      const game = url.searchParams.get("game");
      if (game !== null && !(await isPublicGame(q, game))) return respond(404, { error: "game not found" });
      const since = url.searchParams.get("since");
      if (since !== null && Number.isNaN(Date.parse(since))) return respond(400, { error: "since must be an ISO 8601 time" });
      const limit = url.searchParams.get("limit");
      if (limit !== null && !/^\d{1,3}$/.test(limit)) return respond(400, { error: `limit must be a whole number from 1 to ${MAX_LIST_LIMIT}` });
      return respond(200, await listLevels(q, { gameId: game, limit: limit === null ? 20 : Number(limit), since: since && new Date(since).toISOString() }));
    }

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
    if (!(await isPublicGame(q, game))) return respond(404, { error: "game not found" });
    const madeBy = url.searchParams.get("made_by");
    if (madeBy !== null && madeBy !== "agents") return respond(400, { error: "made_by must be agents" });
    return respond(200, await latestLevels(q, game, Number(url.searchParams.get("limit") ?? 10), madeBy ? { madeBy } : {}));
  };
}

/** The server's database (the platform's Neon), or null without one. */
export const levelsQuery = (databaseUrl: string | undefined): Query | null => (databaseUrl ? neonQuery(databaseUrl) : null);
