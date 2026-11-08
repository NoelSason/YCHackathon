// Seeded Lot Escape level generator. Shared by the browser's endless mode (in a Web Worker), the
// adapter, and any service that needs fresh lots. It never adds a rule of its own: candidates are
// checked with the engine's movement rule through the exact solver, and a level is returned only
// once the solver has cleared it.
//
// Stable API (other services import it; keep these signatures backward compatible):
//   generateLevel(options) -> GeneratedLevel
//   rateLevel(level, solution?) -> LevelRating | undefined
//   difficultyProfile(difficulty) -> DifficultyProfile
//   moveLimitFor(minMoves) -> number
import { distanceToExit, type Axis, type Direction, type Level, type Vehicle } from "./engine.js";
import { solveLevel, type Solution } from "./solver.js";

/** How hard a solvable lot is, measured from the lot and its exact solution. */
export interface LevelRating {
  /** The solver's fewest moves (one move per cell travelled). */
  min_moves: number;
  /** Moves needed if nothing were in the way: the sum of every vehicle's distance to its exit. */
  free_moves: number;
  /** Steps some vehicle must take away from its exit in any best solution: (min_moves - free_moves) / 2. */
  backups: number;
  /** Longest chain of blockers at the start: A waits on B waits on C is 2. A free vehicle is 0. */
  blocking_depth: number;
  /** Vehicles whose route to their exit is blocked at the start. */
  blocked: number;
  vehicles: number;
  trucks: number;
  /** One number for ordering lots by difficulty. Backups weigh most, then depth, then size. */
  score: number;
}

/** What a difficulty notch asks for. Notches start at 1 and rise without limit; above 12 they hold the top profile. */
export interface DifficultyProfile {
  difficulty: number;
  size: number;
  vehicles: [min: number, max: number];
  /** Accept a lot whose rating.score is in [min, max]. */
  score: [min: number, max: number];
  /** At least this many trucks. */
  trucks: number;
}

export interface GenerateOptions {
  /** Any number or string. The same seed and difficulty give the same level. */
  seed: number | string;
  /** Integer notch, 1 or more. Higher is harder. */
  difficulty: number;
  /** Override the generated title (1-48 characters). */
  title?: string;
  /** Candidate lots to try before giving up on the exact band. Deterministic. Default 4000. */
  maxAttempts?: number;
  /** Wall-clock backstop in milliseconds. Default 8000. If it fires, the result depends on machine speed; `stopped` says so. */
  timeLimitMs?: number;
}

export interface GeneratedLevel {
  /** A valid level in the standard JSON format, with move_limit = moveLimitFor(min_moves). */
  level: Level;
  rating: LevelRating;
  /** The solver's shortest solution for `level`. */
  inputs: Array<{ id: string; direction: Direction }>;
  difficulty: number;
  seed: number | string;
  attempts: number;
  /** "target": the rating landed in the profile's band. "budget"/"time": the closest solvable lot found when the attempt or time cap ran out. */
  stopped: "target" | "budget" | "time";
}

/** Solver cap per candidate while generating. Lots that need more are skipped, so every returned level also validates under the adapter's 250k cap. */
const CANDIDATE_STATES = 40_000;
/** Notches above this hold its profile: past it, 6×6 lots rarely get harder within the time budget. */
const CEILING = 12;
const COLORS = ["coral", "sunshine", "lagoon", "mint", "violet", "peach"] as const;
const CAR_NAMES = ["coupe", "taxi", "mini", "jeep", "wagon", "cab", "roadster", "hatch", "sedan", "buggy", "racer", "scout"];
const TRUCK_NAMES = ["truck", "bus", "van", "hauler", "tanker", "camper", "loader", "mover"];
const PLACE_A = ["Copper", "Harbor", "Juniper", "Cobalt", "Maple", "Lantern", "Granite", "Willow", "Saffron", "Beacon", "Orchard", "Tidal", "Ember", "Quarry", "Linden", "Marigold"];
const PLACE_B = ["Lane", "Row", "Yard", "Court", "Alley", "Square", "Depot", "Crossing", "Terrace", "Garage", "Wharf", "Mews"];

/** The move limit for a lot: the solver's best plus about 20%, and at least 2 spare moves. */
export function moveLimitFor(minMoves: number): number { return minMoves + Math.max(2, Math.round(minMoves * 0.2)); }

