import { createHash } from "node:crypto";

/**
 * One line on the stage feed. Every number on the stage is computed from a list of these, and
 * every one comes from a real log row (or a replay file exported from those rows).
 */
export interface StageEvent {
  id: string;
  at: string;
  /** Normalized agent key, e.g. "sales_sender". "human" for step-ins with no named person. */
  agent: string;
  action: string;
  why: string | null;
  result: string | null;
  /** Decision-record fields (docs/agent-plan.md → "Decision record"). Null for plain actions. */
  saw: string | null;
  expected: string | null;
  costUsd: number | null;
  human: boolean;
  kind: "action" | "decision" | "step_in";
  /** The table or file the row came from. */
  source: string;
}

export interface AgentStat {
  agent: string;
  count: number;
  lastAt: string | null;
  lastAction: string | null;
}

export interface StageStats {
  agentActions: number;
  decisions: number;
  stepIns: number;
  spendUsd: number;
  firstAt: string | null;
  lastAt: string | null;
  lastStepInAt: string | null;
  /** Start of the current unattended stretch: the last step-in, or the first event if none. */
  unattendedSince: string | null;
  /** Agent actions logged after the unattended stretch began (all of them when there are no step-ins). */
  actionsSinceStepIn: number;
  perAgent: AgentStat[];
}

type Row = Record<string, unknown>;

const text = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const toIso = (v: unknown): string | null => {
  if (v instanceof Date) return v.toISOString();
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export const agentKey = (name: string): string =>
  name.trim().toLowerCase().replace(/[\s-]+/g, "_");

const first = (row: Row, keys: string[]): unknown => {
  for (const k of keys) if (row[k] !== undefined && row[k] !== null) return row[k];
  return undefined;
};

/**
 * Turn one log row into a stage event. Accepts the business-ops shape (`biz_activity`), the
 * decision-record shape, and rows that keep their details in a JSON `payload`/`data` column, so
 * the stage keeps working when the shared activity table lands with slightly different columns.
 * Returns null for rows with no usable time.
 */
export function normalizeRow(raw: Row, source: string, opts: { forceHuman?: boolean } = {}): StageEvent | null {
  let row: Row = raw;
  for (const nested of ["payload", "data", "detail", "details"]) {
    const v = raw[nested];
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      row = { ...(v as Row), ...raw };
    }
  }

  const at = toIso(first(row, ["at", "ts", "time", "timestamp", "created_at", "occurred_at"]));
  if (!at) return null;

  const human =
    opts.forceHuman === true ||
    row.human === true ||
    row.is_human === true ||
    row.human === "true" ||
    row.kind === "step_in";

  const chose = text(row.chose);
  const saw = text(row.saw);
  const kind: StageEvent["kind"] = human ? "step_in" : chose || saw ? "decision" : "action";

  const agentName = text(first(row, ["agent", "actor", "agent_name", "person", "who"])) ?? (human ? "human" : "unknown");
  const action =
    text(first(row, ["action", "chose", "what", "event", "summary", "title"])) ?? (kind === "decision" ? "Made a decision" : "Did something");

  const result = text(row.result);
  const why = text(first(row, ["why", "reason"]));

  const idPart = text(row.id) ?? createHash("sha1").update(JSON.stringify([at, agentName, action, why, result])).digest("hex").slice(0, 16);

  return {
    id: `${source}:${idPart}`,
    at,
    agent: human && agentName === "unknown" ? "human" : agentKey(agentName),
    action: kind === "decision" && chose ? chose : action,
    why,
    result,
    saw,
    expected: text(row.expected),
    costUsd: num(first(row, ["cost_usd", "costUsd", "cost_estimate_usd", "cost"])),
    human,
    kind,
    source,
  };
}

/**
 * Setup checks the team ran while wiring things up (the "probe" agent, "approval_test" rows, smoke-test decisions). They
 * aren't the company's work, so the stage leaves them out. Human step-ins are never treated as noise.
 */
export function isSetupNoise(e: StageEvent): boolean {
  if (e.human) return false;
  // Plus the platform's smoke-test decisions (chose "a", why "smoke") from wiring up the CEO.
  return e.agent === "probe" || /^approval[_ ]test/i.test(e.action) || (e.kind === "decision" && /^smoke\b/i.test(e.why ?? ""));
}

export const byTime = (a: StageEvent, b: StageEvent): number => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);

export function computeStats(events: readonly StageEvent[]): StageStats {
  let agentActions = 0;
  let decisions = 0;
  let stepIns = 0;
  let spendUsd = 0;
  let firstAt: string | null = null;
  let lastAt: string | null = null;
  let lastStepInAt: string | null = null;
  const perAgent = new Map<string, AgentStat>();

  for (const e of events) {
    if (!firstAt || e.at < firstAt) firstAt = e.at;
    if (!lastAt || e.at > lastAt) lastAt = e.at;
    if (e.costUsd !== null) spendUsd += e.costUsd;
    if (e.human) {
      stepIns += 1;
      if (!lastStepInAt || e.at > lastStepInAt) lastStepInAt = e.at;
      continue;
    }
    agentActions += 1;
    if (e.kind === "decision") decisions += 1;
    const s = perAgent.get(e.agent) ?? { agent: e.agent, count: 0, lastAt: null, lastAction: null };
    s.count += 1;
    if (!s.lastAt || e.at >= s.lastAt) {
      s.lastAt = e.at;
      s.lastAction = e.action;
    }
    perAgent.set(e.agent, s);
  }

  const since = lastStepInAt;
  const actionsSinceStepIn = since ? events.filter((e) => !e.human && e.at > since).length : agentActions;

  return {
    agentActions,
    decisions,
    stepIns,
    spendUsd: Math.round(spendUsd * 100) / 100,
    firstAt,
    lastAt,
    lastStepInAt,
    unattendedSince: lastStepInAt ?? firstAt,
    actionsSinceStepIn,
    perAgent: [...perAgent.values()].sort((a, b) => b.count - a.count),
  };
}
