import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import type {
  ActivityEntry,
  DeliveryRecord,
  Lead,
  OutreachRecord,
  PaymentRecord,
  PipelineStage,
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

  isSuppressed(email: string): Promise<boolean>;
  suppress(email: string, reason: string): Promise<void>;

  /** Returns null when this provider event was already recorded (webhooks retry). */
  recordPayment(input: Omit<PaymentRecord, "id" | "createdAt">): Promise<PaymentRecord | null>;
  listPayments(): Promise<PaymentRecord[]>;
  addDelivery(input: Omit<DeliveryRecord, "id" | "createdAt">): Promise<DeliveryRecord>;

  logActivity(entry: ActivityEntry): Promise<void>;
  listActivity(limit?: number): Promise<ActivityEntry[]>;
}

const now = (): string => new Date().toISOString();
const normalizeEmail = (email: string): string => email.trim().toLowerCase();

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
    const record = { ...input, id: randomUUID(), createdAt: now() };
    this.deliveries.push(record);
    return record;
  }

  async logActivity(entry: ActivityEntry): Promise<void> {
    this.activity.push(entry);
  }

  async listActivity(limit = 100): Promise<ActivityEntry[]> {
    return this.activity.slice(-limit).reverse();
  }
}

type Row = Record<string, unknown>;
/** Runs one parameterized query. Neon's driver in production, PGlite in tests. */
export type Query = (text: string, params?: unknown[]) => Promise<Row[]>;

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const toDbSource = (s: Lead["source"]): string => (s === "inbound_form" ? "inbound_qr" : s);
const fromDbSource = (s: unknown): Lead["source"] => (s === "inbound_qr" ? "inbound_form" : s === "manual" ? "manual" : "research");

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

/**
 * Writes to the platform's tables (platform/db/schema.sql plus business/src/db/schema.sql):
 * leads → studios, sent emails → emails, payments → payments, the log → activity_log, and human
 * step-ins → interventions. Drafts and blocked emails exist only as activity_log rows.
 */
export class PlatformStore implements Store {
  constructor(private readonly q: Query) {}

  async upsertLead(input: Omit<Lead, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<Lead> {
    const email = input.email ? normalizeEmail(input.email) : null;
    const existing = input.id ? await this.getLead(input.id) : email ? await this.findLeadByEmail(email) : null;
    if (existing) {
      const r = await this.q(
        `update studios set name = $2, app_id = coalesce($3, app_id), contact_name = coalesce($4, contact_name),
           contact_email = coalesce($5, contact_email), reason = coalesce($6, reason),
           sample_url = coalesce($7, sample_url), crm_contact_id = coalesce($8, crm_contact_id), updated_at = now()
         where studio_id = $1 returning *`,
        [existing.id, input.company, input.appId, input.contactName, email, input.reason, input.sampleUrl, input.crmContactId],
      );
      return rowToLead(r[0]!);
    }
    const r = await this.q(
      `insert into studios (studio_id, name, app_id, contact_name, contact_email, source, stage, reason, sample_url, crm_contact_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
      [input.id ?? randomUUID(), input.company, input.appId, input.contactName, email, toDbSource(input.source), input.stage,
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
       where e.direction = 'out' and e.ts >= $1 and (coalesce(s.source, '') = 'inbound_qr') = $2`,
      [sinceIso, inbound],
    );
    return Number(r[0]?.n ?? 0);
  }

  async addInboundEmail(input: { leadId: string; subject: string; summary: string; externalId: string | null }): Promise<void> {
    await this.q(`insert into emails (studio_id, direction, subject, summary, external_id) values ($1, 'in', $2, $3, $4)`,
      [input.leadId, input.subject, input.summary.slice(0, 500), input.externalId]);
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
      product: (["pilot_pack", "hint_pack"].includes(String(row.product)) ? row.product : "other") as PaymentRecord["product"],
      createdAt: iso(row.ts),
    }));
  }

  async addDelivery(input: Omit<DeliveryRecord, "id" | "createdAt">): Promise<DeliveryRecord> {
    const r = await this.q(
      `insert into biz_deliveries (payment_id, studio_id, status, detail) values ($1, $2, $3, $4) returning id, created_at`,
      [input.paymentId, input.leadId, input.status, input.detail],
    );
    if (input.status === "delivered") await this.q(`update payments set status = 'delivered' where id::text = $1`, [input.paymentId]);
    return { ...input, id: String(r[0]!.id), createdAt: iso(r[0]!.created_at) };
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
}

export function neonQuery(databaseUrl: string): Query {
  const sql = neon(databaseUrl);
  return async (text, params = []) => (await sql.query(text, params)) as Row[];
}

export function createStore(databaseUrl: string | undefined): Store {
  return databaseUrl ? new PlatformStore(neonQuery(databaseUrl)) : new MemoryStore();
}
