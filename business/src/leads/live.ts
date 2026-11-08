import { randomUUID } from "node:crypto";
import type { ToolContext } from "../mcp/tools.js";
import { rememberTarget } from "../mcp/tools.js";
import { fetchRecentReviews, searchGooglePlay, storeName, type StoreGame } from "../research/monid.js";
import { buildTarget } from "../research/targets.js";
import { describeVerification, verifyTarget } from "../research/verify.js";
import { searchPlayPage } from "../research/play-search.js";
import type { RawReview } from "../research/signals.js";
import { signalPhrase } from "../research/signals.js";
import { checkOutreach } from "../outreach/guard.js";
import { idempotencyKey, sendOutreach } from "../outreach/send.js";
import type { OutreachDraft } from "../outreach/compose.js";
import type { Lead, Target } from "../types.js";
import { finish, isDone, step } from "./progress.js";
import * as E from "../email/html.js";
import { freeLevelsUrl, levelsQuery } from "../levels/public.js";

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
  replyTo?: string;
  /** "email": they emailed us asking for the audit (leads/email-in.ts), instead of using the form. */
  via?: "form" | "email";
}): OutreachDraft & { html: string } {
  const { lead, target, sampleUrl, companyName, postalAddress } = args;
  const byEmail = args.via === "email";
  const first = lead.contactName?.split(" ")[0];
  const game = args.gameTitle ?? lead.company;
  const kind = target?.primarySignal ?? null;
  const n = kind && target ? target.signalCounts[kind] : 0;
  const quote = kind && target ? target.examples[0]?.quote : undefined;

  const evidence =
    kind && target
      ? [
          `We read the ${target.reviewsAnalyzed} newest ${storeName(target.appId)} reviews of ${game}. ${n} of them ${signalPhrase(kind, n)}.`,
          ...(quote ? ["", `One player put it this way: "${quote}"`] : []),
          "",
          "That's exactly what we fix. We make puzzle levels and tune each one by having test players play it hundreds of times before it ships.",
        ]
      : target
        ? [
            `We read the ${target.reviewsAnalyzed} newest ${storeName(target.appId)} reviews of ${game}, and your players aren't complaining about difficulty. Nice work.`,
            "",
            "If you ever need more levels, we make puzzle levels and tune each one by having test players play it hundreds of times before it ships.",
          ]
        : ["We make puzzle levels and tune each one by having test players play it hundreds of times before it ships."];

  const lines = [
    first ? `Hi ${first},` : `Hi ${lead.company} team,`,
    "",
    byEmail ? (kind ? "Thanks for writing to us. Here's what your players are saying." : "Thanks for writing to us.") : `Thanks for stopping by the ${companyName} table.`,
    "",
    ...evidence,
    "",
    sampleUrl ? `Here are free levels our agents designed and tested. Play them on your phone: ${sampleUrl}` : "Reply and we'll send you free levels made for your game.",
    "",
    "If you'd like levels made for your game, just reply. A person on our team reads every reply.",
    "",
    companyName,
    "",
    "—",
    `${companyName} is a small studio where AI agents design and test levels, and this email was written by one of them. You're getting it because you ${byEmail ? "emailed us for it" : "signed up at our table"}.`,
    postalAddress,
    `Reply "stop" and we won't email you again.`,
  ];
  const reviews = target ? `newest ${storeName(target.appId)} reviews` : "";
  const html = E.layout({
    preheader: kind && target ? `${n} of your ${target.reviewsAnalyzed} ${reviews} point to the same thing.` : `Your free levels from ${companyName}.`,
    companyName,
    postalAddress,
    footerReason: byEmail ? "You're getting it because you emailed us for it." : "You're getting it because you signed up for free levels.",
    body: [
      E.eyebrow(kind ? "Your players, in their words" : "Welcome", kind ? E.C.yellow : E.C.green),
      E.heading(kind ? `What ${game}'s players are saying` : byEmail ? `Thanks for writing, ${first ?? lead.company}` : `Thanks for stopping by, ${first ?? lead.company}`),
      ...(kind && target
        ? [
            E.panel(E.bigStat(`${n} of ${target.reviewsAnalyzed}`, `of the ${reviews} of ${game} ${signalPhrase(kind, n)}.`)),
            ...(quote ? [E.quote(quote)] : []),
            E.text("That's exactly what we fix. We design levels in your game's style and play each one hundreds of times until it hits the difficulty you want, then check it on a real iPhone."),
          ]
        : target
          ? [E.panel(E.bigStat(`${target.reviewsAnalyzed}`, `newest ${storeName(target.appId)} reviews of ${game} read. No difficulty complaints. Nice work.`, E.C.green)),
             E.text("If you ever need more levels, we design them in your game's style and tune each one before it ships.")]
          : [E.text("We design levels in your game's style and play each one hundreds of times until it hits the difficulty you want, then check it on a real iPhone.")]),
      ...(sampleUrl ? [E.text("Here are free levels our agents designed and tested. They play right in your phone's browser.")] : []),
      sampleUrl
        ? E.button("Play your free levels", sampleUrl)
        : E.button("Reply for your free levels", `mailto:${args.replyTo ?? "levelai@agentmail.to"}?subject=${encodeURIComponent(`Free levels for ${game}`)}`),
      E.text("A person on our team reads every reply.", { color: E.C.muted, size: 14 }),
    ].join(""),
  });
  return {
    html,
    subject: kind ? `What ${game}'s players are saying` : `Your free levels from ${companyName}`,
    body: lines.join("\n"),
    facts: target
      ? [
          ...(quote ? (quote.match(/\d[\d,.]*\d|\d/g) ?? []).map((v) => ({ value: v.replace(/,/g, ""), source: "the quoted review" })) : []),
          { value: String(target.reviewsAnalyzed), source: "reviews analyzed (Monid)" },
          { value: String(n), source: `reviews matching ${kind ?? "none"}` },
        ]
      : [],
  };
}

