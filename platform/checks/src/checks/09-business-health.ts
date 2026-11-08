import type { Check } from "../types.js";
const check: Check = {
  name: "business_health", owner: "Noel", path: "Outreach / Billing (business server up)",
  async run({ env }) {
    const url = env.BUSINESS_MCP_URL;
    if (!url) return { ok: false, detail: "BUSINESS_MCP_URL not set" };
    const health = url.replace(/\/mcp\/?$/, "") + "/health";
    const t = Date.now();
    const r = await fetch(health, { signal: AbortSignal.timeout(30_000) }).catch((e: unknown) => ({ ok: false, status: String(e) }) as { ok: boolean; status: number | string });
    return r.ok ? { ok: true, detail: `${health} ok in ${Date.now() - t} ms` } : { ok: false, detail: `${health} → ${r.status} (tunnel down? URL changed?)` };
  },
};
export default check;
