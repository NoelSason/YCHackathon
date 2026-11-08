import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_ACTIVITY, DEFAULT_STEPINS, LiveFeed, parseTables } from "./feeds.ts";

/**
 * Save the real activity log to a file, so `./demo.sh --replay <file>` can play it back if the
 * network or the database fails on stage. Run it after the overnight run and again before judging.
 */
const demoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = resolve(demoDir, "..");
for (const file of [join(repoDir, ".env"), join(demoDir, ".env"), join(repoDir, "business", ".env")]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const env = process.env;
const feed = new LiveFeed(env.DATABASE_URL, [
  ...parseTables(env.DEMO_ACTIVITY_TABLES ?? DEFAULT_ACTIVITY, false),
  ...parseTables(env.DEMO_STEPIN_TABLES ?? DEFAULT_STEPINS, true),
]);

const events = await feed.tick();
for (const h of feed.health()) console.log(`${h.ok ? "✓" : "✗"} ${h.name}: ${h.detail}`);
if (events.length === 0) {
  console.error("No events to save.");
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const out = join(demoDir, "data", `run-${stamp}.jsonl`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
console.log(`Saved ${events.length} events to ${out}`);
console.log(`Play it back with: ./demo.sh --replay ${out.replace(repoDir + "/", "")}`);
