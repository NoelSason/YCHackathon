// Seeded Mosslight Trails generator: original terrain, checked with the shared rules (engine.ts)
// before it is returned. The same seed and difficulty always give the same trail.
//
// Difficulty (1 easiest, 12 the top) changes how the trail reads, not the rules:
//   - longer trails, rougher ground, and lower jumps (3 → 2) as it rises;
//   - more floating ledges, which add forks: some lead on, some are dead ends;
//   - one-way drops (deeper than the jump height) that can't be climbed back;
//   - thorn tiles on the ground where a ledge above offers the way round.
// The tuner then sets move_limit from human-bot play to reach a win-rate target.
import { find, path, validateLevel, type PlatformLevel } from "./engine.js";

export interface TrailOptions {
  seed: number;
  /** Integer notch, 1 or more. Above 12 it holds the top profile. */
  difficulty: number;
  name?: string;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function attempt(seed: number, d: number, name: string): PlatformLevel {
  const r = rng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const width = Math.min(56, 16 + 3 * d + int(0, 4));
  const height = 12;
  const jump = d <= 3 ? 3 : 2;
  const fall = d <= 6 ? 5 : 4;
  // Ground surface row per column (the walkable tile; solid below it). Rows grow downward.
  const ground: number[] = [];
  let h = 8;
  for (let x = 0; x < width; x++) {
    if (x > 1 && x < width - 2) {
      const rough = Math.min(3, 1 + Math.floor(d / 4));
      let delta = int(-rough, rough);
      // Now and then a one-way drop: deeper than the jump, so there's no climbing back.
      if (d >= 3 && r() < 0.04 + 0.01 * d && h + jump + 1 <= height - 2) delta = Math.min(fall, jump + 1);
      h = Math.max(3, Math.min(height - 2, h + Math.max(-jump, Math.min(fall, delta))));
    }
    ground.push(h);
  }
  const map = Array.from({ length: height }, () => Array<string>(width).fill("."));
  for (let x = 0; x < width; x++) for (let y = ground[x]! + 1; y < height; y++) map[y]![x] = "#";
  // Floating ledges: a solid row with a walkable tile above, two or more rows over the ground.
  const ledges = Math.floor(width / 9) + Math.floor(d / 2);
  const above = new Set<number>();
  for (let i = 0; i < ledges; i++) {
    const len = int(2, 4), x0 = int(2, Math.max(2, width - len - 3));
    const solid = Math.min(...ground.slice(x0, x0 + len)) - int(2, 3);
    if (solid < 2) continue;
    for (let x = x0; x < x0 + len; x++) { map[solid]![x] = "#"; above.add(x); }
  }
  map[ground[1]!]![1] = "S";
  map[ground[width - 2]!]![width - 2] = "G";
  const level = (): PlatformLevel => ({ name, map: map.map((row) => row.join("")), jump_height: jump, fall_limit: fall });
  // Thorns on the ground where a ledge above gives a way round. Each is kept only if the trail
  // still has a route with it, so thorns force the ledge path instead of closing the trail.
  if (d >= 4) for (const x of [...above].sort((a, b) => a - b)) {
    if (x <= 2 || x >= width - 3 || r() >= 0.15 + 0.02 * d) continue;
    map[ground[x]!]![x] = "^";
    if (!path(level())) map[ground[x]!]![x] = ".";
  }
  // Fireflies on the ground.
  for (let x = 3; x < width - 2; x += int(2, 4)) if (map[ground[x]!]![x] === ".") map[ground[x]!]![x] = "C";
  return level();
}

/** A valid trail for this seed and difficulty. Tries derived seeds until the shared rules accept one. */
export function generateTrail(options: TrailOptions): PlatformLevel {
  const d = Math.max(1, Math.min(12, Math.floor(options.difficulty)));
  const name = options.name ?? `Mosslight Trail ${options.seed >>> 0}`;
  for (let k = 0; k < 200; k++) {
    const level = attempt((options.seed + k * 0x9e3779b9) >>> 0, d, name);
    const route = path(level);
    if (validateLevel(level).ok && route && find(level.map, "S").length === 1 && find(level.map, "G").length === 1) return level;
  }
  throw new Error(`no valid trail for seed ${options.seed} at difficulty ${d}`);
}
