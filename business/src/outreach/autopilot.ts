import type { ToolContext } from "../mcp/tools.js";
import { rememberTarget, toolDraftOutreach, toolSaveLead, toolSendOutreach } from "../mcp/tools.js";
import { findTargets } from "../research/targets.js";
import { findGenericContact } from "../research/contacts.js";

/**
 * The outreach loop: research the top puzzle games, pick strong targets we haven't contacted, find
 * each studio's public role-based contact, and send the evidence email. It goes through the same
 * guarded tools the Sales agent uses (daily cap, opt-outs, honest numbers, legal footer), at most
 * `perRun` emails a run. Each step is logged, so the dashboard shows it working.
 */
// Rotate through puzzle-adjacent charts so the loop keeps finding studios it hasn't read yet.
// (Two puzzle charts alone ran dry by 4:50 PM Nov 7: "found 0 new studios" every cycle.)
const CHARTS: Array<{ chart: string; category: string; label: string }> = [
  { chart: "topselling_free", category: "GAME_PUZZLE", label: "top free puzzle" },
  { chart: "topgrossing", category: "GAME_PUZZLE", label: "top-grossing puzzle" },
  { chart: "topselling_free", category: "GAME_CASUAL", label: "top free casual" },
  { chart: "topselling_free", category: "GAME_BOARD", label: "top free board" },
  { chart: "topselling_free", category: "GAME_WORD", label: "top free word" },
  { chart: "topgrossing", category: "GAME_CASUAL", label: "top-grossing casual" },
  { chart: "topselling_paid", category: "GAME_PUZZLE", label: "top paid puzzle" },
];
const recentlyRead = new Map<string, number>();
let cycleCount = 0;

export async function runOutreachCycle(ctx: ToolContext, opts: { maxGames?: number; perRun?: number; minScore?: number } = {}) {
  const log = (agent: string, action: string, why: string | null, result: string | null) =>
    ctx.store.logActivity({ at: new Date().toISOString(), agent, action, why, result, costUsd: null, human: false });
  if (!ctx.monid) return { sent: 0, reason: "Monid not configured" };

  const perRun = opts.perRun ?? 2;
  const chart = CHARTS[cycleCount++ % CHARTS.length]!;
  const known = new Set((await ctx.store.listLeads()).map((l) => l.appId).filter((x): x is string => Boolean(x)));
  const cutoff = Date.now() - 6 * 3600_000;
  for (const [id, at] of recentlyRead) if (at < cutoff) recentlyRead.delete(id);
  const skip = new Set([...known, ...recentlyRead.keys()]);
  await log("research", `scanning the ${chart.label} games for unhappy players`, "outreach loop", null);
  let targets;
  try {
    targets = await findTargets(ctx.monid, { maxGames: opts.maxGames ?? 12, minSignals: 2, chart: chart.chart, category: chart.category, skip });
  } catch (err) {
    await log("research", `couldn't read the ${chart.label} chart`, err instanceof Error ? err.message.slice(0, 160) : "unknown error", "will try the next chart next cycle");
    return { sent: 0, reason: "store chart unavailable" };
  }
  for (const t of targets) recentlyRead.set(t.appId, Date.now());
  // Cold outreach needs real evidence: at least 3 reviews showing the same problem.
  const fresh = targets.filter((t) => t.primarySignal !== null && t.signalCounts[t.primarySignal] >= 3 && t.score >= (opts.minScore ?? 1.2));
  await log("research", `found ${fresh.length} new studios worth pitching`, fresh.slice(0, 3).map((t) => t.appTitle).join(", ") || null, null);

  let sent = 0;
  for (const t of fresh) {
    if (sent >= perRun) break;
    rememberTarget(t);
    const email = await findGenericContact(ctx.monid, t.developer).catch(() => null);
    if (!email) {
      await log("research", `no public contact for ${t.developer}`, "only role-based addresses are used", "skipped");
      continue;
    }
    await log("research", `found a public contact for ${t.developer}`, t.reason, email.replace(/^[^@]+/, (m) => `${m[0]}…`));
    const lead = await toolSaveLead(ctx, { appId: t.appId, company: t.developer, email });
    const draft = await toolDraftOutreach(ctx, { leadId: lead.id, senderName: "Noel Sason" });
    if (draft.blockedReason) {
      await log("sales-sender", `held the email to ${t.developer}`, draft.blockedReason, "not sent");
      if (/Daily cap/.test(draft.blockedReason)) break;
      continue;
    }
    const res = await toolSendOutreach(ctx, { draftId: draft.draftId });
    if (res.status === "sent") sent++;
  }
  return { sent, reason: null };
}
