// The approval-rule test from docs/agent-plan.md step 1. Answers: does an allow-listed MCP tool run
// without a human click? Run it with the MCP server deployed and the vault bearer set.
// Prints the session's stop_reason: "end_turn" = no approval needed; "awaiting_approval" = a step-in.
import { naive, PLATFORM_MCP_URL } from "./client.js";
import { MODEL, PLATFORM_MCP_NAME } from "./roster.js";

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
  message: "Call platform.list_games, then call platform.log_action with agent 'probe', action 'approval_test', reason 'checking whether allow-listed MCP tools run unattended'. Then reply 'done'.",
  budget_micro_usd: 200_000,
});
console.log("session", session.id);

const deadline = Date.now() + 5 * 60_000;
let s = session;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 5000));
  s = await naive.sessions.get(session.id);
  process.stdout.write(`  status=${s.status} stop_reason=${s.stop_reason ?? "-"}\n`);
  if (s.status !== "running" && s.stop_reason) break;
}

const verdict =
  s.stop_reason === "awaiting_approval" ? "ASKS: an allow-listed MCP tool still paused for approval. Every overnight call is a step-in. Check tools.configs keys and the vault binding."
  : s.stop_reason === "end_turn" || s.status === "completed" ? "OK: allow-listed MCP tools run without a human. Check activity_log for the 'approval_test' row to confirm the call landed."
  : `UNCLEAR: status=${s.status} stop_reason=${s.stop_reason} stop_code=${(s as { stop_code?: string }).stop_code ?? "-"}. Read the session events in the Studio.`;
console.log("\n" + verdict);
console.log("\nNext: send the probe ONE inbound email, run again, and see whether the second call asks (the 'read people's data' rule). Write both results in log.md.");
