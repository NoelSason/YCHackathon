/** Shared between the pack delivery worker (deliver-pack.ts) and the level maker (pack-maker.ts). */
export const PACK_GAME_IDS = ["match3", "watersort", "racer", "lotescape"] as const;
export type PackGameId = (typeof PACK_GAME_IDS)[number];
export type PackDifficulty = "easy" | "medium" | "hard";

export interface MakeRequest {
  gameId: PackGameId;
  difficulty: PackDifficulty;
  /** One target win rate per level slot (0 to 1), in play order: the pack's difficulty curve. */
  targets: number[];
  /** Seeds the design choices, so a pack can be remade exactly. */
  seed: number;
  maxSeconds: number;
  /** Candidates across the whole pack (a slot whose candidate misses gets a new one). */
  maxCandidates: number;
  /** Worker threads for slow games (match-3). */
  threads?: number;
}

export interface MadeLevel {
  /** 1-based slot in the pack. */
  slot: number;
  target: number;
  level: Record<string, unknown>;
  bot: string;
  runs: number;
  wins: number;
  /** Null for exact puzzles measured by their fewest moves instead (parking). */
  measured_win_rate: number | null;
  ci95: [number, number];
  min_moves: number | null;
  solvable: boolean | null;
  /** The accepting measurement's id: its seeds are firstSeedFor(run_id), so anyone can replay it. */
  run_id: string;
  results: Record<string, unknown>;
  /** Measurements this level took (quick rounds plus the accepting one). */
  rounds: number;
  /** Candidates tried for this slot, this one included. */
  candidates: number;
}

export type MakeProgress =
  | { kind: "accepted"; level: MadeLevel; of: number }
  | { kind: "retry"; slot: number; target: number; reason: string };

export interface MakeResult {
  gameId: PackGameId;
  /** Accepted levels in slot order. Fewer than targets.length when a cap stopped it. */
  levels: MadeLevel[];
  candidates: number;
  elapsedMs: number;
  stoppedBy: "done" | "time" | "attempts";
  measuredBy: "win_rate" | "min_moves";
}

export type PackMaker = (req: MakeRequest, onProgress?: (p: MakeProgress) => void | Promise<void>) => Promise<MakeResult>;
