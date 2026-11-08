import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "../mcp/tools.js";
import type { Target } from "../types.js";
import { rememberTarget, toolDraftOutreach, toolSaveLead, toolSendOutreach } from "../mcp/tools.js";
import { findTargets } from "../research/targets.js";
import { findGenericContact } from "../research/contacts.js";
import { describeVerification, verifyTarget } from "../research/verify.js";
import type { StoreGame } from "../research/monid.js";
import type { RawReview } from "../research/signals.js";

/** Cold outreach needs real evidence: at least this many reviews showing the same problem. */
const MIN_EVIDENCE = 3;

/**
 * The outreach loop: research the top puzzle games, pick strong targets we haven't contacted, find
 * each studio's public role-based contact, and send the evidence email. It goes through the same
 * guarded tools the Sales agent uses (daily cap, opt-outs, honest numbers, legal footer), at most
 * `perRun` emails a run. Each step is logged, so the dashboard shows it working.
 */
// Rotate through puzzle-adjacent charts so the loop keeps finding studios it hasn't read yet.
// (Two puzzle charts alone ran dry by 4:50 PM Nov 7: "found 0 new studios" every cycle.)
const CATEGORIES: Array<[string, string]> = [
  ["GAME_PUZZLE", "puzzle"], ["GAME_CASUAL", "casual"], ["GAME_WORD", "word"], ["GAME_BOARD", "board"], ["GAME_CARD", "card"],
];
const CHART_KINDS: Array<[string, string]> = [["topselling_free", "top free"], ["topgrossing", "top-grossing"], ["topselling_paid", "top paid"]];
// 15 passes: every chart kind for each category, interleaved so consecutive passes differ.
const CHARTS: Array<{ chart: string; category: string; label: string }> = CHART_KINDS.flatMap(([chart, cl]) =>
  CATEGORIES.map(([category, gl]) => ({ chart, category, label: `${cl} ${gl}` })),
);
// Games read in the last 6 hours, kept in a temp file so a restart doesn't re-read (and re-pay for) them.
const READ_FILE = join(tmpdir(), "levelai-games-read.json");
const recentlyRead = new Map<string, number>(
  (() => {
    try {
      return Object.entries(JSON.parse(readFileSync(READ_FILE, "utf8")) as Record<string, number>);
    } catch {
      return [];
    }
  })(),
);
function markRead(appId: string) {
  recentlyRead.set(appId, Date.now());
  try {
    writeFileSync(READ_FILE, JSON.stringify(Object.fromEntries(recentlyRead)));
  } catch {
    // Best effort; worst case a restart re-reads a few games.
  }
}
// Start the rotation from the clock, so a server restart moves on to a new chart instead of
// re-reading the first one.
let cycleCount = Math.floor(Date.now() / (10 * 60_000));

