import type { Adapter } from "../../../platform/mcp/src/adapters.js";
import { BOTS, playOut } from "../src/bots.js";
import { DIRECTIONS, type Level, type Vehicle } from "../src/engine.js";
import { solveLevel } from "../src/solver.js";
import { generateLevel, type GenerateOptions, type GeneratedLevel } from "../src/generate.js";
// The level generator, re-exported so platform services can make fresh lots through the adapter.
export { generateLevel, rateLevel, difficultyProfile, moveLimitFor } from "../src/generate.js";
export type { GenerateOptions, GeneratedLevel, LevelRating, DifficultyProfile } from "../src/generate.js";
const BASE_URL = process.env.GAMES_BASE_URL ?? "http://localhost:3000";
const schema = { $schema: "https://json-schema.org/draft/2020-12/schema", title: "Lot Escape level", type: "object", additionalProperties: false, required: ["title", "size", "vehicles", "move_limit"], properties: { title: { type: "string", minLength: 1, maxLength: 48 }, size: { type: "integer", minimum: 5, maximum: 8 }, move_limit: { type: "integer", minimum: 1, maximum: 300 }, vehicles: { type: "array", minItems: 1, maxItems: 12, items: { type: "object", additionalProperties: false, required: ["id", "x", "y", "length", "axis", "exit", "color"], properties: { id: { type: "string", pattern: "^[a-z][a-z0-9-]{0,15}$" }, x: { type: "integer" }, y: { type: "integer" }, length: { type: "integer", minimum: 2, maximum: 3 }, axis: { enum: ["h", "v"] }, exit: { enum: DIRECTIONS }, color: { enum: ["coral", "sunshine", "lagoon", "mint", "violet", "peach"] } } } } } } as const;
export function validateLevel(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false as const, errors: ["level must be an object"] };
  const l = value as Record<string, unknown>, errors: string[] = [];
  if (Object.keys(l).some((k) => !["title", "size", "vehicles", "move_limit"].includes(k))) errors.push("level has an unknown field");
  if (typeof l.title !== "string" || !l.title.trim() || l.title.length > 48) errors.push("title must be 1-48 characters");
  if (!Number.isInteger(l.size) || (l.size as number) < 5 || (l.size as number) > 8) errors.push("size must be an integer from 5 to 8");
  if (!Number.isInteger(l.move_limit) || (l.move_limit as number) < 1 || (l.move_limit as number) > 300) errors.push("move_limit must be an integer from 1 to 300");
  if (!Array.isArray(l.vehicles) || l.vehicles.length < 1 || l.vehicles.length > 12) errors.push("vehicles must contain 1-12 cars");
  if (Array.isArray(l.vehicles) && Number.isInteger(l.size)) {
    const ids = new Set<string>(), occupied = new Set<string>(), size = l.size as number;
    for (const raw of l.vehicles) {
      if (!raw || typeof raw !== "object") { errors.push("each vehicle must be an object"); continue; }
      const v = raw as Vehicle;
      if (!/^[a-z][a-z0-9-]{0,15}$/.test(v.id) || ids.has(v.id)) errors.push("vehicle ids must be unique slugs"); else ids.add(v.id);
      if (!Number.isInteger(v.length) || v.length < 2 || v.length > 3 || !Number.isInteger(v.x) || !Number.isInteger(v.y) || !["h", "v"].includes(v.axis) || (v.axis === "h" ? v.exit !== "left" && v.exit !== "right" : v.exit !== "up" && v.exit !== "down") || !["coral", "sunshine", "lagoon", "mint", "violet", "peach"].includes(v.color)) { errors.push(`vehicle ${v.id} has invalid properties`); continue; }
      if (v.x < 0 || v.y < 0 || (v.axis === "h" ? v.x + v.length : v.y + v.length) > size || (v.axis === "h" ? v.y : v.x) >= size) errors.push(`vehicle ${v.id} is outside the lot`);
      for (let i = 0; i < v.length; i++) { const key = `${v.x + (v.axis === "h" ? i : 0)},${v.y + (v.axis === "v" ? i : 0)}`; if (occupied.has(key)) errors.push(`vehicles overlap at ${key}`); occupied.add(key); }
    }
    if (!errors.length) { const solved = solveLevel(l as unknown as Level); if (solved.truncated) errors.push("the lot is too large to check exactly; use fewer or shorter vehicles"); else if (!solved.solvable) errors.push("all vehicles cannot reach an exit"); else if ((solved.min_moves ?? Infinity) > (l.move_limit as number)) errors.push(`clearing the lot needs ${solved.min_moves} moves, above move_limit`); }
  }
  return errors.length ? { ok: false as const, errors } : { ok: true as const };
}
export const adapter: Adapter = { game_id: "lotescape", name: "Lot Escape", schema: schema as object, bots: [...BOTS], validate: validateLevel, simulate(level, bot, seed) { return playOut(level as Level, bot, seed); }, solve(value) { const check = validateLevel(value); if (!check.ok) return { solvable: false }; const result = solveLevel(value as Level); return { solvable: result.solvable, min_moves: result.min_moves, inputs: result.inputs }; }, level_url(id) { return `${BASE_URL}/lotescape/?level=${encodeURIComponent(id)}`; } };
/** Generates a lot and checks it with this adapter's own validator before returning it. Throws if it somehow fails validation. */
export function generateValidLevel(options: GenerateOptions): GeneratedLevel {
  const made = generateLevel(options), check = validateLevel(made.level);
  if (!check.ok) throw new Error(`generated level failed validation: ${check.errors.join("; ")}`);
  return made;
}
export default adapter;
