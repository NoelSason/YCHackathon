import { neon } from "@neondatabase/serverless";

/**
 * The outreach board: every studio the agents found or that signed up, the evidence they used,
 * the email they sent, and any reply. Read live from the platform tables (studios, emails).
 * Nothing here is typed in; with no database it says so. The team's own test orders
 * (source 'internal_test'), smoke-test rows, and the team's own "Level AI …" test signups aren't customers, so they're left out.
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
      where s.name not ilike '%smoke test%' and s.name !~* '^level ai( |$)' and coalesce(s.source, '') <> 'internal_test'
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
       from studios s where s.name not ilike '%smoke test%' and s.name !~* '^level ai( |$)' and coalesce(s.source, '') <> 'internal_test'`,
  )) as Array<OutreachBoard["totals"]>;
  if (t[0]) board.totals = t[0];
  return board;
}

/**
 * Invented rows for `--rehearsal` only, matching the rehearsal story in feeds.ts. The page shows a
 * "REHEARSAL DATA" banner over them. Every name is made up; addresses use the reserved .example domain.
 */
/** Fixed when the server starts, so the rehearsal board's times don't shift on every refresh. */
const REHEARSAL_START = Date.now();

export function sampleOutreach(now = REHEARSAL_START): OutreachBoard {
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();
  const rows: OutreachRow[] = [
    { company: "Mossberry Studio", source: "research", stage: "pilot_paid", reason: "8 of the 150 newest store reviews of Teacup Tiles say a level is too hard or impossible.", quote: "Stuck on level 34 for three days. It feels impossible without boosters.", subject: "Smoothing a tough spot in Teacup Tiles", sentAt: ago(130), replyAt: ago(40), replySummary: "Interested. Asked for five easier levels to try in Teacup Tiles." },
    { company: "Hexbloom", source: "inbound_qr", stage: "found", reason: "Signed up at our table for free levels for Cozy Hex.", quote: null, subject: "Your iPhone playtest report: Cozy Hex", sentAt: ago(55), replyAt: null, replySummary: null },
    { company: "Pebblewick Games", source: "research", stage: "emailed", reason: "5 of the 120 newest store reviews of Lantern Lane say the levels are too easy.", quote: "Beat the first 60 levels in one evening. Way too easy.", subject: "A harder early curve for Lantern Lane", sentAt: ago(95), replyAt: null, replySummary: null },
    { company: "Thimble & Kite", source: "research", stage: "replied", reason: "6 of the 150 newest store reviews of Paper Boats Puzzle say a level is impossible.", quote: "Level 112 is physically impossible.", subject: "Smoothing a tough spot in Paper Boats Puzzle", sentAt: ago(240), replyAt: ago(150), replySummary: "Not right now. Asked us to check back after their next update." },
    { company: "Starling Bay Games", source: "research", stage: "emailed", reason: "4 of the 150 newest store reviews of Orbit Garden ask for more levels.", quote: "Finished everything in a week. Please add more levels!", subject: "More levels for Orbit Garden", sentAt: ago(200), replyAt: null, replySummary: null },
    { company: "Quillfeather Studio", source: "research", stage: "found", reason: "3 of the 90 newest store reviews of Marble Orchard ask for more levels.", quote: null, subject: null, sentAt: null, replyAt: null, replySummary: null },
  ];
  return { live: true, totals: { studios: 6, researched: 5, signups: 1, emailed: 5, replied: 2, won: 1 }, rows };
}

/** One studio in a pipeline stage, for the stage's drawer on the console. */
export interface StageStudio {
  company: string;
  source: string;
  stage: string;
  reason: string | null;
  game: string | null;
  lastEmailAt: string | null;
  lastReplyAt: string | null;
}

export const PIPELINE_STAGES = ["found", "sample_made", "emailed", "replied", "pilot_offered", "pilot_paid", "delivered"] as const;

/** The game named in a studio's reason, as the business server writes it ("…reviews of X say…", "…free levels for X."). */
export function gameFrom(reason: string | null): string | null {
  if (!reason) return null;
  const m = reason.match(/reviews of (.+?) (?:say|says|ask|asks)\b/i) ?? reason.match(/free levels for (.+?)\.?$/i) ?? reason.match(/playtest of (\S+?)[\s.(]/i);
  return m?.[1]?.trim() ?? null;
}

export async function loadStageStudios(databaseUrl: string | undefined, stage: string): Promise<StageStudio[]> {
  if (!databaseUrl) return [];
  const sql = neon(databaseUrl);
  const rows = (await sql.query(
    `select s.name, coalesce(s.source, '') as source, s.stage, s.reason,
            (select max(ts) from emails e where e.studio_id = s.studio_id and e.direction = 'out') as last_out,
            (select max(ts) from emails e where e.studio_id = s.studio_id and e.direction = 'in') as last_in
       from studios s
      where s.stage = $1 and s.name not ilike '%smoke test%' and s.name !~* '^level ai( |$)' and coalesce(s.source, '') <> 'internal_test'
      order by s.updated_at desc
      limit 100`,
    [stage],
  )) as Array<Record<string, unknown>>;
  const iso = (v: unknown): string | null => (v ? new Date(String(v)).toISOString() : null);
  return rows.map((r) => ({
    company: String(r.name),
    source: String(r.source),
    stage: String(r.stage),
    reason: r.reason ? String(r.reason) : null,
    game: gameFrom(r.reason ? String(r.reason) : null),
    lastEmailAt: iso(r.last_out),
    lastReplyAt: iso(r.last_in),
  }));
}

/** The rehearsal board's studios in one stage (same invented rows as sampleOutreach). */
export function sampleStageStudios(stage: string): StageStudio[] {
  return sampleOutreach().rows
    .filter((r) => r.stage === stage)
    .map((r) => ({ company: r.company, source: r.source, stage: r.stage, reason: r.reason, game: gameFrom(r.reason), lastEmailAt: r.sentAt, lastReplyAt: r.replyAt }));
}
