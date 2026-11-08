import type { Adapter } from "../../../platform/mcp/src/adapters.js";

type PlatformLevel = { name: string; map: string[]; jump_height: number; fall_limit: number };
type Pos = { x: number; y: number };
const BASE_URL = process.env.GAMES_BASE_URL ?? "http://localhost:3000";
const WALKABLE = new Set([".", "S", "G", "C"]);
const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["name", "map", "jump_height", "fall_limit"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 60 },
    map: { type: "array", minItems: 5, maxItems: 32, items: { type: "string", minLength: 8, maxLength: 64, pattern: "^[.#^SCG]+$" } },
    jump_height: { type: "integer", minimum: 1, maximum: 4 },
    fall_limit: { type: "integer", minimum: 1, maximum: 8 },
  },
} as const;

function record(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === "object" && !Array.isArray(v); }
function find(map: string[], tile: string): Pos[] {
  const result: Pos[] = [];
  map.forEach((row, y) => [...row].forEach((c, x) => { if (c === tile) result.push({ x, y }); }));
  return result;
}
function cell(map: string[], x: number, y: number): string { return map[y]?.[x] ?? "#"; }
function neighbors(level: PlatformLevel, p: Pos): Pos[] {
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
function key(p: Pos): string { return `${p.x},${p.y}`; }
function path(level: PlatformLevel): Pos[] | undefined {
  const start = find(level.map, "S")[0]!;
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

export const adapter: Adapter = {
  game_id: "platformer",
  name: "Mosslight Trails",
  schema,
  bots: ["random", "greedy"],
  validate(value) {
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
    if (!errors.length && !path(l as PlatformLevel)) errors.push("goal is unreachable under the declared jump and fall limits");
    return errors.length ? { ok: false, errors } : { ok: true };
  },
  simulate(value, bot, seed) {
    const check = adapter.validate(value);
    if (!check.ok) throw new Error(check.errors.join("; "));
    if (!adapter.bots.includes(bot)) throw new Error(`unknown bot: ${bot}`);
    const level = value as PlatformLevel;
    if (bot === "greedy") {
      const route = path(level)!;
      return { won: true, moves_used: route.length - 1, detail: { seed, path: route } };
    }
    let state = find(level.map, "S")[0]!;
    const goal = find(level.map, "G")[0]!;
    const random = (() => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) | 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
    const visited = new Set<string>([key(state)]);
    for (let moves = 1; moves <= level.map.length * (level.map[0]?.length ?? 0); moves++) {
      const options = neighbors(level, state).filter((p) => !visited.has(key(p)));
      if (!options.length) return { won: false, moves_used: moves - 1, detail: { seed, stuck: key(state) } };
      options.sort((a, b) => Math.abs(a.x - goal.x) + Math.abs(a.y - goal.y) - (Math.abs(b.x - goal.x) + Math.abs(b.y - goal.y)));
      state = options[Math.floor(random() * options.length)]!;
      visited.add(key(state));
      if (key(state) === key(goal)) return { won: true, moves_used: moves, detail: { seed } };
    }
    return { won: false, moves_used: visited.size - 1, detail: { seed, reason: "step limit" } };
  },
  solve(value) {
    const check = adapter.validate(value);
    if (!check.ok) return { solvable: false };
    const route = path(value as PlatformLevel);
    return route ? { solvable: true, min_moves: route.length - 1, inputs: route } : { solvable: false };
  },
  level_url(level_id) { return `${BASE_URL}/platformer/?level=${encodeURIComponent(level_id)}`; },
};

export default adapter;
