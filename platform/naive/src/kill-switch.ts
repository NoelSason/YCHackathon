// Kill switch and switch-on. One command pauses every cron deployment and flips the platform's
// kill_switch setting (publish_pack refuses while it's on). `on` reverses it.
//   npm run kill -- off   # stop everything
//   npm run kill -- on    # resume everything (the 6:00 PM switch-on)
// Each use is a human step-in: it writes an interventions row with the reason you pass.
import { readFileSync } from "node:fs";
import pg from "pg";
import { naive } from "./client.js";

const mode = process.argv[2];
const why = process.argv.slice(3).join(" ") || (mode === "off" ? "kill switch" : "switch-on");
if (mode !== "on" && mode !== "off") { console.error("usage: npm run kill -- on|off [reason]"); process.exit(1); }

const team = JSON.parse(readFileSync(new URL("../team.json", import.meta.url), "utf8")) as { deployments: Record<string, string> };
for (const [name, id] of Object.entries(team.deployments)) {
  await naive.deployments.update(id, { enabled: mode === "on" });
  console.log(`${mode === "on" ? "enabled " : "paused  "} ${name} ${id}`);
}

const url = process.env.DATABASE_URL;
if (url) {
  const pool = new pg.Pool({ connectionString: url, ssl: process.env.PGSSL === "0" ? undefined : { rejectUnauthorized: true } });
  await pool.query(`insert into settings(key,value) values ('kill_switch',$1) on conflict (key) do update set value=excluded.value`, [JSON.stringify(mode === "off")]);
  await pool.query(`insert into interventions(who, what, why, kind) values ($1,$2,$3,$4)`,
    [process.env.USER ?? "unknown", mode === "off" ? "kill switch on: all deployments paused, publishing blocked" : "switch-on: deployments enabled, publishing allowed", why, "kill"]);
  await pool.end();
  console.log(`kill_switch=${mode === "off"}; intervention logged`);
} else {
  console.log("DATABASE_URL not set: deployments changed, platform kill_switch NOT changed");
}
