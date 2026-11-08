// Create or update the Naïve Team: the roster agents, the CEO coordinator with its board, and the
// cron deployments. Idempotent: agents are matched by name, so re-running updates them in place.
// Writes platform/naive/team.json (ids only, no secrets) for the other scripts and the dashboard.
import { writeFileSync } from "node:fs";
import { naive, PLATFORM_MCP_URL } from "./client.js";
import { ROSTER, CEO, MODEL, PLATFORM_MCP_NAME, BUSINESS_MCP_NAME, PLATFORM_CRM_MCP_NAME, toolsFor, budgetFor, type RosterAgent } from "./roster.js";

if (!PLATFORM_MCP_URL) {
  console.error("PLATFORM_MCP_URL is not set (the deployed MCP server, ending in /mcp)");
  process.exit(1);
}
const mcp_servers = [{ name: PLATFORM_MCP_NAME, url: PLATFORM_MCP_URL }];
// Noel's business MCP server. Its bearer also goes in Naïve's vault, keyed to BUSINESS_MCP_URL.
const BUSINESS_MCP_URL = process.env.BUSINESS_MCP_URL;
const PLATFORM_CRM_MCP_URL = `${PLATFORM_MCP_URL.replace(/\/+$/, "")}/crm`;
const serversFor = (a: RosterAgent) => [
  ...mcp_servers,
  ...(a.businessTools?.length && BUSINESS_MCP_URL ? [{ name: BUSINESS_MCP_NAME, url: BUSINESS_MCP_URL }] : []),
  ...(a.crmTools?.length ? [{ name: PLATFORM_CRM_MCP_NAME, url: PLATFORM_CRM_MCP_URL }] : []),
];
if (!BUSINESS_MCP_URL) console.warn("BUSINESS_MCP_URL is not set: agents get platform tools only (no research, email, billing, or phone tools).");
// Auth for that server is NOT set here: Naïve rejects inline Authorization headers. Put the bearer
// in Naïve's vault keyed to PLATFORM_MCP_URL (static_bearer) from the dashboard or CLI.

type Created = { id: string; current_version?: number; version?: number };

async function findByName(name: string): Promise<Created | undefined> {
  const page = await naive.agents.list({ limit: 100 });
  const hit = (page.data as Array<{ id: string; name: string; current_version?: number; version?: number }>).find((a) => a.name === name);
  return hit;
}

async function upsert(a: RosterAgent, extra: Record<string, unknown> = {}): Promise<Created> {
  const body = { name: a.name, model: MODEL, system: a.system, tools: toolsFor(a), mcp_servers: serversFor(a), budget: budgetFor(a), window: "immediate" as const, ...extra };
  const existing = await findByName(a.name);
  if (existing) {
    const r = await naive.agents.update(existing.id, body);
    console.log(`updated  ${a.name} ${existing.id}`);
    return r as Created;
  }
  const r = await naive.agents.create(body);
  console.log(`created  ${a.name} ${(r as Created).id}`);
  return r as Created;
}

const ids: Record<string, string> = {};
const versions: Record<string, number> = {};

for (const a of ROSTER) {
  const r = await upsert(a);
  ids[a.name] = r.id;
  versions[a.name] = (r.current_version ?? r.version ?? 1) as number;
}

// CEO: a coordinator with the roster pinned to the versions we just saved, plus the board.
const ceo = await upsert(CEO, {
  multiagent: {
    type: "coordinator",
    agents: ROSTER.map((a) => ({ type: "agent" as const, id: ids[a.name], version: versions[a.name] })),
    board: true,
  },
  handoffs: "team",
});
ids.ceo = ceo.id;

// Cron deployments for the agents that run on a schedule. Existing ones are left alone unless
// RESET_DEPLOYMENTS=1, so re-running setup doesn't double-schedule.
const existingDeps = (await naive.deployments.list({ limit: 100 })).data as Array<{ id: string; agent_id: string; cron: string }>;
const deployments: Record<string, string> = {};
for (const a of [...ROSTER, CEO]) {
  const cron = a.cron;
  if (!cron) continue;
  const have = existingDeps.find((d) => d.agent_id === ids[a.name] && d.cron === cron.expr);
  if (have && !process.env.RESET_DEPLOYMENTS) {
    deployments[a.name] = have.id;
    console.log(`deploy   ${a.name} exists ${have.id}`);
    continue;
  }
  const d = await naive.deployments.create({
    agent_id: ids[a.name],
    cron: cron.expr,
    timezone: "America/Los_Angeles",
    input_template: cron.input,
    budget_micro_usd: Math.round(cron.budget_usd * 1_000_000),
    window: "immediate",
    enabled: false, // switched on at 6:00 PM with `npm run kill -- on`, not by setup
  });
  deployments[a.name] = d.id;
  console.log(`deploy   ${a.name} created ${d.id} (disabled until switch-on)`);
}

writeFileSync(new URL("../team.json", import.meta.url), JSON.stringify({ model: MODEL, agents: ids, versions, deployments, mcp: PLATFORM_MCP_URL }, null, 2) + "\n");
console.log("wrote team.json");
