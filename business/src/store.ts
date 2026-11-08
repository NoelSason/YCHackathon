import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import type {
  ActivityEntry,
  DeliveryRecord,
  Lead,
  OutreachRecord,
  PaymentRecord,
  SubscriptionRecord,
  PipelineStage,
  WatchOrder,
} from "./types.js";

/**
 * Persistence for business ops. `MemoryStore` backs tests and local runs without a database.
 * `NeonStore` uses the tables in `src/db/schema.sql`.
 */
export interface Store {
  upsertLead(input: Omit<Lead, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<Lead>;
  getLead(id: string): Promise<Lead | null>;
  findLeadByEmail(email: string): Promise<Lead | null>;
  listLeads(stage?: PipelineStage): Promise<Lead[]>;
  setStage(id: string, stage: PipelineStage): Promise<Lead | null>;

  addOutreach(input: Omit<OutreachRecord, "id" | "createdAt">): Promise<OutreachRecord>;
  /** Sent first emails since a time. `inbound` counts only signups; otherwise only cold outreach. */
  countSentSince(sinceIso: string, inbound?: boolean): Promise<number>;
  /** Records a studio's reply as it arrives, so the Sender can answer that exact message later. */
  addInboundEmail(input: { leadId: string; subject: string; summary: string; externalId: string | null }): Promise<void>;
  lastInboundMessageId(leadId: string): Promise<string | null>;
  hasInboundMessage(externalId: string): Promise<boolean>;
  /** Studio API keys, stored only as SHA-256 hashes. */
  addApiKey(leadId: string, keyHash: string): Promise<void>;
  leadForApiKey(keyHash: string): Promise<Lead | null>;

  isSuppressed(email: string): Promise<boolean>;
  suppress(email: string, reason: string): Promise<void>;

  /** Returns null when this provider event was already recorded (webhooks retry). */
  recordPayment(input: Omit<PaymentRecord, "id" | "createdAt">): Promise<PaymentRecord | null>;
  listPayments(): Promise<PaymentRecord[]>;
  addDelivery(input: Omit<DeliveryRecord, "id" | "createdAt">): Promise<DeliveryRecord>;

  /** Records a new subscription. Returns null when it's already on file (webhooks retry). */
  addSubscription(input: Omit<SubscriptionRecord, "status" | "startedAt" | "cancelledAt">): Promise<SubscriptionRecord | null>;
  getSubscription(id: string): Promise<SubscriptionRecord | null>;
  /**
   * Marks a subscription cancelled (adding it if it isn't on file). Returns null when it was
   * already cancelled, so a retried cancel event changes nothing.
   */
  cancelSubscription(input: { id: string; leadId: string | null; livemode: boolean }): Promise<SubscriptionRecord | null>;

  logActivity(entry: ActivityEntry): Promise<void>;
  listActivity(limit?: number): Promise<ActivityEntry[]>;
  /** Activity in a time window, oldest first. `toIso` null means up to now. */
  listActivityBetween(fromIso: string, toIso: string | null, limit?: number): Promise<ActivityEntry[]>;

  /** Playtest orders and their live watch tokens (`/watch?o=<token>`). */
  addWatchOrder(input: { leadId: string; token: string; appUrl: string; gameName: string }): Promise<WatchOrder>;
  getWatchOrder(id: string): Promise<WatchOrder | null>;
  getWatchOrderByToken(token: string): Promise<WatchOrder | null>;
  updateWatchOrder(id: string, patch: WatchOrderPatch): Promise<WatchOrder | null>;
  /** Paid orders from the last day that never finished (a restart dropped them from the in-memory queue). */
  listUnfinishedPaidOrders(): Promise<WatchOrder[]>;

  /** One market-research pass over a store chart: what the players of its games say about levels. */
  addResearchRun(run: ResearchRun): Promise<void>;
  listResearchRuns(limit?: number): Promise<ResearchRun[]>;

  /**
   * The home page's proof numbers over the whole history (not the newest log rows, which bulk
   * level work floods): emails sent to people outside the team, and phone playtests run, not
   * counting the team's own test orders.
   */
  publicCounts(): Promise<{ emailsSent: number; playtestsRun: number }>;
}

/**
 * Phone playtest rows in the activity log start "playtested ". The team's own test orders use
 * company names that start with "Level AI" ("Level AI billing check's app"), so those are left out.
 */
export const PLAYTEST_ROW = /^playtested /;
/** The team's own test playtests: "playtested Level AI's app", or a pack's closing playtest, "playtested level 1 of Level AI Test Agency's match-3 pack". */
export const TEAM_PLAYTEST_ROW = /^playtested (level \d+ of )?Level AI\b/;

export type WatchOrderPatch = Partial<Pick<WatchOrder, "state" | "test" | "gameName" | "startedAt" | "finishedAt" | "summary" | "paymentId" | "focus">>;

export interface ResearchRun {
  at: string;
  chart: string;
  gamesRead: number;
  reviewsRead: number;
  tooHard: number;
  tooEasy: number;
  wantsMoreLevels: number;
  repetitive: number;
  /** Games where at least 3 reviews describe the same level problem. */
  gamesWithEvidence: number;
  topGame: string | null;
  topReason: string | null;
}

const now = (): string => new Date().toISOString();
const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/**
 * The mailbox an address delivers to, for recognizing the team's own addresses: lowercase, with any
 * "+tag" dropped ("noel+judge1@x.edu" → "noel@x.edu"), and Gmail's ignored dots dropped too. Only for
 * matching TEAM_EMAILS; leads keep the address exactly as typed.
 */
export function mailboxKey(email: string): string {
  const e = normalizeEmail(email);
  const at = e.lastIndexOf("@");
  if (at <= 0) return e;
  let local = e.slice(0, at).split("+")[0]!;
  const domain = e.slice(at + 1);
  if (domain === "gmail.com" || domain === "googlemail.com") local = local.replace(/\./g, "");
  return `${local}@${domain === "googlemail.com" ? "gmail.com" : domain}`;
}

/** Whether an address is one of the team's (TEAM_EMAILS), including +tag variants used for tests. */
export function isTeamEmail(email: string | null | undefined, teamEmails: Iterable<string>): boolean {
  if (!email) return false;
  const key = mailboxKey(email);
  for (const t of teamEmails) if (t.trim() && mailboxKey(t) === key) return true;
  return false;
}

export class MemoryStore implements Store {
  private leads = new Map<string, Lead>();
  private outreach: OutreachRecord[] = [];
  private inbound: Array<{ leadId: string; externalId: string | null }> = [];
  private suppressed = new Map<string, string>();
  private payments = new Map<string, PaymentRecord>();
  private deliveries: DeliveryRecord[] = [];
  private activity: ActivityEntry[] = [];