/** The notch ladder. Each notch asks for a higher score band; vehicle count and truck count rise with it. */
export function difficultyProfile(difficulty: number): DifficultyProfile {
  const d = Math.max(1, Math.floor(Number.isFinite(difficulty) ? difficulty : 1));
  const top = Math.min(d, CEILING);
  const lo = 14 + 5 * (top - 1);
  return {
    difficulty: d,
    size: 6,
    vehicles: [Math.min(7 + Math.floor(top / 2), 11), Math.min(8 + Math.floor(top / 2), 12)],
    score: [lo, d >= CEILING ? Number.POSITIVE_INFINITY : lo + 7],
    trucks: Math.min(1 + Math.floor(top / 3), 4),
  };
}

/** Rates a lot. Returns undefined when it isn't solvable (or too large to check). Pass a solution you already have to skip re-solving. */
export function rateLevel(level: Level, solution: Solution = solveLevel(level)): LevelRating | undefined {
  if (!solution.solvable || solution.min_moves === undefined) return undefined;
  const free = level.vehicles.reduce((sum, v) => sum + distanceToExit(level.size, v), 0);
  const backups = (solution.min_moves - free) / 2;
  const { depth, blocked } = blocking(level);
  const trucks = level.vehicles.filter((v) => v.length === 3).length;
  return { min_moves: solution.min_moves, free_moves: free, backups, blocking_depth: depth, blocked, vehicles: level.vehicles.length, trucks, score: 8 * backups + 2 * Math.min(depth, 6) + level.vehicles.length + trucks };
}

/** Generates a solvable lot at the given notch. Deterministic for a seed and difficulty unless the time backstop fires. */
export function generateLevel(options: GenerateOptions): GeneratedLevel {
  const profile = difficultyProfile(options.difficulty);
  const rand = rng(`${options.seed}|${profile.difficulty}`);
  const maxAttempts = options.maxAttempts ?? 4000, deadline = Date.now() + (options.timeLimitMs ?? 8000);
  const [lo, hi] = profile.score;
  const distance = (score: number) => (score < lo ? lo - score : score > hi ? score - hi : 0);
  let best: { vehicles: Vehicle[]; rating: LevelRating; solution: Solution } | undefined;
  let current: { vehicles: Vehicle[]; distance: number } | undefined;
  let attempts = 0, stale = 0, stopped: GeneratedLevel["stopped"] = "budget";

  while (attempts < maxAttempts) {
    if (Date.now() > deadline && best) { stopped = "time"; break; }
    attempts++;
    // Stuck: restart, half the time from a fresh random lot, half from a shaken-up copy of the best so far.
    if (stale >= 150) { stale = 0; current = best && rand() < 0.5 ? { vehicles: shake(best.vehicles, profile, rand), distance: Infinity } : undefined; }
    const vehicles = current ? mutate(current.vehicles, profile, rand) : randomLot(profile, rand);
    if (!vehicles) continue;
    const level: Level = { title: "candidate", size: profile.size, vehicles, move_limit: 300 };
    const solution = solveLevel(level, CANDIDATE_STATES);
    const rating = rateLevel(level, solution);
    if (!rating) { stale++; continue; }
    const d = distance(rating.score);
    if (!best || d < distance(best.rating.score)) best = { vehicles, rating, solution };
    if (d === 0) { stopped = "target"; break; }
    // Hill climb: keep a change that brings the score closer to the band (or no further away).
    if (!current || d < current.distance) { current = { vehicles, distance: d }; stale = 0; }
    else { if (d === current.distance || rand() < 0.03) current = { vehicles, distance: d }; stale++; }
  }
  // Nothing solvable inside the caps (very unlikely): fall back to a small, sparse lot, which always clears quickly.
  while (!best) {
    const vehicles = randomLot({ ...profile, vehicles: [5, 5], trucks: 1 }, rand);
    if (!vehicles) continue;
    const solution = solveLevel({ title: "candidate", size: profile.size, vehicles, move_limit: 300 }, CANDIDATE_STATES);
    const rating = rateLevel({ title: "candidate", size: profile.size, vehicles, move_limit: 300 }, solution);
    if (rating) best = { vehicles, rating, solution };
  }
  const level = finish(best.vehicles, profile.size, best.rating.min_moves, options.title, rand);
  // Renaming vehicles doesn't change the lot, but the inputs must use the final ids.
  const rename = new Map(best.vehicles.map((v, i) => [v.id, level.vehicles[i]!.id]));
  const inputs = (best.solution.inputs ?? []).map((input) => ({ id: rename.get(input.id)!, direction: input.direction }));
  return { level, rating: best.rating, inputs, difficulty: profile.difficulty, seed: options.seed, attempts, stopped };
}

