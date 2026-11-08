// Splash Sort adapter: plugs the game into the platform (platform/CONTRACTS.md §1).
import { schema, validateLevel, type Level } from "../src/engine.js";
import { BOTS, playOut } from "../src/bots.js";
import { solveLevel } from "../src/solver.js";

const GAMES_BASE_URL = process.env.GAMES_BASE_URL ?? "http://localhost:3000";

export const adapter = {
  game_id: "watersort",
  name: "Splash Sort",
  schema: schema as object,
  // "human" first: it is the reference bot the Tuner tunes against.
  bots: [...BOTS] as string[],
  validate(level: unknown) {
    return validateLevel(level);
  },
  simulate(level: object, bot: string, seed: number) {
    return playOut(level as Level, bot, seed);
  },
  solve(level: object) {
    const r = solveLevel(level as Level);
    const l = level as Level;
    // "Solvable" for this level means: solvable within its move limit.
    return {
      solvable: r.solvable && (r.min_moves ?? Infinity) <= l.move_limit,
      min_moves: r.min_moves,
      inputs: r.inputs,
    };
  },
  level_url(level_id: string) {
    return `${GAMES_BASE_URL}/watersort/?level=${encodeURIComponent(level_id)}`;
  },
};

export default adapter;
