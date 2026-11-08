import { HUMAN_ATTEMPTS_CTE } from "../player-attempts.js";
import type { Query } from "../queue.js";
import { LEVEL_CAP, RECIPE_VERSION, type ProductionGame } from "./catalog.js";

export const AHEAD = 100;
export interface BufferState {
  played_through: number;
  target_through: number;
  ready: number[];
  needed: number[];
}

/** Shared per-game catalog follows completed sequence progress; all old levels stay available.
 * Attempts/losses do not advance progress. Existing excess stock is preserved, not replaced. */
export function bufferState(playedThrough: number, ready: number[]): BufferState {
  const progress = Math.min(LEVEL_CAP, Math.max(0, Math.floor(playedThrough)));
  const target = Math.min(LEVEL_CAP, progress + AHEAD);
  const inventory = new Set(ready);
  return { played_through: progress, target_through: target, ready: [...inventory].sort((a,b)=>a-b),
    needed: Array.from({ length: target - progress }, (_,i) => progress+i+1).filter(p => !inventory.has(p)) };
}

/** Existing schema only: sequence metadata is in production notes, and wins are player_events.
 * Parse notes in JS so unrelated/manual rows with malformed metadata cannot break the query. */
export async function readBuffer(q: Query, game: ProductionGame, series: number): Promise<BufferState> {
  const rows = await q("select level_id::text as level_id, status, notes from levels where game_id=$1 and created_by='production'", [game]);
  const positions = new Map<string, number>(), ready: number[] = [];
  for (const row of rows) {
    let note: { producer?: string; series?: number; position?: number };
    try { note = JSON.parse(String(row.notes)); } catch { continue; }
    if (note.producer !== RECIPE_VERSION || note.series !== series || !Number.isInteger(note.position) || note.position! < 1 || note.position! > LEVEL_CAP) continue;
    positions.set(String(row.level_id), note.position!);
    if (row.status === "accepted" || row.status === "published") ready.push(note.position!);
  }
  const wins = await q(`with ${HUMAN_ATTEMPTS_CTE} select distinct e.level_id::text as level_id from human_outcomes e
    join levels l on l.level_id=e.level_id where e.game_id=$1 and l.game_id=$1
    and l.created_by='production' and e.type='win'`, [game]);
  const completed = new Set(wins.map(row => positions.get(String(row.level_id))).filter((p): p is number => p !== undefined));
  let progress = 0;
  while (completed.has(progress+1)) progress++;
  // A one-off playtest of level 561 is not proof that levels 1–560 were completed.
  return bufferState(progress, ready);
}

export class BufferFullError extends Error {}
