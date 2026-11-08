import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "../mcp/tools.js";
import type { Target } from "../types.js";
import { rememberTarget, toolDraftOutreach, toolSaveLead, toolSendOutreach } from "../mcp/tools.js";
import { findTargets } from "../research/targets.js";
import { findGenericContact } from "../research/contacts.js";
import { describeVerification, verifyTarget } from "../research/verify.js";
import { monidSpentTodayUsd, monidSpentUsd, recentlyFetchedAppIds, type StoreGame } from "../research/monid.js";
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
// One "paused" row per day at most, so a capped night doesn't fill the feed.
let capLoggedDay: string | null = null;
/** A pass with nothing new on its chart moves to the next chart, up to this many in one pass. */
const MAX_CHARTS_PER_PASS = 3;

/** Milliseconds until the next pass: `intervalMs` after this one started, or a short pause if it ran longer. */
export function nextPassDelayMs(startedAt: number, finishedAt: number, intervalMs: number): number {
  return Math.max(30_000, intervalMs - (finishedAt - startedAt));
}

export async function runOutreachCycle(ctx: ToolContext, opts: { maxGames?: number; perRun?: number; minScore?: number } = {}) {
  const log = (agent: string, action: string, why: string | null, result: string | null, costUsd: number | null = null) =>
    ctx.store.logActivity({ at: new Date().toISOString(), agent, action, why, result, costUsd, human: false });
  const spentBefore = monidSpentUsd();
  if (!ctx.monid) return { sent: 0, reason: "Monid not configured" };

  const cap = ctx.config.MONID_DAILY_USD;
  const today = monidSpentTodayUsd();
  if (today >= cap) {
    const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    if (capLoggedDay !== day) {
      capLoggedDay = day;
      await log("research", "paused market research for today", `today's research spend reached the $${cap.toFixed(2)} daily limit`, `$${today.toFixed(2)} spent`);
    }
    return { sent: 0, reason: "Monid daily cap reached" };
  }

  const perRun = opts.perRun ?? 3;
  const known = new Set((await ctx.store.listLeads()).map((l) => l.appId).filter((x): x is string => Boolean(x)));
  const cutoff = Date.now() - 6 * 3600_000;
  for (const [id, at] of recentlyRead) if (at < cutoff) recentlyRead.delete(id);
  // Anything read here or by an audit in the last six hours stays out, so each pass reads new games
  // and the "reviews read" count only grows by reviews this pass fetched.
  const skip = new Set([...known, ...recentlyRead.keys(), ...recentlyFetchedAppIds(ctx.monid)]);
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

  // A chart whose top games were all read recently costs almost nothing to check, so the pass moves
  // on to the next chart instead of waiting for the next one.
  const tried: string[] = [];
  let chartLabel = "";
  let chartErrors = 0;
  for (let n = 0; n < MAX_CHARTS_PER_PASS && read.length === 0; n++) {
    const chart = CHARTS[cycleCount++ % CHARTS.length]!;
    chartLabel = chart.label;
    tried.push(chart.label);
    await log("research", `scanning the ${chart.label} games for unhappy players`, "outreach loop", null);
    try {
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
      chartErrors++;
      await log("research", `couldn't read the ${chart.label} chart`, err instanceof Error ? err.message.slice(0, 160) : "unknown error", "trying another chart");
    }
  }
  if (!read.length) {
    if (chartErrors === tried.length) return { sent, reason: "store chart unavailable" };
    await log("research", `no new games to read on the ${tried.join(", ")} charts`, "each one was read in the last six hours or is already a lead", "will try other charts next pass");
    return { sent, reason: null };
  }
  await recordResearch(ctx, chartLabel, read, log, monidSpentUsd() - spentBefore);
  await log("research", `found ${qualified.length} new ${qualified.length === 1 ? "studio" : "studios"} worth pitching`, qualified.slice(0, 3).map((t) => t.appTitle).join(", ") || null, sent ? `${sent} emailed` : null);
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
  log: (agent: string, action: string, why: string | null, result: string | null, costUsd?: number | null) => Promise<void>,
  costUsd: number | null = null,
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
    costUsd !== null && costUsd > 0 ? Number(costUsd.toFixed(4)) : null,
  );
}
