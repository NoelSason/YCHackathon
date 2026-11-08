import type { Check } from "../types.js";
// Live phone view: the demo stage (./demo.sh) is serving fresh phone screenshots.
const check: Check = {
  name: "live_phone_view", owner: "Noel", path: "Live phone view",
  async run({ env }) {
    const base = (env.DEMO_STAGE_URL ?? `http://localhost:${env.DEMO_PORT ?? "4545"}`).replace(/\/$/, "");
    const r = await fetch(`${base}/api/phone.png`, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!r) return { ok: false, detail: `demo stage not reachable at ${base} (run ./demo.sh)` };
    if (!r.ok) return { ok: false, detail: `${base}/api/phone.png → ${r.status} (phone not connected?)` };
    const type = r.headers.get("content-type") ?? "";
    const bytes = (await r.arrayBuffer()).byteLength;
    return type.startsWith("image/") && bytes > 1000
      ? { ok: true, detail: `phone view live: ${type}, ${Math.round(bytes / 1024)} KB` }
      : { ok: false, detail: `phone view returned ${type || "no type"}, ${bytes} bytes` };
  },
};
export default check;
