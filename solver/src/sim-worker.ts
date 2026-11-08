// Worker thread: plays a slice of seeds for one bot and reports the tally.
// It loads the same adapter registry as the main thread, so the rules are identical.
import { parentPort, workerData } from "node:worker_threads";
import { getAdapter } from "../../platform/mcp/src/adapters.js";

interface Job {
  gameId: string;
  level: object;
  bot: string;
  start: number;    // first seed of this slice
  count: number;
  minGames: number; // play at least this many even past the deadline
  deadline: number; // epoch ms
}

const job = workerData as Job;
try {
  const a = getAdapter(job.gameId);
  if (!a) throw new Error(`no adapter for game ${job.gameId} in this worker`);
  let wins = 0;
  let moves = 0;
  let done = 0;
  for (let i = 0; i < job.count; i++) {
    if (done >= job.minGames && Date.now() > job.deadline) break;
    const seed = (job.start + i) >>> 0;
    const out = a.simulate(job.level, job.bot, seed);
    if (typeof out?.won !== "boolean" || typeof out.moves_used !== "number" || !Number.isFinite(out.moves_used)) {
      throw new Error(`simulate(bot=${job.bot}, seed=${seed}) returned a malformed result`);
    }
    if (out.won) wins++;
    moves += out.moves_used;
    done++;
  }
  parentPort!.postMessage({ wins, moves, done });
} catch (e) {
  parentPort!.postMessage({ error: e instanceof Error ? e.message : String(e) });
}
