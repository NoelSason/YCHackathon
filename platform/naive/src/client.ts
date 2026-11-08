import { createClient } from "@usenaive-sdk/managed-agents";
import { withRetry } from "./retry.js";

const apiKey = process.env.NAIVE_API_KEY;
if (!apiKey) {
  console.error("NAIVE_API_KEY is not set (put it in platform/naive/.env)");
  process.exit(1);
}

const raw = createClient({ baseUrl: process.env.NAIVE_BASE_URL ?? "https://api.vetta.sh", apiKey });

// Every SDK call retries on 429/503 ("the service is at capacity" under hackathon load). The
// client is a tree of namespaces (naive.agents.create, naive.vaults.credentials.list, ...), so
// wrap it recursively; functions get withRetry, objects get wrapped lazily.
function retrying<T extends object>(obj: T, path = "naive"): T {
  return new Proxy(obj, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      const name = `${path}.${String(prop)}`;
      if (typeof v === "function") return (...args: unknown[]) => withRetry(() => (v as (...a: unknown[]) => unknown).apply(target, args) as Promise<unknown>, name);
      if (v && typeof v === "object") return retrying(v as object, name);
      return v;
    },
  });
}

export const naive = retrying(raw);

export const PLATFORM_MCP_URL = process.env.PLATFORM_MCP_URL; // e.g. https://<function-host>/mcp
