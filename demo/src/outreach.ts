import { neon } from "@neondatabase/serverless";

/**
 * The outreach board: every studio the agents found or that signed up, the evidence they used,
 * the email they sent, and any reply. Read live from the platform tables (studios, emails).
 * Nothing here is typed in; with no database it says so.
 */
export interface OutreachRow {
  company: string;
  source: "research" | "inbound_qr" | string;
  stage: string;
  reason: string | null;
  quote: string | null;
  subject: string | null;
  sentAt: string | null;
  replyAt: string | null;
  replySummary: string | null;
}

export interface OutreachBoard {
  live: boolean;
  totals: { studios: number; researched: number; signups: number; emailed: number; replied: number; won: number };
  rows: OutreachRow[];
}

const QUOTE = /One player put it this way: "([^"]+)"/;

export function quoteFrom(summary: string | null): string | null {
  return summary?.match(QUOTE)?.[1] ?? null;
}

export async function loadOutreach(databaseUrl: string | undefined): Promise<OutreachBoard> {
  const empty: OutreachBoard = { live: false, totals: { studios: 0, researched: 0, signups: 0, emailed: 0, replied: 0, won: 0 }, rows: [] };
  if (!databaseUrl) return empty;
  const sql = neon(databaseUrl);
  const rows = (await sql.query(
    `select s.name, coalesce(s.source, '') as source, s.stage, s.reason,
            o.subject, o.summary as out_summary, o.ts as sent_at,
            i.ts as reply_at, i.summary as reply_summary
       from studios s
       left join lateral (select subject, summary, ts from emails e
                           where e.studio_id = s.studio_id and e.direction = 'out' order by ts asc limit 1) o on true
       left join lateral (select summary, ts from emails e
                           where e.studio_id = s.studio_id and e.direction = 'in' order by ts desc limit 1) i on true
      where s.name not ilike '%smoke test%'
      order by coalesce(i.ts, o.ts, s.updated_at) desc
      limit 24`,
  )) as Array<Record<string, unknown>>;
  const iso = (v: unknown): string | null => (v ? new Date(String(v)).toISOString() : null);
  const board: OutreachBoard = {
    live: true,
    totals: { studios: 0, researched: 0, signups: 0, emailed: 0, replied: 0, won: 0 },
    rows: rows.map((r) => ({
      company: String(r.name),
      source: String(r.source),
      stage: String(r.stage),
      reason: r.reason ? String(r.reason) : null,
      quote: quoteFrom(r.out_summary ? String(r.out_summary) : null),
      subject: r.subject ? String(r.subject) : null,
      sentAt: iso(r.sent_at),
      replyAt: iso(r.reply_at),
      replySummary: r.reply_summary ? String(r.reply_summary).slice(0, 280) : null,
    })),
  };
  // Totals count every studio, not just the 24 shown.
  const t = (await sql.query(
    `select count(*)::int as studios,
            count(*) filter (where source = 'research')::int as researched,
            count(*) filter (where source = 'inbound_qr')::int as signups,
            count(*) filter (where exists (select 1 from emails e where e.studio_id = s.studio_id and e.direction = 'out'))::int as emailed,
            count(*) filter (where exists (select 1 from emails e where e.studio_id = s.studio_id and e.direction = 'in'))::int as replied,
            count(*) filter (where stage in ('pilot_paid', 'delivered'))::int as won
       from studios s where s.name not ilike '%smoke test%'`,
  )) as Array<OutreachBoard["totals"]>;
  if (t[0]) board.totals = t[0];
  return board;
}
