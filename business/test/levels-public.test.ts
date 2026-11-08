import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { Query } from "../src/store.js";
import { freeLevelsUrl, publicLevelRoutes, STUDIO_LEVELS_NOTE } from "../src/levels/public.js";
import { loadConfig } from "../src/config.js";
import { createHandler } from "../src/app.js";
import { MemoryStore } from "../src/store.js";
import { hashKey, newKey } from "../src/studio/keys.js";
import type { ToolContext } from "../src/mcp/tools.js";

/** The public level API against the real platform schema, in an in-process Postgres. */
const platformSchema = await readFile(new URL("../../platform/db/schema.sql", import.meta.url), "utf8");

const level = (name: string) => ({
  name, width: 8, height: 8, colour_count: 5, seed: `seed-${name}`, goal: { colour: "red", target: 12 }, move_limit: 20,
});

async function freshDb(): Promise<Query> {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(platformSchema);
  await db.exec(`insert into games(game_id, name) values ('match3', 'Gem Garden'), ('platformer', 'Mosslight Trails'), ('racer', 'Turbo Lanes')`);
  return async (text, params = []) => (await db.query<Record<string, unknown>>(text, params)).rows;
}

async function addLevel(q: Query, l: object, status: string, opts: { game?: string; measured?: number | null; notes?: string } = {}): Promise<string> {
  const rows = await q(
    `insert into levels(game_id, level, target_win_rate, status, measured_win_rate, notes, created_by) values ($1,$2,0.4,$3,$4,$5,'designer') returning level_id`,
    [opts.game ?? "match3", JSON.stringify(l), status, opts.measured ?? null, opts.notes ?? null],
  );
  return String(rows[0]!.level_id);
}

const get = (routes: ReturnType<typeof publicLevelRoutes>, path: string, method = "GET") =>
  routes(new Request(`http://x${path}`, { method }), new URL(`http://x${path}`));

