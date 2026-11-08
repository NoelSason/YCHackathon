import { z } from "zod";
import type { ToolContext } from "../mcp/tools.js";
import { createPaymentLink } from "../billing/stripe.js";
import { runPlan, type PlaytestOutcome } from "../mobile/playtest.js";
import { idempotencyKey } from "../outreach/send.js";
import type { Lead } from "../types.js";

/**
 * The phone playtest offer: "Your app, played on a real iPhone, with a report in about 10 minutes."
 * A team enters their app's link. With a price set and Stripe configured they pay first, and the
 * paid webhook starts the playtest; otherwise it's free and starts right away. The Playtest agent
 * plays it on the cloud iPhone and the report is emailed. Orders run one at a time (one phone).
 */
export const PlaytestOrderSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().max(200),
  team: z.string().trim().min(1).max(160),
  appUrl: z.url().max(500).refine((u) => /^https?:\/\//i.test(u), "Use a web link (https://…)."),
  focus: z.string().trim().max(400).optional(),
  consent: z.literal(true),
});
export type PlaytestOrder = z.infer<typeof PlaytestOrderSchema>;

let queue: Promise<unknown> = Promise.resolve();
/** Runs playtests one after another, because there's one phone. */
export function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job);
  queue = next.catch(() => undefined);
  return next;
}

export async function createPlaytestOrder(ctx: ToolContext, input: unknown): Promise<
  { ok: true; lead: Lead; payUrl: string | null } | { ok: false; error: string }
> {
  const parsed = PlaytestOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please fill in your name, email, team, and app link (https://…), and tick the box." };
  const o = parsed.data;
  const lead = await ctx.store.upsertLead({
    company: o.team, appId: null, contactName: o.name, email: o.email, source: "inbound_form", stage: "found",
    reason: `Ordered a phone playtest of ${o.appUrl}${o.focus ? ` (focus: ${o.focus})` : ""}.`, sampleUrl: null, crmContactId: null,
  });
  await ctx.store.logActivity({
    at: new Date().toISOString(), agent: "sales", action: `playtest ordered by ${o.team}`, why: o.appUrl, result: `lead ${lead.id}`, costUsd: null, human: false,
  });

  const price = ctx.config.PLAYTEST_PRICE_USD;
  if (price && ctx.stripe) {
    const link = await createPaymentLink(ctx.stripe, {
      product: "playtest",
      name: "Phone playtest: your app on a real iPhone, with a report",
      amountMinor: Math.round(price * 100),
      leadId: lead.id,
      successUrl: `${ctx.config.PUBLIC_BASE_URL}/playtest?paid=1`,
      extraMetadata: { app_url: o.appUrl, focus: (o.focus ?? "").slice(0, 400) },
    });
    await ctx.store.setStage(lead.id, "pilot_offered");
    return { ok: true, lead, payUrl: link.url };
  }
  void enqueue(() => runPlaytestOrder(ctx, lead, o.appUrl, o.focus ?? null)).catch(() => undefined);
  return { ok: true, lead, payUrl: null };
}

export function composeReport(args: {
  name: string | null;
  team: string;
  appUrl: string;
  outcome: PlaytestOutcome | null;
  error: string | null;
  companyName: string;
  postalAddress: string;
}): { subject: string; body: string } {
  const r = args.outcome?.results?.results?.[0];
  const hi = args.name ? `Hi ${args.name.split(" ")[0]},` : `Hi ${args.team},`;
  const findings: string[] = [];
  if (!r) {
    findings.push(
      args.error
        ? "Our phone couldn't finish the playtest this time, so there's no report yet. We'll retry and write again."
        : "The playtest finished, but the phone didn't return a readable report. We'll retry and write again.",
    );
  } else {
    findings.push(`• Loaded on iPhone: ${r.loaded ? "yes" : "no"}`);
    findings.push(`• Taps and swipes worked: ${r.touchOk ? "yes" : "no"}`);
    findings.push(`• Visual problems: ${r.visualIssues.length ? r.visualIssues.join("; ") : "none seen"}`);
    if (r.stuckReason) findings.push(`• Where it got stuck: ${r.stuckReason}`);
    if (r.notes) findings.push(`• Notes: ${r.notes}`);
  }
  const body = [
    hi,
    "",
    `We played ${args.appUrl} on a real iPhone. Here's what we found:`,
    "",
    ...findings,
    "",
    "Reply with anything you'd like us to check next, like a specific flow or screen, and we'll run it again.",
    "",
    args.companyName,
    "",
    "—",
    `${args.companyName} is a small studio where AI agents play, design, and test games, and this report was written by one of them. You're getting it because you ordered a playtest.`,
    args.postalAddress,
    `Reply "stop" and we won't email you again.`,
  ].join("\n");
  return { subject: `Your iPhone playtest report: ${args.team}`, body };
}

export async function runPlaytestOrder(ctx: ToolContext, lead: Lead, appUrl: string, focus: string | null): Promise<void> {
  const log = (action: string, why: string | null, result: string | null) =>
    ctx.store.logActivity({ at: new Date().toISOString(), agent: "playtest-lead", action, why, result, costUsd: null, human: false });
  let outcome: PlaytestOutcome | null = null;
  let error: string | null = null;
  const deviceId = ctx.config.MOBILERUN_DEVICE_ID;
  if (!ctx.mobilerun || !deviceId) error = "phone not configured";
  else {
    await log(`playtesting ${lead.company}'s app on the iPhone`, appUrl, null);
    try {
      outcome = await runPlan({
        client: ctx.mobilerun,
        deviceId,
        model: ctx.config.MOBILERUN_MODEL,
        plan: {
          planId: `order-${lead.id.slice(0, 8)}`,
          app: { platform: "ios", package: "safari" },
          goal: `Try this app like a first-time user${focus ? `, paying attention to: ${focus}` : ""}. Explore its main screens and report what works and what breaks.`,
          steps: [{ level: "app", open: appUrl, attempts: 1 }],
          limits: { maxMinutes: 8 },
        },
      });
      await log(`playtested ${lead.company}'s app`, appUrl, `${outcome.status}${outcome.results ? "" : " (no report)"}`);
    } catch (err) {
      error = err instanceof Error ? err.message.slice(0, 200) : "unknown error";
      await log(`playtest failed for ${lead.company}`, error, null);
    }
  }

  if (!lead.email || !ctx.mail) return;
  const { subject, body } = composeReport({
    name: lead.contactName, team: lead.company, appUrl, outcome, error,
    companyName: ctx.config.COMPANY_NAME, postalAddress: ctx.config.COMPANY_POSTAL_ADDRESS ?? "",
  });
  if (await ctx.store.isSuppressed(lead.email)) return;
  const sent = await ctx.mail.send({ to: lead.email, subject, text: body, idempotencyKey: idempotencyKey("playtest-report", lead.id, appUrl, outcome?.taskId ?? "none") });
  await ctx.store.addOutreach({ leadId: lead.id, to: lead.email, subject, body, status: "sent", blockedReason: null, providerMessageId: sent.messageId });
  if (outcome?.results) await ctx.store.setStage(lead.id, "delivered");
  await log(`emailed the playtest report to ${lead.company}`, null, `message ${sent.messageId}`);
}
