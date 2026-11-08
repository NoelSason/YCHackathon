import type { Check } from "../types.js";
const check: Check = {
  name: "platform_health", owner: "Abhinav", path: "all (platform up)",
  async run({ platformUrl }) {
    const t = Date.now();
    const r = await fetch(`${platformUrl}/health`, { signal: AbortSignal.timeout(30_000) });
    const body = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    const ms = Date.now() - t;
    return body.ok ? { ok: true, detail: `/health ok in ${ms} ms` } : { ok: false, detail: `/health ${r.status} ${body.error ?? ""} (${ms} ms)` };
  },
};
export default check;
