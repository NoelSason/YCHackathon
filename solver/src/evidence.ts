import { createHash } from "node:crypto";
import { MIN_VERIFICATION_RUNS, onTarget } from "./policy.js";
import { wilson95 } from "./stats.js";

// Bump a game's version whenever its simulation rules or reference bot changes.
// Runtime checkouts are pinned separately; this binds evidence to game semantics.
export const RULES_VERSION: Readonly<Record<string, string>> = {
  racer: "racer-cleared-history-boost-v2",
  watersort: "watersort-reference-v1", match3: "match3-shuffle-greedy-v1",
  lotescape: "lotescape-human-v1", platformer: "platformer-step-budget-human-v1", stub: "stub-v1",
};
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).filter(k => row[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(row[k])}`).join(",")}}`;
}
export const levelHash = (level: object): string => createHash("sha256").update(canonical(level)).digest("hex");
export function evidenceStamp(game: string, level: object): { rules_version: string; level_hash: string } {
  return { rules_version: RULES_VERSION[game] ?? "unversioned", level_hash: levelHash(level) };
}
export interface EvidenceInput {
  runs: number; wins: number; win_rate: number; ci95_low: number; ci95_high: number;
  rules_version?: string; level_hash?: string;
}
/** Recompute the confidence interval; a caller cannot submit a made-up interval or rate. */
export function evidenceProblem(game: string, level: object, target: number, r: EvidenceInput | undefined): string | null {
  if (!r || !Number.isInteger(r.runs) || r.runs < MIN_VERIFICATION_RUNS) return `need at least ${MIN_VERIFICATION_RUNS} completed reference-bot games`;
  if (!Number.isInteger(r.wins) || r.wins < 0 || r.wins > r.runs || !Number.isFinite(r.win_rate) || Math.abs(r.wins / r.runs - r.win_rate) > 0.000051) return "invalid wins/runs/rate evidence";
  const stamp = evidenceStamp(game, level);
  if (r.rules_version !== stamp.rules_version || r.level_hash !== stamp.level_hash) return "evidence is stale: replay this exact level under the current game rules";
  const ci = wilson95(r.wins, r.runs);
  if (!Number.isFinite(target) || target < 0 || target > 1 || !onTarget({ win_rate: r.wins / r.runs, ci95_low: ci.low, ci95_high: ci.high }, target)) return "reference-bot result misses the unchanged target";
  return null;
}
