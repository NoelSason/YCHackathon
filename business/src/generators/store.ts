import type { Query } from "../store.js";
import type { PackGameId } from "../levels/pack-types.js";
import { encryptSecret, newSecret } from "./protocol.js";

/** A studio's registered level generator (table biz_generators). `secretEnc` never leaves the server. */
export interface Generator {
  id: string;
  studioId: string;
  name: string;
  genre: PackGameId;
  /** "levelai": its levels use our JSON format for that genre, so our web player can preview them. */
  format: "custom" | "levelai";
  baseUrl: string;
  secretEnc: string;
  /** The secret's last 4 characters, to tell secrets apart. */
  secretHint: string;
  status: "active" | "replaced";
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastError: string | null;
  createdAt: string;
}

/** What a studio may see about its generator. */
export function publicGenerator(g: Generator) {
  return {
    id: g.id, name: g.name, genre: g.genre, format: g.format, base_url: g.baseUrl, status: g.status, secret_hint: `…${g.secretHint}`,
    last_test_at: g.lastTestAt, last_test_ok: g.lastTestOk, last_error: g.lastError, created_at: g.createdAt,
  };
}

type Row = Record<string, unknown>;
const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));

function toGenerator(r: Row): Generator {
  return {
    id: String(r.id), studioId: String(r.studio_id), name: String(r.name), genre: r.genre as PackGameId, format: r.format === "levelai" ? "levelai" : "custom",
    baseUrl: String(r.base_url), secretEnc: String(r.secret_enc), secretHint: String(r.secret_hint), status: r.status === "active" ? "active" : "replaced",
    lastTestAt: iso(r.last_test_at), lastTestOk: r.last_test_ok === null || r.last_test_ok === undefined ? null : Boolean(r.last_test_ok),
    lastError: r.last_error === null || r.last_error === undefined ? null : String(r.last_error), createdAt: iso(r.created_at) ?? "",
  };
}

/**
 * Registers a generator and returns its signing secret, the only time it's ever shown. A studio's
 * earlier generator for the same genre is marked replaced, so each studio and genre has one.
 */
export async function registerGenerator(q: Query, keyHex: string, g: { studioId: string; name: string; genre: PackGameId; format: Generator["format"]; baseUrl: string }): Promise<{ generator: Generator; secret: string }> {
  const secret = newSecret();
  await q(`update biz_generators set status = 'replaced', updated_at = now() where studio_id = $1 and genre = $2 and status = 'active'`, [g.studioId, g.genre]);
  const r = await q(
    `insert into biz_generators (studio_id, name, genre, format, base_url, secret_enc, secret_hint) values ($1, $2, $3, $4, $5, $6, $7) returning *`,
    [g.studioId, g.name, g.genre, g.format, g.baseUrl, encryptSecret(secret, keyHex), secret.slice(-4)],
  );
  return { generator: toGenerator(r[0]!), secret };
}

export async function getGenerator(q: Query, id: string): Promise<Generator | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await q(`select * from biz_generators where id::text = $1`, [id]);
  return r[0] ? toGenerator(r[0]) : null;
}

export async function listGenerators(q: Query, studioId: string): Promise<Generator[]> {
  return (await q(`select * from biz_generators where studio_id = $1 and status = 'active' order by created_at desc`, [studioId])).map(toGenerator);
}

/** The studio's active generator for a genre, or null (then the pack is built in our own engine). */
export async function activeGeneratorFor(q: Query, studioId: string, genre: PackGameId): Promise<Generator | null> {
  const r = await q(`select * from biz_generators where studio_id = $1 and genre = $2 and status = 'active' order by created_at desc limit 1`, [studioId, genre]);
  return r[0] ? toGenerator(r[0]) : null;
}

export async function recordTest(q: Query, id: string, ok: boolean, error: string | null): Promise<void> {
  await q(`update biz_generators set last_test_at = now(), last_test_ok = $2, last_error = $3, updated_at = now() where id = $1`, [id, ok, error?.slice(0, 300) ?? null]);
}
