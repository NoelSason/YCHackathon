import type { Check } from "../types.js";
// Phone playtest: the Mobilerun iPhone is ready, and (after switch-on) a playtest finished recently.
const check: Check = {
  name: "phone_playtest", owner: "Noel", path: "Phone playtest",
  async run({ db, env, expectRunning }) {
    const key = env.MOBILERUN_API_KEY, device = env.MOBILERUN_DEVICE_ID;
    if (!key || !device) return { ok: false, detail: "MOBILERUN_API_KEY or MOBILERUN_DEVICE_ID not set" };
    const r = await fetch(`https://api.mobilerun.ai/v1/devices/${encodeURIComponent(device)}`, {
      headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000),
    }).catch((e: unknown) => ({ ok: false, status: String(e), json: async () => ({}) }) as unknown as Response);
    if (!r.ok) return { ok: false, detail: `Mobilerun device lookup → ${r.status}` };
    const d = (await r.json()) as { state?: string; name?: string; platform?: string };
    if (d.state !== "ready") return { ok: false, detail: `phone "${d.name ?? device}" is ${d.state ?? "unknown"}, not ready` };
    const q = await db.query(`select count(*) filter (where action ilike 'playtested %' or action ilike 'phone playtest %') as done,
                                     max(ts) as last from activity_log where agent in ('playtest-lead','playtest') and ts > now() - interval '24 hours'`);
    const x = q.rows[0] as { done: string; last: Date | null };
    const detail = `phone "${d.name}" (${d.platform}) ready; ${x.done} playtests finished in 24h${x.last ? `, last ${new Date(x.last).toISOString()}` : ""}`;
    return !expectRunning || Number(x.done) > 0 ? { ok: true, detail } : { ok: false, detail: `${detail}: none since switch-on` };
  },
};
export default check;
