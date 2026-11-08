/**
 * Creates or updates Noel's Naïve agents.
 *   npm run agents:plan    prints what would be created (secrets masked). No API calls.
 *   npm run agents:apply   creates missing agents and updates existing ones by name.
 *
 * Needs NAIVE_API_KEY (agents:read, agents:write), BUSINESS_MCP_URL (the public /mcp URL of
 * src/server.ts), and BUSINESS_MCP_TOKEN. Pick the model with `naive models list`.
 */
import { createClient } from "@usenaive-sdk/managed-agents";
import { agentDefinitions } from "./definitions.js";

const apply = process.argv.includes("--apply");
const model = process.env.AGENT_MODEL ?? "z-ai/glm-5.3-flash";
const businessMcpUrl = process.env.BUSINESS_MCP_URL ?? "https://REPLACE-ME.example.com/mcp";
const businessMcpToken = process.env.BUSINESS_MCP_TOKEN ?? "REPLACE-ME";

const defs = agentDefinitions({ model, businessMcpUrl, businessMcpToken });

if (!apply) {
  const masked = defs.map((d) => ({
    ...d,
    mcp_servers: d.mcp_servers?.map((s) => ({ ...s, headers: { Authorization: "Bearer ***" } })),
  }));
  console.log(JSON.stringify(masked, null, 2));
  console.log(`\n${defs.length} agents. Run with --apply to create them.`);
  process.exit(0);
}

// Disabled Nov 7, 2:50 PM: Abhinav's platform/naive/src/roster.ts already defines `research`,
// `finance`, `sales_reader`, `sales_sender`, and `playtest`, and this script updates by name, so it
// would overwrite his agents. The plan is to move these prompts and the business MCP server into
// roster.ts instead. Remove this guard only if the team decides otherwise.
if (!process.env.ALLOW_SEPARATE_BUSINESS_AGENTS) {
  throw new Error("Disabled: the business agents live in platform/naive/src/roster.ts. See the comment in this file.");
}

const apiKey = process.env.NAIVE_API_KEY;
if (!apiKey) throw new Error("NAIVE_API_KEY is required for --apply.");
if (businessMcpUrl.includes("REPLACE-ME") || businessMcpToken === "REPLACE-ME") {
  throw new Error("Set BUSINESS_MCP_URL and BUSINESS_MCP_TOKEN first.");
}

const client = createClient({ apiKey, baseUrl: process.env.NAIVE_BASE_URL ?? "https://api.vetta.sh" });
const existing = await client.agents.list();
const byName = new Map(existing.data.map((a) => [a.name, a]));

for (const def of defs) {
  const found = byName.get(def.name);
  if (found) {
    await client.agents.update(found.id, { ...def, expected_version: found.current_version });
    console.log(`updated ${def.name} (${found.id})`);
  } else {
    const created = await client.agents.create(def);
    console.log(`created ${def.name} (${created.id})`);
  }
}
