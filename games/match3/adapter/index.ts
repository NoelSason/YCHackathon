import type { Adapter } from "../../../platform/mcp/src/adapters.js";
import { advanceTicks, applyAction, createGame, legalActions, statusOf } from "../engine/houseki-gem-swap/gem-swap/engine.js";
import { goalValue } from "../engine/houseki-gem-swap/gem-swap/engine-ticks.js";
import type { Action } from "../engine/houseki-gem-swap/gem-swap/types-actions.js";
import type { GameState } from "../engine/houseki-gem-swap/gem-swap/types-state.js";
import type { GemColour } from "../engine/houseki-gem-swap/gem-swap/types-pieces.js";
import { levelOptions, type MatchLevel } from "./levels.js";

export { levelOptions, PRACTICE_LEVELS, type MatchLevel } from "./levels.js";

const BASE_URL = process.env.GAMES_BASE_URL ?? "http://localhost:3000";
const COLOURS: readonly GemColour[] = ["red", "blue", "green", "gold", "purple", "teal"];
const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["name", "width", "height", "colour_count", "seed", "goal", "move_limit"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 60 },
    width: { type: "integer", minimum: 4, maximum: 16 },
    height: { type: "integer", minimum: 4, maximum: 32 },
    colour_count: { type: "integer", enum: [4, 5, 6] },
    seed: { oneOf: [{ type: "integer", minimum: 0, maximum: 4294967295 }, { type: "string", minLength: 1, maxLength: 200 }] },
    mask: { type: "array", description: "Optional row-major active-cell mask; its length must equal width × height.", items: { type: "boolean" } },
    seals: { type: "array", description: "Optional clearable tile blockers placed over active cells.", maxItems: 512, items: { type: "object", additionalProperties: false, required: ["cell", "layers"], properties: { cell: { type: "integer", minimum: 0 }, layers: { type: "integer", minimum: 1, maximum: 3 } } } },
    goal: { type: "object", additionalProperties: false, required: ["colour", "target"], properties: { colour: { enum: COLOURS }, target: { type: "integer", minimum: 1, maximum: 1000 } } },
    move_limit: { type: "integer", minimum: 1, maximum: 200 },
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function settle(state: GameState): GameState {
  // One call that runs up to 3600 ticks and stops when the board settles: the same game state as
  // advanceTicks(state, 1) in a loop, without the per-call replay-history copy (about 2x faster).
  if (state.phase !== "ready" && state.phase !== "finished") state = advanceTicks(state, 3600).state;
  if (state.phase !== "ready" && state.phase !== "finished") throw new Error("match-3 engine did not settle within 3600 ticks");
  return state;
}

