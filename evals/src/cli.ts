// Evals command line.
//   npm run report [-- --json] [--since=2026-11-08T02:00:00-08:00]   pipeline evals from the database
//   npm run decision -- <decision_id> [--json]                       the CEO's "did it work?" check
//   npm run tunability [-- --json] [--runs=200] [--max-seconds=10]   offline eval set, no database
import pg from "pg";
import { checkDecision, type Query } from "./decision-check.js";
import { evalReport, formatReport } from "./report.js";
import { formatTunability, runTunability } from "./tunability.js";

const [cmd, ...rest] = process.argv.slice(2);
const json = rest.includes("--json");
const arg = (name: string) => rest.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

async function withDb<T>(fn: (q: Query) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set (copy evals/.env.example to evals/.env)");
    process.exit(2);
  }
  const pool = new pg.Pool({ connectionString: url, max: 2, ssl: process.env.PGSSL === "0" ? undefined : { rejectUnauthorized: true } });
  try {
    return await fn(async (text, params = []) => (await pool.query(text, params)).rows);
  } finally {
    await pool.end();
  }
}

if (cmd === "report") {
  const since = arg("since");
  const r = await withDb((q) => evalReport(q, { since: since ? new Date(since) : undefined }));
  console.log(json ? JSON.stringify(r, null, 2) : formatReport(r));
} else if (cmd === "decision") {
  const id = rest.find((a) => !a.startsWith("--"));
  if (!id) {
    console.error("usage: npm run decision -- <decision_id>");
    process.exit(2);
  }
  const r = await withDb((q) => checkDecision(q, id));
  if (!r) {
    console.error(`no decision ${id}`);
    process.exit(1);
  }
  console.log(json ? JSON.stringify(r, null, 2) : `${r.verdict}: ${r.summary}`);
} else if (cmd === "tunability") {
  const runs = Number(arg("runs") ?? 200);
  const { availableParallelism } = await import("node:os");
  const r = await runTunability({ runs, maxSeconds: Number(arg("max-seconds") ?? 10), threads: Math.max(1, availableParallelism() - 2) });
  console.log(json ? JSON.stringify(r, null, 2) : formatTunability(r));
} else {
  console.error("usage: npm run report | npm run decision -- <id> | npm run tunability");
  process.exit(2);
}
