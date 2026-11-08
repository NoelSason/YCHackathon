import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { Query } from "../src/store.js";
import { freeLevelsUrl, publicLevelRoutes } from "../src/levels/public.js";
import { loadConfig } from "../src/config.js";
import { createHandler } from "../src/app.js";

/** The public level API against the real platform schema, in an in-process Postgres. */
const platformSchema = await readFile(new URL("../../platform/db/schema.sql", import.meta.url), "utf8");

const level = (name: string) => ({
  name, width: 8, height: 8, colour_count: 5, seed: `seed-${name}`, goal: { colour: "red", target: 12 }, move_limit: 20,
});

async function freshDb(): Promise<Query> {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(platformSchema);
  await db.exec(`insert into games(game_id, name) values ('match3', 'Gem Garden'), ('platformer', 'Mosslight Trails')`);
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

  it("serves accepted and published match3 levels, with only the level and its win rates", async () => {
    const id = await addLevel(q, level("Open Field"), "accepted", { measured: 0.42, notes: "private tuner notes" });
    const res = (await get(publicLevelRoutes(q), `/levels/${id}`))!;
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ level_id: id, game_id: "match3", level: level("Open Field"), target_win_rate: 0.4, measured_win_rate: 0.42 });
    expect(JSON.stringify(body)).not.toContain("private tuner notes");
  });

  it("hides drafts, rejected levels, other games, and bad ids", async () => {
    const routes = publicLevelRoutes(q);
    for (const status of ["draft", "solving", "rejected"]) {
      const id = await addLevel(q, level(status), status);
      expect((await get(routes, `/levels/${id}`))!.status).toBe(404);
    }
    const other = await addLevel(q, { name: "x" }, "accepted", { game: "platformer" });
    expect((await get(routes, `/levels/${other}`))!.status).toBe(404);
    expect((await get(routes, "/levels/not-a-uuid"))!.status).toBe(400);
    expect((await get(routes, "/levels/00000000-0000-4000-8000-000000000000", "POST"))!.status).toBe(405);
    expect((await get(routes, "/levels-latest?game=platformer"))!.status).toBe(400);
    expect(await get(routes, "/public-stats")).toBeNull();
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
  });
});

describe("free levels link for the welcome email", () => {
  it("is null with no database or no playable levels, so the email keeps the reply wording", async () => {
    expect(await freeLevelsUrl(null, "https://levelai.vercel.app")).toBeNull();
    const q = await freshDb();
    await addLevel(q, level("Draft"), "draft");
    expect(await freeLevelsUrl(q, "https://levelai.vercel.app")).toBeNull();
  });

  it("links /play for accepted levels and the newest pack once one is published", async () => {
    const q = await freshDb();
    const id = await addLevel(q, level("A"), "accepted", { measured: 0.4 });
    expect(await freeLevelsUrl(q, "https://levelai.vercel.app/")).toBe("https://levelai.vercel.app/play");
    const [pack] = await q(`insert into packs(game_id, name, level_ids) values ('match3', 'Set 1', $1) returning pack_id`, [JSON.stringify([id])]);
    expect(await freeLevelsUrl(q, "https://levelai.vercel.app")).toBe(`https://levelai.vercel.app/play?pack=${pack!.pack_id}`);
  });

  it("never throws when the lookup fails", async () => {
    const broken: Query = async () => { throw new Error("db down"); };
    expect(await freeLevelsUrl(broken, "https://levelai.vercel.app")).toBeNull();
  });
});
