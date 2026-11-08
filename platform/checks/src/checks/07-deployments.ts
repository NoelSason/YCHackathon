import { readFileSync } from "node:fs";
import { createClient } from "@usenaive-sdk/managed-agents";
import type { Check } from "../types.js";

// The deployments live in the team's Naïve workspace. On some laptops NAIVE_API_KEY belongs to a
// different (empty) workspace and NAIVE_API_KEY_SOCIAL is the team's key, so a key that can't see
// the team's deployments falls back to the next one instead of reporting them missing.
const check: Check = {
  name: "deployments", owner: "Abhinav", path: "CEO decision (cron is on)",
  async run({ env, expectRunning }) {
    const keys = [env.NAIVE_API_KEY, env.NAIVE_API_KEY_SOCIAL].filter((k): k is string => !!k);
    if (!keys.length) return { ok: false, detail: "NAIVE_API_KEY not set" };
    const team = JSON.parse(readFileSync(new URL("../../../naive/team.json", import.meta.url), "utf8")) as { deployments: Record<string, string> };
    let lastErr: unknown;
    for (const apiKey of keys) {
      const naive = createClient({ apiKey, baseUrl: env.NAIVE_BASE_URL ?? "https://api.vetta.sh" });
      try {
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
      } catch (e) {
        lastErr = e;
        if (!/no such deployment/i.test(e instanceof Error ? e.message : String(e))) throw e;
      }
    }
    throw lastErr;
  },
};
export default check;
