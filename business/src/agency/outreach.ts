import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "../mcp/tools.js";
import type { Lead } from "../types.js";
import type { MonidRunner } from "../research/monid.js";
import { monidSpentUsd } from "../research/monid.js";
import { numbersIn, type OutreachDraft } from "../outreach/compose.js";
import { checkOutreach } from "../outreach/guard.js";
import { idempotencyKey } from "../outreach/send.js";
import * as E from "../email/html.js";
import { GENRES } from "../levels/deliver-pack.js";
import { buildFacts, SAMPLE_LEVELS } from "./facts.js";
import { chatJson } from "./openai.js";
import type { AgencyRecord, AgencyStore } from "./store.js";
import {
  clutchPage, clutchProfile, fetchSite, hunterGeneric, looksLikeGameStudio, pickAgencyAddress, rankCandidates, siteDomain,
  type ClutchProfile, type SiteInfo,
} from "./discover.js";

/**
 * Cold outreach to game-development agencies: find one in Clutch's game development directory, read
 * what they do from their own site, find a role-based address, and offer a concrete free trial (a
 * 5-level sample for one of their clients' puzzle games, or an iPhone playtest of any build).
 * Every email passes the same guard as studio outreach (opt-outs, postal address, opt-out line,
 * numbers with a source, the shared daily cap), plus the agency cap.
 */
export const AGENT = "agency-sales";
export const DEFAULT_AGENCY_DAILY_CAP = 10;

export function agencyDailyCap(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.AGENCY_DAILY_CAP);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_AGENCY_DAILY_CAP;
}

const log = (ctx: ToolContext, action: string, why: string | null, result: string | null, costUsd: number | null = null) =>
  ctx.store.logActivity({ at: new Date().toISOString(), agent: AGENT, action, why, result, costUsd, human: false });

/** Real agency emails in the last 24 hours (the test agency doesn't count). */
export async function agencyEmailsSince(ctx: ToolContext, sinceIso: string): Promise<number> {
  const rows = await ctx.store.listActivity(1000);
  return rows.filter((a) => a.agent === AGENT && a.at >= sinceIso && /^emailed agency /.test(a.action)).length;
}

// ---------- the email ----------

export interface AgencyEmailInput {
  company: string;
  /** What they do, as a verb phrase after "your team", e.g. "builds mobile games and game art for clients". */
  about: string | null;
  /** Fallback: their Clutch service lines. */
  services: string[];
  sender: { name: string; company: string; postalAddress: string; site: string };
  genres: string[];
}

