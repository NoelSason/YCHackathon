// Run every check in src/checks/, print a table, and write one `checks` row per check so the
// dashboard shows the latest state. Exit 1 if anything is red.
//   npm run check            # table
//   npm run check -- --json  # JSON for the dashboard / CI
//   EXPECT_RUNNING=1 npm run check   # after the 6 PM switch-on: require the loop to be producing
import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import type { Check, CheckContext, CheckResult } from "./types.js";

const env = process.env;
for (const k of ["DATABASE_URL", "PLATFORM_URL", "MCP_BEARER_TOKEN"]) {
  if (!env[k]) { console.error(`${k} is not set (see platform/checks/.env.example)`); process.exit(2); }
}
const json = process.argv.includes("--json");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7)?.split(",");

const db = new pg.Pool({ connectionString: env.DATABASE_URL, max: 3, ssl: env.PGSSL === "0" ? undefined : { rejectUnauthorized: true } });
const ctx: CheckContext = {
  db,
  platformUrl: env.PLATFORM_URL!.replace(/\/+$/, ""),
  bearer: env.MCP_BEARER_TOKEN!,
  expectRunning: env.EXPECT_RUNNING === "1",
  env,
};

const dir = join(dirname(fileURLToPath(import.meta.url)), "checks");
const files = readdirSync(dir).filter((f) => /\.(ts|js)$/.test(f)).sort();
const checks: Check[] = [];
for (const f of files) {
  const mod = (await import(pathToFileURL(join(dir, f)).href)) as { default: Check };
  checks.push(mod.default);
}
const selected = only ? checks.filter((c) => only.includes(c.name)) : checks;

type Row = { name: string; owner: string; path: string; ok: boolean; detail: string; ms: number };
const rows: Row[] = [];
for (const c of selected) {
  const t = Date.now();
  let res: CheckResult;
  try {
    res = await Promise.race([
      c.run(ctx),
      new Promise<CheckResult>((_, rej) => setTimeout(() => rej(new Error("timed out after 60 s")), 60_000)),
    ]);
  } catch (e) {
    res = { ok: false, detail: `threw: ${e instanceof Error ? e.message : String(e)}` };
  }
  rows.push({ name: c.name, owner: c.owner, path: c.path, ...res, ms: Date.now() - t });
}

// Record, so the dashboard's "last check" column is real.
for (const r of rows) {
  await db.query(`insert into checks(name, owner, ok, detail) values ($1,$2,$3,$4)`, [r.name, r.owner, r.ok, r.detail]);
}
await db.end();

const red = rows.filter((r) => !r.ok);
if (json) {
  console.log(JSON.stringify({ ran_at: new Date().toISOString(), expect_running: ctx.expectRunning, ok: red.length === 0, checks: rows }, null, 2));
} else {
  const w = Math.max(...rows.map((r) => r.name.length));
  for (const r of rows) console.log(`${r.ok ? "  OK " : " RED "} ${r.name.padEnd(w)}  ${r.owner.padEnd(7)} ${r.detail}  (${r.ms} ms)`);
  console.log(`\n${rows.length - red.length}/${rows.length} green${ctx.expectRunning ? " (EXPECT_RUNNING)" : ""}${red.length ? `. Red: ${red.map((r) => `${r.name} (${r.owner})`).join(", ")}` : ""}`);
}
process.exit(red.length ? 1 : 0);
