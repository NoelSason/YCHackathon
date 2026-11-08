// A finite, resumable content compilation task. Naïve agents still own design policy/publication.
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import pg from "pg";
import { setTimeout as sleep } from "node:timers/promises";
import { readBuffer, BufferFullError } from "./buffer.js";
import { GAMES, LEVEL_CAP, RECIPE_VERSION, recipe, type ProductionGame } from "./catalog.js";
import type { AcceptedLevel } from "./calibrate.js";
import { generateOne } from "./runner.js";
import { lockOutput, readCheckpoint } from "./checkpoint.js";
import { saveAccepted } from "./store.js";

const args = process.argv.slice(2);
const flags = new Set(["--plan-only", "--database", "--watch"]);
const options = new Set(["--start", "--count", "--series", "--max-seconds", "--games", "--out", "--poll-seconds"]);
for (let i = 0; i < args.length; i++) {
  if (flags.has(args[i]!)) continue;
  if (!options.has(args[i]!) || !args[i+1] || args[i+1]!.startsWith("--")) throw new Error(`unknown or incomplete option: ${args[i]}`);
  i++;
}
const option = (name: string, fallback: string) => { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1] ?? ""; };
const start = Number(option("--start", "1")), count = Number(option("--count", "1000")), series = Number(option("--series", "1"));
const maxMs = Number(option("--max-seconds", "55")) * 1000;
const games = option("--games", GAMES.join(",")).split(",") as ProductionGame[];
const planOnly = args.includes("--plan-only"), database = args.includes("--database"), watch = args.includes("--watch");
const pollMs = Number(option("--poll-seconds", "60")) * 1000;
if (watch && (!database || planOnly)) throw new Error("--watch requires --database and cannot plan only");
if (!Number.isFinite(pollMs) || pollMs < 5000 || pollMs > 3600000) throw new Error("poll seconds must be 5–3600");
const out = resolve(option("--out", `production/${RECIPE_VERSION}-${series}${planOnly ? '-plan' : ''}.jsonl`));
if (!Number.isInteger(start) || !Number.isInteger(count) || start < 1 || count < 1 || start + count - 1 > LEVEL_CAP || !Number.isInteger(series) || series < 0 || !Number.isFinite(maxMs) || maxMs < 1000 || maxMs > 60000 || !games.length || new Set(games).size !== games.length || games.some(g => !GAMES.includes(g))) throw new Error("invalid options: positions 1–1000, unique games racer/watersort/match3, deadline 1–60 seconds");
if (database && planOnly) throw new Error("plans are unverified and cannot be imported");
if (database && !process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for --database");
const pool = database ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3, ssl: process.env.PGSSL === "0" ? undefined : { rejectUnauthorized: true } }) : undefined;
const controller = new AbortController();
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => controller.abort());
await mkdir(dirname(out), { recursive: true });
const unlock = await lockOutput(out);
const completed = new Map<string, AcceptedLevel>();
const planned = new Set<string>();
const failures = new Map<string, number>();
const existing = await readCheckpoint(out);
for (const line of existing.split("\n").filter(Boolean)) {
  const record = JSON.parse(line) as { version: string; series: number; status: string; result?: AcceptedLevel; game_id?: ProductionGame; position?: number };
  if (record.version !== RECIPE_VERSION || record.series !== series) throw new Error("checkpoint belongs to another recipe/series");
  if (record.status === "accepted" && record.result) completed.set(`${record.result.game_id}:${record.result.position}`, record.result);
  if (record.status === "failed") {
    const key = `${record.game_id}:${record.position}`;
    failures.set(key, (failures.get(key) ?? 0) + 1);
  }
  if (record.status === "planned") planned.add(`${record.game_id}:${record.position}`);
}
// Serialize appends so the three game streams cannot interleave a checkpoint line.
let writing = Promise.resolve();
const write = (value: object) => (writing = writing.then(() => appendFile(out, JSON.stringify({ version: RECIPE_VERSION, series, ...value }) + "\n")));
const began = Date.now();
let accepted = 0, failed = 0, resumed = 0, bufferMissing = 0;
try {
  do {
  if (pool) {
    const killed = await pool.query("select 1 from settings where key in ('kill_switch','production_kill_switch') and value='true'::jsonb");
    if (killed.rows.length) { controller.abort(); break; }
  }
  const jobs = await Promise.allSettled(games.map(async game => {
    const q = pool ? async (sql: string, values: unknown[] = []) => (await pool.query(sql, values)).rows : undefined;
    const inventory = q ? await readBuffer(q, game, series) : undefined;
    const due = inventory ? inventory.needed.filter(p => p >= start && p < start+count) : Array.from({length:count}, (_,i) => start+i);
    if (inventory) console.log(JSON.stringify({ event: due.length ? "buffer_top_up" : "buffer_healthy", game, played_through: inventory.played_through, target_through: inventory.target_through, needed: due.length, existing_ready: inventory.ready.length }));
    const fingerprints = [...completed.values()].filter(r => r.game_id === game).map(r => r.fingerprint);
    for (let pass = 0; pass < (planOnly ? 1 : 3) && !controller.signal.aborted; pass++) {
    for (const position of due) {
      if (controller.signal.aborted) break;
      const key = `${game}:${position}`, previous = completed.get(key);
      if (planOnly) {
        if (!planned.has(key)) await write({ status: "planned", ...recipe(game, position, 0, series) });
        continue;
      }
      if (previous) {
        if (pass === 0 && pool) {
          try { await saveAccepted(async (sql, values=[]) => (await pool.query(sql, values)).rows, previous, series); }
          catch (e) { if (e instanceof BufferFullError) continue; throw e; }
        }
        if (pass === 0) resumed++;
        continue;
      }
      if (pool) {
        const killed = await pool.query("select 1 from settings where key in ('kill_switch','production_kill_switch') and value='true'::jsonb");
        if (killed.rows.length) { controller.abort(); break; }
      }
      const result = await generateOne(game, position, series, maxMs, fingerprints, controller.signal, (failures.get(key) ?? 0) * 8);
      if (!result.ok) {
        failed++;
        failures.set(key, (failures.get(key) ?? 0) + 1);
        if (controller.signal.aborted) break;
        await write({ status: "failed", game_id: game, position, errors: result.errors });
        if (pool) await pool.query("insert into activity_log(agent,action,reason,result,ref_kind,ref_id) values ('platform','production.level_rejected',$1,$2,'production',$3)", [`deterministic compiler rejected ${game} position ${position}`, result.errors.join("; "), `${RECIPE_VERSION}:${series}:${game}:${position}`]);
        console.log(JSON.stringify({ event: "failed", game, position, errors: result.errors }));
        continue;
      }
      // Checkpoint first: if DB import fails, restart imports this exact measured result once.
      await write({ status: "accepted", result: result.result });
      if (pool) {
        try { await saveAccepted(async (sql, values=[]) => (await pool.query(sql, values)).rows, result.result, series); }
        catch (e) { if (e instanceof BufferFullError) break; throw e; }
      }
      completed.set(key, result.result);
      accepted++;
      fingerprints.push(result.result.fingerprint);
      console.log(JSON.stringify({ event: "accepted", game, position, target: result.result.target, measured: result.result.measured, ms: result.result.elapsed_ms }));
    }
    }
  }).map(job => job.catch(error => { controller.abort(); throw error; })));
  const error = jobs.find((j): j is PromiseRejectedResult => j.status === "rejected");
  if (error) throw error.reason;
  if (pool) {
    bufferMissing = 0;
    for (const game of games) {
      const state = await readBuffer(async (sql, values=[]) => (await pool.query(sql, values)).rows, game, series);
      bufferMissing += state.needed.filter(p => p >= start && p < start+count).length;
    }
  }
  if (watch && !controller.signal.aborted) {
    try { await sleep(pollMs, undefined, { signal: controller.signal }); }
    catch (e) { if (!controller.signal.aborted) throw e; }
  }
  } while (watch && !controller.signal.aborted);
} finally {
  controller.abort();
  await writing;
  await pool?.end();
  await unlock();
}
const missing = planOnly ? 0 : database ? bufferMissing : games.reduce((n,g) => n + Array.from({length:count}, (_,i) => !completed.has(`${g}:${start+i}`)).filter(Boolean).length, 0);
console.log(JSON.stringify({ event: "complete", out, planned: planOnly ? count * games.length : 0, accepted, failed_attempts: failed, missing, resumed, stopped: missing > 0 && controller.signal.aborted, elapsed_ms: Date.now() - began }));
if (missing) process.exitCode = 2;