export function composeAgencyEmail(input: AgencyEmailInput): OutreachDraft {
  const { company, about, services, sender } = input;
  const what = about
    ? `From your site, it looks like your team ${about.replace(/[.\s]+$/, "")}.`
    : services.length
    ? `Your Clutch listing puts your work in ${joinList(services.slice(0, 3).map((s) => s.toLowerCase()))}.`
    : null;
  const genres = joinList(input.genres);
  const lines = [
    `Hi ${company} team,`,
    "",
    `I found ${company} in Clutch's game development directory.${what ? ` ${what}` : ""}`,
    "",
    `I'm writing from ${sender.company}, a small puzzle-level studio run by AI agents. Our agents design puzzle levels and play each one with bots until it lands on a target win rate, and they can play any build on a real iPhone in the cloud.`,
    "",
    `A concrete offer, free: we'll build and bot-test a ${SAMPLE_LEVELS}-level sample for one of your clients' puzzle games, or run an iPhone playtest of any build and send you the report. Today we build in ${genres}. Reply with the genre and a link to the game, and the sample or playtest starts from your reply.`,
    "",
    `You can play levels our agents made at ${sender.site}/games, and our prices are at ${sender.site}/pricing.`,
    "",
    sender.name,
    sender.company,
    "",
    "—",
    `${sender.company} is a small studio where AI agents design and test levels, and this email was written by one of them.`,
    sender.postalAddress,
    `Reply "stop" and we won't email you again.`,
  ];
  const body = lines.join("\n");
  const html = E.layout({
    preheader: `A free ${SAMPLE_LEVELS}-level sample for one of your clients' puzzle games, or a free iPhone playtest.`,
    companyName: sender.company, postalAddress: sender.postalAddress,
    footerReason: `You're getting it because ${company} is listed in Clutch's game development directory.`,
    body: [
      E.eyebrow("Free trial for agencies"),
      E.heading(`Hi ${company} team`),
      E.text(`I found ${company} in Clutch's game development directory.${what ? ` ${what}` : ""}`),
      E.text(`I'm writing from ${sender.company}, a small puzzle-level studio run by AI agents. Our agents design puzzle levels and play each one with bots until it lands on a target win rate, and they can play any build on a real iPhone in the cloud.`),
      E.panel(E.rows([
        E.checkRow(`${SAMPLE_LEVELS}-level sample for a client's puzzle game`, "Free", "pass"),
        E.checkRow("iPhone playtest of any build, with a report", "Free", "pass"),
        E.checkRow("Genres today", genres, "info"),
      ].join(""))),
      E.text("Reply with the genre and a link to the game, and the sample or playtest starts from your reply."),
      E.button("Play levels our agents made", `${sender.site}/games`),
      E.text(`Prices: ${sender.site}/pricing`, { color: E.C.muted }),
      E.text(`${sender.name}, ${sender.company}`, { color: E.C.muted }),
    ].join(""),
  });
  return {
    subject: `A free ${SAMPLE_LEVELS}-level puzzle sample for one of ${company}'s clients`,
    body,
    html,
    facts: [
      { value: String(SAMPLE_LEVELS), source: "free sample size (agency/facts.ts)" },
      ...numbersIn(company).map((value) => ({ value, source: "the agency's own name" })),
      ...numbersIn(genres).map((value) => ({ value, source: "our genre names (match-3)" })),
    ],
  };
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** Rules for the one-line "what they do": their words, no numbers, no superlatives. */
export function acceptableAbout(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
  if (t.length < 12 || t.length > 160) return null;
  if (/\d/.test(t)) return null;
  if (/\b(best|top|leading|#1|award|world-class|premier|number one|trusted by)\b/i.test(t)) return null;
  if (/[<>{}@]|https?:/i.test(t)) return null;
  return t;
}

/** One clause on what the agency does, written from their own site text. Null when nothing fits the rules. */
export async function describeAgency(
  ctx: ToolContext,
  args: { company: string; profile: ClutchProfile | null; site: SiteInfo | null },
  fetchImpl?: typeof fetch,
): Promise<string | null> {
  const key = ctx.config.OPENAI_API_KEY;
  const source = [args.site?.title, args.site?.description, args.site?.text.slice(0, 1500)].filter(Boolean).join("\n");
  if (!key || !source.trim()) return null;
  const r = await chatJson({ apiKey: key, model: ctx.config.OPENAI_MODEL, fetchImpl }, {
    system:
      "You write one short clause describing what a company does, using only facts stated in the text given. " +
      "It completes the sentence 'From your site, it looks like your team ...', so start with a verb in third person (e.g. 'builds', 'makes', 'develops'). " +
      "Plain words, 6 to 20 words, no numbers, no superlatives or praise, no client names. If the text doesn't say what they do, return an empty string.",
    user: JSON.stringify({ company: args.company, clutch_services: args.profile?.services ?? [], site_text: source }),
    schemaName: "agency_about",
    schema: { type: "object", additionalProperties: false, required: ["clause"], properties: { clause: { type: "string" } } },
    maxTokens: 1500,
  });
  if (!r.ok) return null;
  return acceptableAbout((r.value as { clause?: string }).clause ?? null);
}

// ---------- the email provider's new-recipient limit ----------

/**
 * AgentMail caps a new account at 10 distinct new recipients in its first 24 hours (25 in its first
 * week). Replies to people who wrote to us first still go. When a first email hits that limit, cold
 * agency email pauses until the time the provider names ("The limit rises to 25 at <ISO time>"), or
 * an hour if it names none; the pause survives a restart (temp file). Discovery is skipped while
 * paused, so no Monid money is spent on agencies we can't email.
 */
const PAUSE_FILE = join(tmpdir(), "levelai-agency-send-pause.json");
// Tests never read or write the live server's pause file.
const PERSIST_PAUSE = !process.env.VITEST;
let pausedUntil: number | null = (() => {
  if (!PERSIST_PAUSE) return null;
  try {
    const v = (JSON.parse(readFileSync(PAUSE_FILE, "utf8")) as { until?: number }).until;
    return typeof v === "number" ? v : null;
  } catch {
    return null;
  }
})();

export function sendPausedUntil(now = new Date()): Date | null {
  return pausedUntil !== null && pausedUntil > now.getTime() ? new Date(pausedUntil) : null;
}

export function setSendPause(until: Date | null, persist = true): void {
  pausedUntil = until ? until.getTime() : null;
  if (!persist || !PERSIST_PAUSE) return;
  try {
    writeFileSync(PAUSE_FILE, JSON.stringify({ until: pausedUntil }));
  } catch {
    // Best effort; the in-memory pause still holds.
  }
}

/** When an email-provider error is a sending or new-recipient limit: the time it lifts (or an hour from now). Null otherwise. */
export function providerLimitUntil(err: unknown, now = new Date()): Date | null {
  const e = err as { name?: unknown; message?: unknown; status?: unknown; statusCode?: unknown };
  const message = typeof e?.message === "string" ? e.message : String(err);
  const status = typeof e?.status === "number" ? e.status : typeof e?.statusCode === "number" ? e.statusCode : null;
  if (!/recipient limit|send(ing)? limit|limit exceeded|daily limit/i.test(message) && !(status === 429 && /limit/i.test(message))) return null;
  const at = message.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/);
  const t = at ? Date.parse(at[0]) : NaN;
  return Number.isFinite(t) && t > now.getTime() ? new Date(t) : new Date(now.getTime() + 3600_000);
}

export const formatPacific = (d: Date): string =>
  `${d.toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric", minute: "2-digit" })} PT`;

// ---------- sending ----------

export type SendResult = { status: "sent" | "drafted" | "blocked" | "paused"; reason: string | null; messageId: string | null };

/**
 * Checks and sends one first email to an agency lead. The guard is the studio outreach guard. The
 * idempotency key includes the conversation start, so a demo restart sends a fresh email but a
 * retry of the same one doesn't. A provider limit pauses agency email (status "paused").
 */
export async function sendAgencyEmail(
  ctx: ToolContext,
  lead: Lead,
  draft: OutreachDraft,
  opts: { internalTest: boolean; startedAt: string; domain: string | null; now?: Date },
): Promise<SendResult> {
  const label = opts.internalTest ? `the test agency (${lead.company})` : `agency ${lead.company}`;
  const paused = sendPausedUntil(opts.now);
  if (paused) return { status: "paused", reason: `email provider limit; paused until ${formatPacific(paused)}`, messageId: null };
  const extra = [ctx.config.COMPANY_POSTAL_ADDRESS ?? "", lead.company];
  const blocked = await checkOutreach(lead, draft, {
    store: ctx.store, dailyCap: ctx.config.OUTREACH_DAILY_CAP, postalAddress: ctx.config.COMPANY_POSTAL_ADDRESS, extraAllowedNumbers: extra,
  });
  if (blocked) {
    await log(ctx, `held the email to ${label}`, blocked, "not sent");
    return { status: "blocked", reason: blocked, messageId: null };
  }
  if (ctx.config.OUTREACH_SEND !== "1" || !ctx.mail) {
    await log(ctx, `drafted an email to ${label}`, "sending is turned off (OUTREACH_SEND=0)", "draft only");
    return { status: "drafted", reason: null, messageId: null };
  }
  let messageId: string;
  try {
    ({ messageId } = await ctx.mail.send({
      to: lead.email!, subject: draft.subject, text: draft.body, ...(draft.html ? { html: draft.html } : {}),
      idempotencyKey: idempotencyKey("agency-first", lead.id, opts.startedAt),
    }));
  } catch (err) {
    const until = providerLimitUntil(err, opts.now);
    if (until) {
      setSendPause(until);
      await log(ctx, `email provider limit reached; paused until ${formatPacific(until)}`, `the first email to ${label} was refused: new-recipient limit on a new account`, "agency email paused; it resumes on its own");
      return { status: "paused", reason: `email provider limit; paused until ${formatPacific(until)}`, messageId: null };
    }
    const why = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").slice(0, 200);
    await log(ctx, `couldn't email ${label}`, why, "not sent; will retry next cycle");
    return { status: "blocked", reason: why, messageId: null };
  }
  await ctx.store.addOutreach({ leadId: lead.id, to: lead.email!, subject: draft.subject, body: draft.body, status: "sent", blockedReason: null, providerMessageId: messageId });
  await ctx.store.setStage(lead.id, "emailed");
  await log(
    ctx,
    opts.internalTest ? `emailed the test agency: ${lead.company}` : `emailed agency ${lead.company}${opts.domain ? ` (${opts.domain})` : ""}`,
    opts.internalTest ? "internal test: a teammate plays the agency, so it's kept out of the numbers" : "offered a free 5-level sample or a free iPhone playtest",
    `message ${messageId}`,
  );
  return { status: "sent", reason: null, messageId };
}

/** Marks a studios row as an agency lead (or the internal test) and records its domain. */
export async function tagLead(ctx: ToolContext, leadId: string, source: "agency_research" | "internal_test", domain: string | null): Promise<void> {
  if (!ctx.db) return;
  await ctx.db(`update studios set source = $2 where studio_id::text = $1 and ($2 = 'internal_test' or coalesce(source, '') <> 'internal_test')`, [leadId, source]);
  if (domain) await ctx.db(`update studios set domain = $2 where studio_id::text = $1 and domain is null`, [leadId, domain]).catch(() => undefined); // domain is unique; another row may hold it
}

/** True when any lead already has this domain or an address on it. */
async function domainKnown(ctx: ToolContext, agencies: AgencyStore, domain: string): Promise<boolean> {
  if (await agencies.byDomain(domain)) return true;
  if (ctx.db) {
    const r = await ctx.db(`select 1 from studios where domain = $1 or lower(contact_email) like $2 limit 1`, [domain, `%@${domain}`]);
    if (r.length) return true;
  } else {
    if ((await ctx.store.listLeads()).some((l) => l.email?.toLowerCase().endsWith(`@${domain}`))) return true;
  }
  return false;
}

// ---------- the cycle ----------

export interface CycleDeps {
  agencies: AgencyStore;
  monid: MonidRunner | null;
  fetchImpl?: typeof fetch;
  now?: Date;
  /** Cache Clutch search pages in a temp file for a day (default true; tests turn it off). */
  cache?: boolean;
}

export interface CycleOptions {
  /** Emails this run (default 2, so a 30-minute loop spreads the daily cap out). */
  perRun?: number;
  /** Most Clutch profiles bought this run ($0.02 each). */
  maxProfiles?: number;
  /** Search pages to walk before giving up this run. */
  maxPages?: number;
  cap?: number;
}

let lastPauseLog = 0;

export async function runAgencyCycle(ctx: ToolContext, deps: CycleDeps, opts: CycleOptions = {}): Promise<{ sent: number; looked: number; reason: string | null; emailed: Array<{ company: string; domain: string }> }> {
  const { agencies, monid } = deps;
  const emailed: Array<{ company: string; domain: string }> = [];
  if (!monid) return { sent: 0, looked: 0, reason: "Monid not configured", emailed };
  await agencies.ensure();
  const now = deps.now ?? new Date();
  const cap = opts.cap ?? agencyDailyCap();
  const already = await agencyEmailsSince(ctx, new Date(now.getTime() - 24 * 3600_000).toISOString());
  if (already >= cap) {
    await log(ctx, "agency outreach paused for today", `daily cap of ${cap} agency emails reached`, "nothing sent");
    return { sent: 0, looked: 0, reason: "daily cap", emailed };
  }
  const paused = sendPausedUntil(now);
  if (paused) {
    // Log the pause once an hour at most, so the feed shows it without filling up.
    if (now.getTime() - lastPauseLog > 3600_000) {
      lastPauseLog = now.getTime();
      await log(ctx, `agency outreach paused until ${formatPacific(paused)}`, "email provider limit on new recipients for a new account", "no agencies looked up or emailed; resumes on its own");
    }
    return { sent: 0, looked: 0, reason: "email provider limit", emailed };
  }
  const perRun = Math.min(opts.perRun ?? 2, cap - already);
  const maxProfiles = opts.maxProfiles ?? 4;
  const spentBefore = monidSpentUsd();
  const facts = buildFacts(ctx.config, { stripe: Boolean(ctx.stripe) });
  const knownNames = new Set((await ctx.store.listLeads()).map((l) => l.company.toLowerCase()));
  let looked = 0;
  let sent = 0;
  const draftFor = (company: string, about: string | null, services: string[]) => composeAgencyEmail({
    company, about, services,
    sender: { name: "Noel Sason", company: ctx.config.COMPANY_NAME, postalAddress: ctx.config.COMPANY_POSTAL_ADDRESS ?? "", site: facts.links.site },
    genres: facts.openGenres.map((g) => GENRES[g].label),
  });

  // First, agencies already found whose email didn't go (a refused or paused send). No new lookups.
  for (const rec of await agencies.pending()) {
    if (sent >= perRun) break;
    const lead = rec.leadId ? await ctx.store.getLead(rec.leadId) : null;
    if (!lead || lead.stage !== "found") {
      await agencies.save({ ...rec, status: lead && lead.stage !== "found" ? "emailed" : "skipped", detail: lead ? rec.detail : "lead is gone" });
      continue;
    }
    const res = await sendAgencyEmail(ctx, lead, draftFor(rec.company, rec.about, rec.services ? rec.services.split(", ") : []), { internalTest: false, startedAt: rec.startedAt, domain: rec.domain, now });
    if (res.status === "sent") {
      sent++;
      emailed.push({ company: rec.company, domain: rec.domain ?? "" });
      await agencies.save({ ...rec, status: "emailed" });
    }
    if (res.status === "paused") return { sent, looked, reason: "email provider limit", emailed };
  }

  await log(ctx, "looking for game-development agencies", "Clutch's game development directory", null);
  for (let page = 0; page < (opts.maxPages ?? 4) && sent < perRun && looked < maxProfiles; page++) {
    let list;
    try {
      list = await clutchPage(monid, page, { cache: deps.cache });
    } catch (err) {
      await log(ctx, "couldn't read the agency directory", err instanceof Error ? err.message.slice(0, 160) : "unknown error", "will try again next cycle");
      break;
    }
    if (!list.length) break;
    for (const c of rankCandidates(list)) {
      if (sent >= perRun || looked >= maxProfiles) break;
      if (knownNames.has(c.name.toLowerCase()) || (await agencies.bySlug(c.slug))) continue;
      looked++;
      const skip = async (detail: string, domain: string | null = null, website: string | null = null) => {
        await agencies.save({ leadId: null, slug: c.slug, domain, company: c.name, about: null, services: null, website, contactEmail: null, internalTest: false, status: "skipped", detail });
        await log(ctx, `skipped agency ${c.name}`, detail, "not emailed");
      };
      const profile = await clutchProfile(monid, c.slug).catch(() => null);
      const domain = siteDomain(profile?.website ?? null);
      if (!profile || !domain || !profile.website) {
        await skip("no website on its Clutch listing");
        continue;
      }
      if (await domainKnown(ctx, agencies, domain)) {
        await skip("already in our CRM (same domain)", domain, profile.website);
        continue;
      }
      const site = await fetchSite(profile.website, deps.fetchImpl);
      if (!looksLikeGameStudio(profile, site)) {
        await skip("its listing and site don't mention making games", domain, profile.website);
        continue;
      }
      let email = pickAgencyAddress(site?.emails ?? [], domain);
      let from = "their site";
      if (!email) {
        email = pickAgencyAddress(await hunterGeneric(monid, domain).catch(() => []), domain);
        from = "Hunter (generic addresses only)";
      }
      if (!email) {
        await skip("no public role-based address (hello@, contact@, info@, business@…)", domain, profile.website);
        continue;
      }
      if (await ctx.store.isSuppressed(email)) {
        await skip("that address opted out", domain, profile.website);
        continue;
      }
      const about = await describeAgency(ctx, { company: c.name, profile, site }, deps.fetchImpl).catch(() => null);
      await log(ctx, `found agency ${c.name}`, about ? `${domain}: ${about}` : `${domain}: ${profile.services.slice(0, 3).join(", ") || "game development"}`, `public address from ${from}: ${email.replace(/^[^@]+/, (m) => `${m[0]}…`)}`);
      const lead = await ctx.store.upsertLead({
        company: c.name, appId: null, contactName: null, email, source: "manual", stage: "found",
        reason: `Game-development agency on Clutch (${domain})${about ? `: ${about}` : ""}.`, sampleUrl: null, crmContactId: null,
      });
      await tagLead(ctx, lead.id, "agency_research", domain);
      const rec = await agencies.save({
        leadId: lead.id, slug: c.slug, domain, company: c.name, about, services: profile.services.join(", ") || null, website: profile.website,
        contactEmail: email, internalTest: false, status: "found", detail: null,
      });
      const draft = draftFor(c.name, about, profile.services);
      const res = await sendAgencyEmail(ctx, lead, draft, { internalTest: false, startedAt: rec.startedAt, domain, now });
      if (res.status === "sent") {
        sent++;
        emailed.push({ company: c.name, domain });
        await agencies.save({ ...rec, status: "emailed" });
      }
      if (res.status === "paused") return { sent, looked, reason: "email provider limit", emailed };
      if (res.reason && /Daily cap/.test(res.reason)) break;
    }
  }
  const cost = monidSpentUsd() - spentBefore;
  await log(ctx, `agency outreach pass: looked at ${looked} agenc${looked === 1 ? "y" : "ies"}, emailed ${sent}`, `cap ${cap} a day; ${already + sent} sent in the last 24 hours`, emailed.map((e) => e.company).join(", ") || null, cost > 0 ? Number(cost.toFixed(4)) : null);
  return { sent, looked, reason: null, emailed };
}

export type { AgencyRecord };
