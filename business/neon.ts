import { defineConfig } from "@neon/config/v1";

// The business server runs as a Neon Function next to the platform's, on the same project and branch.
// Deploy from business/: `neon deploy --env ../.env` (see README "Deploy").
// DATABASE_URL is injected by Neon. Every value below is read from that .env at deploy time.
//
// `auth` and `branch` must match platform/mcp/neon.ts: both files apply to the same branch.
// MONID_API_KEY is left out on purpose: the function has no `monid` CLI, so find_targets should say
// "Monid isn't configured" instead of failing to start a program that isn't there.
const optional = (key: string) => ({ value: process.env[key], required: false as const });

export default defineConfig({
  auth: false,
  functions: {
    business: {
      name: "level ai business ops (MCP + webhooks + leads)",
      source: "src/fn.ts",
      // agentmail lazily imports its optional x402 payments peer, which we don't install or use.
      // Without this, esbuild can't resolve it and the deploy fails to bundle.
      externalPackages: [{ name: "@x402/fetch", includeFiles: false }],
      env: {
        BUSINESS_MCP_TOKEN: { value: process.env.BUSINESS_MCP_TOKEN, required: true },
        PUBLIC_BASE_URL: optional("PUBLIC_BASE_URL"),

        NAIVE_API_KEY: optional("NAIVE_API_KEY"),
        NAIVE_BASE_URL: optional("NAIVE_BASE_URL"),
        SALES_READER_AGENT_ID: optional("SALES_READER_AGENT_ID"),

        AGENTMAIL_API_KEY: optional("AGENTMAIL_API_KEY"),
        AGENTMAIL_INBOX_ID: optional("AGENTMAIL_INBOX_ID"),
        AGENTMAIL_WEBHOOK_SECRET: optional("AGENTMAIL_WEBHOOK_SECRET"),

        STRIPE_SECRET_KEY: optional("STRIPE_SECRET_KEY"),
        STRIPE_WEBHOOK_SECRET: optional("STRIPE_WEBHOOK_SECRET"),
        BILLING_ALLOW_LIVE: optional("BILLING_ALLOW_LIVE"),
        PILOT_PRICE_USD: optional("PILOT_PRICE_USD"),
        PILOT_LEVELS: optional("PILOT_LEVELS"),
        HINT_PACK_PRICE_USD: optional("HINT_PACK_PRICE_USD"),

        OUTREACH_SEND: optional("OUTREACH_SEND"),
        OUTREACH_DAILY_CAP: optional("OUTREACH_DAILY_CAP"),
        COMPANY_NAME: optional("COMPANY_NAME"),
        COMPANY_POSTAL_ADDRESS: optional("COMPANY_POSTAL_ADDRESS"),

        MOBILERUN_API_KEY: optional("MOBILERUN_API_KEY"),
        MOBILERUN_DEVICE_ID: optional("MOBILERUN_DEVICE_ID"),
        MOBILERUN_MODEL: optional("MOBILERUN_MODEL"),
      },
    },
  },
  branch: (branch) => {
    if (branch.isDefault) return {};
    if (!branch.exists) return { ttl: "7d" };
    return {};
  },
});