/**
 * The welcome email's play link. A team-set SAMPLE_PLAY_URL wins; otherwise the newest real match3
 * pack or accepted levels on levelai.vercel.app/play; otherwise DEMO_PLAY_URL; otherwise null, and
 * the email asks them to reply for levels instead. It never links to a page with nothing to play.
 */
export async function samplePlayUrl(ctx: ToolContext, findFreeLevels: () => Promise<string | null>): Promise<string | null> {
  if (ctx.config.SAMPLE_PLAY_URL) return ctx.config.SAMPLE_PLAY_URL;
  return (await findFreeLevels().catch(() => null)) ?? ctx.config.DEMO_PLAY_URL ?? null;
}

/** The whole research step (store lookup, reviews, quote check) gets this long before the email goes without it. */
export const RESEARCH_BUDGET_MS = 30_000;
/** Finding a typed game name on Google Play (about 5 s alone; 9 s wasn't enough with 5 at once on Nov 7). */
const LOOKUP_MS = 12_000;
/** The free-levels link lookup (one database query). */
const FREE_LEVELS_MS = 4_000;
/** The model check of the quotes runs only when at least this much of the budget is left, and for at most VERIFY_MAX_MS. */
const VERIFY_MIN_MS = 5_000;
const VERIFY_MAX_MS = 9_000;
/** Someone who signs up again gets another welcome, up to this many per address a day (in memory). */
const WELCOMES_PER_ADDRESS_PER_DAY = 3;

const welcomesByAddress = new Map<string, number[]>();
const DAY_MS = 24 * 60 * 60 * 1000;

function recentWelcomes(email: string): number {
  const cutoff = Date.now() - DAY_MS;
  const kept = (welcomesByAddress.get(email) ?? []).filter((t) => t > cutoff);
  welcomesByAddress.set(email, kept);
  return kept.length;
}

/** Test helper. */
export function resetWelcomeCounts(): void {
  welcomesByAddress.clear();
}

/** What the page says when the email couldn't go: the email-in route always works (leads/email-in.ts). */
const failedText = (ctx: ToolContext): string =>
  `We couldn't email you just now. Email ${ctx.config.AGENTMAIL_INBOX_ID ?? "levelai@agentmail.to"} with your game's name and we'll reply with your audit in about a minute`;

class TimedOut extends Error {}

let playSearch: (query: string, timeoutMs: number) => Promise<StoreGame | null> = (q, ms) => searchPlayPage(q, ms);
/** Test helper: replaces the store-page lookup (the default fetches play.google.com). */
export function setPlaySearch(fn: typeof playSearch | null): void {
  playSearch = fn ?? ((q, ms) => searchPlayPage(q, ms));
}

