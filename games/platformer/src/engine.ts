// Shared original grid-step rules: browser, adapter, bots and solver all import this module.
// move_limit is optional: without it a trail can't be lost (the authored practice trails). With it,
// running out of steps before the goal loses the trail; the tuner sets it to reach a win rate.
export type PlatformLevel = { name: string; map: string[]; jump_height: number; fall_limit: number; move_limit?: number };
export type Pos = { x: number; y: number };
const WALKABLE = new Set([".", "S", "G", "C"]);
export const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["name", "map", "jump_height", "fall_limit"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 60 },
    map: { type: "array", minItems: 5, maxItems: 32, items: { type: "string", minLength: 8, maxLength: 64, pattern: "^[.#^SCG]+$" } },
    jump_height: { type: "integer", minimum: 1, maximum: 4 },
    fall_limit: { type: "integer", minimum: 1, maximum: 8 },
    move_limit: { type: "integer", minimum: 1, maximum: 500, description: "Optional step budget; reaching it before the goal loses the trail." },
  },
} as const;

function record(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === "object" && !Array.isArray(v); }
export function find(map: string[], tile: string): Pos[] {
  const result: Pos[] = [];
  map.forEach((row, y) => [...row].forEach((c, x) => { if (c === tile) result.push({ x, y }); }));
  return result;
}
export function cell(map: string[], x: number, y: number): string { return map[y]?.[x] ?? "#"; }
export function neighbors(level: PlatformLevel, p: Pos): Pos[] {
  const result: Pos[] = [];
  const h = level.map.length;
  const w = level.map[0]?.length ?? 0;
  for (const dx of [-1, 1]) {
    const x = p.x + dx;
    if (x < 0 || x >= w) continue;
    // A move may step up by jump_height, or drop no farther than fall_limit.
    for (let rise = 0; rise <= level.jump_height; rise++) {
      const y = p.y - rise;
      if (y >= 0 && WALKABLE.has(cell(level.map, x, y)) && cell(level.map, x, y + 1) === "#") { result.push({ x, y }); break; }
    }
    for (let drop = 1; drop <= level.fall_limit && p.y + drop < h; drop++) {
      const y = p.y + drop;
      if (WALKABLE.has(cell(level.map, x, y)) && cell(level.map, x, y + 1) === "#") { result.push({ x, y }); break; }
    }
  }
  return result;
}
export function key(p: Pos): string { return `${p.x},${p.y}`; }
export function path(level: PlatformLevel, start = find(level.map, "S")[0]!): Pos[] | undefined {
  const goal = find(level.map, "G")[0]!;
  const queue: Pos[] = [start];
  const previous = new Map<string, string | null>([[key(start), null]]);
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]!;
    if (key(current) === key(goal)) break;
    for (const next of neighbors(level, current)) {
      const k = key(next);
      if (!previous.has(k)) { previous.set(k, key(current)); queue.push(next); }
    }
  }
  if (!previous.has(key(goal))) return undefined;
  const result: Pos[] = [];
  let cursor: string | null = key(goal);
  while (cursor) {
    const [x, y] = cursor.split(",").map(Number) as [number, number];
    result.push({ x, y });
    cursor = previous.get(cursor) ?? null;
  }
  return result.reverse();
}

export function validateLevel(value: unknown): { ok: true } | { ok: false; errors: string[] } {
    const errors: string[] = [];
    if (!record(value)) return { ok: false, errors: ["level must be an object"] };
    const l = value as unknown as Partial<PlatformLevel>;
    if (typeof l.name !== "string" || !l.name.trim() || l.name.length > 60) errors.push("name must be 1–60 characters");
    const rowsAreStrings = Array.isArray(l.map) && l.map.every((row) => typeof row === "string");
    const mapRows = rowsAreStrings ? l.map as string[] : [];
    if (!rowsAreStrings || mapRows.length < 5 || mapRows.length > 32 || mapRows.some((r) => r.length < 8 || r.length > 64 || !/^[.#^SCG]+$/.test(r))) errors.push("map must be 5–32 equal-width rows using only ., #, ^, S, C, and G");
    if (rowsAreStrings && mapRows.length && mapRows.some((r) => r.length !== mapRows[0]!.length)) errors.push("all map rows must have equal width");
    if (rowsAreStrings && (find(mapRows, "S").length !== 1 || find(mapRows, "G").length !== 1)) errors.push("map must contain exactly one start S and one goal G");
    if (!Number.isInteger(l.jump_height) || (l.jump_height ?? 0) < 1 || (l.jump_height ?? 0) > 4) errors.push("jump_height must be an integer from 1 to 4");
    if (!Number.isInteger(l.fall_limit) || (l.fall_limit ?? 0) < 1 || (l.fall_limit ?? 0) > 8) errors.push("fall_limit must be an integer from 1 to 8");
    if (rowsAreStrings && mapRows.some((row, y) => [...row].some((c, x) => c === "S" && cell(mapRows, x, y + 1) !== "#"))) errors.push("start S must stand on solid ground");
    if (rowsAreStrings && mapRows.some((row, y) => [...row].some((c, x) => c === "G" && cell(mapRows, x, y + 1) !== "#"))) errors.push("goal G must stand on solid ground");
    if (l.move_limit !== undefined && (!Number.isInteger(l.move_limit) || l.move_limit < 1 || l.move_limit > 500)) errors.push("move_limit, if set, must be an integer from 1 to 500");
    const route = errors.length ? undefined : path(l as PlatformLevel);
    if (!errors.length && !route) errors.push("goal is unreachable under the declared jump and fall limits");
    if (!errors.length && route && l.move_limit !== undefined && l.move_limit < route.length - 1) errors.push(`move_limit ${l.move_limit} is below the shortest route (${route.length - 1} steps)`);
    return errors.length ? { ok: false, errors } : { ok: true };
}

export interface PlayState { position: Pos; moves: number; collected: string[]; status: "playing" | "won" | "lost"; }
export function initialState(level: PlatformLevel): PlayState {
  return { position: find(level.map,"S")[0]!, moves: 0, collected: [], status: "playing" };
}
export function move(level: PlatformLevel, state: PlayState, target: Pos): PlayState {
  if (state.status !== "playing" || !neighbors(level,state.position).some(p=>p.x===target.x&&p.y===target.y)) return state;
  const token = `${target.x},${target.y}`;
  return { position: {...target}, moves: state.moves+1,
    collected: cell(level.map,target.x,target.y)==="C" && !state.collected.includes(token) ? [...state.collected,token] : state.collected,
    status: cell(level.map,target.x,target.y)==="G" ? "won" : level.move_limit !== undefined && state.moves+1 >= level.move_limit ? "lost" : "playing" };
}
