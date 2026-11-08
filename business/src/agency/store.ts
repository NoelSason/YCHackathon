import type { Query } from "../store.js";

/**
 * What the agency agents remember beyond the shared studios/emails/activity tables:
 *   biz_agencies       one row per agency candidate we looked at (emailed, or skipped and why), so a
 *                      later cycle never pays to look at it again; studio_id links it to its lead.
 *   biz_agency_turns   one row per inbound message the sales agent handled. The unique message id is
 *                      the idempotency key: the webhook and the inbox poll can both see a reply, and
 *                      only the first claim answers it.
 * Additive only (`if not exists`); `ensureAgencySchema` is safe to run on every boot.
 */
export const AGENCY_SCHEMA = `
create table if not exists biz_agencies (
  id            uuid primary key default gen_random_uuid(),
  studio_id     uuid unique,
  slug          text unique,
  domain        text,
  company       text not null,
  about         text,
  services      text,
  website       text,
  contact_email text,
  internal_test boolean not null default false,
  status        text not null default 'found',
  detail        text,
  started_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index if not exists biz_agencies_domain on biz_agencies(domain);
create table if not exists biz_agency_turns (
  id                 uuid primary key default gen_random_uuid(),
  studio_id          uuid not null,
  inbound_message_id text not null unique,
  inbound_text       text,
  action             text,
  topic              text,
  status             text not null default 'working',
  reply_text         text,
  created_at         timestamptz not null default now()
);
create index if not exists biz_agency_turns_studio on biz_agency_turns(studio_id, created_at);
`;

export interface AgencyRecord {
  leadId: string | null;
  slug: string | null;
  domain: string | null;
  company: string;
  about: string | null;
  services: string | null;
  website: string | null;
  contactEmail: string | null;
  internalTest: boolean;
  /** found → emailed, or skipped (with `detail` saying why). */
  status: "found" | "emailed" | "skipped";
  detail: string | null;
  /** When this agency's current conversation started (demo-start resets it). */
  startedAt: string;
}

export type TurnStatus = "working" | "sent" | "drafted" | "handoff" | "blocked" | "failed";
export type TurnAction = "answer" | "send_free_sample" | "send_checkout" | "book_playtest" | "handoff";

export interface Turn {
  leadId: string;
  inboundMessageId: string;
  inboundText: string | null;
  action: TurnAction | null;
  topic: string | null;
  status: TurnStatus;
  replyText: string | null;
  createdAt: string;
}

export interface AgencyStore {
  ensure(): Promise<void>;
  /** Saves by lead id, else slug; returns the stored record. */
  save(rec: Omit<AgencyRecord, "startedAt"> & { startedAt?: string }): Promise<AgencyRecord>;
  forLead(leadId: string): Promise<AgencyRecord | null>;
  bySlug(slug: string): Promise<AgencyRecord | null>;
  byDomain(domain: string): Promise<AgencyRecord | null>;
  /** Real agencies we found and saved as leads but haven't emailed yet (a send was refused or paused). */
  pending(): Promise<AgencyRecord[]>;
  /** True when this message is now ours to answer; false when another call already claimed it. */
  claimTurn(leadId: string, inboundMessageId: string, inboundText?: string): Promise<boolean>;
  finishTurn(inboundMessageId: string, patch: { action: TurnAction | null; topic: string | null; status: TurnStatus; replyText: string | null }): Promise<void>;
  turns(leadId: string, sinceIso?: string): Promise<Turn[]>;
  countTurnsSince(sinceIso: string, statuses: TurnStatus[]): Promise<number>;
}

export class MemoryAgencyStore implements AgencyStore {
  agencies: AgencyRecord[] = [];
  turnRows: Turn[] = [];

  async ensure(): Promise<void> {}

  async save(rec: Omit<AgencyRecord, "startedAt"> & { startedAt?: string }): Promise<AgencyRecord> {
    const i = this.agencies.findIndex((a) => (rec.leadId && a.leadId === rec.leadId) || (rec.slug && a.slug === rec.slug));
    const prev = i >= 0 ? this.agencies[i]! : null;
    const next: AgencyRecord = { ...rec, startedAt: rec.startedAt ?? prev?.startedAt ?? new Date().toISOString() };
    if (i >= 0) this.agencies[i] = next;
    else this.agencies.push(next);
    return next;
  }

  async forLead(leadId: string) { return this.agencies.find((a) => a.leadId === leadId) ?? null; }
  async bySlug(slug: string) { return this.agencies.find((a) => a.slug === slug) ?? null; }
  async byDomain(domain: string) { return this.agencies.find((a) => a.domain === domain) ?? null; }
  async pending() { return this.agencies.filter((a) => a.status === "found" && a.leadId && !a.internalTest); }

  async claimTurn(leadId: string, inboundMessageId: string, inboundText = ""): Promise<boolean> {
    if (this.turnRows.some((t) => t.inboundMessageId === inboundMessageId)) return false;
    this.turnRows.push({ leadId, inboundMessageId, inboundText: inboundText.slice(0, 4000), action: null, topic: null, status: "working", replyText: null, createdAt: new Date().toISOString() });
    return true;
  }

  async finishTurn(inboundMessageId: string, patch: { action: TurnAction | null; topic: string | null; status: TurnStatus; replyText: string | null }) {
    const t = this.turnRows.find((x) => x.inboundMessageId === inboundMessageId);
    if (t) Object.assign(t, patch);
  }

