import type { Config } from "../config.js";
import type { ToolContext } from "../mcp/tools.js";
import { answerReply, setReplyResponder, type InboundReply, type ReplyResponder } from "../outreach/inbound.js";
import { classifyReply } from "../outreach/guard.js";
import { flagMoneyRequest } from "../billing/requests.js";
import { GENRES } from "../levels/deliver-pack.js";
import { timingSafeEqual } from "node:crypto";
import { buildFacts } from "./facts.js";
import { converse, type ConverseDeps } from "./converse.js";
import { composeAgencyEmail, runAgencyCycle, sendAgencyEmail, tagLead } from "./outreach.js";
import { MemoryAgencyStore, SqlAgencyStore, type AgencyStore } from "./store.js";
import { TEST_AGENCY, withProspects } from "./prospect.js";
import type { PolledMessage } from "../outreach/poll.js";

export { TEST_AGENCY };

/**
 * Agency outreach and the conversational sales agent, hooked into the server with two calls:
 *   app.ts     `const agencyRoute = registerAgency(ctx, config)` (after setReplyResponder), and
 *              `if (agencyRoute) ...` inside the router, for POST /agency/demo-start;
 *   server.ts  `startAgencyLoop(ctx)`: the agency outreach cycle every 30 minutes when AGENCY_OUTREACH=1.
 */
const stores = new WeakMap<ToolContext, AgencyStore>();
export function agencyStore(ctx: ToolContext): AgencyStore {
  let s = stores.get(ctx);
  if (!s) {
    s = ctx.db ? new SqlAgencyStore(ctx.db) : new MemoryAgencyStore();
    stores.set(ctx, s);
  }
  return s;
}

/**
 * The reply responder. Money requests go to a person (flagMoneyRequest, unchanged). Clear auto-replies and clear no's keep the existing path (answerReply). A
 * clear yes from a studio that hasn't talked to the agent yet gets the existing fixed answer. Every
 * other reply goes to the sales agent, including a yes from an agency: our agency email offered a
 * specific free sample or playtest, and the fixed answer can't start either one. Opt-outs never get
 * here (handleInboundReply suppresses them first), and converse() checks again.
 */
