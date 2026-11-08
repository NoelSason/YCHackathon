// Adapter registry. See platform/CONTRACTS.md §1.
// Max's adapters live in games/<game_id>/adapter/index.ts and are imported here by game_id.
// The `stub` adapter remains available for backward-compatible smoke runs.
import { adapter as match3 } from "../../../games/match3/adapter/index.js";
import { adapter as platformer } from "../../../games/platformer/adapter/index.js";

export interface ValidateOk { ok: true }
export interface ValidateErr { ok: false; errors: string[] }

export interface Adapter {
  game_id: string;
  name: string;
  schema: object;
  bots: string[];
  validate(level: unknown): ValidateOk | ValidateErr;
  simulate(level: object, bot: string, seed: number): { won: boolean; moves_used: number; detail?: object };
  solve?(level: object): { solvable: boolean; min_moves?: number; inputs?: unknown };
  level_url(level_id: string): string;
}

const GAMES_BASE_URL = process.env.GAMES_BASE_URL ?? "http://localhost:3000";

// Tiny deterministic PRNG so stub results are reproducible per seed.
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const stubAdapter: Adapter = {
  game_id: "stub",
  name: "Stub game",
  schema: {
    type: "object",
    required: ["width", "height", "moves"],
    properties: {
      width: { type: "integer", minimum: 3, maximum: 12 },
      height: { type: "integer", minimum: 3, maximum: 12 },
      moves: { type: "integer", minimum: 1, maximum: 100 },
    },
  },
  bots: ["random"],
  validate(level) {
    const errors: string[] = [];
    const l = level as Record<string, unknown>;
    if (!l || typeof l !== "object") return { ok: false, errors: ["level must be an object"] };
    for (const k of ["width", "height", "moves"]) {
      if (typeof l[k] !== "number") errors.push(`${k} must be a number`);
    }
    return errors.length ? { ok: false, errors } : { ok: true };
  },
  simulate(level, _bot, seed) {
    // Win probability rises with the move budget. Good enough to exercise the Tuner loop.
    const l = level as { moves: number; width: number; height: number };
    const rnd = mulberry32(seed);
    const p = Math.min(0.95, l.moves / (l.width * l.height));
    const won = rnd() < p;
    return { won, moves_used: Math.max(1, Math.round(l.moves * (0.5 + rnd() * 0.5))) };
  },
  level_url(level_id) {
    return `${GAMES_BASE_URL}/stub/?level=${level_id}`;
  },
};

const registry = new Map<string, Adapter>([
  [match3.game_id, match3],
  [platformer.game_id, platformer],
  [stubAdapter.game_id, stubAdapter],
]);

export function getAdapter(game_id: string): Adapter | undefined {
  return registry.get(game_id);
}

export function listAdapters(): Adapter[] {
  return [...registry.values()];
}
