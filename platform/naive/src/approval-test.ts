// The approval-rule test from docs/agent-plan.md step 1. Answers: does an allow-listed MCP tool run
// without a human click? Run it with the MCP server deployed and the vault bearer set.
// Prints the session's stop_reason: "end_turn" = no approval needed; "awaiting_approval" = a step-in.
import { naive, PLATFORM_MCP_URL } from "./client.js";
import { MODEL, PLATFORM_MCP_NAME } from "./roster.js";
import { withRetry } from "./retry.js";

if (!PLATFORM_MCP_URL) { console.error("PLATFORM_MCP_URL is not set"); process.exit(1); }

const name = "approval-probe";
const page = await naive.agents.list({ limit: 100 });
let probe = (page.data as Array<{ id: string; name: string }>).find((a) => a.name === name);
const body = {
  name,
  model: MODEL,
  system: "You are a test agent. Do exactly what the message says, using the platform tools, then stop.",
  tools: {
    default_config: { permission: "allow" as const },
    configs: {
      [`${PLATFORM_MCP_NAME}.log_action`]: { enabled: true, permission: "allow" as const },
      [`${PLATFORM_MCP_NAME}.list_games`]: { enabled: true, permission: "allow" as const },
    },
  },
  mcp_servers: [{ name: PLATFORM_MCP_NAME, url: PLATFORM_MCP_URL }],
  budget: { cap_micro_usd: 1_000_000, max_task_micro_usd: 200_000, period: "day" as const },
};
probe = probe ? ((await naive.agents.update(probe.id, body)) as { id: string; name: string }) : ((await naive.agents.create(body)) as { id: string; name: string });

const session = await naive.sessions.create({
  agent_id: probe.id,
  // Two dependent turns on purpose: the second call needs the first call's result, so the model
  // cannot batch them. This is what the CEO does on every run.
  message: "Step 1: call platform.list_games and wait for the result. Step 2: call platform.log_action with agent 'probe', action 'approval_test', reason set to the exact number of games returned in step 1 followed by ' games listed'. Then reply 'done'.",
  budget_micro_usd: 200_000,
});
console.log("session", session.id);

const deadline = Date.now() + 5 * 60_000;
let s = session;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 5000));
  s = await withRetry(() => naive.sessions.get(session.id), "session");
  process.stdout.write(`  status=${s.status} stop_reason=${s.stop_reason ?? "-"}\n`);
  if (s.status !== "running" && s.stop_reason) break;
}

// The session ending cleanly is not proof: an agent whose MCP server has no credential also ends
// with end_turn and does nothing. The row in activity_log is the proof.
let landed: boolean | null = null;
if (process.env.DATABASE_URL) {
  const pg = (await import("pg")).default;
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
  const r = await pool.query(`select count(*)::int as n from activity_log where action = 'approval_test' and ts > now() - interval '15 minutes'`);
  landed = (r.rows[0] as { n: number }).n > 0;
  await pool.end();
}

const verdict =
  s.stop_reason === "awaiting_approval" ? "ASKS: an allow-listed MCP tool still paused for approval. Every overnight call is a step-in. Check tools.configs keys and the vault binding."
  : landed === true ? "OK: the probe called platform.log_action unattended and the row is in activity_log. Allow-listed MCP tools run without a human."
  : landed === false ? "NOT REACHED: the session ended without any approval card, but no 'approval_test' row landed in the last 15 minutes. The agent could not call the platform. Check the vault credential for PLATFORM_MCP_URL and the session's events in the Studio (look for session.error)."
  : s.stop_reason === "end_turn" || s.status === "completed" ? "UNVERIFIED: session ended cleanly, but DATABASE_URL is not set so the activity_log row was not checked. Set it in .env and rerun."
  : `UNCLEAR: status=${s.status} stop_reason=${s.stop_reason} stop_code=${(s as { stop_code?: string }).stop_code ?? "-"}. Read the session events in the Studio.`;
console.log("\n" + verdict);

// Diagnostics: what the session actually did. Tool events and anything that looks like an error.
const ev = await naive.sessions.events(session.id, { limit: 100 });
const interesting = ev.data.filter((e) =>
  e.type.startsWith("tool.") || e.type === "message.completed" || e.type === "session.retrying" || e.type === "session.degraded" || e.type === "budget.exceeded" || JSON.stringify(e.data).toLowerCase().includes("error"),
);
console.log(`\nSession events (${ev.data.length} total, ${interesting.length} shown):`);
for (const e of interesting) {
  const d = JSON.stringify(e.data);
  console.log(`  ${e.seq}\t${e.type}\t${d.length > 300 ? d.slice(0, 300) + "…" : d}`);
}
if (!interesting.some((e) => e.type === "tool.started")) {
  console.log("  (no tool.started event: the model never attempted a tool call, so either the platform tools were not offered to it or the MCP connection failed before the turn; look for an mcp/connection error above)");
}
console.log("\nNext: send the probe ONE inbound email, run again, and see whether the second call asks (the 'read people's data' rule). Write both results in log.md.");