  async turns(leadId: string, sinceIso = "") {
    return this.turnRows.filter((t) => t.leadId === leadId && t.createdAt >= sinceIso);
  }

  async countTurnsSince(sinceIso: string, statuses: TurnStatus[]) {
    return this.turnRows.filter((t) => t.createdAt >= sinceIso && statuses.includes(t.status)).length;
  }
}

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

function toRecord(r: Row): AgencyRecord {
  return {
    leadId: s(r.studio_id), slug: s(r.slug), domain: s(r.domain), company: String(r.company), about: s(r.about), services: s(r.services),
    website: s(r.website), contactEmail: s(r.contact_email), internalTest: Boolean(r.internal_test),
    status: (r.status as AgencyRecord["status"]) ?? "found", detail: s(r.detail), startedAt: iso(r.started_at),
  };
}

function toTurn(r: Row): Turn {
  return {
    leadId: String(r.studio_id), inboundMessageId: String(r.inbound_message_id), inboundText: s(r.inbound_text), action: (s(r.action) as TurnAction | null),
    topic: s(r.topic), status: r.status as TurnStatus, replyText: s(r.reply_text), createdAt: iso(r.created_at),
  };
}

export class SqlAgencyStore implements AgencyStore {
  private ready: Promise<void> | null = null;
  constructor(private readonly q: Query) {}

  ensure(): Promise<void> {
    // One statement at a time: the HTTP driver runs a single statement per call.
    this.ready ??= (async () => {
      for (const stmt of AGENCY_SCHEMA.split(";").map((x) => x.trim()).filter(Boolean)) await this.q(stmt);
    })();
    return this.ready;
  }

  async save(rec: Omit<AgencyRecord, "startedAt"> & { startedAt?: string }): Promise<AgencyRecord> {
    await this.ensure();
    const found = await this.q(
      `select id from biz_agencies where ($1::text is not null and studio_id::text = $1) or ($2::text is not null and slug = $2)
       order by (studio_id::text = coalesce($1, '')) desc limit 1`,
      [rec.leadId, rec.slug],
    );
    const vals = [rec.leadId, rec.slug, rec.domain, rec.company, rec.about, rec.services, rec.website, rec.contactEmail, rec.internalTest, rec.status, rec.detail];
    if (found[0]) {
      const r = await this.q(
        `update biz_agencies set studio_id = coalesce($1::uuid, studio_id), slug = coalesce($2, slug), domain = coalesce($3, domain), company = $4,
           about = coalesce($5, about), services = coalesce($6, services), website = coalesce($7, website), contact_email = coalesce($8, contact_email),
           internal_test = $9, status = $10, detail = $11, started_at = coalesce($12::timestamptz, started_at)
         where id = $13 returning *`,
        [...vals, rec.startedAt ?? null, found[0].id],
      );
      return toRecord(r[0]!);
    }
    const r = await this.q(
      `insert into biz_agencies (studio_id, slug, domain, company, about, services, website, contact_email, internal_test, status, detail, started_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, coalesce($12::timestamptz, now())) returning *`,
      [...vals, rec.startedAt ?? null],
    );
    return toRecord(r[0]!);
  }

  async forLead(leadId: string) {
    await this.ensure();
    const r = await this.q(`select * from biz_agencies where studio_id::text = $1 limit 1`, [leadId]);
    return r[0] ? toRecord(r[0]) : null;
  }

  async bySlug(slug: string) {
    await this.ensure();
    const r = await this.q(`select * from biz_agencies where slug = $1 limit 1`, [slug]);
    return r[0] ? toRecord(r[0]) : null;
  }

  async byDomain(domain: string) {
    await this.ensure();
    const r = await this.q(`select * from biz_agencies where domain = $1 limit 1`, [domain]);
    return r[0] ? toRecord(r[0]) : null;
  }

  async pending() {
    await this.ensure();
    const r = await this.q(`select * from biz_agencies where status = 'found' and studio_id is not null and not internal_test order by created_at limit 20`);
    return r.map(toRecord);
  }

  async claimTurn(leadId: string, inboundMessageId: string, inboundText = ""): Promise<boolean> {
    await this.ensure();
    const r = await this.q(
      `insert into biz_agency_turns (studio_id, inbound_message_id, inbound_text) values ($1, $2, $3) on conflict (inbound_message_id) do nothing returning id`,
      [leadId, inboundMessageId, inboundText.slice(0, 4000)],
    );
    return r.length > 0;
  }

  async finishTurn(inboundMessageId: string, patch: { action: TurnAction | null; topic: string | null; status: TurnStatus; replyText: string | null }) {
    await this.ensure();
    await this.q(`update biz_agency_turns set action = $2, topic = $3, status = $4, reply_text = $5 where inbound_message_id = $1`,
      [inboundMessageId, patch.action, patch.topic, patch.status, patch.replyText]);
  }

  async turns(leadId: string, sinceIso?: string) {
    await this.ensure();
    const r = await this.q(`select * from biz_agency_turns where studio_id::text = $1 and created_at >= $2 order by created_at`, [leadId, sinceIso ?? "1970-01-01T00:00:00Z"]);
    return r.map(toTurn);
  }

  async countTurnsSince(sinceIso: string, statuses: TurnStatus[]) {
    await this.ensure();
    const r = await this.q(`select count(*)::int as n from biz_agency_turns where created_at >= $1 and status = any($2)`, [sinceIso, statuses]);
    return Number(r[0]?.n ?? 0);
  }
}