describe("public level API", () => {
  let q: Query;
  beforeEach(async () => { q = await freshDb(); });

  it("serves accepted and published levels, with only the level, its win rates, and its times", async () => {
    const id = await addLevel(q, level("Open Field"), "accepted", { measured: 0.42, notes: "private tuner notes" });
    const res = (await get(publicLevelRoutes(q), `/levels/${id}`))!;
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      level_id: id, game_id: "match3", level: level("Open Field"), target_win_rate: 0.4, measured_win_rate: 0.42,
      status: "accepted", created_at: expect.any(String), updated_at: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(String(body.updated_at)))).toBe(false);
    expect(JSON.stringify(body)).not.toContain("private tuner notes");
    expect(JSON.stringify(body)).not.toContain("designer");
  });

  it("serves every public game's levels, and hides drafts, rejected levels, the stub game, and bad ids", async () => {
    const routes = publicLevelRoutes(q);
    for (const status of ["draft", "solving", "rejected"]) {
      const id = await addLevel(q, level(status), status);
      expect((await get(routes, `/levels/${id}`))!.status).toBe(404);
    }
    const other = await addLevel(q, { name: "x" }, "accepted", { game: "platformer" });
    expect((await get(routes, `/levels/${other}`))!.status).toBe(200);
    const stub = await addLevel(q, { width: 3, height: 3, moves: 5 }, "accepted", { game: "stub" });
    expect((await get(routes, `/levels/${stub}`))!.status).toBe(404);
    expect((await get(routes, "/levels/not-a-uuid"))!.status).toBe(400);
    expect((await get(routes, "/levels/00000000-0000-4000-8000-000000000000", "POST"))!.status).toBe(405);
    expect((await get(routes, "/levels-latest?game=platformer"))!.status).toBe(200);
    expect((await get(routes, "/levels-latest?game=stub"))!.status).toBe(404);
    expect((await get(routes, "/levels-latest?game=nope"))!.status).toBe(404);
    expect(await get(routes, "/public-stats")).toBeNull();
  });

  it("games: every public game with its genre and servable level count", async () => {
    await addLevel(q, level("A"), "accepted");
    await addLevel(q, level("B"), "published");
    await addLevel(q, level("C"), "draft");
    await addLevel(q, { width: 3, height: 3, moves: 5 }, "accepted", { game: "stub" });
    const res = (await get(publicLevelRoutes(q), "/games"))!;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      games: [
        { game_id: "match3", name: "Gem Garden", genre: "match-3", levels_available: 2 },
        { game_id: "platformer", name: "Mosslight Trails", genre: "platformer", levels_available: 0 },
        { game_id: "racer", name: "Turbo Lanes", genre: "lane racer", levels_available: 0 },
      ],
    });
  });

  it("levels: newest first, filtered by game, limited, and paged forward with since", async () => {
    const routes = publicLevelRoutes(q);
    const a = await addLevel(q, level("A"), "accepted");
    const b = await addLevel(q, { name: "track" }, "accepted", { game: "racer" });
    const c = await addLevel(q, level("C"), "published");
    await addLevel(q, level("D"), "rejected");
    await q(`update levels set updated_at = now() - make_interval(mins => $2) where level_id = $1`, [a, 30]);
    await q(`update levels set updated_at = now() - make_interval(mins => $2) where level_id = $1`, [b, 20]);
    await q(`update levels set updated_at = now() - make_interval(mins => $2) where level_id = $1`, [c, 10]);
    const ids = async (path: string) => ((await (await get(routes, path))!.json()) as { levels: Array<{ level_id: string }> }).levels.map((l) => l.level_id);

    expect(await ids("/levels")).toEqual([c, b, a]);
    expect(await ids("/levels?game=match3")).toEqual([c, a]);
    expect(await ids("/levels?game=match3&limit=1")).toEqual([c]);
    const all = (await (await get(routes, "/levels"))!.json()) as { game_id: unknown; levels: Array<{ updated_at: string }> };
    expect(all.game_id).toBeNull();
    // Paging forward: oldest first after `since`.
    expect(await ids(`/levels?since=${encodeURIComponent(all.levels[2]!.updated_at)}`)).toEqual([b, c]);

    expect((await get(routes, "/levels?game=stub"))!.status).toBe(404);
    expect((await get(routes, "/levels?game=nope"))!.status).toBe(404);
    expect((await get(routes, "/levels?limit=abc"))!.status).toBe(400);
    expect((await get(routes, "/levels?since=yesterday"))!.status).toBe(400);
    expect((await get(routes, "/levels", "POST"))!.status).toBe(405);
  });

  it("serves a pack in its own order and skips levels pulled after publishing", async () => {
    const a = await addLevel(q, level("A"), "published", { measured: 0.6 });
    const b = await addLevel(q, level("B"), "published", { measured: 0.3 });
    const pulled = await addLevel(q, level("C"), "rejected");
    const [pack] = await q(`insert into packs(game_id, name, level_ids) values ('match3', 'Starter set', $1) returning pack_id`, [JSON.stringify([b, pulled, a])]);
    const res = (await get(publicLevelRoutes(q), `/packs/${pack!.pack_id}`))!;
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; levels: Array<{ level_id: string }> };
    expect(body.name).toBe("Starter set");
    expect(body.levels.map((l) => l.level_id)).toEqual([b, a]);
  });

  it("latest: the newest pack first, else the newest accepted levels easiest first", async () => {
    const routes = publicLevelRoutes(q);
    const empty = (await (await get(routes, "/levels-latest?game=match3"))!.json()) as { pack: unknown; levels: unknown[] };
    expect(empty).toEqual({ game_id: "match3", pack: null, levels: [] });

    const hard = await addLevel(q, level("Hard"), "accepted", { measured: 0.2 });
    const easy = await addLevel(q, level("Easy"), "accepted", { measured: 0.7 });
    await addLevel(q, level("Draft"), "draft");
    const accepted = (await (await get(routes, "/levels-latest?game=match3&limit=10"))!.json()) as { pack: unknown; levels: Array<{ level_id: string }> };
    expect(accepted.pack).toBeNull();
    expect(accepted.levels.map((l) => l.level_id)).toEqual([easy, hard]);

    const [pack] = await q(`insert into packs(game_id, name, level_ids) values ('match3', 'Set 1', $1) returning pack_id`, [JSON.stringify([hard])]);
    const fromPack = (await (await get(routes, "/levels-latest"))!.json()) as { pack: { pack_id: string }; levels: Array<{ level_id: string }> };
    expect(fromPack.pack.pack_id).toBe(pack!.pack_id);
    expect(fromPack.levels.map((l) => l.level_id)).toEqual([hard]);
  });

  it("answers 503 without a database, through the server's router", async () => {
    const handle = createHandler(loadConfig({}));
    expect((await handle(new Request("http://x/levels-latest"))).status).toBe(503);
    expect((await handle(new Request("http://x/packs/00000000-0000-4000-8000-000000000000"))).status).toBe(503);
    expect((await handle(new Request("http://x/games"))).status).toBe(503);
    expect((await handle(new Request("http://x/levels?game=match3"))).status).toBe(503);
  });
});

