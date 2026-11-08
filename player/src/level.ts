import type { CreateOptions } from "../../games/match3/engine/houseki-gem-swap/gem-swap/types.js";
import type { GemColour } from "../../games/match3/engine/houseki-gem-swap/gem-swap/types-pieces.js";

/**
 * A saved match3 level, exactly as the adapter's schema defines it
 * (games/match3/adapter/index.ts, `MatchLevel` and `schema`).
 */
export interface MatchLevel {
  name: string;
  width: number;
  height: number;
  colour_count: 4 | 5 | 6;
  seed: number | string;
  mask?: boolean[];
  seals?: { cell: number; layers: number }[];
  goal: { colour: GemColour; target: number };
  move_limit: number;
}

/**
 * Level JSON → engine settings. This MIRRORS `options()` in games/match3/adapter/index.ts, which the
 * Solver uses to measure each level's win rate. That function isn't exported and the adapter module
 * reads `process.env`, so it can't be imported into a browser bundle. Keep the two identical: if the
 * adapter's mapping changes, change this too, or players get a different game than the one measured.
 *
 * `runSeed` plays the role of the Solver's per-run seed: same level seed, a fresh board each attempt.
 */
export function toCreateOptions(level: MatchLevel, runSeed: number): CreateOptions {
  return {
    width: level.width,
    height: level.height,
    colourCount: level.colour_count,
    seed: `${String(level.seed)}:${runSeed >>> 0}`,
    tools: false,
    mode: "challenge",
    challenge: {
      goals: [
        { kind: "collect", colour: level.goal.colour, target: level.goal.target },
        ...(level.seals?.length ? [{ kind: "seals" as const }] : []),
      ],
      moveLimit: level.move_limit,
      ...(level.seals ? { seals: level.seals } : {}),
    },
    ...(level.mask ? { mask: level.mask } : {}),
  };
}
