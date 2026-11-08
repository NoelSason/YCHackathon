// The harness worker. Polls solver_runs, plays each queued level, writes the results.
//   npm run worker   keep running (overnight)
//   npm run drain    process everything queued, then exit
import os from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";
import { getAdapter, listAdapters } from "../../platform/mcp/src/adapters.js";
import { failStale, processNext, unplayableQueued, writeHeartbeat, type Query } from "./queue.js";
import { tuneNextDesign } from "./autotune.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (see solver/.env.example)");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: url,
  max: 2,
  // Neon needs TLS; local Postgres usually doesn't. PGSSL=0 opts out (same as platform/mcp).
  ssl: process.env.PGSSL === "0" ? undefined : { rejectUnauthorized: true },
});
const q: Query = async (text, params = []) => (await pool.query(text, params)).rows;

const workerId = process.env.WORKER_ID ?? `${os.hostname()}:${process.pid}`;
const pollMs = Number(process.env.POLL_MS ?? 1000);
const staleMinutes = Number(process.env.STALE_MINUTES ?? 15);
// Slow games are played across threads, and each run stops at a time budget (see run.ts).
const threads = Number(process.env.SOLVER_THREADS ?? Math.max(1, os.availableParallelism() - 2));
const maxSeconds = Number(process.env.SOLVER_MAX_SECONDS ?? 240);
const once = process.argv.includes("--once");
// The automatic Tuner (src/autotune.ts) tunes the Designer's new levels when the queue is idle.
// AUTOTUNE=0 turns it off on this worker.
const autotune = process.env.AUTOTUNE !== "0";
// The games this worker can play: the adapter registry as it was when the worker started. A game
// added later needs a pull and a restart; until then its runs stay queued (see claimNext) and the
// heartbeat and log below say which game is waiting.
const games = listAdapters().map((a) => a.game_id).sort();
const startedAt = new Date().toISOString();
const HEARTBEAT_MS = 30_000;

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(JSON.stringify({ worker: workerId, event: "stopping", signal: sig }));
    stopping = true;
  });
}

const log = (o: Record<string, unknown>) => console.log(JSON.stringify({ ts: new Date().toISOString(), worker: workerId, ...o }));

log({ event: "started", once, games, poll_ms: pollMs, stale_minutes: staleMinutes, threads, max_seconds: maxSeconds, autotune });
let lastStaleCheck = 0;
let lastHeartbeat = 0;
let lastUnplayable = "";
let errorsInARow = 0;

while (!stopping) {
  try {
    if (Date.now() - lastStaleCheck > 60_000) {
      const stale = await failStale(q, staleMinutes);
      if (stale.length) log({ event: "stale_runs_failed", run_ids: stale });
      lastStaleCheck = Date.now();
      const waiting = await unplayableQueued(q, games);
      const key = JSON.stringify(waiting);
      if (Object.keys(waiting).length && key !== lastUnplayable) {
        log({ event: "queued_for_unknown_games", waiting, games, hint: "git pull, then restart the worker" });
      }
      lastUnplayable = key;
    }
    if (!once && Date.now() - lastHeartbeat > HEARTBEAT_MS) {
      await writeHeartbeat(q, { worker: workerId, games, started_at: startedAt, at: new Date().toISOString() });
      lastHeartbeat = Date.now();
    }
    const out = await processNext(q, workerId, getAdapter, { threads, maxSeconds, games });
    errorsInARow = 0;
    if (out.kind === "idle") {
      const tuned = autotune ? await tuneNextDesign(q, workerId, getAdapter, { games, threads, maxSeconds: Math.min(maxSeconds, 120) }) : { kind: "idle" as const };
      if (tuned.kind !== "idle") {
        log({ event: `autotune_${tuned.kind}`, ...tuned });
        continue;
      }
      if (once) break;
      await sleep(pollMs);
    } else {
      log({ event: out.kind, ...out });
    }
  } catch (e) {
    // Database blips must not end the overnight run. Back off and keep going.
    errorsInARow++;
    log({ event: "error", message: e instanceof Error ? e.message : String(e), errors_in_a_row: errorsInARow });
    if (once && errorsInARow >= 3) break;
    await sleep(Math.min(30_000, 1000 * 2 ** Math.min(errorsInARow, 5)));
  }
}

if (!once) {
  await writeHeartbeat(q, { worker: workerId, games, started_at: startedAt, at: new Date().toISOString(), stopped: true })
    .catch(() => undefined); // best effort: a stale heartbeat reads as stopped anyway
}
await pool.end();
log({ event: "stopped" });