/** The first promise to resolve with a value; null when all resolve empty; rejects only when all fail. */
function firstMatch<T>(ps: Array<Promise<T | null>>): Promise<T | null> {
  return new Promise((resolve, reject) => {
    let left = ps.length;
    let failed = 0;
    let lastErr: unknown = null;
    for (const p of ps) {
      p.then(
        (v) => { if (v) resolve(v); else if (--left === 0) resolve(null); },
        (err) => { failed++; lastErr = err; if (--left === 0) (failed === ps.length ? reject(lastErr) : resolve(null)); },
      );
    }
  });
}

/** Resolves or rejects with `p`, or rejects with TimedOut after `ms`. */
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  if (ms <= 0) return Promise.reject(new TimedOut(`no time left for ${what}`));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimedOut(`${what} took longer than ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}

const shortError = (err: unknown): string => (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").slice(0, 200);

export interface LiveSignupOptions {
  /** This signup's own app id, from its store link. Defaults to the lead's (a repeat signup's lead can hold an older one). */
  appId?: string | null;
  /** Defaults to RESEARCH_BUDGET_MS. */
  researchBudgetMs?: number;
  /** A team member's test signup: logged as one, so the feed and the numbers can tell. */
  teamTest?: boolean;
  /** They emailed us for this (leads/email-in.ts): answer their message in its thread. */
  replyToMessageId?: string;
}

interface Research {
  target: Target | null;
  /** The game's name for the email: the store's title when we found it, else what they typed. */
  title: string;
}

/**
 * Reads the game's newest reviews within `budgetMs`. A store link is used as given; a bare game name
 * is looked up on Google Play first (and only a matching title counts). If the link's reviews come
 * back empty (a typo'd link), the typed name is tried. Quotes the keyword match found are checked by
 * a model when there's time. Anything slow or failing ends with no evidence, never a guess.
 */
async function research(
  ctx: ToolContext,
  lead: Lead,
  typedTitle: string | null,
  appIdIn: string | null,
  budgetMs: number,
  why: string,
): Promise<Research> {
  const log = (action: string, reason: string | null, result: string | null) =>
    ctx.store.logActivity({ at: new Date().toISOString(), agent: "research", action, why: reason, result, costUsd: null, human: false });
  const fallbackTitle = typedTitle ?? lead.company;
  const monid = ctx.monid;
  if (!monid || (!appIdIn && !typedTitle)) return { target: null, title: fallbackTitle };

  const deadline = Date.now() + budgetMs;
  const left = () => deadline - Date.now();
  let title = fallbackTitle;
  let triedName = false;

  const lookUpName = async (): Promise<StoreGame | null> => {
    triedName = true;
    if (!typedTitle) return null;
    step(lead.id, `Finding ${typedTitle} on Google Play`);
    const ms = Math.min(LOOKUP_MS, left());
    try {
      // Two lookups race; the first match wins. Both missing (or failing) means no match.
      const found = await within(firstMatch([playSearch(typedTitle, ms), searchGooglePlay(monid, typedTitle, ms)]), ms, "the store search");
      if (found) {
        await log(`found ${found.title} on Google Play`, `searched for "${typedTitle}"`, found.appId);
        return found;
      }
      await log(`couldn't find ${typedTitle} on Google Play`, `no listing's title matches "${typedTitle}"`, "sending the welcome without review evidence");
      step(lead.id, `We couldn't find ${typedTitle} on Google Play, so we'll skip the reviews`);
    } catch (err) {
      await log(`couldn't search Google Play for ${typedTitle}`, shortError(err), "sending the welcome without review evidence");
      step(lead.id, "The store search didn't answer in time, so we'll skip the reviews");
    }
    return null;
  };

  let game: StoreGame | null = appIdIn
    ? { appId: appIdIn, title: fallbackTitle, developer: lead.company, rating: null, downloads: null }
    : await lookUpName();

  while (game) {
    title = game.title;
    const store = storeName(game.appId);
    step(lead.id, `Reading ${title}'s newest ${store} reviews`);
    await log(`reading ${title}'s newest ${store} reviews`, why, null);
    let reviews: RawReview[];
    try {
      reviews = await within(fetchRecentReviews(monid, game.appId, 150, left()), left(), "reading the reviews");
    } catch (err) {
      const slow = err instanceof TimedOut || /ETIMEDOUT|killed|SIGKILL|timed out/i.test(shortError(err));
      await log(`couldn't read reviews for ${title}`, slow ? `took longer than ${Math.round(budgetMs / 1000)} s` : shortError(err), "sending the welcome without review evidence");
      step(lead.id, slow ? "Reading the reviews took too long, so we'll skip that part" : "Couldn't read the reviews this time, so we'll skip that part");
      return { target: null, title };
    }
    const analyzed = reviews.filter((r) => r.review_text?.trim()).length;
    if (analyzed === 0) {
      await log(`couldn't read reviews for ${title}`, "no reviews came back for that listing", "sending the welcome without review evidence");
      // A typo'd link: try the name they typed, if there's time for a lookup and a read.
      if (appIdIn && typedTitle && !triedName && left() > LOOKUP_MS + 8_000) {
        game = await lookUpName();
        if (game && game.appId === appIdIn) game = null;
        continue;
      }
      step(lead.id, "We couldn't find reviews for that listing, so we'll skip that part");
      return { target: null, title };
    }

    let target = buildTarget(game, reviews);
    if (target.primarySignal && ctx.config.OPENAI_API_KEY && left() >= VERIFY_MIN_MS) {
      step(lead.id, "Double-checking each quote");
      const ms = Math.min(VERIFY_MAX_MS, left());
      try {
        const checked = await within(
          verifyTarget(game, reviews, target, {
            apiKey: ctx.config.OPENAI_API_KEY, model: ctx.config.OPENAI_MODEL, dailyCalls: ctx.config.OPENAI_DAILY_CALLS, timeoutMs: ms, recall: false,
          }),
          ms,
          "the quote check",
        );
        target = checked.target;
        const line = describeVerification(checked.report, title, 1);
        if (line) await log(line.action, line.why, line.result);
      } catch (err) {
        await log(`couldn't double-check the quotes for ${title}`, shortError(err), "used the keyword match as is");
      }
    }
    rememberTarget(target);
    await ctx.store.upsertLead({ ...lead, reason: target.reason });
    await log(`audited ${title}`, target.reason, target.primarySignal ? `pitch angle: ${target.primarySignal}` : "no difficulty complaints");
    step(lead.id, target.primarySignal ? `Found it: ${target.reason}` : `Read ${target.reviewsAnalyzed} reviews: no difficulty complaints`);
    return { target, title };
  }
  return { target: null, title };
}

