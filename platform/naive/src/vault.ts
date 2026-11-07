// Store the platform MCP bearer in Naïve's vault, keyed to PLATFORM_MCP_URL, so every agent that
// declares that server gets it injected. Idempotent by vault name. Reads MCP_BEARER_TOKEN from .env.
import { naive, PLATFORM_MCP_URL } from "./client.js";

const token = process.env.MCP_BEARER_TOKEN;
if (!PLATFORM_MCP_URL || !token) {
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
const have = creds.find((c) => c.mcp_server_url === PLATFORM_MCP_URL);
if (have && !process.env.ROTATE) {
  console.log(`credential for ${PLATFORM_MCP_URL} exists (${have.id}); set ROTATE=1 to replace`);
} else {
  if (have) await naive.vaults.credentials.delete(vault.id, have.id);
  const c = await naive.vaults.credentials.create(vault.id, {
    kind: "static_bearer",
    key: "platform mcp bearer",
    value: token,
    mcp_server_url: PLATFORM_MCP_URL,
  });
  console.log(`stored bearer for ${PLATFORM_MCP_URL} as ${(c as { id: string }).id}`);
}
