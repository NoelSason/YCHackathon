import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { byTime, normalizeRow, type StageEvent } from "./events.ts";

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
          out.push(e);
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
        const r = (await this.sql.query("select stage, count(*)::int as n from studios group by stage")) as Array<{ stage: string; n: number }>;
        for (const { stage, n } of r) stages[stage] = n;
      }
      const payments = { test: 0, live: 0, liveAmountMinor: 0, testAmountMinor: 0 };
      if (this.pipelineTables.payments) {
        const r = (await this.sql.query(
          `select count(*) filter (where mode = 'live')::int as live, count(*) filter (where mode = 'test')::int as test,
                  coalesce(round(sum(amount_usd) filter (where mode = 'live') * 100), 0)::int as live_amt,
                  coalesce(round(sum(amount_usd) filter (where mode = 'test') * 100), 0)::int as test_amt
           from payments where status in ('paid', 'delivered')`,
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
// Sample: invented events for rehearsing the layout. The stage labels it on screen in large type.

const SCRIPT: Array<Partial<StageEvent> & { agent: string; action: string }> = [
  { agent: "ceo", action: "Ordered a new pack of 10 match-3 levels", why: "Pack 3 sold out of fresh levels", kind: "decision", saw: "Players finished pack 2 in 40 minutes on average", expected: "Pack 3 live within 2 hours" },
  { agent: "designer", action: "Drafted level 31 for the match-3 game", why: "Design card for pack 3, target win rate 40%" },
  { agent: "tuner", action: "Measured level 31 at a 3% win rate over 500 bot games", result: "Too hard, retuning" },
  { agent: "tuner", action: "Raised level 31's move limit from 18 to 23", result: "Win rate 41%, accepted" },
  { agent: "playtest_lead", action: "Sent level 31 to a cloud phone for a playtest", why: "Every level is played on a real phone before it ships" },
  { agent: "playtest_lead", action: "Phone playtest passed", result: "Won in 19 moves, no visual bugs" },
  { agent: "research", action: "Found a studio whose players ask for more levels", why: "12 of the 90 newest reviews ask for more levels" },
  { agent: "sales_sender", action: "Emailed the studio a playable sample", result: "Sent, pipeline stage: emailed" },
  { agent: "finance", action: "Checked spend against budget", result: "On budget" },
  { agent: "human", action: "Restarted the phone after it froze", why: "The cloud phone stopped responding", human: true, kind: "step_in" },
];

export class SampleFeed implements Feed {
  readonly mode = "sample" as const;
  readonly banner = "SAMPLE DATA: invented events for rehearsing the layout. Nothing here is real.";
  readonly clockTicks = true;
  private i = 0;
  private lastAt = 0;
  private seeded = false;

  clock(): string {
    return new Date().toISOString();
  }

  private make(n: number, at: Date): StageEvent {
    const s = SCRIPT[n % SCRIPT.length]!;
    return {
      id: `sample:${randomUUID()}`,
      at: at.toISOString(),
      agent: s.agent,
      action: s.action,
      why: s.why ?? null,
      result: s.result ?? null,
      saw: s.saw ?? null,
      expected: s.expected ?? null,
      costUsd: s.human ? null : 0.03,
      human: s.human ?? false,
      kind: s.kind ?? "action",
      source: "sample",
    };
  }

  async tick(): Promise<StageEvent[]> {
    if (!this.seeded) {
      this.seeded = true;
      const now = Date.now();
      // A history with one step-in near the start, so the unattended clock has something to count from.
      return Array.from({ length: 30 }, (_, k) => this.make(k === 0 ? SCRIPT.length - 1 : k, new Date(now - (30 - k) * 4 * 60_000)));
    }
    if (Date.now() - this.lastAt < 3500) return [];
    this.lastAt = Date.now();
    this.i += 1;
    // Never emit the scripted step-in live; it would reset the clock every loop.
    if (SCRIPT[this.i % SCRIPT.length]!.human) this.i += 1;
    return [this.make(this.i, new Date())];
  }

  health(): HealthItem[] {
    return [{ name: "Sample data", ok: false, detail: "Rehearsal only. Don't show this to judges as real." }];
  }

  async pipeline(): Promise<Pipeline | null> {
    return null;
  }
}
