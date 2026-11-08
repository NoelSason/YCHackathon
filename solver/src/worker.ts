// The harness worker. Polls solver_runs, plays each queued level, writes the results.
//   npm run worker   keep running (overnight)
//   npm run drain    process everything queued, then exit
import os from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";
import { getAdapter } from "../../platform/mcp/src/adapters.js";
import { failStale, processNext, type Query } from "./queue.js";

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
const once = process.argv.includes("--once");

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(JSON.stringify({ worker: workerId, event: "stopping", signal: sig }));
    stopping = true;
  });
}

const log = (o: Record<string, unknown>) => console.log(JSON.stringify({ ts: new Date().toISOString(), worker: workerId, ...o }));

log({ event: "started", once, poll_ms: pollMs, stale_minutes: staleMinutes });
let lastStaleCheck = 0;
let errorsInARow = 0;

while (!stopping) {
  try {
    if (Date.now() - lastStaleCheck > 60_000) {
      const stale = await failStale(q, staleMinutes);
      if (stale.length) log({ event: "stale_runs_failed", run_ids: stale });
      lastStaleCheck = Date.now();
    }
    const out = await processNext(q, workerId, getAdapter);
    errorsInARow = 0;
    if (out.kind === "idle") {
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

await pool.end();
log({ event: "stopped" });