function randomFor(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isSwap(action: Action): action is Extract<Action, { kind: "swap" }> {
  return action.kind === "swap";
}

function transitionFor(state: GameState, action: Extract<Action, { kind: "swap" }>): GameState {
  const transition = applyAction(state, action);
  if (!transition.accepted) throw new Error(`engine rejected legal swap: ${transition.reason ?? "unknown reason"}`);
  return settle(transition.state);
}

export const adapter: Adapter = {
  game_id: "match3",
  name: "Gem Garden",
  schema,
  bots: ["random", "greedy"],
  validate(value) {
    const errors: string[] = [];
    if (!isRecord(value)) return { ok: false, errors: ["level must be an object"] };
    const l = value as unknown as Partial<MatchLevel>;
    if (typeof l.name !== "string" || !l.name.trim() || l.name.length > 60) errors.push("name must be 1–60 characters");
    if (!Number.isInteger(l.width) || (l.width ?? 0) < 4 || (l.width ?? 0) > 16) errors.push("width must be an integer from 4 to 16");
    if (!Number.isInteger(l.height) || (l.height ?? 0) < 4 || (l.height ?? 0) > 32 || (l.width ?? 0) * (l.height ?? 0) > 512) errors.push("height must be 4–32 and the board may contain at most 512 cells");
    if (![4, 5, 6].includes(l.colour_count ?? 0)) errors.push("colour_count must be 4, 5, or 6");
    if (typeof l.seed !== "string" && (!Number.isInteger(l.seed) || (l.seed ?? -1) < 0 || (l.seed ?? 0) > 0xffff_ffff)) errors.push("seed must be a string or unsigned 32-bit integer");
    if (typeof l.seed === "string" && (!l.seed.length || l.seed.length > 200)) errors.push("string seed must be 1–200 characters");
    if (l.mask !== undefined && (!Array.isArray(l.mask) || l.mask.length !== (l.width ?? 0) * (l.height ?? 0) || l.mask.some((cell) => typeof cell !== "boolean"))) errors.push("mask must be a boolean array with width × height entries");
    if (l.seals !== undefined) {
      if (!Array.isArray(l.seals) || l.seals.length > 512) errors.push("seals must be an array of at most 512 blockers");
      else {
        const seen = new Set<number>();
        for (const seal of l.seals) {
          if (!seal || !Number.isInteger(seal.cell) || seal.cell < 0 || seal.cell >= (l.width ?? 0) * (l.height ?? 0) || !Number.isInteger(seal.layers) || seal.layers < 1 || seal.layers > 3 || seen.has(seal.cell)) {
            errors.push("each seal needs a unique in-bounds cell and 1–3 layers"); break;
          }
          if ((l.mask && !l.mask[seal.cell]) || (!l.mask && (l.width ?? 0) * (l.height ?? 0) <= seal.cell)) {
            errors.push("seals must be placed on active cells"); break;
          }
          seen.add(seal.cell);
        }
      }
    }
    const goal = l.goal;
    if (!goal || typeof goal !== "object" || !COLOURS.includes(goal.colour) || !Number.isInteger(goal.target) || goal.target < 1 || goal.target > 1000) errors.push("goal must request 1–1000 gems of a supported colour");
    else if (COLOURS.indexOf(goal.colour) >= (l.colour_count ?? 0)) errors.push("goal colour must be included by colour_count");
    if (!Number.isInteger(l.move_limit) || (l.move_limit ?? 0) < 1 || (l.move_limit ?? 0) > 200) errors.push("move_limit must be an integer from 1 to 200");
    if (!errors.length) {
      try { createGame(levelOptions(l as MatchLevel, 0)); }
      catch (error) { errors.push(error instanceof Error ? error.message : "level settings are not accepted by the game engine"); }
    }
    return errors.length ? { ok: false, errors } : { ok: true };
  },
  simulate(value, bot, seed) {
    const check = adapter.validate(value);
    if (!check.ok) throw new Error(check.errors.join("; "));
    if (!adapter.bots.includes(bot)) throw new Error(`unknown bot: ${bot}`);
    const level = value as MatchLevel;
    const random = randomFor(seed);
    let state = settle(createGame(levelOptions(level, seed)));
    while (state.phase !== "finished") {
      const swaps = legalActions(state).filter(isSwap);
      if (!swaps.length) break;
      let next: GameState;
      if (bot === "random") {
        next = transitionFor(state, swaps[Math.floor(random() * swaps.length)]!);
      } else {
        // Goal progress is read once per candidate with goalValue (what statusOf reports as
        // goalProgress[0].current). statusOf() also rescans every legal move, and calling it inside
        // the comparator made the greedy bot about 20x slower. Same comparisons, same order, same
        // random() calls, so the results are unchanged.
        const candidates = swaps.map((action) => {
          const s = transitionFor(state, action);
          const goal = s.challenge?.goals[0];
          return { s, goal: goal ? goalValue(s, goal) : 0 };
        });
        candidates.sort((a, b) => b.goal - a.goal || b.s.score - a.s.score || random() - 0.5);
        next = candidates[0]!.s;
      }
      state = next;
    }
    const progress = statusOf(state).goalProgress[0]?.current ?? 0;
    return {
      won: state.outcome === "won",
      moves_used: state.swapCount,
      detail: { collected: progress, target: level.goal.target, score: state.score, seed },
    };
  },
  level_url(level_id) { return `${BASE_URL}/match3/?level=${encodeURIComponent(level_id)}`; },
};

export default adapter;
