// Built-in sample levels (playable with ?sample=N before the platform serves levels by id),
// plus a seeded generator for making more. Every sample is checked by the tests: valid and solvable.
import { COLORS, type Color, isComplete, type Level, toTubes } from "./engine.js";
import { mulberry32 } from "./bots.js";
import { solveLevel, SolverLimitError } from "./solver.js";

/**
 * Deal `colors` colors of `capacity` units each, shuffled, into tubes, plus `spare` empty tubes.
 * This is a raw deal: it can be unsolvable. Use generateSolvableLevel for a level to publish.
 */
export function generateLevel(opts: {
  colors: number;
  capacity: number;
  spare: number;
  move_limit: number;
  seed: number;
  title?: string;
}): Level {
  const rnd = mulberry32(opts.seed);
  const units: Color[] = [];
  for (let c = 0; c < opts.colors; c++) for (let k = 0; k < opts.capacity; k++) units.push(COLORS[c]!);
  for (let i = units.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [units[i], units[j]] = [units[j]!, units[i]!];
  }
  const tubes: Color[][] = [];
  for (let t = 0; t < opts.colors; t++) tubes.push(units.slice(t * opts.capacity, (t + 1) * opts.capacity));
  for (let s = 0; s < opts.spare; s++) tubes.push([]);
  return { title: opts.title, capacity: opts.capacity, tubes, move_limit: opts.move_limit };
}

/**
 * A deal the exact solver has proven solvable within `move_limit`, with no tube finished at the
 * start. Tries the given seed first, then later seeds, so a seed that already gives a good deal
 * returns exactly what generateLevel would.
 */
export function generateSolvableLevel(opts: Parameters<typeof generateLevel>[0], maxAttempts = 50): Level {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const level = generateLevel({ ...opts, seed: opts.seed + attempt });
    if (toTubes(level).some((t) => isComplete(t, level.capacity))) continue;
    try {
      const r = solveLevel(level);
      if (r.solvable && r.min_moves! <= level.move_limit) return level;
    } catch (e) {
      if (!(e instanceof SolverLimitError)) throw e;
    }
  }
  throw new Error(`no solvable deal within ${opts.move_limit} pours in ${maxAttempts} seeds; add a spare tube or raise move_limit`);
}

export const SAMPLES: Level[] = [
  {
    title: "First Splash",
    capacity: 4,
    move_limit: 12,
    tubes: [
      ["red", "blue", "red", "blue"],
      ["blue", "red", "blue", "red"],
      [],
    ],
  },
  {
    title: "Three Tides",
    capacity: 4,
    move_limit: 20,
    tubes: [
      ["yellow", "teal", "pink", "teal"],
      ["pink", "yellow", "teal", "yellow"],
      ["teal", "pink", "yellow", "pink"],
      [],
      [],
    ],
  },
  generateLevel({ colors: 5, capacity: 4, spare: 2, move_limit: 20, seed: 7, title: "Rainbow Rush" }),
  generateLevel({ colors: 7, capacity: 4, spare: 2, move_limit: 28, seed: 21, title: "Deep End" }),
];
