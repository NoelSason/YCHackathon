// Work the browser hands to the Web Worker (ui/worker.ts) so building or checking a lot never
// freezes the page. The same function runs on the main thread if workers are unavailable.
import type { Level } from "../src/engine.js";
import { generateLevel } from "../src/generate.js";
import { solveLevel } from "../src/solver.js";

export type JobRequest =
  | { kind: "generate"; seed: string; difficulty: number; timeLimitMs?: number }
  | { kind: "solve"; level: Level };
export type Job = JobRequest & { id: number };
export type JobResult =
  | { id: number; kind: "generate"; level: Level; best: number; stopped: string }
  | { id: number; kind: "solve"; best?: number }
  | { id: number; kind: "error"; message: string };

export function runJob(job: Job): JobResult {
  try {
    if (job.kind === "generate") {
      const made = generateLevel({ seed: job.seed, difficulty: job.difficulty, timeLimitMs: job.timeLimitMs });
      return { id: job.id, kind: "generate", level: made.level, best: made.rating.min_moves, stopped: made.stopped };
    }
    const solved = solveLevel(job.level);
    return { id: job.id, kind: "solve", best: solved.solvable ? solved.min_moves : undefined };
  } catch (error) {
    return { id: job.id, kind: "error", message: error instanceof Error ? error.message : String(error) };
  }
}