// ---- helpers ---------------------------------------------------------------------------------

type Rand = () => number;
function rng(seed: string): Rand {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = <T>(rand: Rand, items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;

function cellsOf(v: Pick<Vehicle, "x" | "y" | "length" | "axis">): number[] {
  return Array.from({ length: v.length }, (_, i) => (v.y + (v.axis === "v" ? i : 0)) * 16 + v.x + (v.axis === "h" ? i : 0));
}
/** Two vehicles in one lane that each need to drive through the other can never both leave. */
function headOn(a: Vehicle, b: Vehicle): boolean {
  if (a.axis !== b.axis || (a.axis === "h" ? a.y !== b.y : a.x !== b.x)) return false;
  const [first, second] = (a.axis === "h" ? a.x < b.x : a.y < b.y) ? [a, b] : [b, a];
  return (first.exit === "right" || first.exit === "down") && (second.exit === "left" || second.exit === "up");
}
function fits(vehicles: Vehicle[], candidate: Vehicle, size: number, skip = -1): boolean {
  if (candidate.x < 0 || candidate.y < 0) return false;
  if (candidate.axis === "h" ? candidate.x + candidate.length > size || candidate.y >= size : candidate.y + candidate.length > size || candidate.x >= size) return false;
  const taken = new Set(vehicles.flatMap((v, i) => (i === skip ? [] : cellsOf(v))));
  if (cellsOf(candidate).some((c) => taken.has(c))) return false;
  return !vehicles.some((v, i) => i !== skip && headOn(v, candidate));
}
function randomVehicle(id: string, size: number, rand: Rand, length = rand() < 0.3 ? 3 : 2): Vehicle {
  const axis: Axis = rand() < 0.5 ? "h" : "v";
  const along = Math.floor(rand() * (size - length + 1)), lane = Math.floor(rand() * size);
  const exit: Direction = axis === "h" ? (rand() < 0.5 ? "left" : "right") : rand() < 0.5 ? "up" : "down";
  return { id, x: axis === "h" ? along : lane, y: axis === "h" ? lane : along, length, axis, exit, color: "coral" };
}
function randomLot(profile: Pick<DifficultyProfile, "size" | "vehicles" | "trucks">, rand: Rand): Vehicle[] | undefined {
  const [min, max] = profile.vehicles, target = min + Math.floor(rand() * (max - min + 1));
  const vehicles: Vehicle[] = [];
  for (let tries = 0; vehicles.length < target && tries < 400; tries++) {
    const truck = vehicles.length < profile.trucks || rand() < 0.2;
    const v = randomVehicle(`v${vehicles.length}`, profile.size, rand, truck ? 3 : 2);
    if (fits(vehicles, v, profile.size)) vehicles.push(v);
  }
  return vehicles.length >= min ? vehicles : undefined;
}
/** One small random change: move a vehicle, nudge it a cell, flip its exit, or swap it for a new one. */
function mutate(source: Vehicle[], profile: DifficultyProfile, rand: Rand): Vehicle[] | undefined {
  const vehicles = source.map((v) => ({ ...v }));
  const [min, max] = profile.vehicles, trucks = () => vehicles.filter((v) => v.length === 3).length;
  for (let tries = 0; tries < 30; tries++) {
    const roll = rand(), i = Math.floor(rand() * vehicles.length), v = vehicles[i]!;
    if (roll < 0.1 && vehicles.length < max) {
      const added = randomVehicle(`v${vehicles.length}`, profile.size, rand);
      if (fits(vehicles, added, profile.size)) { vehicles.push(added); return vehicles; }
    } else if (roll < 0.18 && vehicles.length > min && (v.length === 2 || trucks() > profile.trucks)) {
      vehicles.splice(i, 1); return vehicles.map((x, k) => ({ ...x, id: `v${k}` }));
    } else if (roll < 0.45) {
      const step = rand() < 0.5 ? -1 : 1;
      const moved = { ...v, x: v.axis === "h" ? v.x + step : v.x, y: v.axis === "v" ? v.y + step : v.y };
      if (fits(vehicles, moved, profile.size, i)) { vehicles[i] = moved; return vehicles; }
    } else if (roll < 0.6) {
      const flipped: Vehicle = { ...v, exit: ({ left: "right", right: "left", up: "down", down: "up" } as const)[v.exit] };
      if (fits(vehicles, flipped, profile.size, i)) { vehicles[i] = flipped; return vehicles; }
    } else {
      const keepTruck = v.length === 3 && trucks() <= profile.trucks;
      const replaced = randomVehicle(v.id, profile.size, rand, keepTruck ? 3 : undefined);
      if (fits(vehicles, replaced, profile.size, i)) { vehicles[i] = replaced; return vehicles; }
    }
  }
  return undefined;
}
function shake(source: Vehicle[], profile: DifficultyProfile, rand: Rand): Vehicle[] {
  let vehicles = source;
  for (let i = 0; i < 4; i++) vehicles = mutate(vehicles, profile, rand) ?? vehicles;
  return vehicles;
}
/** Route cells from a vehicle's front to its exit edge. */
function route(v: Vehicle, size: number): number[] {
  const out: number[] = [];
  if (v.exit === "right") for (let x = v.x + v.length; x < size; x++) out.push(v.y * 16 + x);
  if (v.exit === "left") for (let x = 0; x < v.x; x++) out.push(v.y * 16 + x);
  if (v.exit === "down") for (let y = v.y + v.length; y < size; y++) out.push(y * 16 + v.x);
  if (v.exit === "up") for (let y = 0; y < v.y; y++) out.push(y * 16 + v.x);
  return out;
}
function blocking(level: Level): { depth: number; blocked: number } {
  const owner = new Map<number, number>();
  level.vehicles.forEach((v, i) => cellsOf(v).forEach((c) => owner.set(c, i)));
  const blockers = level.vehicles.map((v) => [...new Set(route(v, level.size).flatMap((c) => (owner.has(c) ? [owner.get(c)!] : [])))]);
  // Longest simple chain of "waits on" edges. Lots have at most 12 vehicles, so a plain DFS is cheap.
  const longest = (i: number, path: Set<number>): number => {
    let best = 0;
    for (const j of blockers[i]!) {
      if (path.has(j)) { best = Math.max(best, 1); continue; }
      path.add(j); best = Math.max(best, 1 + longest(j, path)); path.delete(j);
    }
    return best;
  };
  return { depth: Math.max(0, ...level.vehicles.map((_, i) => longest(i, new Set([i])))), blocked: blockers.filter((b) => b.length > 0).length };
}
function touching(a: Vehicle, b: Vehicle): boolean {
  const near = new Set(cellsOf(a).flatMap((c) => [c - 1, c + 1, c - 16, c + 16]));
  return cellsOf(b).some((c) => near.has(c));
}
/** Final ids, colors, title, and move limit. Vehicles keep their order, so solver inputs can be renamed index by index. */
function finish(vehicles: Vehicle[], size: number, minMoves: number, title: string | undefined, rand: Rand): Level {
  const cars = [...CAR_NAMES], trucks = [...TRUCK_NAMES], offset = Math.floor(rand() * COLORS.length);
  const take = (names: string[], fallback: string, i: number) => names.length ? names.splice(Math.floor(rand() * names.length), 1)[0]! : `${fallback}-${i}`;
  // Colors: vehicles that touch get different colors where possible, so two never read as one.
  const colors: Vehicle["color"][] = [], used = new Map<string, number>();
  vehicles.forEach((v, i) => {
    const near = new Set(vehicles.slice(0, i).flatMap((u, k) => (touching(u, v) ? [colors[k]!] : [])));
    const order = COLORS.map((_, k) => COLORS[(i + offset + k) % COLORS.length]!);
    const free = order.filter((c) => !near.has(c));
    const color = (free.length ? free : order).reduce((a, b) => ((used.get(b) ?? 0) < (used.get(a) ?? 0) ? b : a));
    colors.push(color); used.set(color, (used.get(color) ?? 0) + 1);
  });
  const named = vehicles.map((v, i) => ({ ...v, id: take(v.length === 3 ? trucks : cars, v.length === 3 ? "truck" : "car", i), color: colors[i]! }));
  return { title: (title ?? `${pick(rand, PLACE_A)} ${pick(rand, PLACE_B)}`).slice(0, 48), size, vehicles: named, move_limit: moveLimitFor(minMoves) };
}
