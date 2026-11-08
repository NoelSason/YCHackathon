import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { byTime, isSetupNoise, normalizeRow, type StageEvent } from "./events.ts";

export type Mode = "live" | "replay" | "sample";

export interface HealthItem {
  name: string;
  ok: boolean;
  detail: string;
}

/** Studio pipeline counts from the business-ops tables. Null when those tables don't exist. */
export interface Pipeline {
  stages: Record<string, number>;
  payments: { test: number; live: number; liveAmountMinor: number; testAmountMinor: number };
}

/**
 * Where the stage's events come from. Each tick returns only events it hasn't returned before.
 * `clock` is the stage's "now": wall time when live, the newest released event's time in a replay.
 */
export interface Feed {
  mode: Mode;
  banner: string | null;
  tick(): Promise<StageEvent[]>;
  clock(): string;
  clockTicks: boolean;
  health(): HealthItem[];
  pipeline(): Promise<Pipeline | null>;
}

interface TableSpec {
  table: string;
  timeColumn: string;
  stepIns: boolean;
}

/**
 * The shared log tables from platform/db/schema.sql (Abhinav), plus business ops' own log.
 * Tables that don't exist yet are skipped and rechecked every 30 s.
 */
export const DEFAULT_ACTIVITY = "activity_log:ts,decisions:ts";
export const DEFAULT_STEPINS = "interventions:ts";

const IDENT =/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/i;
const quote = (ident: string): string => ident.split(".").map((p) => `"${p}"`).join(".");

/** Parse "biz_activity:at,activity_log:time" into table specs. Rejects anything that isn't a plain identifier. */
export function parseTables(spec: string | undefined, stepIns: boolean): TableSpec[] {
  if (!spec) return [];
  return spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [table = "", timeColumn = "at"] = s.split(":").map((p) => p.trim());
      if (!IDENT.test(table) || !IDENT.test(timeColumn)) throw new Error(`Not a plain table or column name: "${s}"`);
      return { table, timeColumn, stepIns };
    });
}

// ---------------------------------------------------------------------------------------------
// Live: read the real logs in Neon.

interface TableState {
  spec: TableSpec;
  exists: boolean | null;
  lastSeen: string | null;
  seenAtLastSeen: Set<string>;
  error: string | null;
  rows: number;
  checkedAt: number;
}

export class LiveFeed implements Feed {
  readonly mode = "live" as const;
  readonly banner = null;
  readonly clockTicks = true;
  private sql: NeonQueryFunction<false, false> | null;
  private tables: TableState[];
  private dbError: string | null = null;
  private pipelineTables: { leads: boolean; payments: boolean } | null = null;

  constructor(databaseUrl: string | undefined, specs: TableSpec[]) {
    this.sql = databaseUrl ? neon(databaseUrl) : null;
    this.tables = specs.map((spec) => ({
      spec,
      exists: null,
      lastSeen: null,
      seenAtLastSeen: new Set(),
      error: null,
      rows: 0,
      checkedAt: 0,
    }));
  }

  clock(): string {
    return new Date().toISOString();
  }

  private async exists(table: string): Promise<boolean> {
    const r = (await this.sql!.query("select to_regclass($1) is not null as ok", [table])) as Array<{ ok: boolean }>;
    return r[0]?.ok === true;
  }

  async tick(): Promise<StageEvent[]> {
    if (!this.sql) return [];
    const out: StageEvent[] = [];
    for (const t of this.tables) {
      try {
        // A missing table is normal early on (another teammate hasn't created it yet). Recheck every 30 s.
        if (t.exists !== true) {
          if (Date.now() - t.checkedAt < 30_000 && t.exists === false) continue;
          t.checkedAt = Date.now();
          t.exists = await this.exists(t.spec.table);
          if (!t.exists) continue;
        }
        const col = quote(t.spec.timeColumn);
        const rows = (t.lastSeen
          ? await this.sql.query(`select * from ${quote(t.spec.table)} where ${col} >= $1 order by ${col} asc limit 5000`, [t.lastSeen])
          : await this.sql.query(`select * from ${quote(t.spec.table)} order by ${col} asc limit 20000`)) as Array<Record<string, unknown>>;
        this.dbError = null;
        t.error = null;
        for (const row of rows) {
          const e = normalizeRow(row, t.spec.table, { forceHuman: t.spec.stepIns });
          if (!e) continue;
          if (t.lastSeen && e.at === t.lastSeen && t.seenAtLastSeen.has(e.id)) continue;
          if (!t.lastSeen || e.at > t.lastSeen) {
            t.lastSeen = e.at;
            t.seenAtLastSeen = new Set();
          }
          t.seenAtLastSeen.add(e.id);
          t.rows += 1;
          if (!isSetupNoise(e)) out.push(e);
        }
      } catch (err) {
        t.error = err instanceof Error ? err.message : String(err);
        this.dbError = t.error;
      }
    }
    return out.sort(byTime);
  }

