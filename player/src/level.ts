/**
 * The match-3 level format, its engine mapping, and the built-in practice levels all come from
 * games/match3/adapter/levels.ts, the same module the adapter (and so the Solver) uses. Importing it
 * instead of mirroring it means players always get the game the Solver measured.
 */
import { levelOptions, PRACTICE_LEVELS, type MatchLevel } from "../../games/match3/adapter/levels.js";

export { PRACTICE_LEVELS, type MatchLevel };

/** Level JSON → engine settings. `runSeed` gives each attempt a fresh board, like the Solver's per-run seed. */
export const toCreateOptions = levelOptions;
