import { defineConfig } from "@neon/config/v1";

// The platform MCP server runs as a Neon Function next to the database.
// Deploy: `neon deploy --env .env` (DATABASE_URL is injected; the two below come from .env).
export default defineConfig({
  auth: false,
  functions: {
    platform: {
      name: "level studio platform (MCP + events)",
      source: "src/fn.ts",
      env: {
        MCP_BEARER_TOKEN: { value: process.env.MCP_BEARER_TOKEN, required: true },
        GAMES_BASE_URL: { value: process.env.GAMES_BASE_URL ?? "https://example.com", required: false },
      },
    },
  },
  branch: (branch) => {
    if (branch.isDefault) return {};
    if (!branch.exists) return { ttl: "7d" };
    return {};
  },
});
