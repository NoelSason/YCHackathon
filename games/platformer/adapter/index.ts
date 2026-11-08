import type { Adapter } from "../../../platform/mcp/src/adapters.js";

import { type PlatformLevel, schema, find, key, neighbors, path, validateLevel } from "../src/engine.js";
const BASE_URL = process.env.GAMES_BASE_URL ?? "http://localhost:3000";

export const adapter: Adapter = {
  game_id: "platformer",
  name: "Mosslight Trails",
  schema,
  bots: ["random", "greedy"],
  validate: validateLevel,
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
  level_url(level_id) { return `${BASE_URL}/games/platformer/?level=${encodeURIComponent(level_id)}`; },
};

export default adapter;
