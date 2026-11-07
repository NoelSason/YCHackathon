// Store MCP bearers in Naïve's vault, keyed to each server URL, so every agent that declares the
// server gets the token injected. Idempotent by URL. Reads from .env:
//   PLATFORM_MCP_URL + MCP_BEARER_TOKEN        (the platform server, required)
//   BUSINESS_MCP_URL + BUSINESS_MCP_TOKEN      (Noel's business server, optional)
// ROTATE=1 replaces existing credentials.
import { naive, PLATFORM_MCP_URL } from "./client.js";

const targets: Array<{ label: string; url: string | undefined; token: string | undefined; required: boolean }> = [
  { label: "platform mcp bearer", url: PLATFORM_MCP_URL, token: process.env.MCP_BEARER_TOKEN, required: true },
  { label: "business mcp bearer", url: process.env.BUSINESS_MCP_URL, token: process.env.BUSINESS_MCP_TOKEN, required: false },
];
if (!targets[0]!.url || !targets[0]!.token) {
  console.error("PLATFORM_MCP_URL and MCP_BEARER_TOKEN must be set in platform/naive/.env");
  process.exit(1);
}

const VAULT_NAME = "level-studio-platform";
const existing = (await naive.vaults.list({ limit: 100 })).data as Array<{ id: string; display_name: string }>;
let vault = existing.find((v) => v.display_name === VAULT_NAME);
if (!vault) {
  vault = (await naive.vaults.create({ display_name: VAULT_NAME })) as { id: string; display_name: string };
  console.log(`created vault ${vault.id}`);
} else {
  console.log(`vault ${vault.id} exists`);
}

const creds = (await naive.vaults.credentials.list(vault.id, { limit: 100 })).data as Array<{ id: string; key: string; mcp_server_url?: string | null }>;

for (const t of targets) {
  if (!t.url || !t.token) {
    if (!t.required) console.log(`skipped  ${t.label}: BUSINESS_MCP_URL / BUSINESS_MCP_TOKEN not set`);
    continue;
  }
  const have = creds.find((c) => c.mcp_server_url === t.url);
  if (have && !process.env.ROTATE) {
    console.log(`exists   ${t.label} for ${t.url} (${have.id}); ROTATE=1 to replace`);
    continue;
  }
  if (have) await naive.vaults.credentials.delete(vault.id, have.id);
  const c = await naive.vaults.credentials.create(vault.id, { kind: "static_bearer", key: t.label, value: t.token, mcp_server_url: t.url });
  console.log(`stored   ${t.label} for ${t.url} as ${(c as { id: string }).id}`);
}
