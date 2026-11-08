import type { Adapter } from "../../../platform/mcp/src/adapters.js";
import { BOTS, playOut } from "../src/bots.js";
import { initialState, TILES, type Level } from "../src/engine.js";
import { solveLevel } from "../src/solver.js";

const BASE_URL = process.env.GAMES_BASE_URL ?? "http://localhost:3000";
const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Crate Grove level",
  type: "object",
  additionalProperties: false,
  required: ["title", "map", "move_limit"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 48 },
    map: { type: "array", minItems: 5, maxItems: 16, items: { type: "string", minLength: 5, maxLength: 16, pattern: "^[# .SBG*+]+$" } },
    move_limit: { type: "integer", minimum: 1, maximum: 300 },
  },
} as const;

export function validateLevel(value: unknown) {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false as const, errors: ["level must be an object"] };
  const l = value as Record<string, unknown>;
  if (Object.keys(l).some((k) => !["title", "map", "move_limit"].includes(k))) errors.push("level has an unknown field");
  if (typeof l.title !== "string" || !l.title.trim() || l.title.length > 48) errors.push("title must be 1-48 characters");
  if (!Number.isInteger(l.move_limit) || (l.move_limit as number) < 1 || (l.move_limit as number) > 300) errors.push("move_limit must be an integer from 1 to 300");
  const map = l.map;
  if (!Array.isArray(map) || map.length < 5 || map.length > 16 || map.some((r) => typeof r !== "string" || r.length < 5 || r.length > 16 || ![...r].every((c) => TILES.includes(c as typeof TILES[number])))) {
    errors.push("map must contain 5-16 rows of 5-16 cells using # . S B G * +");
  }
  if (Array.isArray(map) && map.every((r) => typeof r === "string")) {
    const rows = map as string[];
    if (rows.some((r) => r.length !== rows[0]!.length)) errors.push("all map rows must have equal width");
    const cells = [...rows.join("")];
    if (cells.filter((c) => c === "S" || c === "+").length !== 1) errors.push("map must contain exactly one player: S or +");
    const boxes = cells.filter((c) => c === "B" || c === "*").length;
    const goals = cells.filter((c) => c === "G" || c === "*" || c === "+").length;
    if (boxes < 1 || boxes > 3 || boxes !== goals) errors.push("map must have 1-3 boxes and the same number of goals");
    if (!errors.length) {
      if (initialState(l as unknown as Level).won) errors.push("level is already solved");
      const solved = solveLevel(l as unknown as Level);
      if (!solved.solvable) errors.push(`goal is unreachable (explored ${solved.explored} states)`);
      else if ((solved.min_moves ?? Infinity) > (l.move_limit as number)) errors.push(`minimum solution needs ${solved.min_moves} moves, above move_limit`);
    }
  }
  return errors.length ? { ok: false as const, errors } : { ok: true as const };
}

export const adapter: Adapter = {
  game_id: "crategrove",
  name: "Crate Grove",
  schema: schema as object,
  bots: [...BOTS],
  validate: validateLevel,
  simulate(level, bot, seed) { return playOut(level as Level, bot, seed); },
  solve(value) {
    const check = validateLevel(value);
    if (!check.ok) return { solvable: false };
    const result = solveLevel(value as Level);
    return { solvable: result.solvable, min_moves: result.min_moves, inputs: result.inputs };
  },
  level_url(level_id) { return `${BASE_URL}/crategrove/?level=${encodeURIComponent(level_id)}`; },
};

export default adapter;