export function agencyResponder(ctx: ToolContext, deps: Partial<ConverseDeps> = {}): ReplyResponder {
  const full: ConverseDeps = { agencies: deps.agencies ?? agencyStore(ctx), ...deps };
  return async (o: { leadId: string; reply: InboundReply }) => {
    // Refunds, cancellations, and billing complaints go to a person first, as before (billing/requests.ts).
    if (await flagMoneyRequest(ctx, o)) return false;
    const { intent } = classifyReply(o.reply.subject, o.reply.text);
    if (intent === "auto_reply" || intent === "not_interested") return answerReply(ctx, o);
    const agency = await full.agencies.forLead(o.leadId);
    const talking = (await full.agencies.turns(o.leadId, agency?.startedAt)).length > 0;
    const autoAnswered = (await ctx.store.listActivity(500)).some((a) => /^auto-replied to /.test(a.action) && a.why?.startsWith(`lead ${o.leadId}:`));
    // A studio we emailed from research was offered a free sample for a reply, and only the agent can start one.
    const lead = await ctx.store.getLead(o.leadId);
    if (intent === "interested" && !agency && !talking && !autoAnswered && lead?.source !== "research") {
      if (await answerReply(ctx, o)) return true;
    }
    return converse(ctx, full, o);
  };
}

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function bearerOk(token: string | undefined, authorization: string | null): boolean {
  if (!token) return false;
  const given = Buffer.from((authorization ?? "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}


/**
 * POST /agency/demo-start (Bearer BUSINESS_MCP_TOKEN): makes (or resets) the test agency, a lead whose
 * contact is a teammate's own address, and sends it the real agency email. The lead is stored as an
 * internal test, so the console's numbers leave it out, and its log rows say "test agency".
 * Body: { email?: a TEAM_EMAILS address (default the first), about?: what the pretend agency does,
 *   direction?: "inbound" to skip our first email and wait for the agency to write in }. When the email
 *   provider's new-recipient limit blocks the first email, it falls back to inbound by itself.
 */
export async function demoStart(ctx: ToolContext, config: Config, body: Record<string, unknown>, agencies: AgencyStore = agencyStore(ctx)): Promise<Response> {
  const team = config.TEAM_EMAILS.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  const email = (typeof body.email === "string" && body.email.trim() ? body.email.trim().toLowerCase() : team[0]) ?? null;
  if (!email || !team.includes(email)) return json(400, { ok: false, error: "email must be one of TEAM_EMAILS" });
  const about = typeof body.about === "string" && body.about.trim() ? body.about.trim().slice(0, 160) : "builds and ships mobile puzzle games for client studios";
  await agencies.ensure();
  const existing = await ctx.store.findLeadByEmail(email);
  const lead = await ctx.store.upsertLead({
    ...(existing ? { id: existing.id } : {}),
    company: TEST_AGENCY, appId: null, contactName: null, email, source: "manual", stage: "found",
    reason: "Internal test agency: a teammate plays a game-development agency for the demo.", sampleUrl: null, crmContactId: null,
  });
  // A fresh conversation each run: stage back to found, turn count and free trials start over.
  await ctx.store.setStage(lead.id, "found");
  await tagLead(ctx, lead.id, "internal_test", null);
  // Strictly later than the last run, so each run's first email has its own idempotency key.
  const prev = await agencies.forLead(lead.id);
  const startedAt = new Date(Math.max(Date.now(), prev ? Date.parse(prev.startedAt) + 1 : 0)).toISOString();
  const rec = await agencies.save({
    leadId: lead.id, slug: null, domain: null, company: TEST_AGENCY, about, services: null, website: null, contactEmail: email,
    internalTest: true, status: "found", detail: "test agency", startedAt,
  });
  await ctx.store.logActivity({
    at: startedAt, agent: "agency-sales", action: `test agency created: ${TEST_AGENCY}`,
    why: "demo: a teammate plays a game-development agency; kept out of the numbers", result: `lead ${lead.id}`, costUsd: null, human: false,
  });
  const inbox = config.AGENTMAIL_INBOX_ID ?? "levelai@agentmail.to";
  const waitForThem = async (why: string) => {
    // Their first email to us starts the thread; the inbox poll hands it to the sales agent.
    await ctx.store.setStage(lead.id, "emailed");
    await agencies.save({ ...rec, status: "emailed", detail: "wrote to us first" });
    await ctx.store.logActivity({
      at: new Date().toISOString(), agent: "agency-sales", action: `test agency ready: waiting for ${TEST_AGENCY} to write in`,
      why, result: `email ${inbox} from the test address; the sales agent answers in the thread`, costUsd: null, human: false,
    });
    return json(202, { ok: true, leadId: lead.id, status: "waiting_for_inbound", next: `Email ${inbox} from ${email} (any subject, e.g. "Agency inquiry"). The agent replies in the thread within about 1-2 minutes.`, reason: why });
  };
  if (body.direction === "inbound") return waitForThem("inbound demo: the agency writes first");
  const facts = buildFacts(config, { stripe: Boolean(ctx.stripe) });
  const draft = composeAgencyEmail({
    company: TEST_AGENCY, about, services: [],
    sender: { name: "Noel Sason", company: config.COMPANY_NAME, postalAddress: config.COMPANY_POSTAL_ADDRESS ?? "", site: facts.links.site },
    genres: facts.openGenres.map((g) => GENRES[g].label),
  });
  const res = await sendAgencyEmail(ctx, (await ctx.store.getLead(lead.id)) ?? lead, draft, { internalTest: true, startedAt: rec.startedAt, domain: null });
  if (res.status === "paused") return waitForThem(`our first email can't go yet (${res.reason}), so the agency writes first`);
  if (res.status === "sent") await agencies.save({ ...rec, status: "emailed" });
  return json(res.status === "blocked" ? 409 : 202, { ok: res.status !== "blocked", leadId: lead.id, status: res.status, reason: res.reason, subject: draft.subject });
}

/** Registers the reply responder and returns the route handler for /agency/*. Call after setReplyResponder. */
export function registerAgency(ctx: ToolContext, config: Config): (request: Request, url: URL) => Promise<Response | null> {
  setReplyResponder(agencyResponder(ctx));
  return async (request, url) => {
    if (url.pathname !== "/agency/demo-start") return null;
    if (!bearerOk(config.BUSINESS_MCP_TOKEN, request.headers.get("authorization"))) return json(401, { error: "unauthorized" });
    if (request.method !== "POST") return json(405, { error: "use POST" });
    const text = await request.text();
    if (text.length > 10_000) return json(413, { error: "body too large" });
    let body: Record<string, unknown> = {};
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return json(400, { error: "body must be JSON" });
    }
    return demoStart(ctx, config, body);
  };
}

/** The inbox lister, wrapped so prospects who write to us first (including the test agency) become leads first. */
export function agencyInbox(ctx: ToolContext, list: () => Promise<PolledMessage[]>): () => Promise<PolledMessage[]> {
  return withProspects(ctx, agencyStore(ctx), list);
}

/** The agency outreach loop: every AGENCY_OUTREACH_MINUTES (default 30) when AGENCY_OUTREACH=1 and sending is on. */
export function startAgencyLoop(ctx: ToolContext, env: NodeJS.ProcessEnv = process.env): (() => void) | null {
  if (env.AGENCY_OUTREACH !== "1" || ctx.config.OUTREACH_SEND !== "1") return null;
  const minutes = Number(env.AGENCY_OUTREACH_MINUTES) > 0 ? Number(env.AGENCY_OUTREACH_MINUTES) : 30;
  let running = false;
  const cycle = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runAgencyCycle(ctx, { agencies: agencyStore(ctx), monid: ctx.monid });
      console.log(`agency outreach: emailed ${r.sent} of ${r.looked} looked at${r.reason ? ` (${r.reason})` : ""}`);
    } catch (err) {
      console.error("agency outreach failed:", err instanceof Error ? err.message.slice(0, 200) : "unknown");
    } finally {
      running = false;
    }
  };
  const first = setTimeout(cycle, 45_000);
  const t = setInterval(cycle, minutes * 60_000);
  return () => { clearTimeout(first); clearInterval(t); };
}
