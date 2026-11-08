import { readFileSync } from "node:fs";
import { createClient } from "@usenaive-sdk/managed-agents";
import type { Check } from "../types.js";
const check: Check = {
  name: "deployments", owner: "Abhinav", path: "CEO decision (cron is on)",
  async run({ env, expectRunning }) {
    if (!env.NAIVE_API_KEY) return { ok: false, detail: "NAIVE_API_KEY not set" };
    const naive = createClient({ apiKey: env.NAIVE_API_KEY, baseUrl: env.NAIVE_BASE_URL ?? "https://api.vetta.sh" });
    const team = JSON.parse(readFileSync(new URL("../../../naive/team.json", import.meta.url), "utf8")) as { deployments: Record<string, string> };
    const states: string[] = [];
    let bad = 0;
    for (const [name, id] of Object.entries(team.deployments)) {
      const d = await naive.deployments.get(id);
      const on = d.enabled && d.schedule_status === "scheduled";
      states.push(`${name}:${on ? "on" : "off"}`);
      if (expectRunning && !on) bad++;
    }
    const detail = states.join(" ");
    return bad ? { ok: false, detail: `${detail}: ${bad} deployment(s) not scheduled after switch-on` } : { ok: true, detail };
  },
};
export default check;
