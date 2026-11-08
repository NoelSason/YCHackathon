// Start one CEO run right now (same input as its cron deployment) and follow it until it stops.
// Use it right after the switch-on so the first run isn't an hour away, and whenever you want to
// watch a run. It is an agent run, not a step-in: the agent decides everything.
import { readFileSync } from "node:fs";
import { naive } from "./client.js";
import { CEO } from "./roster.js";

const team = JSON.parse(readFileSync(new URL("../team.json", import.meta.url), "utf8")) as { agents: Record<string, string> };
const agentId = team.agents.ceo;
if (!agentId) { console.error("no ceo in team.json; run npm run setup"); process.exit(1); }

const s0 = await naive.sessions.create({
  agent_id: agentId,
  message: CEO.cron?.input ?? "CEO run.",
  budget_micro_usd: Math.round((CEO.cron?.budget_usd ?? 0.5) * 1_000_000),
});
console.log(`CEO session ${s0.id} (watch it in the Studio)`);

let seen = 0;
const deadline = Date.now() + 15 * 60_000;
let s = s0;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 5000));
  const ev = await naive.sessions.events(s.id, { after_seq: seen, limit: 100 });
  for (const e of ev.data) {
    seen = Math.max(seen, e.seq);
    if (e.type === "tool.started" || e.type === "tool.completed" || e.type === "tool.confirm" || e.type === "message.completed" || e.type === "budget.exceeded") {
      const d = JSON.stringify(e.data);
      console.log(`  ${e.type}\t${d.length > 240 ? d.slice(0, 240) + "…" : d}`);
    }
  }
  s = await naive.sessions.get(s.id);
  if (s.status !== "running" && s.stop_reason) break;
}
console.log(`\nstatus=${s.status} stop_reason=${s.stop_reason ?? "-"}`);
if (s.stop_reason === "awaiting_approval") console.log("The CEO is waiting for a human. That is a step-in; find which tool and allow it by name in roster.ts.");
