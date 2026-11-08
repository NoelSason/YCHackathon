// A bounded CPU job, not an agent. Parent termination also bounds an unresponsive exact search.
import { parentPort, workerData } from "node:worker_threads";
import { recipe, type ProductionGame } from "./catalog.js";
import { calibrate } from "./calibrate.js";
const job = workerData as { game: ProductionGame; position: number; series: number; maxMs: number; fingerprints: string[]; attemptOffset?: number };
const deadlineMs = Date.now() + job.maxMs;
const errors: string[] = [];
try {
  for (let attempt = 0; attempt < 8; attempt++) {
    if (Date.now() > deadlineMs) break;
    try {
      const result = calibrate(recipe(job.game, job.position, (job.attemptOffset ?? 0) + attempt, job.series), { deadlineMs });
      if (job.fingerprints.includes(result.fingerprint)) { errors.push("duplicate layout"); continue; }
      parentPort!.postMessage({ ok: true, result });
      process.exit(0);
    } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
  }
  parentPort!.postMessage({ ok: false, errors });
} catch (e) { parentPort!.postMessage({ ok: false, errors: [String(e)] }); }
