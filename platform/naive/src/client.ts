import { createClient } from "@usenaive-sdk/managed-agents";

const apiKey = process.env.NAIVE_API_KEY;
if (!apiKey) {
  console.error("NAIVE_API_KEY is not set (put it in platform/naive/.env)");
  process.exit(1);
}

export const naive = createClient({ baseUrl: process.env.NAIVE_BASE_URL ?? "https://api.vetta.sh", apiKey });

export const PLATFORM_MCP_URL = process.env.PLATFORM_MCP_URL; // e.g. https://level-studio-platform.onrender.com/mcp
