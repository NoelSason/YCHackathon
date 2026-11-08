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
export async function runOutreachCycle(ctx: ToolContext, opts: { maxGames?: number; perRun?: number; minScore?: number } = {}) {
  const log = (agent: string, action: string, why: string | null, result: string | null) =>
    ctx.store.logActivity({ at: new Date().toISOString(), agent, action, why, result, costUsd: null, human: false });
  if (!ctx.monid) return { sent: 0, reason: "Monid not configured" };

  const perRun = opts.perRun ?? 2;
  await log("research", "scanning the top puzzle games for unhappy players", "outreach loop", null);
  const targets = await findTargets(ctx.monid, { maxGames: opts.maxGames ?? 8, minSignals: 3 });
  const known = new Set((await ctx.store.listLeads()).map((l) => l.appId).filter(Boolean));
  const fresh = targets.filter((t) => !known.has(t.appId) && t.score >= (opts.minScore ?? 2));
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