export async function runOutreachCycle(ctx: ToolContext, opts: { maxGames?: number; perRun?: number; minScore?: number } = {}) {
  const log = (agent: string, action: string, why: string | null, result: string | null) =>
    ctx.store.logActivity({ at: new Date().toISOString(), agent, action, why, result, costUsd: null, human: false });
  if (!ctx.monid) return { sent: 0, reason: "Monid not configured" };

  const perRun = opts.perRun ?? 3;
  const chart = CHARTS[cycleCount++ % CHARTS.length]!;
  const known = new Set((await ctx.store.listLeads()).map((l) => l.appId).filter((x): x is string => Boolean(x)));
  const cutoff = Date.now() - 6 * 3600_000;
  for (const [id, at] of recentlyRead) if (at < cutoff) recentlyRead.delete(id);
  const skip = new Set([...known, ...recentlyRead.keys()]);
  await log("research", `scanning the ${chart.label} games for unhappy players`, "outreach loop", null);
  const read: Target[] = [];
  const qualified: Target[] = [];
  let sent = 0;
  let stop = false;
  const pitch = async (t: Target) => {
    rememberTarget(t);
    const email = await findGenericContact(ctx.monid!, t.developer, t.appId).catch(() => null);
    if (!email) {
      await log("research", `no public contact for ${t.developer}`, "only role-based addresses are used", "skipped");
      return;
    }
    await log("research", `found a public contact for ${t.developer}`, t.reason, email.replace(/^[^@]+/, (m) => `${m[0]}…`));
    const lead = await toolSaveLead(ctx, { appId: t.appId, company: t.developer, email });
    const draft = await toolDraftOutreach(ctx, { leadId: lead.id, senderName: "Noel Sason" });
    if (draft.blockedReason) {
      await log("sales-sender", `held the email to ${t.developer}`, draft.blockedReason, "not sent");
      if (/Daily cap/.test(draft.blockedReason)) stop = true;
      return;
    }
    const res = await toolSendOutreach(ctx, { draftId: draft.draftId });
    if (res.status === "sent") sent++;
  };
  try {
    // The keyword match is the cheap first pass. Games it says have enough evidence get their quotes
    // double-checked by a model before anyone is emailed; the counts and quotes come from what holds up.
    const verifyOpts = { apiKey: ctx.config.OPENAI_API_KEY, model: ctx.config.OPENAI_MODEL, dailyCalls: ctx.config.OPENAI_DAILY_CALLS };
    const verify = async (game: StoreGame, reviews: RawReview[], t: Target) => {
      if (!t.primarySignal || t.signalCounts[t.primarySignal] < MIN_EVIDENCE) return t;
      const { target, report } = await verifyTarget(game, reviews, t, verifyOpts);
      const line = describeVerification(report, game.title, MIN_EVIDENCE);
      if (line) await log("research", line.action, line.why, line.result).catch(() => undefined);
      return target;
    };
    await findTargets(ctx.monid, {
      maxGames: opts.maxGames ?? 30, minSignals: 2, chart: chart.chart, category: chart.category, skip, verify,
      onSkip: (game, err) => console.error(`outreach loop: skipped ${game.title}: ${err instanceof Error ? err.message.slice(0, 120) : "unknown"}`),
      // Pitch each studio as soon as its game qualifies, so a restart mid-pass doesn't lose the emails.
      onRead: async (t) => {
        read.push(t);
        markRead(t.appId);
        if (stop || sent >= perRun) return;
        if (t.primarySignal === null || t.signalCounts[t.primarySignal] < MIN_EVIDENCE || t.score < (opts.minScore ?? 1.2)) return;
        qualified.push(t);
        await pitch(t);
      },
    });
  } catch (err) {
    await log("research", `couldn't read the ${chart.label} chart`, err instanceof Error ? err.message.slice(0, 160) : "unknown error", "will try the next chart next cycle");
    return { sent, reason: "store chart unavailable" };
  }
  await recordResearch(ctx, chart.label, read, log);
  await log("research", `found ${qualified.length} new studios worth pitching`, qualified.slice(0, 3).map((t) => t.appTitle).join(", ") || null, sent ? `${sent} emailed` : null);
  return { sent, reason: null };
}

/** Totals for one chart pass, saved and logged so the dashboard and site can show real numbers. */
export function summarizeResearch(chart: string, read: Target[], at = new Date().toISOString()) {
  const sum = (k: keyof Target["signalCounts"]) => read.reduce((n, t) => n + (t.signalCounts[k] ?? 0), 0);
  const withEvidence = read.filter((t) => t.primarySignal !== null && t.signalCounts[t.primarySignal] >= MIN_EVIDENCE);
  const top = [...withEvidence].sort((a, b) => b.score - a.score)[0] ?? null;
  return {
    at,
    chart,
    gamesRead: read.length,
    reviewsRead: read.reduce((n, t) => n + t.reviewsAnalyzed, 0),
    tooHard: sum("too_hard"),
    tooEasy: sum("too_easy"),
    wantsMoreLevels: sum("wants_more_levels"),
    repetitive: sum("repetitive"),
    gamesWithEvidence: withEvidence.length,
    topGame: top ? top.appTitle : null,
    topReason: top ? top.reason : null,
  };
}

async function recordResearch(
  ctx: ToolContext,
  label: string,
  read: Target[],
  log: (agent: string, action: string, why: string | null, result: string | null) => Promise<void>,
) {
  if (!read.length) return;
  const r = summarizeResearch(label, read);
  await ctx.store.addResearchRun(r).catch(() => undefined);
  const complaints = r.tooHard + r.tooEasy + r.wantsMoreLevels + r.repetitive;
  await log(
    "research",
    `read ${r.reviewsRead.toLocaleString("en-US")} player reviews of ${r.gamesRead} ${label} games`,
    `${complaints} reviews are about the levels: ${r.tooHard} too hard, ${r.tooEasy} too easy, ${r.wantsMoreLevels} want more levels, ${r.repetitive} repetitive`,
    r.gamesWithEvidence ? `${r.gamesWithEvidence} games show a clear level problem; strongest: ${r.topGame}` : "no game showed a clear level problem",
  );
}
