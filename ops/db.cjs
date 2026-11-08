// Database helper for ops/monitor.sh. Reads DATABASE_URL from the environment.
//
//   node ops/db.cjs fresh                              → one line of key=value freshness facts
//   node ops/db.cjs log <action> <reason> <result>     → one activity_log row as agent "watchdog"
//
// Uses the solver's installed `pg` so ops/ needs no npm install of its own.
const path = require("node:path");
const { Client } = require(path.join(__dirname, "..", "solver", "node_modules", "pg"));

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000, query_timeout: 15000 });
  await db.connect();
  try {
    if (cmd === "fresh") {
      // Agent rows exclude the level compiler's bulk `production.*` rows and the watchdog's own rows,
      // so a flood of compiler output can't hide dead business loops.
      const r = await db.query(`
        select
          extract(epoch from now() - (select max(ts) from activity_log))::int as any_age_s,
          extract(epoch from now() - (select max(ts) from activity_log
             where agent <> 'watchdog' and not (agent = 'platform' and action like 'production.%')))::int as agent_age_s,
          extract(epoch from now() - (select max(ts) from activity_log where agent = 'playtest-lead'))::int as playtest_age_s,
          extract(epoch from now() - (select max(ts) from activity_log where agent = 'research'))::int as research_age_s,
          (select extract(epoch from now() - max((value->>'at')::timestamptz))::int from settings
             where key like 'solver_worker:%' and coalesce((value->>'stopped')::boolean, false) = false) as solver_age_s,
          (select value::text from settings where key = 'kill_switch') as kill_switch`);
      const row = r.rows[0];
      console.log(Object.entries(row).map(([k, v]) => `${k}=${v ?? "none"}`).join(" "));
    } else if (cmd === "log") {
      const [action, reason, result] = args;
      if (!action) throw new Error("usage: db.cjs log <action> <reason> <result>");
      await db.query("insert into activity_log (agent, action, reason, result) values ('watchdog', $1, $2, $3)", [action, reason ?? null, result ?? null]);
      console.log("logged");
    } else {
      throw new Error("usage: db.cjs fresh | log <action> <reason> <result>");
    }
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error(`db.cjs: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