/**
 * The whole live signup: research within its time budget, then the welcome email, which always goes
 * (with evidence or without). The page's progress always ends, even if something throws.
 */
export async function runLiveSignup(
  ctx: ToolContext,
  lead: Lead,
  gameTitle: string | null,
  findFreeLevels: () => Promise<string | null> = () => freeLevelsUrl(levelsQuery(ctx.config.DATABASE_URL), ctx.config.SITE_URL),
  opts: LiveSignupOptions = {},
): Promise<LiveOutcome> {
  const runId = randomUUID();
  try {
    return await welcome(ctx, lead, gameTitle, findFreeLevels, opts, runId);
  } catch (err) {
    await ctx.store.logActivity({
      at: new Date().toISOString(), agent: "sales-sender", action: `couldn't send the welcome email to ${lead.company}`,
      why: shortError(err), result: "the signup is saved; a person will follow up", costUsd: null, human: false,
    }).catch(() => undefined);
    return { leadId: lead.id, audited: false, signal: null, email: "blocked", reason: shortError(err) };
  } finally {
    if (!isDone(lead.id)) finish(lead.id, failedText(ctx), false);
  }
}

async function welcome(
  ctx: ToolContext,
  lead: Lead,
  gameTitle: string | null,
  findFreeLevels: () => Promise<string | null>,
  opts: LiveSignupOptions,
  runId: string,
): Promise<LiveOutcome> {
  const appId = opts.appId === undefined ? lead.appId : opts.appId;
  const { target, title } = await research(
    ctx, lead, gameTitle, appId, opts.researchBudgetMs ?? RESEARCH_BUDGET_MS,
    opts.replyToMessageId ? (opts.teamTest ? "a team test email" : "a studio emailed us") : opts.teamTest ? "a team test signup" : "a studio signed up",
  );

  step(lead.id, "Writing your email");
  const fallbackLink = ctx.config.SAMPLE_PLAY_URL ?? ctx.config.DEMO_PLAY_URL ?? null;
  const sampleUrl = await within(samplePlayUrl(ctx, findFreeLevels), FREE_LEVELS_MS, "the free levels lookup").catch(() => fallbackLink);
  const fresh = (await ctx.store.getLead(lead.id)) ?? lead;

  const address = fresh.email ? fresh.email.trim().toLowerCase() : "";
  if (recentWelcomes(address) >= WELCOMES_PER_ADDRESS_PER_DAY) {
    const reason = `Already sent ${WELCOMES_PER_ADDRESS_PER_DAY} welcome emails to this address today.`;
    await ctx.store.logActivity({ at: new Date().toISOString(), agent: "sales-sender", action: `outreach blocked for ${fresh.company}`, why: reason, result: "not sent", costUsd: null, human: false });
    finish(lead.id, "We've already emailed you today. Check your inbox", false);
    return { leadId: lead.id, audited: target !== null, signal: target?.primarySignal ?? null, email: "blocked", reason };
  }

  const compose = (t: Target | null) => composeWelcome({
    lead: fresh, gameTitle: title, target: t, sampleUrl,
    companyName: ctx.config.COMPANY_NAME, postalAddress: ctx.config.COMPANY_POSTAL_ADDRESS ?? "", replyTo: ctx.config.AGENTMAIL_INBOX_ID,
    via: opts.replyToMessageId ? "email" : "form",
  });
  // Numbers in names they typed or the store's title ("2048", "Block Blast 3D") come from them, not from us.
  const extraAllowedNumbers = [sampleUrl ?? "", ctx.config.COMPANY_POSTAL_ADDRESS ?? "", title, gameTitle ?? "", fresh.company, fresh.contactName ?? ""];
  const guard = {
    store: ctx.store,
    dailyCap: ctx.config.OUTREACH_DAILY_CAP,
    inboundDailyCap: ctx.config.INBOUND_DAILY_CAP,
    postalAddress: ctx.config.COMPANY_POSTAL_ADDRESS,
    extraAllowedNumbers,
    welcome: true,
  };
  let evidence = target;
  let draft = compose(evidence);
  // If the evidence version can't pass the number check, the plain version goes instead of nothing.
  if (evidence && /numbers with no source/i.test((await checkOutreach(fresh, draft, guard)) ?? "")) {
    evidence = null;
    draft = compose(null);
  }

  // The feed's "outreach sent" row shows this reason, so it says what this email is based on.
  const reason = evidence ? evidence.reason : `Signed up for free levels for ${title}; this email has no review evidence.`;
  let record;
  try {
    record = await sendOutreach({ ...fresh, reason }, draft, {
      ...guard,
      sender: ctx.mail,
      // A signup asked for this email, so it goes out even while cold outreach is still drafts-only.
      sendingEnabled: ctx.config.INBOUND_AUTO_REPLY === "1",
      agent: "sales-sender",
      // One key per signup run: AgentMail's retries reuse it, and a later signup gets its own.
      idempotencyKey: idempotencyKey("welcome", lead.id, runId),
      ...(opts.replyToMessageId ? { replyToMessageId: opts.replyToMessageId } : {}),
    });
  } catch (err) {
    const why = shortError(err);
    await ctx.store.logActivity({
      at: new Date().toISOString(), agent: "sales-sender", action: `couldn't send the welcome email to ${fresh.company}`,
      why, result: "the signup is saved; a person will follow up", costUsd: null, human: false,
    });
    finish(lead.id, failedText(ctx), false);
    return { leadId: lead.id, audited: target !== null, signal: target?.primarySignal ?? null, email: "blocked", reason: why };
  }
  const blocked = record.status === "blocked" ? record.blockedReason : null;
  if (record.status === "sent") {
    welcomesByAddress.set(address, [...(welcomesByAddress.get(address) ?? []), Date.now()]);
    finish(lead.id, "Email sent. Check your inbox");
  } else if (record.status === "drafted") finish(lead.id, "Your email is written and waiting to send");
  else finish(lead.id, failedText(ctx), false);
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