  health(): HealthItem[] {
    if (!this.sql) return [{ name: "Database", ok: false, detail: "DATABASE_URL isn't set, so there's no log to show." }];
    const items: HealthItem[] = [
      { name: "Database", ok: this.dbError === null, detail: this.dbError ?? "Connected" },
    ];
    for (const t of this.tables) {
      items.push({
        name: `Log: ${t.spec.table}`,
        ok: t.exists === true && t.error === null,
        detail:
          t.error ??
          (t.exists === null ? "Not checked yet" : t.exists ? `${t.rows} rows read` : "Table doesn't exist yet"),
      });
    }
    return items;
  }

  async pipeline(): Promise<Pipeline | null> {
    if (!this.sql) return null;
    try {
      if (!this.pipelineTables || (!this.pipelineTables.leads && !this.pipelineTables.payments)) {
        this.pipelineTables = { leads: await this.exists("studios"), payments: await this.exists("payments") };
      }
      if (!this.pipelineTables.leads && !this.pipelineTables.payments) return null;
      const stages: Record<string, number> = {};
      if (this.pipelineTables.leads) {
        // The team's own test orders (source 'internal_test') aren't customers, so they're left out.
        const r = (await this.sql.query(
          "select stage, count(*)::int as n from studios where coalesce(source, '') <> 'internal_test' group by stage",
        )) as Array<{ stage: string; n: number }>;
        for (const { stage, n } of r) stages[stage] = n;
      }
      const payments = { test: 0, live: 0, liveAmountMinor: 0, testAmountMinor: 0 };
      if (this.pipelineTables.payments) {
        const r = (await this.sql.query(
          `select count(*) filter (where p.mode = 'live')::int as live, count(*) filter (where p.mode = 'test')::int as test,
                  coalesce(round(sum(p.amount_usd) filter (where p.mode = 'live') * 100), 0)::int as live_amt,
                  coalesce(round(sum(p.amount_usd) filter (where p.mode = 'test') * 100), 0)::int as test_amt
           from payments p
           left join studios s on s.studio_id = p.studio_id
           where p.status in ('paid', 'delivered') and coalesce(s.source, '') <> 'internal_test'`,
        )) as Array<{ live: number; test: number; live_amt: number; test_amt: number }>;
        const p = r[0];
        if (p) Object.assign(payments, { live: p.live, test: p.test, liveAmountMinor: p.live_amt, testAmountMinor: p.test_amt });
      }
      return { stages, payments };
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Replay: play back a file exported from the real logs (`npm run snapshot`). The backup if live breaks.

export class ReplayFeed implements Feed {
  readonly mode = "replay" as const;
  readonly clockTicks = false;
  readonly banner: string;
  private events: StageEvent[];
  private released = 0;
  private base = 0;
  private initialSent = false;
  private startedAt = 0;
  private stepMs: number;

  constructor(private file: string, replaySeconds: number) {
    this.events = readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as StageEvent)
      .filter((e) => !isSetupNoise(e))
      .sort(byTime);
    if (this.events.length === 0) throw new Error(`${file} has no events.`);
    // Most of the history appears at once; the newest part plays back so the room sees it move.
    this.released = Math.max(0, this.events.length - 40);
    this.base = this.released;
    this.stepMs = (replaySeconds * 1000) / Math.max(1, this.events.length - this.released);
    const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric", minute: "2-digit" });
    this.banner = `Replay of the recorded run, ${fmt(this.events[0]!.at)} to ${fmt(this.events.at(-1)!.at)} PT`;
  }

  clock(): string {
    return this.events[Math.max(0, this.released - 1)]?.at ?? new Date().toISOString();
  }

  async tick(): Promise<StageEvent[]> {
    if (!this.initialSent) {
      this.initialSent = true;
      this.startedAt = Date.now();
      return this.events.slice(0, this.released);
    }
    const target = Math.min(this.events.length, this.base + Math.floor((Date.now() - this.startedAt) / this.stepMs));
    if (target <= this.released) return [];
    const out = this.events.slice(this.released, target);
    this.released = target;
    return out;
  }

  health(): HealthItem[] {
    return [{ name: "Replay file", ok: true, detail: `${this.file}: ${this.released}/${this.events.length} events shown` }];
  }

  async pipeline(): Promise<Pipeline | null> {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Rehearsal (--rehearsal, or --sample): an invented story for practicing the 3-minute demo. Every
// studio, game, and address is made up (addresses use the reserved .example domain). The stage shows
// a big "REHEARSAL DATA" banner the whole time, and the CLI refuses to call it live.

type Step = Partial<StageEvent> & { agent: string; action: string; /** Seconds after the previous step. */ after: number };

const TEACUP = "8 of the 150 newest store reviews of Teacup Tiles say a level is too hard or impossible.";
const COZY = "https://cozy-hex.example";

/** One loop of the story, about three minutes, with a moment every 10 to 25 seconds. */
export const REHEARSAL_STORY: Step[] = [
  { after: 4, agent: "research", action: "scanning the top free puzzle games for unhappy players", why: "outreach loop" },
  { after: 7, agent: "research", action: "audited Teacup Tiles", why: TEACUP, result: "pitch angle: too_hard" },
  { after: 9, agent: "research", action: "audited Lantern Lane", why: "5 of the 120 newest store reviews of Lantern Lane say the levels are too easy.", result: "pitch angle: too_easy" },
  { after: 6, agent: "research", action: "found 2 new studios worth pitching", why: "Teacup Tiles, Lantern Lane" },
  { after: 5, agent: "research", action: "found a public contact for Mossberry Studio", why: TEACUP, result: "h…@mossberry.example" },
  { after: 7, agent: "sales_sender", action: "outreach sent to Mossberry Studio", why: TEACUP, result: "message <rehearsal>" },
  { after: 7, agent: "designer", action: "Drafted level 31 for Teacup Tiles", why: "Design card: a gentler spike, target win rate 40%" },
  { after: 6, agent: "tuner", action: "Measured level 31 at a 3% win rate over 500 simulated games", result: "Too hard, retuning" },
  { after: 6, agent: "tuner", action: "Raised level 31's move limit from 18 to 23", result: "Win rate 41%, on target" },
  { after: 6, agent: "intake", action: "new inbound lead: Hexbloom", why: "signed up through the table QR code" },
  { after: 5, agent: "sales", action: "playtest ordered by Hexbloom", why: COZY },
  { after: 5, agent: "playtest_lead", action: "playtesting Hexbloom's app on the iPhone", why: COZY },
  { after: 22, agent: "playtest_lead", action: "playtested Hexbloom's app", why: COZY, result: "completed" },
  { after: 5, agent: "playtest_lead", action: "emailed the playtest report to Hexbloom", result: "message <rehearsal>" },
  { after: 12, agent: "sales_inbox", action: "reply from Mossberry Studio", result: "sent to the Sales Reader" },
  { after: 5, agent: "sales_reader", action: "read reply from Mossberry Studio", why: "Interested. Asked for five easier levels to try in Teacup Tiles.", result: "interested; next: send a pilot offer" },
  { after: 6, agent: "sales_sender", action: "replied to Mossberry Studio", why: "Offered a pilot pack of 20 levels", result: "message <rehearsal>" },
  { after: 12, agent: "billing", action: "payment received: Pilot pack", result: "49.00 USD (test mode)" },
  {
    after: 12, agent: "ceo", kind: "decision", action: "Retune levels 30 to 40 of Teacup Tiles to a 45% win rate",
    saw: "Players quit level 34 three times more often than the levels around it",
    why: "Simulated players beat level 34 far more often than real players do",
    expected: "Quits at level 34 fall below 35% by tomorrow",
    result: "Retuned 11 levels; all 11 passed on the phone",
  },
  { after: 8, agent: "finance", action: "Checked spend against budget", result: "On budget: $1.84 of $25 today" },
  { after: 8, agent: "research", action: "audited Marble Orchard", why: "3 of the 90 newest store reviews of Marble Orchard ask for more levels.", result: "pitch angle: more_levels" },
  { after: 7, agent: "platform", action: "solver_run.done", result: "random 41% (205/500)" },
];

/** The two times a person stepped in, early in the invented night. */
const REHEARSAL_STEPINS: Array<{ minutesAgo: number; agent: string; action: string; why: string }> = [
  { minutesAgo: 400, agent: "noel", action: "Restarted the test phone after it froze", why: "The phone stopped responding to taps" },
  { minutesAgo: 372, agent: "noel", action: "Approved the first list of studios to email", why: "A person checks the first batch before any email goes out" },
];

export class RehearsalFeed implements Feed {
  readonly mode = "sample" as const;
  readonly banner = "REHEARSAL DATA: an invented story for practicing the demo. Nothing here is real.";
  readonly clockTicks = true;
  private next = 0;
  private dueAt = 0;
  private seeded = false;

  clock(): string {
    return new Date().toISOString();
  }

  private make(s: Partial<StageEvent> & { agent: string; action: string }, at: Date, human = false): StageEvent {
    return {
      id: `rehearsal:${randomUUID()}`,
      at: at.toISOString(),
      agent: s.agent,
      action: s.action,
      why: s.why ?? null,
      result: s.result ?? null,
      saw: s.saw ?? null,
      expected: s.expected ?? null,
      costUsd: human ? null : Math.round((0.01 + ((s.action.length * 7) % 50) / 1000) * 1000) / 1000,
      human,
      kind: human ? "step_in" : s.kind ?? "action",
      source: "rehearsal",
    };
  }

  async tick(): Promise<StageEvent[]> {
    const now = Date.now();
    if (!this.seeded) {
      this.seeded = true;
      // History: the two step-ins, then three earlier loops of the story spread over the night.
      const out = REHEARSAL_STEPINS.map((s) => this.make(s, new Date(now - s.minutesAgo * 60_000), true));
      const startMs = now - 368 * 60_000, endMs = now - 3 * 60_000;
      const loops = 3, total = REHEARSAL_STORY.length * loops;
      for (let k = 0; k < total; k++) {
        out.push(this.make(REHEARSAL_STORY[k % REHEARSAL_STORY.length]!, new Date(startMs + ((endMs - startMs) * k) / (total - 1))));
      }
      this.dueAt = now + REHEARSAL_STORY[0]!.after * 1000;
      return out.sort(byTime);
    }
    // After a long pause (a sleeping laptop), pick up from now instead of firing a backlog.
    if (now - this.dueAt > 30_000) this.dueAt = now;
    const out: StageEvent[] = [];
    while (now >= this.dueAt) {
      out.push(this.make(REHEARSAL_STORY[this.next]!, new Date()));
      this.next = (this.next + 1) % REHEARSAL_STORY.length;
      this.dueAt += REHEARSAL_STORY[this.next]!.after * 1000;
    }
    return out;
  }

  health(): HealthItem[] {
    return [{ name: "Rehearsal data", ok: false, detail: "Practice only. Don't show this to judges as real." }];
  }

  /** Invented counts that match the rehearsal outreach board (outreach.ts → sampleOutreach). */
  async pipeline(): Promise<Pipeline | null> {
    return {
      stages: { found: 2, emailed: 2, replied: 1, pilot_paid: 1 },
      payments: { test: 1, live: 0, liveAmountMinor: 0, testAmountMinor: 4900 },
    };
  }
}

/** The old name; `--sample` still works and means the same rehearsal story. */
export const SampleFeed = RehearsalFeed;

// ---------------------------------------------------------------------------------------------
// Market research: one row per store-chart pass by the outreach loop (business ops' table
// biz_market_research). Counts only, plus the strongest game's evidence sentence. No review text.

export interface ResearchRun {
  at: string;
  chart: string;
  gamesRead: number;
  reviewsRead: number;
  tooHard: number;
  tooEasy: number;
  wantsMoreLevels: number;
  repetitive: number;
  gamesWithEvidence: number;
  topGame: string | null;
  topReason: string | null;
}

export interface ResearchTotals {
  passes: number;
  gamesRead: number;
  reviewsRead: number;
  tooHard: number;
  tooEasy: number;
  wantsMoreLevels: number;
  repetitive: number;
  gamesWithEvidence: number;
}

/** `available` is false when there's no database or the table doesn't exist yet. */
export interface Research {
  available: boolean;
  totals: ResearchTotals;
  runs: ResearchRun[];
}

const RESEARCH_TABLE = "biz_market_research";

export function totalsOf(runs: ResearchRun[]): ResearchTotals {
  const sum = (k: keyof Omit<ResearchTotals, "passes">) => runs.reduce((n, r) => n + r[k], 0);
  return {
    passes: runs.length,
    gamesRead: sum("gamesRead"),
    reviewsRead: sum("reviewsRead"),
    tooHard: sum("tooHard"),
    tooEasy: sum("tooEasy"),
    wantsMoreLevels: sum("wantsMoreLevels"),
    repetitive: sum("repetitive"),
    gamesWithEvidence: sum("gamesWithEvidence"),
  };
}

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0)) || 0;
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const isoOf = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

/** Every pass in the table, totalled, plus the newest `limit` passes. */
export async function loadResearch(databaseUrl: string | undefined, limit = 60): Promise<Research> {
  const empty: Research = { available: false, totals: totalsOf([]), runs: [] };
  if (!databaseUrl) return empty;
  const sql = neon(databaseUrl);
  const ok = (await sql.query("select to_regclass($1) is not null as ok", [RESEARCH_TABLE])) as Array<{ ok: boolean }>;
  if (ok[0]?.ok !== true) return empty;
  const [agg, rows] = await Promise.all([
    sql.query(
      `select count(*)::int as passes, coalesce(sum(games_read), 0)::int as games_read, coalesce(sum(reviews_read), 0)::int as reviews_read,
              coalesce(sum(too_hard), 0)::int as too_hard, coalesce(sum(too_easy), 0)::int as too_easy,
              coalesce(sum(wants_more_levels), 0)::int as wants_more_levels, coalesce(sum(repetitive), 0)::int as repetitive,
              coalesce(sum(games_with_evidence), 0)::int as games_with_evidence
       from ${RESEARCH_TABLE}`,
    ) as Promise<Array<Record<string, unknown>>>,
    sql.query(`select * from ${RESEARCH_TABLE} order by ts desc limit $1`, [limit]) as Promise<Array<Record<string, unknown>>>,
  ]);
  const a = agg[0] ?? {};
  return {
    available: true,
    totals: {
      passes: num(a.passes),
      gamesRead: num(a.games_read),
      reviewsRead: num(a.reviews_read),
      tooHard: num(a.too_hard),
      tooEasy: num(a.too_easy),
      wantsMoreLevels: num(a.wants_more_levels),
      repetitive: num(a.repetitive),
      gamesWithEvidence: num(a.games_with_evidence),
    },
    runs: rows.map((r) => ({
      at: isoOf(r.ts),
      chart: String(r.chart ?? ""),
      gamesRead: num(r.games_read),
      reviewsRead: num(r.reviews_read),
      tooHard: num(r.too_hard),
      tooEasy: num(r.too_easy),
      wantsMoreLevels: num(r.wants_more_levels),
      repetitive: num(r.repetitive),
      gamesWithEvidence: num(r.games_with_evidence),
      topGame: text(r.top_game),
      topReason: text(r.top_reason),
    })),
  };
}

/** Rehearsal: invented passes, one every 20 minutes through the night. Every game here is made up. */
const SAMPLE_CHARTS = ["top free puzzle", "top-grossing puzzle", "top free casual", "top free board", "top free word", "top-grossing casual", "top paid puzzle"];
const SAMPLE_GAMES: Array<[string, string]> = [
  ["Teacup Tiles", "say a level is too hard or impossible"],
  ["Lantern Lane", "say the levels are too easy or take too long to get challenging"],
  ["Marble Orchard", "ask for more levels"],
  ["Pebble Path", "say the levels feel repetitive"],
  ["Honeycomb Hop", "say a level is too hard or impossible"],
  ["Word Willow", "ask for more levels"],
  ["Cozy Hex", "say the levels feel repetitive"],
];

export function sampleResearch(now = Date.now(), passes = 18): Research {
  const slot = 20 * 60_000;
  const last = Math.floor(now / slot) * slot + 3 * 60_000;
  const newest = last > now ? last - slot : last;
  const runs: ResearchRun[] = [];
  for (let i = 0; i < passes; i++) {
    // A fixed pattern by slot number, so the numbers stay put between page refreshes.
    const k = Math.floor(newest / slot) - i;
    const h = (n: number) => ((k * 7919 + n * 104_729) % 997 + 997) % 997;
    const games = 12 + (h(1) % 9);
    const reviews = games * (110 + (h(2) % 50));
    const evidence = h(3) % 4;
    const [game, phrase] = SAMPLE_GAMES[(k % SAMPLE_GAMES.length + SAMPLE_GAMES.length) % SAMPLE_GAMES.length]!;
    const analyzed = 120 + (h(4) % 4) * 10;
    const count = 4 + (h(5) % 7);
    runs.push({
      at: new Date(newest - i * slot).toISOString(),
      chart: SAMPLE_CHARTS[(k % SAMPLE_CHARTS.length + SAMPLE_CHARTS.length) % SAMPLE_CHARTS.length]!,
      gamesRead: games,
      reviewsRead: reviews,
      tooHard: 6 + (h(6) % 22),
      tooEasy: 2 + (h(7) % 9),
      wantsMoreLevels: 3 + (h(8) % 14),
      repetitive: 1 + (h(9) % 8),
      gamesWithEvidence: evidence,
      topGame: evidence ? game : null,
      topReason: evidence ? `${count} of the ${analyzed} newest Google Play reviews of ${game} ${phrase}.` : null,
    });
  }
  return { available: true, totals: totalsOf(runs), runs };
}
