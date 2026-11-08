// Deterministic content recipes, not another agent loop. Naïve remains the Designer/CEO.
// Every recipe uses the registered game's level format and the game's own generator/rules.
import { createHash } from "node:crypto";
import { generateLevel } from "../../../games/watersort/src/levels.js";
import { generateTrack } from "../../../games/racer/src/levels.js";
import type { MatchLevel } from "../../../games/match3/adapter/levels.js";
import { generateLevel as generateLot } from "../../../games/lotescape/src/generate.js";

export const GAMES = ["watersort", "racer", "match3", "lotescape"] as const;
export type ProductionGame = typeof GAMES[number];
export const RECIPE_VERSION = "production-v1";
export const LEVEL_CAP = 1000;

/** Shown in titles, e.g. "Lot 0042". The game pages read the number back as the level number. */
export const TITLE_PREFIX: Record<ProductionGame, string> = { watersort: "Tide", racer: "Circuit", match3: "Garden", lotescape: "Lot" };

export interface Recipe {
  game_id: ProductionGame;
  position: number;
  chapter: number;
  slot: "learn" | "build" | "challenge" | "recovery";
  target: number;
  features: string[];
  seed: number;
  level: object;
}

export function progression(position: number) {
  if (!Number.isInteger(position) || position < 1 || position > LEVEL_CAP) throw new Error("position must be 1–1000");
  const depth = Math.min(1, (position - 1) / 499);
  const slot = position <= 5 ? "learn" : position % 10 === 0 ? "challenge" : position % 10 === 1 ? "recovery" : "build";
  const target = slot === "learn" ? 0.85 : slot === "challenge" ? 0.45 - depth * 0.1 : slot === "recovery" ? 0.85 - depth * 0.1 : 0.75 - depth * 0.15;
  return { chapter: Math.ceil(position / 25), slot, target: Math.round(target * 100) / 100, depth } as const;
}

export function recipe(game: ProductionGame, position: number, attempt = 0, series = 1): Recipe {
  const p = progression(position);
  if (!Number.isInteger(attempt) || attempt < 0 || !Number.isInteger(series) || series < 0) throw new Error("attempt and series must be nonnegative integers");
  const digest = createHash("sha256").update(`${RECIPE_VERSION}:${series}:${game}:${position}:${attempt}`).digest();
  const seed = digest.readUInt32LE(0);
  const title = `${TITLE_PREFIX[game]} ${String(position).padStart(4, "0")}`;
  let level: object;
  let features: string[];
  if (game === "watersort") {
    // Keep exact search bounded: combinations progress, not an unbounded board-size arms race.
    const colors = position < 10 ? 3 : position < 30 ? 4 : position < 100 ? 5 : 5 + (seed % 2);
    const capacity = position < 20 ? 3 : 4;
    const spare = position >= 150 && p.slot === "challenge" && seed % 3 === 0 && attempt % 4 === 0 ? 1 : 2;
    level = generateLevel({ title, colors, capacity, spare, move_limit: 100, seed });
    features = [`${colors}-colors`, `${capacity}-layer-tubes`, `${spare}-spare-tubes`, "hint", "undo"];
    if (spare === 1) features.push("single-buffer-challenge");
  } else if (game === "racer") {
    const lanes = position < 25 ? 3 : position < 100 ? 4 : 5;
    const length = 40 + Math.round(p.depth * 50) + seed % 11;
    const track = generateTrack({ title, lanes, length, seed, speed: 6 + Math.round(p.depth * 6), gap: Math.max(4, 8 - Math.floor(p.depth * 4)), blocked: position < 15 ? 1 : Math.min(lanes - 1, 2 + seed % 2), boosts: position < 8 ? 0 : 2 + seed % 3, coins: 4 + seed % 8, time_limit: 1000, crash_penalty: position < 50 ? 2 : 3, lane_change_cooldown: position >= 200 && p.slot === "challenge" ? 1 : 0 });
    track.objects = track.objects.filter(o => o.kind !== "oil" || position >= 35).filter(o => o.kind !== "shield" || position >= 20);
    level = track;
    features = ["traffic", "cones", "coins", `${lanes}-lanes`];
    if (position >= 8) features.push("boost");
    if (position >= 20) features.push("shield");
    if (position >= 35) features.push("oil");
    if (track.lane_change_cooldown) features.push("steering-cooldown");
  } else if (game === "lotescape") {
    // Lot Escape's own generator and difficulty ladder (notch 1 easiest, 12 the top). The ladder
    // sets how tangled the lot is; the move_limit is tuned afterwards to the slot's win-rate target.
    const build = 1 + Math.round(p.depth * 8);
    const notch = p.slot === "learn" ? 1 : p.slot === "challenge" ? Math.min(12, build + 3) : p.slot === "recovery" ? Math.max(1, build - 2) : build;
    const made = generateLot({ seed, difficulty: notch, title });
    level = made.level;
    features = [`notch-${notch}`, `${made.rating.vehicles}-cars`, ...(made.rating.trucks ? ["trucks"] : []), ...(made.rating.blocking_depth >= 2 ? ["blocker-chains"] : [])];
  } else {
    const width = position < 100 ? 5 : 6;
    const height = 5;
    const count = position < 25 ? 4 : position < 250 ? 5 : 6;
    const colors = ["red", "blue", "green", "gold", "purple", "teal"] as const;
    const mask = Array<boolean>(width * height).fill(true);
    // Corners only: avoid disconnected/tiny islands while introducing a different board silhouette.
    if (position >= 50) { mask[0] = false; mask[width * height - 1] = false; }
    const seals = position < 20 ? [] : Array.from({ length: position < 100 ? 1 : 2 + seed % 2 }, (_, i) => ({ cell: width + 1 + i * (width - 1), layers: position >= 500 && p.slot === "challenge" ? 2 : 1 }));
    const match: MatchLevel = { name: title, width, height, colour_count: count, seed, goal: { colour: colors[seed % count]!, target: 1000 }, move_limit: 10 + Math.round(p.depth * 6), ...(position >= 50 ? { mask } : {}), ...(seals.length ? { seals } : {}) };
    level = match;
    features = ["color-collection", "match-created-specials", `${count}-colors`];
    if (seals.length) features.push(seals[0]!.layers > 1 ? "layered-seals" : "seals");
    if (position >= 50) features.push("shaped-board");
  }
  return { game_id: game, position, chapter: p.chapter, slot: p.slot, target: p.target, features, seed, level };
}

/** Ignore display names and the tuned allowance: a new title/budget isn't a new layout. */
export function fingerprint(game: ProductionGame, level: object): string {
  const l = structuredClone(level) as Record<string, unknown>;
  delete l.title; delete l.name;
  if (game === "racer") delete l.time_limit;
  if (game === "lotescape") delete l.move_limit;
  if (game === "watersort") {
    delete l.move_limit;
    const tubes = l.tubes as string[][];
    const colors = [...new Set(tubes.flat())];
    let best: string | undefined;
    const visit = (order: string[]) => {
      if (order.length < colors.length) {
        for (const c of colors) if (!order.includes(c)) visit([...order, c]);
        return;
      }
      const ids = new Map(order.map((c, i) => [c, String.fromCharCode(97 + i)]));
      const key = tubes.map(t => t.map(c => ids.get(c)!).join("")).sort().join("|");
      if (best === undefined || key < best) best = key;
    };
    visit([]); // At most six colors in these production recipes (720 assignments).
    l.tubes = best;
  }
  return createHash("sha256").update(JSON.stringify(l)).digest("hex");
}
