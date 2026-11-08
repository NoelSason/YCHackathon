// An in-process Postgres with the real platform schema, plus small builders for test data.
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { Query } from "../src/decision-check.js";

const schema = await readFile(new URL("../../platform/db/schema.sql", import.meta.url), "utf8");

export async function freshDb(): Promise<Query> {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(schema);
  return async (text, params = []) => (await db.query<Record<string, unknown>>(text, params)).rows;
}

export const hoursAfter = (t: Date, h: number) => new Date(t.getTime() + h * 3_600_000);

export async function addGame(q: Query, game_id: string): Promise<void> {
  await q(`insert into games(game_id, name, bots) values ($1, $1, '["human","greedy","random"]') on conflict do nothing`, [game_id]);
}

export async function addLevel(
  q: Query,
  o: { game_id: string; target?: number; status?: string; measured?: number | null; parent?: string | null; created_at?: Date },
): Promise<string> {
  const [r] = await q(
    `insert into levels(game_id, level, target_win_rate, status, measured_win_rate, parent_level_id, created_at, updated_at)
     values ($1, '{}', $2, $3, $4, $5, $6, $6) returning level_id::text as id`,
    [o.game_id, o.target ?? 0.4, o.status ?? "draft", o.measured ?? null, o.parent ?? null, (o.created_at ?? new Date()).toISOString()],
  );
  return String(r!.id);
}

/** `attempts` attempts, of which `wins` won and `quits` quit (the rest lost), spread over [from, to). */
export async function addPlays(
  q: Query, game_id: string, level_id: string, from: Date, to: Date, n: { attempts: number; wins: number; quits: number },
): Promise<void> {
  const span = to.getTime() - from.getTime();
  for (let i = 0; i < n.attempts; i++) {
    const ts = new Date(from.getTime() + Math.floor(((i + 0.5) / n.attempts) * span));
    const end = i < n.wins ? "win" : i < n.wins + n.quits ? "quit" : "loss";
    await q(
      `insert into player_events(game_id, level_id, session_id, type, ts) values ($1,$2,$3,'attempt',$4), ($1,$2,$3,$5,$4)`,
      [game_id, level_id, `human:v1:${from.getTime()}-${i}`, ts.toISOString(), end],
    );
  }
}

export async function addDecision(
  q: Query, o: { ts: Date; chose: string; expected?: string; cards?: string[]; saw?: string },
): Promise<string> {
  const [r] = await q(
    `insert into decisions(ts, saw, chose, why, expected, cards) values ($1, $2, $3, 'test', $4, $5) returning id::text as id`,
    [o.ts.toISOString(), o.saw ?? "test", o.chose, o.expected ?? null, JSON.stringify(o.cards ?? [])],
  );
  return String(r!.id);
}
