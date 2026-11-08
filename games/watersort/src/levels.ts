// Built-in sample levels (playable with ?sample=N before the platform serves levels by id),
// plus a seeded generator for making more. Every sample is checked by the tests: valid and solvable.
import { COLORS, type Color, type Level } from "./engine.js";
import { mulberry32 } from "./bots.js";

/** Deal `colors` colors of `capacity` units each, shuffled, into tubes, plus `spare` empty tubes. */
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