describe("a studio's levels, with its developer key", () => {
  /** A studio with a developer key; `sample` makes the sample link on its record from the database. */
  async function setup(sample: (q: Query) => Promise<string | null> = async () => null) {
    const q = await freshDb();
    const config = loadConfig({});
    const store = new MemoryStore();
    const lead = await store.upsertLead({
      company: "Acme Games", appId: null, contactName: "Ada", email: "ada@acme.test", source: "inbound_form", stage: "found",
      reason: null, sampleUrl: await sample(q), crmContactId: null,
    });
    const key = newKey();
    await store.addApiKey(lead.id, hashKey(key));
    const ctx: ToolContext = { config, store, monid: null, mail: null, stripe: null, mobilerun: null, naive: null };
    return { q, key, handle: createHandler(config, ctx, q) };
  }
  const studioGet = (handle: (r: Request) => Promise<Response>, key: string | null) =>
    handle(new Request("http://x/studio/levels", { headers: key ? { authorization: `Bearer ${key}` } : {} }));

  it("refuses a missing or unknown key", async () => {
    const { handle } = await setup();
    expect((await studioGet(handle, null)).status).toBe(401);
    expect((await studioGet(handle, newKey())).status).toBe(401);
    expect((await studioGet(handle, "lvl_short")).status).toBe(401);
  });

  it("is empty with an honest note when nothing links levels to the studio", async () => {
    const { handle, key } = await setup();
    const res = await studioGet(handle, key);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ studio: "Acme Games", sample: null, levels: [], note: STUDIO_LEVELS_NOTE });
  });

  it("lists the sample pack linked on the studio's record, and the MCP tool returns the same", async () => {
    let levelId = "";
    let packId = "";
    const { handle, key } = await setup(async (q) => {
      levelId = await addLevel(q, level("A"), "published", { measured: 0.5 });
      const [pack] = await q(`insert into packs(game_id, name, level_ids) values ('match3', 'Sample set', $1) returning pack_id`, [JSON.stringify([levelId])]);
      packId = String(pack!.pack_id);
      return `https://levelai.vercel.app/play?pack=${packId}`;
    });

    const body = (await (await studioGet(handle, key)).json()) as { sample: { pack_id: string; name: string }; levels: Array<{ level_id: string }> };
    expect(body.sample).toMatchObject({ pack_id: packId, name: "Sample set" });
    expect(body.levels.map((l) => l.level_id)).toEqual([levelId]);

    const mcp = await handle(new Request("http://x/studio-mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_my_levels", arguments: {} } }),
    }));
    const rpc = (await mcp.json()) as { result: { content: Array<{ text: string }> } };
    expect(JSON.parse(rpc.result.content[0]!.text)).toEqual(body);
  });
});
