import type { Adapter } from "../../../platform/mcp/src/adapters.js";

import { type PlatformLevel, schema, find, key, neighbors, path, validateLevel } from "../src/engine.js";
const BASE_URL = process.env.GAMES_BASE_URL ?? "http://localhost:3000";

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Chance that the human bot takes a wrong landing at a fork: lower jumps make trails harder to read. */
export function wrongTurnChance(level: PlatformLevel): number {
  return Math.min(0.3, 0.12 + 0.03 * (4 - level.jump_height));
}

//   human   follows the shortest route from wherever it stands, but at a fork sometimes lands on a
//           wrong ledge, then re-plans from there. A wrong drop it can't climb back may cost a long
//           detour, or the trail. The reference bot for tuning move_limit.
//   greedy  the exact shortest route (wins whenever move_limit allows it)
//   random  wanders toward the goal at random
function human(level: PlatformLevel, seed: number) {
  const random = rng(seed);
  const goal = find(level.map, "G")[0]!;
  const limit = level.move_limit ?? Infinity;
  const chance = wrongTurnChance(level);
  let at = find(level.map, "S")[0]!;
  let route = path(level, at), step = 1, moves = 0, wrongTurns = 0;
  while (route && key(at) !== key(goal) && moves < limit) {
    const best = route[step]!;
    const others = neighbors(level, at).filter((p) => key(p) !== key(best));
    let next = best;
    if (others.length && random() < chance) { next = others[Math.floor(random() * others.length)]!; wrongTurns++; }
    at = next; moves++;
    if (next === best) step++;
    else { route = path(level, at); step = 1; }
  }
  const won = key(at) === key(goal) && moves <= limit;
  return { won, moves_used: moves, detail: { seed, wrong_turns: wrongTurns, ...(route ? {} : { stuck: key(at) }) } };
}

export const adapter: Adapter = {
  game_id: "platformer",
  name: "Mosslight Trails",
  schema,
  bots: ["human", "greedy", "random"],
  validate: validateLevel,
  simulate(value, bot, seed) {
    const check = adapter.validate(value);
    if (!check.ok) throw new Error(check.errors.join("; "));
    if (!adapter.bots.includes(bot)) throw new Error(`unknown bot: ${bot}`);
    const level = value as PlatformLevel;
    if (bot === "human") return human(level, seed);
    if (bot === "greedy") {
      const route = path(level)!;
      return { won: route.length - 1 <= (level.move_limit ?? Infinity), moves_used: route.length - 1, detail: { seed, path: route } };
    }
    let state = find(level.map, "S")[0]!;
    const goal = find(level.map, "G")[0]!;
    const random = (() => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) | 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
    const visited = new Set<string>([key(state)]);
    for (let moves = 1; moves <= Math.min(level.map.length * (level.map[0]?.length ?? 0), level.move_limit ?? Infinity); moves++) {
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
  level_url(level_id) { return `${BASE_URL}/games/platformer/?level=${encodeURIComponent(level_id)}`; },
};

export default adapter;
