import type { CreateOptions } from "../engine/houseki-gem-swap/gem-swap/types.js";
import type { GemColour } from "../engine/houseki-gem-swap/gem-swap/types-pieces.js";

/**
 * The match-3 level format and its mapping to engine settings. This module has no Node or
 * environment dependencies, so the adapter (Solver) and the browser player (player/) import the same
 * code. Never copy `levelOptions` elsewhere: players must get the game the Solver measured.
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

/** Level JSON → engine settings. `runSeed` gives each attempt a fresh board from the same level. */
export function levelOptions(level: MatchLevel, runSeed: number): CreateOptions {
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

/** Builds a row-major mask from rows of `#` (playable) and `.` (empty). */
function maskOf(rows: readonly string[]): boolean[] {
  return rows.flatMap((row) => [...row].map((cell) => cell === "#"));
}

/**
 * Built-in practice levels, shipped with the game rather than made by the agents. These are the
 * three local-demo boards (demo/server.ts) in the adapter's level format. The web player offers them
 * only while no agent-made match-3 level has been published, and labels them as practice.
 */
export const PRACTICE_LEVELS: readonly (MatchLevel & { id: string })[] = Object.freeze([
  {
    id: "meadow",
    name: "Open Meadow",
    width: 8,
    height: 8,
    colour_count: 5,
    seed: "practice-meadow",
    mask: maskOf(["########", "########", "########", "########", "########", "########", "########", "########"]),
    seals: [18, 29, 34, 45].map((cell) => ({ cell, layers: 1 })),
    goal: { colour: "red", target: 12 },
    move_limit: 24,
  },
  {
    id: "blossom",
    name: "Blossom Bowl",
    width: 8,
    height: 8,
    colour_count: 5,
    seed: "practice-blossom",
    mask: maskOf(["..####..", ".######.", "########", "########", "########", "########", ".######.", "..####.."]),
    seals: [19, 20, 35, 36].map((cell) => ({ cell, layers: 1 })),
    goal: { colour: "red", target: 12 },
    move_limit: 24,
  },
  {
    id: "bend",
    name: "Winding Orchard",
    width: 8,
    height: 8,
    colour_count: 5,
    seed: "practice-bend",
    mask: maskOf(["##......", "####....", "######..", "..######", "....####", "....####", "......##", "......##"]),
    seals: [{ cell: 37, layers: 1 }],
    goal: { colour: "red", target: 8 },
    move_limit: 35,
  },
]);
