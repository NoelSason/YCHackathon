// Built-in sample tracks (playable with ?sample=N before the platform serves levels by id),
// plus a seeded generator for making more. Every sample is checked by the tests.
import { mulberry32 } from "./bots.js";
import { cellKey, type Kind, type Level, type TrackObject } from "./engine.js";

/**
 * Lay out a track: every `gap` rows, block `blocked` lanes with cars, cones, or oil (always leaving
 * at least one lane open), and sprinkle boosts, coins, and shields. Nothing is placed under a car's
 * second row, so every object stays visible and reachable.
 */
export function generateTrack(opts: {
  lanes: number;
  length: number;
  speed: number;
  gap: number;
  blocked: number;
  boosts: number;
  coins: number;
  time_limit: number;
  seed: number;
  title?: string;
  crash_penalty?: number;
  lane_change_cooldown?: number;
}): Level {
  const rnd = mulberry32(opts.seed);
  const objects: TrackObject[] = [];
  const used = new Set<number>();
  const put = (row: number, lane: number, kind: Kind) => {
    const k = cellKey(row, lane);
    if (row < 1 || row >= opts.length || used.has(k)) return;
    if (kind === "car" && used.has(cellKey(row + 1, lane))) return;
    used.add(k);
    if (kind === "car") used.add(cellKey(row + 1, lane)); // a car covers two rows
    objects.push({ row, lane, kind });
  };
  for (let row = 6; row < opts.length - 2; row += opts.gap) {
    const lanes = [...Array(opts.lanes).keys()];
    for (let i = lanes.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [lanes[i], lanes[j]] = [lanes[j]!, lanes[i]!];
    }
    const n = Math.min(opts.blocked, opts.lanes - 1);
    for (let i = 0; i < n; i++) put(row, lanes[i]!, rnd() < 0.6 ? "car" : rnd() < 0.5 ? "cone" : "oil");
  }
  for (let i = 0; i < opts.boosts; i++) put(4 + Math.floor(rnd() * (opts.length - 6)), Math.floor(rnd() * opts.lanes), "boost");
  for (let i = 0; i < opts.coins; i++) put(3 + Math.floor(rnd() * (opts.length - 4)), Math.floor(rnd() * opts.lanes), "coin");
  for (let i = 0; i < 2; i++) put(5 + Math.floor(rnd() * (opts.length - 8)), Math.floor(rnd() * opts.lanes), "shield");
  objects.sort((a, b) => a.row - b.row || a.lane - b.lane);
  return {
    title: opts.title,
    lanes: opts.lanes,
    length: opts.length,
    speed: opts.speed,
    time_limit: opts.time_limit,
    crash_penalty: opts.crash_penalty ?? 3,
    lane_change_cooldown: opts.lane_change_cooldown ?? 0,
    objects,
  };
}

export const SAMPLES: Level[] = [
  generateTrack({ title: "Warm-Up Loop", lanes: 3, length: 60, speed: 6, gap: 7, blocked: 1, boosts: 2, coins: 6, time_limit: 62, seed: 3 }),
  generateTrack({ title: "Rush Hour", lanes: 3, length: 90, speed: 8, gap: 5, blocked: 2, boosts: 3, coins: 8, time_limit: 96, seed: 11 }),
  generateTrack({ title: "Neon Highway", lanes: 4, length: 120, speed: 10, gap: 4, blocked: 2, boosts: 4, coins: 10, time_limit: 132, seed: 5 }),
  generateTrack({ title: "Night Sprint", lanes: 5, length: 150, speed: 12, gap: 4, blocked: 3, boosts: 5, coins: 12, time_limit: 176, seed: 9, lane_change_cooldown: 1 }),
];
