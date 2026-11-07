import type { ToolContext } from "../mcp/tools.js";
import { rememberTarget } from "../mcp/tools.js";
import { fetchRecentReviews } from "../research/monid.js";
import { buildTarget } from "../research/targets.js";
import { signalPhrase } from "../research/signals.js";
import { checkOutreach } from "../outreach/guard.js";
import { sendOutreach } from "../outreach/send.js";
import type { OutreachDraft } from "../outreach/compose.js";
import type { Lead, Target } from "../types.js";

/**
 * The live signup: someone at our table (or in the audience) enters their game, and within about a
 * minute the agents read its newest Google Play reviews and email them what their players are
 * saying, plus free levels. They opted in on the form, so this email is expected.
 *
 * Each step writes an activity_log row, so the demo stage shows it happening.
 */
export interface LiveOutcome {
  leadId: string;
  audited: boolean;
  signal: string | null;
  email: "sent" | "drafted" | "blocked";
  reason: string | null;
}

export function composeWelcome(args: {
  lead: Pick<Lead, "contactName" | "company">;
  gameTitle: string | null;
  target: Target | null;
  sampleUrl: string | null;
  companyName: string;
  postalAddress: string;
}): OutreachDraft {
  const { lead, target, sampleUrl, companyName, postalAddress } = args;
  const first = lead.contactName?.split(" ")[0];
  const game = args.gameTitle ?? lead.company;
  const kind = target?.primarySignal ?? null;
  const n = kind && target ? target.signalCounts[kind] : 0;
  const quote = kind && target ? target.examples[0]?.quote : undefined;

  const evidence =
    kind && target
      ? [
          `We just read the ${target.reviewsAnalyzed} newest Google Play reviews of ${game}. ${n} of them ${signalPhrase(kind, n)}.`,
          ...(quote ? ["", `One player put it this way: "${quote}"`] : []),
          "",
          "That's exactly what we fix. We make puzzle levels and tune each one by having test players play it hundreds of times before it ships.",
        ]
      : target
        ? [
            `We read the ${target.reviewsAnalyzed} newest Google Play reviews of ${game}, and your players aren't complaining about difficulty. Nice work.`,
            "",
            "If you ever need more levels, we make puzzle levels and tune each one by having test players play it hundreds of times before it ships.",
          ]
        : ["We make puzzle levels and tune each one by having test players play it hundreds of times before it ships."];

  const lines = [
    first ? `Hi ${first},` : `Hi ${lead.company} team,`,
    "",
    `Thanks for stopping by the ${companyName} table.`,
    "",
    ...evidence,
    "",
    sampleUrl ? `Here are free levels our agents made today. Try one on your phone: ${sampleUrl}` : "Reply and we'll send you free levels made for your game.",
    "",
    "If you'd like levels made for your game, just reply. A person on our team reads every reply.",
    "",
    companyName,
    "",
    "—",
    `${companyName} is a small studio where AI agents design and test levels, and this email was written by one of them. You're getting it because you signed up at our table.`,
    postalAddress,
    `Reply "stop" and we won't email you again.`,
  ];
  return {
    subject: kind ? `What ${game}'s players are saying` : `Your free levels from ${companyName}`,
    body: lines.join("\n"),
    facts: target
      ? [
          { value: String(target.reviewsAnalyzed), source: "reviews analyzed (Monid)" },
          { value: String(n), source: `reviews matching ${kind ?? "none"}` },
        ]
      : [],
  };
}

export async function runLiveSignup(ctx: ToolContext, lead: Lead, gameTitle: string | null): Promise<LiveOutcome> {
  const log = (action: string, why: string | null, result: string | null) =>
    ctx.store.logActivity({ at: new Date().toISOString(), agent: "research", action, why, result, costUsd: null, human: false });

  let target: Target | null = null;
  if (lead.appId && ctx.monid) {
    await log(`reading ${gameTitle ?? lead.company}'s newest Google Play reviews`, "a studio signed up at our table", null);
    try {
      const reviews = await fetchRecentReviews(ctx.monid, lead.appId);
      target = buildTarget({ appId: lead.appId, title: gameTitle ?? lead.company, developer: lead.company, rating: null, downloads: null }, reviews);
      rememberTarget(target);
      await ctx.store.upsertLead({ ...lead, reason: target.reason });
      await log(`audited ${gameTitle ?? lead.company}`, target.reason, target.primarySignal ? `pitch angle: ${target.primarySignal}` : "no difficulty complaints");
    } catch (err) {
      await log(`couldn't read reviews for ${gameTitle ?? lead.company}`, err instanceof Error ? err.message.slice(0, 200) : "unknown error", "sending the welcome without evidence");
    }
  }

  const sampleUrl = ctx.config.SAMPLE_PLAY_URL ?? ctx.config.DEMO_PLAY_URL ?? null;
  const fresh = (await ctx.store.getLead(lead.id)) ?? lead;
  const draft = composeWelcome({
    lead: fresh,
    gameTitle,
    target,
    sampleUrl,
    companyName: ctx.config.COMPANY_NAME,
    postalAddress: ctx.config.COMPANY_POSTAL_ADDRESS ?? "",
  });
  const extraAllowedNumbers = [sampleUrl ?? "", ctx.config.COMPANY_POSTAL_ADDRESS ?? ""];

  const record = await sendOutreach(fresh, draft, {
    store: ctx.store,
    dailyCap: ctx.config.OUTREACH_DAILY_CAP,
    inboundDailyCap: ctx.config.INBOUND_DAILY_CAP,
    postalAddress: ctx.config.COMPANY_POSTAL_ADDRESS,
    extraAllowedNumbers,
    sender: ctx.mail,
    // A signup asked for this email, so it goes out even while cold outreach is still drafts-only.
    sendingEnabled: ctx.config.INBOUND_AUTO_REPLY === "1",
    agent: "sales-sender",
  });
  const blocked = record.status === "blocked" ? record.blockedReason : null;
  return { leadId: lead.id, audited: target !== null, signal: target?.primarySignal ?? null, email: record.status, reason: blocked };
}

/** For tests and the preview: what the guard says about a welcome draft without sending. */
export async function previewWelcome(ctx: ToolContext, lead: Lead, draft: OutreachDraft): Promise<string | null> {
  return checkOutreach(lead, draft, {
    store: ctx.store,
    dailyCap: ctx.config.OUTREACH_DAILY_CAP,
    postalAddress: ctx.config.COMPANY_POSTAL_ADDRESS,
    extraAllowedNumbers: [ctx.config.SAMPLE_PLAY_URL ?? ctx.config.DEMO_PLAY_URL ?? "", ctx.config.COMPANY_POSTAL_ADDRESS ?? ""],
  });
}