  async upsertLead(input: Omit<Lead, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<Lead> {
    const existing =
      (input.id ? this.leads.get(input.id) : undefined) ??
      (input.email ? await this.findLeadByEmail(input.email) : null) ??
      undefined;
    const lead: Lead = {
      ...input,
      email: input.email ? normalizeEmail(input.email) : null,
      id: existing?.id ?? input.id ?? randomUUID(),
      // Never move an existing lead backwards just because research found it again.
      stage: existing ? existing.stage : input.stage,
      createdAt: existing?.createdAt ?? now(),
      updatedAt: now(),
    };
    this.leads.set(lead.id, lead);
    return lead;
  }

  async getLead(id: string): Promise<Lead | null> {
    return this.leads.get(id) ?? null;
  }

  async findLeadByEmail(email: string): Promise<Lead | null> {
    const target = normalizeEmail(email);
    for (const lead of this.leads.values()) if (lead.email === target) return lead;
    return null;
  }

  async listLeads(stage?: PipelineStage): Promise<Lead[]> {
    return [...this.leads.values()].filter((l) => !stage || l.stage === stage);
  }

  async setStage(id: string, stage: PipelineStage): Promise<Lead | null> {
    const lead = this.leads.get(id);
    if (!lead) return null;
    const updated = { ...lead, stage, updatedAt: now() };
    this.leads.set(id, updated);
    return updated;
  }

  async addOutreach(input: Omit<OutreachRecord, "id" | "createdAt">): Promise<OutreachRecord> {
    const record = { ...input, id: randomUUID(), createdAt: now() };
    this.outreach.push(record);
    return record;
  }

  async countSentSince(sinceIso: string, inbound = false): Promise<number> {
    return this.outreach.filter((o) => {
      if (o.status !== "sent" || o.createdAt < sinceIso) return false;
      const isInbound = this.leads.get(o.leadId)?.source === "inbound_form";
      return inbound ? isInbound : !isInbound;
    }).length;
  }

  async addInboundEmail(input: { leadId: string; subject: string; summary: string; externalId: string | null }): Promise<void> {
    this.inbound.push({ leadId: input.leadId, externalId: input.externalId });
  }

  async hasInboundMessage(externalId: string): Promise<boolean> {
    return this.inbound.some((m) => m.externalId === externalId);
  }

  private apiKeys = new Map<string, string>();

  async addApiKey(leadId: string, keyHash: string): Promise<void> {
    this.apiKeys.set(keyHash, leadId);
  }

  async leadForApiKey(keyHash: string): Promise<Lead | null> {
    const id = this.apiKeys.get(keyHash);
    return id ? this.getLead(id) : null;
  }

  async lastInboundMessageId(leadId: string): Promise<string | null> {
    return [...this.inbound].reverse().find((m) => m.leadId === leadId && m.externalId)?.externalId ?? null;
  }

  async isSuppressed(email: string): Promise<boolean> {
    return this.suppressed.has(normalizeEmail(email));
  }

  async suppress(email: string, reason: string): Promise<void> {
    this.suppressed.set(normalizeEmail(email), reason);
  }

  async recordPayment(input: Omit<PaymentRecord, "id" | "createdAt">): Promise<PaymentRecord | null> {
    if (this.payments.has(input.providerEventId)) return null;
    const record = { ...input, id: randomUUID(), createdAt: now() };
    this.payments.set(input.providerEventId, record);
    return record;
  }

  async listPayments(): Promise<PaymentRecord[]> {
    return [...this.payments.values()];
  }

  async addDelivery(input: Omit<DeliveryRecord, "id" | "createdAt">): Promise<DeliveryRecord> {
    // An outcome closes the payment's open "pending" row instead of leaving it behind (see PgStore).
    const open = input.status === "pending" ? undefined : this.deliveries.find((d) => d.paymentId === input.paymentId && d.status === "pending");
    if (open) return Object.assign(open, { status: input.status, detail: input.detail, leadId: input.leadId ?? open.leadId });
    const record = { ...input, id: randomUUID(), createdAt: now() };
    this.deliveries.push(record);
    return record;
  }

  /** For tests: every delivery row. */
  listDeliveries(): DeliveryRecord[] {
    return [...this.deliveries];
  }

  private subscriptions = new Map<string, SubscriptionRecord>();

  async addSubscription(input: Omit<SubscriptionRecord, "status" | "startedAt" | "cancelledAt">): Promise<SubscriptionRecord | null> {
    if (this.subscriptions.has(input.id)) return null;
    const record: SubscriptionRecord = { ...input, status: "active", startedAt: now(), cancelledAt: null };
    this.subscriptions.set(input.id, record);
    return { ...record };
  }

  async getSubscription(id: string): Promise<SubscriptionRecord | null> {
    const r = this.subscriptions.get(id);
    return r ? { ...r } : null;
  }

  async cancelSubscription(input: { id: string; leadId: string | null; livemode: boolean }): Promise<SubscriptionRecord | null> {
    const existing = this.subscriptions.get(input.id);
    if (existing?.status === "cancelled") return null;
    const record: SubscriptionRecord = existing
      ? { ...existing, status: "cancelled", cancelledAt: now() }
      : { ...input, gameUrl: null, difficulty: null, status: "cancelled", startedAt: now(), cancelledAt: now() };
    this.subscriptions.set(input.id, record);
    return { ...record };
  }

  async logActivity(entry: ActivityEntry): Promise<void> {
    this.activity.push(entry);
  }

  async listActivity(limit = 100): Promise<ActivityEntry[]> {
    return this.activity.slice(-limit).reverse();
  }

  async listActivityBetween(fromIso: string, toIso: string | null, limit = 200): Promise<ActivityEntry[]> {
    return this.activity.filter((a) => a.at >= fromIso && (toIso === null || a.at <= toIso)).slice(0, limit);
  }

  private watchOrders = new Map<string, WatchOrder>();

  async addWatchOrder(input: { leadId: string; token: string; appUrl: string; gameName: string }): Promise<WatchOrder> {
    const order: WatchOrder = { ...input, id: randomUUID(), state: "queued", test: false, createdAt: now(), startedAt: null, finishedAt: null, summary: null, paymentId: null, focus: null };
    this.watchOrders.set(order.id, order);
    return { ...order };
  }

  async getWatchOrder(id: string): Promise<WatchOrder | null> {
    const o = this.watchOrders.get(id);
    return o ? { ...o } : null;
  }

  async getWatchOrderByToken(token: string): Promise<WatchOrder | null> {
    for (const o of this.watchOrders.values()) if (o.token === token) return { ...o };
    return null;
  }

  async updateWatchOrder(id: string, patch: WatchOrderPatch): Promise<WatchOrder | null> {
    const o = this.watchOrders.get(id);
    if (!o) return null;
    const updated = { ...o, ...patch };
    this.watchOrders.set(id, updated);
    return { ...updated };
  }

  async listUnfinishedPaidOrders(): Promise<WatchOrder[]> {
    const since = Date.now() - 24 * 3600_000;
    return [...this.watchOrders.values()].filter((o) => o.paymentId && (o.state === "queued" || o.state === "testing") && Date.parse(o.createdAt) >= since);
  }

  private research: ResearchRun[] = [];
  async addResearchRun(run: ResearchRun): Promise<void> {
    this.research.push(run);
  }
  async listResearchRuns(limit = 50): Promise<ResearchRun[]> {
    return this.research.slice(-limit).reverse();
  }

  async publicCounts(): Promise<{ emailsSent: number; playtestsRun: number }> {
    return {
      emailsSent: this.outreach.filter((o) => o.status === "sent").length,
      playtestsRun: this.activity.filter((a) => PLAYTEST_ROW.test(a.action) && !TEAM_PLAYTEST_ROW.test(a.action)).length,
    };
  }
}

type Row = Record<string, unknown>;
/** Runs one parameterized query. Neon's driver in production, PGlite in tests. */
export type Query = (text: string, params?: unknown[]) => Promise<Row[]>;

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const toDbSource = (s: Lead["source"]): string => (s === "inbound_form" ? "inbound_qr" : s);
// Team test rows ("internal_test") read back as "manual", so they never count as research or signups.
const fromDbSource = (s: unknown): Lead["source"] => (s === "inbound_qr" ? "inbound_form" : s === "research" ? "research" : "manual");

function rowToLead(r: Row): Lead {
  return {
    id: String(r.studio_id),
    company: String(r.name),
    appId: str(r.app_id),
    contactName: str(r.contact_name),
    email: str(r.contact_email),
    source: fromDbSource(r.source),
    stage: r.stage as PipelineStage,
    reason: str(r.reason),
    sampleUrl: str(r.sample_url),
    crmContactId: str(r.crm_contact_id),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function rowToWatchOrder(r: Row): WatchOrder {
  const summary = typeof r.summary === "string" ? (JSON.parse(r.summary) as WatchOrder["summary"]) : ((r.summary ?? null) as WatchOrder["summary"]);
  return {
    id: String(r.id),
    token: String(r.watch_token),
    leadId: String(r.studio_id),
    appUrl: String(r.app_url),
    gameName: String(r.game_name),
    state: r.state as WatchOrder["state"],
    test: Boolean(r.test_order),
    createdAt: iso(r.created_at),
    startedAt: r.started_at === null || r.started_at === undefined ? null : iso(r.started_at),
    finishedAt: r.finished_at === null || r.finished_at === undefined ? null : iso(r.finished_at),
    summary,
    paymentId: r.payment_id === null || r.payment_id === undefined ? null : String(r.payment_id),
    focus: r.focus === null || r.focus === undefined ? null : String(r.focus),
  };
}

function rowToSubscription(r: Row): SubscriptionRecord {
  return {
    id: String(r.stripe_subscription_id),
    leadId: str(r.studio_id),
    status: r.status === "cancelled" ? "cancelled" : "active",
    livemode: r.mode === "live",
    gameUrl: str(r.game_url),
    difficulty: str(r.difficulty),
    startedAt: iso(r.started_at),
    cancelledAt: r.cancelled_at === null || r.cancelled_at === undefined ? null : iso(r.cancelled_at),
  };
}

/**
 * Writes to the platform's tables (platform/db/schema.sql plus business/src/db/schema.sql):
 * leads → studios, sent emails → emails, payments → payments, the log → activity_log, and human
 * step-ins → interventions. Drafts and blocked emails exist only as activity_log rows.
 */
export class PlatformStore implements Store {
  /** `teamEmails`: the team's own addresses. Their signups and orders are stored as internal tests. */
  constructor(private readonly q: Query, private readonly teamEmails: Set<string> = new Set()) {}

  async upsertLead(input: Omit<Lead, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<Lead> {
    const email = input.email ? normalizeEmail(input.email) : null;
    const existing = input.id ? await this.getLead(input.id) : email ? await this.findLeadByEmail(email) : null;
    if (existing) {
      const r = await this.q(
        `update studios set name = $2, app_id = coalesce($3, app_id), contact_name = coalesce($4, contact_name),
           contact_email = coalesce($5, contact_email), reason = coalesce($6, reason),
           sample_url = coalesce($7, sample_url), crm_contact_id = coalesce($8, crm_contact_id),
           source = case when $9 then 'internal_test' else source end, updated_at = now()
         where studio_id = $1 returning *`,
        [existing.id, input.company, input.appId, input.contactName, email, input.reason, input.sampleUrl, input.crmContactId,
         isTeamEmail(email, this.teamEmails)],
      );
      return rowToLead(r[0]!);
    }
    const r = await this.q(
      `insert into studios (studio_id, name, app_id, contact_name, contact_email, source, stage, reason, sample_url, crm_contact_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
      [input.id ?? randomUUID(), input.company, input.appId, input.contactName, email,
       isTeamEmail(email, this.teamEmails) ? "internal_test" : toDbSource(input.source), input.stage,
       input.reason, input.sampleUrl, input.crmContactId],
    );
    return rowToLead(r[0]!);
  }

  async getLead(id: string): Promise<Lead | null> {
    const r = await this.q(`select * from studios where studio_id::text = $1`, [id]);
    return r[0] ? rowToLead(r[0]) : null;
  }

  async findLeadByEmail(email: string): Promise<Lead | null> {
    const r = await this.q(`select * from studios where lower(contact_email) = $1 limit 1`, [normalizeEmail(email)]);
    return r[0] ? rowToLead(r[0]) : null;
  }

  async listLeads(stage?: PipelineStage): Promise<Lead[]> {
    const r = stage
      ? await this.q(`select * from studios where stage = $1 order by updated_at desc`, [stage])
      : await this.q(`select * from studios order by updated_at desc`);
    return r.map(rowToLead);
  }

  async setStage(id: string, stage: PipelineStage): Promise<Lead | null> {
    const r = await this.q(`update studios set stage = $2, updated_at = now() where studio_id::text = $1 returning *`, [id, stage]);
    return r[0] ? rowToLead(r[0]) : null;
  }

  async addOutreach(input: Omit<OutreachRecord, "id" | "createdAt">): Promise<OutreachRecord> {
    // Only sent emails are emails. Drafts and blocks are already in the activity log.
    if (input.status !== "sent") return { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    const r = await this.q(
      `insert into emails (studio_id, direction, subject, summary, external_id) values ($1, 'out', $2, $3, $4) returning id, ts`,
      [input.leadId, input.subject, input.body.slice(0, 500), input.providerMessageId],
    );
    return { ...input, id: String(r[0]!.id), createdAt: iso(r[0]!.ts) };
  }

  async countSentSince(sinceIso: string, inbound = false): Promise<number> {
    const r = await this.q(
      `select count(*)::int as n from emails e left join studios s on s.studio_id = e.studio_id
       where e.direction = 'out' and e.ts >= $1 and (coalesce(s.source, '') in ('inbound_qr', 'internal_test')) = $2`,
      [sinceIso, inbound],
    );
    return Number(r[0]?.n ?? 0);
  }

  async addInboundEmail(input: { leadId: string; subject: string; summary: string; externalId: string | null }): Promise<void> {
    await this.q(`insert into emails (studio_id, direction, subject, summary, external_id) values ($1, 'in', $2, $3, $4)`,
      [input.leadId, input.subject, input.summary.slice(0, 500), input.externalId]);
  }

  async addApiKey(leadId: string, keyHash: string): Promise<void> {
    await this.q(`insert into biz_api_keys (key_hash, studio_id) values ($1, $2) on conflict (key_hash) do nothing`, [keyHash, leadId]);
  }

  async leadForApiKey(keyHash: string): Promise<Lead | null> {
    const r = await this.q(`select s.* from biz_api_keys k join studios s on s.studio_id = k.studio_id where k.key_hash = $1 and k.revoked_at is null`, [keyHash]);
    return r[0] ? rowToLead(r[0]) : null;
  }

  async hasInboundMessage(externalId: string): Promise<boolean> {
    return (await this.q(`select 1 from emails where direction = 'in' and external_id = $1 limit 1`, [externalId])).length > 0;
  }

  async lastInboundMessageId(leadId: string): Promise<string | null> {
    const r = await this.q(`select external_id from emails where studio_id::text = $1 and direction = 'in' and external_id is not null
                            order by ts desc limit 1`, [leadId]);
    return str(r[0]?.external_id);
  }

  async isSuppressed(email: string): Promise<boolean> {
    return (await this.q(`select 1 from biz_suppressions where email = $1`, [normalizeEmail(email)])).length > 0;
  }

  async suppress(email: string, reason: string): Promise<void> {
    await this.q(`insert into biz_suppressions (email, reason) values ($1, $2) on conflict (email) do nothing`, [normalizeEmail(email), reason]);
  }

  async recordPayment(input: Omit<PaymentRecord, "id" | "createdAt">): Promise<PaymentRecord | null> {
    const r = await this.q(
      `insert into payments (studio_id, product, amount_usd, mode, stripe_id, status)
       values ($1, $2, $3, $4, $5, 'paid')
       on conflict (stripe_id) where stripe_id is not null do nothing
       returning id, ts`,
      [input.leadId, input.product, input.amountMinor / 100, input.livemode ? "live" : "test", input.providerEventId],
    );
    const row = r[0];
    return row ? { ...input, id: String(row.id), createdAt: iso(row.ts) } : null;
  }

  async listPayments(): Promise<PaymentRecord[]> {
    const r = await this.q(`select * from payments where status in ('paid', 'delivered') order by ts desc`);
    return r.map((row) => ({
      id: String(row.id),
      leadId: str(row.studio_id),
      provider: "stripe" as const,
      providerEventId: String(row.stripe_id ?? row.id),
      amountMinor: Math.round(Number(row.amount_usd) * 100),
      currency: "usd",
      livemode: row.mode === "live",
      product: (["pilot_pack", "hint_pack", "playtest", "subscription"].includes(String(row.product)) ? row.product : "other") as PaymentRecord["product"],
      createdAt: iso(row.ts),
    }));
  }

  async addDelivery(input: Omit<DeliveryRecord, "id" | "createdAt">): Promise<DeliveryRecord> {
    // The webhook opens one "pending" row per payment; an outcome (delivered or failed) closes that
    // row. Appending a second row left the pending one open forever, which read as an unfulfilled
    // delivery. With no open row (a re-run after a failure), the outcome is added as a new row.
    const closed = input.status === "pending" ? [] : await this.q(
      `update biz_deliveries set status = $2, detail = $3, studio_id = coalesce($4, studio_id)
       where id = (select id from biz_deliveries where payment_id::text = $1 and status = 'pending' order by created_at limit 1)
       returning id, created_at`,
      [input.paymentId, input.status, input.detail, input.leadId],
    );
    const r = closed[0] ? closed : await this.q(
      `insert into biz_deliveries (payment_id, studio_id, status, detail) values ($1, $2, $3, $4) returning id, created_at`,
      [input.paymentId, input.leadId, input.status, input.detail],
    );
    if (input.status === "delivered") await this.q(`update payments set status = 'delivered' where id::text = $1`, [input.paymentId]);
    return { ...input, id: String(r[0]!.id), createdAt: iso(r[0]!.created_at) };
  }

  async addSubscription(input: Omit<SubscriptionRecord, "status" | "startedAt" | "cancelledAt">): Promise<SubscriptionRecord | null> {
    const r = await this.q(
      `insert into biz_subscriptions (stripe_subscription_id, studio_id, mode, game_url, difficulty)
       values ($1, $2, $3, $4, $5) on conflict (stripe_subscription_id) do nothing returning *`,
      [input.id, input.leadId, input.livemode ? "live" : "test", input.gameUrl, input.difficulty],
    );
    return r[0] ? rowToSubscription(r[0]) : null;
  }

  async getSubscription(id: string): Promise<SubscriptionRecord | null> {
    const r = await this.q(`select * from biz_subscriptions where stripe_subscription_id = $1`, [id]);
    return r[0] ? rowToSubscription(r[0]) : null;
  }

  async cancelSubscription(input: { id: string; leadId: string | null; livemode: boolean }): Promise<SubscriptionRecord | null> {
    // One statement: add it as cancelled, or flip an active row. An already-cancelled row returns nothing.
    const r = await this.q(
      `insert into biz_subscriptions (stripe_subscription_id, studio_id, mode, status, cancelled_at)
       values ($1, $2, $3, 'cancelled', now())
       on conflict (stripe_subscription_id) do update set status = 'cancelled', cancelled_at = now()
         where biz_subscriptions.status <> 'cancelled'
       returning *`,
      [input.id, input.leadId, input.livemode ? "live" : "test"],
    );
    return r[0] ? rowToSubscription(r[0]) : null;
  }

  async logActivity(e: ActivityEntry): Promise<void> {
    if (e.human) {
      await this.q(`insert into interventions (ts, who, what, why, kind) values ($1, $2, $3, $4, 'manual')`, [e.at, e.agent, e.action, e.why ?? "not given"]);
      return;
    }
    await this.q(
      `insert into activity_log (ts, agent, action, reason, result, cost_usd) values ($1, $2, $3, $4, $5, $6)`,
      [e.at, e.agent, e.action, e.why, e.result, e.costUsd ?? 0],
    );
  }

  async listActivity(limit = 100): Promise<ActivityEntry[]> {
    const r = await this.q(`select * from activity_log order by ts desc limit $1`, [limit]);
    return r.map((row) => ({
      at: iso(row.ts),
      agent: String(row.agent),
      action: String(row.action),
      why: str(row.reason),
      result: str(row.result),
      costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
      human: false,
    }));
  }

  async listActivityBetween(fromIso: string, toIso: string | null, limit = 200): Promise<ActivityEntry[]> {
    const r = await this.q(
      `select * from activity_log where ts >= $1 and ($2::timestamptz is null or ts <= $2::timestamptz) order by ts asc limit $3`,
      [fromIso, toIso, limit],
    );
    return r.map((row) => ({
      at: iso(row.ts), agent: String(row.agent), action: String(row.action), why: str(row.reason), result: str(row.result),
      costUsd: row.cost_usd === null ? null : Number(row.cost_usd), human: false,
    }));
  }

  async addWatchOrder(input: { leadId: string; token: string; appUrl: string; gameName: string }): Promise<WatchOrder> {
    const r = await this.q(
      `insert into biz_playtest_orders (watch_token, studio_id, app_url, game_name) values ($1, $2, $3, $4) returning *`,
      [input.token, input.leadId, input.appUrl, input.gameName],
    );
    return rowToWatchOrder(r[0]!);
  }

  async getWatchOrder(id: string): Promise<WatchOrder | null> {
    const r = await this.q(`select * from biz_playtest_orders where id::text = $1`, [id]);
    return r[0] ? rowToWatchOrder(r[0]) : null;
  }

  async getWatchOrderByToken(token: string): Promise<WatchOrder | null> {
    const r = await this.q(`select * from biz_playtest_orders where watch_token = $1`, [token]);
    return r[0] ? rowToWatchOrder(r[0]) : null;
  }

  async updateWatchOrder(id: string, patch: WatchOrderPatch): Promise<WatchOrder | null> {
    const cols: Record<keyof WatchOrderPatch, string> = {
      state: "state", test: "test_order", gameName: "game_name", startedAt: "started_at", finishedAt: "finished_at", summary: "summary",
      paymentId: "payment_id", focus: "focus",
    };
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const [key, col] of Object.entries(cols) as Array<[keyof WatchOrderPatch, string]>) {
      if (!(key in patch)) continue;
      const v = patch[key];
      params.push(key === "summary" ? (v === null ? null : JSON.stringify(v)) : v);
      sets.push(`${col} = $${params.length}`);
    }
    if (!sets.length) return this.getWatchOrder(id);
    const r = await this.q(`update biz_playtest_orders set ${sets.join(", ")} where id::text = $1 returning *`, params);
    return r[0] ? rowToWatchOrder(r[0]) : null;
  }

  async listUnfinishedPaidOrders(): Promise<WatchOrder[]> {
    const r = await this.q(
      `select * from biz_playtest_orders where payment_id is not null and state in ('queued', 'testing') and created_at > now() - interval '24 hours' order by created_at`,
    );
    return r.map(rowToWatchOrder);
  }

  async addResearchRun(r: ResearchRun): Promise<void> {
    await this.q(
      `insert into biz_market_research (ts, chart, games_read, reviews_read, too_hard, too_easy, wants_more_levels, repetitive, games_with_evidence, top_game, top_reason)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [r.at, r.chart, r.gamesRead, r.reviewsRead, r.tooHard, r.tooEasy, r.wantsMoreLevels, r.repetitive, r.gamesWithEvidence, r.topGame, r.topReason],
    );
  }

  async publicCounts(): Promise<{ emailsSent: number; playtestsRun: number }> {
    // Emails: every sent email to a studio that isn't one of the team's own test records. Playtests:
    // every phone playtest row (orders, market studies, our own levels) except the team's test orders,
    // also matched by the current name of any internal_test studio.
    const [e] = await this.q(
      `select count(*)::int as n from emails m left join studios s on s.studio_id = m.studio_id
       where m.direction = 'out' and coalesce(s.source, '') <> 'internal_test'`,
    );
    const [p] = await this.q(
      `select count(*)::int as n from activity_log a
       where a.action like 'playtested %' and a.action !~ '^playtested (level [0-9]+ of )?Level AI\\M'
         and not exists (select 1 from studios s where s.source = 'internal_test'
           and (a.action like 'playtested ' || s.name || '''s %' or a.action like 'playtested level % of ' || s.name || '''s %'))`,
    );
    return { emailsSent: Number(e?.n ?? 0), playtestsRun: Number(p?.n ?? 0) };
  }

  async listResearchRuns(limit = 50): Promise<ResearchRun[]> {
    const rows = await this.q(`select * from biz_market_research order by ts desc limit $1`, [limit]);
    return rows.map((row) => ({
      at: iso(row.ts),
      chart: String(row.chart),
      gamesRead: Number(row.games_read),
      reviewsRead: Number(row.reviews_read),
      tooHard: Number(row.too_hard),
      tooEasy: Number(row.too_easy),
      wantsMoreLevels: Number(row.wants_more_levels),
      repetitive: Number(row.repetitive),
      gamesWithEvidence: Number(row.games_with_evidence),
      topGame: str(row.top_game),
      topReason: str(row.top_reason),
    }));
  }
}

const DB_NETWORK_ERROR = /fetch failed|Error connecting to database/i;

/** Retries a query that failed on the network. A brief drop shouldn't turn a signup into "we couldn't email you". */
export async function withDbRetry<T>(run: () => Promise<T>, delaysMs: number[] = [300, 1200, 3000]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      const delay = delaysMs[attempt];
      if (delay === undefined || !DB_NETWORK_ERROR.test(err instanceof Error ? err.message : String(err))) throw err;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

export function neonQuery(databaseUrl: string): Query {
  const sql = neon(databaseUrl);
  return (text, params = []) => withDbRetry(async () => (await sql.query(text, params)) as Row[]);
}

export function createStore(databaseUrl: string | undefined, teamEmails: string[] = []): Store {
  return databaseUrl ? new PlatformStore(neonQuery(databaseUrl), new Set(teamEmails.map(normalizeEmail))) : new MemoryStore();
}
