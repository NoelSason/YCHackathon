// Turbo Lanes adapter: plugs the game into the platform (platform/CONTRACTS.md §1).
import { schema, validateLevel, type Level } from "../src/engine.js";
import { BOTS, drive } from "../src/bots.js";
import { solveLevel } from "../src/solver.js";

const GAMES_BASE_URL = process.env.GAMES_BASE_URL ?? "http://localhost:3000";

export const adapter = {
  game_id: "racer",
  name: "Turbo Lanes",
  schema: schema as object,
  // "human" first: it is the reference bot the Tuner tunes against.
  bots: [...BOTS] as string[],
  validate(level: unknown) {
    return validateLevel(level);
  },
  simulate(level: object, bot: string, seed: number) {
    return drive(level as Level, bot, seed);
  },
  solve(level: object) {
    const l = level as Level;
    const r = solveLevel(l);
    // "Solvable" for this level means: the fastest possible run beats the time limit.
    // min_moves is that fastest time in ticks; inputs replay it (one steer per tick).
    return { solvable: r.min_ticks <= l.time_limit, min_moves: r.min_ticks, inputs: r.inputs };
  },
  level_url(level_id: string) {
    return `${GAMES_BASE_URL}/racer/?level=${encodeURIComponent(level_id)}`;
  },
};

export default adapter;
