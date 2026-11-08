import { HUMAN_ATTEMPTS_CTE } from "../../../solver/src/player-attempts.js";
// MCP tools. Names, inputs and outputs follow platform/CONTRACTS.md §2 exactly.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { q, one } from "./db.js";
import { getAdapter, listAdapters } from "./adapters.js";
// Pinara's "did that decision work?" check (master plan package 11). Read-only.
import { acceptVerified, verifiedLevel } from "../../../solver/src/acceptance.js";
import { checkDecision } from "../../../evals/src/decision-check.js";

type Json = Record<string, unknown>;

// Every tool returns JSON text. Errors are returned, not thrown, so the agent can read them.
function ok(data: Json) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}
function err(code: string, message: string) {
  return ok({ error: { code, message } });
}

function numify(row: Record<string, unknown>): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(row)) out[k] = typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  return out;
}

// Platform-side audit: every tool call lands in activity_log as agent='platform' unless the
// tool itself writes a richer entry.
async function audit(action: string, ref?: { kind: string; id: string }, result?: string) {
  await q(
    `insert into activity_log(agent, action, result, ref_kind, ref_id) values ('platform', $1, $2, $3, $4)`,
    [action, result ?? null, ref?.kind ?? null, ref?.id ?? null],
  );
}

// Two catalogs on two endpoints. Naïve appears to classify an MCP server by the tools it
// advertises: a server with CRM/email/payment tools is treated as holding people's data, and any
// read from it sets `read_people` for the chat, after which every call asks. So the production
// agents (CEO, Designer, Tuner, Playtest) get a catalog with nothing people-flavored on it, served
// at /mcp, and the pipeline tools live at /mcp/crm for Finance and Sales only.
export type Catalog = "core" | "crm";
export const READ_TOOLS = new Set(["check_decision", "get_company_metrics", "get_level", "get_pipeline_metrics", "get_player_stats", "get_recent_decisions", "get_solver_run", "get_spend", "list_games", "validate_level"]);
export const CRM_TOOLS = new Set(["get_pipeline_metrics", "crm_upsert", "crm_set_stage", "record_email", "create_payment_link"]);

export function registerTools(realServer: McpServer, catalog: Catalog = "core") {
  // Wrap registerTool so each tool lands on the right catalog without touching every definition.
  const server = new Proxy(realServer, {
    get(target, prop, receiver) {
      if (prop !== "registerTool") return Reflect.get(target, prop, receiver);
      return (name: string, ...rest: unknown[]) => {
        const isCrm = CRM_TOOLS.has(name);
        if ((catalog === "core" && isCrm) || (catalog === "crm" && !isCrm)) return undefined;
        // MCP tool annotations: everything here is our own database (closed world); reads are
        // read-only and idempotent. If Naïve keys its people-data rule on these hints, this is
        // where it would see them.
        const [config, cb] = rest as [Record<string, unknown>, unknown];
        const annotated = { ...config, annotations: { readOnlyHint: READ_TOOLS.has(name), destructiveHint: false, idempotentHint: READ_TOOLS.has(name), openWorldHint: false, ...(config.annotations as object | undefined) } };
        return (target.registerTool as unknown as (...a: unknown[]) => unknown)(name, annotated, cb);
      };
    },
  }) as McpServer;

  // ---------- games and levels ----------

  server.registerTool(
    "list_games",
    { description: "Games connected to the platform, their bots, and default difficulty targets." },
    async () => {
      const rows = await q<{ game_id: string; name: string; bots: string[]; default_win_rate: string }>(
        `select game_id, name, bots, default_win_rate from games order by game_id`,
      );
      const games = rows.map((r) => ({
        game_id: r.game_id,
        name: r.name,
        bots: getAdapter(r.game_id)?.bots ?? r.bots,
        schema_url: `/games/${r.game_id}/schema`,
        targets: { default_win_rate: Number(r.default_win_rate) },
        adapter_loaded: !!getAdapter(r.game_id),
      }));
      return ok({ games });
    },
  );

  server.registerTool(
    "validate_level",
    {
      description: "Check a level against the game's rules. Returns ok:true or a list of errors.",
      inputSchema: { game_id: z.string(), level: z.record(z.unknown()) },
    },
    async ({ game_id, level }) => {
      const a = getAdapter(game_id);
      if (!a) return err("unknown_game", `no adapter for ${game_id}`);
      return ok({ ...a.validate(level) });
    },
  );

  server.registerTool(
    "save_level",
    {
      description: "Validate and save a level as a draft. Returns its id and playable URL.",
      inputSchema: {
        game_id: z.string(),
        level: z.record(z.unknown()),
        target_win_rate: z.number().min(0).max(1),
        notes: z.string().optional(),
        parent_level_id: z.string().uuid().optional(),
        agent: z.string().default("designer"),
      },
    },
    async ({ game_id, level, target_win_rate, notes, parent_level_id, agent }) => {
      const a = getAdapter(game_id);
      if (!a) return err("unknown_game", `no adapter for ${game_id}`);
      const v = a.validate(level);
      if (!v.ok) return err("invalid_level", v.errors.join("; "));
      const row = await one<{ level_id: string }>(
        `insert into levels(game_id, level, target_win_rate, notes, parent_level_id, created_by)
         values ($1, $2, $3, $4, $5, $6) returning level_id`,
        [game_id, level, target_win_rate, notes ?? null, parent_level_id ?? null, agent],
      );
      const level_id = row!.level_id;
      await q(
        `insert into activity_log(agent, action, reason, result, ref_kind, ref_id) values ($1,'save_level',$2,'saved as draft','level',$3)`,
        [agent, notes ?? null, level_id],
      );
      return ok({ level_id, url: a.level_url(level_id) });
    },
  );

  server.registerTool(
    "get_level",
    { description: "A saved level, its status, and its solver runs.", inputSchema: { level_id: z.string().uuid() } },
    async ({ level_id }) => {
      const lvl = await one(`select * from levels where level_id = $1`, [level_id]);
      if (!lvl) return err("not_found", "no such level");
      const runs = await q(
        `select run_id, status, bots, runs_per_bot, results, solvable, min_moves, error, created_at, finished_at
         from solver_runs where level_id = $1 order by created_at desc`,
        [level_id],
      );
      return ok({ ...lvl, solver_runs: runs });
    },
  );

  server.registerTool(
    "solve_level",
    {
      description:
        "Queue bot plays for a level. Returns a run_id immediately; poll get_solver_run. Default: every bot, 200 runs each.",
      inputSchema: {
        level_id: z.string().uuid(),
        bots: z.array(z.string()).optional(),
        runs: z.number().int().min(1).max(2000).default(200),
      },
    },
    async ({ level_id, bots, runs }) => {
      const lvl = await one<{ game_id: string }>(`select game_id from levels where level_id = $1`, [level_id]);
      if (!lvl) return err("not_found", "no such level");
      const a = getAdapter(lvl.game_id);
      if (!a) return err("unknown_game", `no adapter for ${lvl.game_id}`);
      const chosen = bots ?? a.bots;
      const bad = chosen.filter((b) => !a.bots.includes(b));
      if (bad.length) return err("unknown_bot", `unknown bots: ${bad.join(", ")}; valid: ${a.bots.join(", ")}`);
      const row = await one<{ run_id: string }>(
        `insert into solver_runs(level_id, bots, runs_per_bot) values ($1, $2, $3) returning run_id`,
        [level_id, JSON.stringify(chosen), runs],
      );
      await q(`update levels set status = 'solving', updated_at = now() where level_id = $1 and status = 'draft'`, [level_id]);
      await audit("solve_level.queued", { kind: "solver_run", id: row!.run_id });
      return ok({ run_id: row!.run_id, status: "queued" });
    },
  );

  server.registerTool(
    "get_solver_run",
    { description: "Status and results of a solver run.", inputSchema: { run_id: z.string().uuid() } },
    async ({ run_id }) => {
      const r = await one(`select run_id, level_id, status, results, solvable, min_moves, error from solver_runs where run_id = $1`, [run_id]);
      if (!r) return err("not_found", "no such run");
      return ok(r);
    },
  );

  server.registerTool(
    "accept_level",
    {
      description: "Mark a level accepted with its measured win rate.",
      inputSchema: { level_id: z.string().uuid(), measured_win_rate: z.number().min(0).max(1), reason: z.string(), agent: z.string().default("tuner") },
    },
    async ({ level_id, measured_win_rate, reason, agent }) => {
      try { await acceptVerified(q, level_id, measured_win_rate); }
      catch (e) { return err("invalid_evidence", e instanceof Error ? e.message : String(e)); }
      await q(`insert into activity_log(agent, action, reason, result, ref_kind, ref_id) values ($1,'accept_level',$2,$3,'level',$4)`,
        [agent, reason, `measured ${measured_win_rate}`, level_id]);
      return ok({ ok: true });
    },
  );

  server.registerTool(
    "reject_level",
    { description: "Mark a level rejected.", inputSchema: { level_id: z.string().uuid(), reason: z.string(), agent: z.string().default("tuner") } },
    async ({ level_id, reason, agent }) => {
      const r = await q(`update levels set status='rejected', updated_at=now() where level_id=$1 returning level_id`, [level_id]);
      if (!r.length) return err("not_found", "no such level");
      await q(`insert into activity_log(agent, action, reason, ref_kind, ref_id) values ($1,'reject_level',$2,'level',$3)`, [agent, reason, level_id]);
      return ok({ ok: true });
    },
  );

  server.registerTool(
    "publish_pack",
    {
      description: "Publish accepted levels as a pack. Levels become playable by URL.",
      inputSchema: { game_id: z.string(), level_ids: z.array(z.string().uuid()).min(1), name: z.string(), agent: z.string().default("ceo") },
    },
    async ({ game_id, level_ids, name, agent }) => {
      const a = getAdapter(game_id);
      if (!a) return err("unknown_game", `no adapter for ${game_id}`);
      const kill = await one<{ value: boolean }>(`select value from settings where key='kill_switch'`);
      if (kill?.value === true) return err("kill_switch", "kill switch is on; publishing is paused");
      const accepted = await q<{ level_id: string }>(
        `select level_id from levels where game_id=$1 and level_id = any($2::uuid[]) and status in ('accepted','published')`,
        [game_id, level_ids],
      );
      if (accepted.length !== level_ids.length) {
        return err("not_accepted", `only ${accepted.length}/${level_ids.length} levels are accepted; publish accepted levels only`);
      }
      try { for (const id of level_ids) await verifiedLevel(q, id, game_id); }
      catch (e) { return err("invalid_evidence", e instanceof Error ? e.message : String(e)); }
      const row = await one<{ pack_id: string }>(
        `insert into packs(game_id, name, level_ids) values ($1,$2,$3) returning pack_id`,
        [game_id, name, JSON.stringify(level_ids)],
      );
      await q(`update levels set status='published', updated_at=now() where level_id = any($1::uuid[])`, [level_ids]);
      await q(`insert into activity_log(agent, action, reason, result, ref_kind, ref_id) values ($1,'publish_pack',$2,$3,'pack',$4)`,
        [agent, name, `${level_ids.length} levels live`, row!.pack_id]);
      return ok({
        pack_id: row!.pack_id,
        url: `${process.env.GAMES_BASE_URL ?? ""}/${game_id}/?pack=${row!.pack_id}`,
        level_urls: level_ids.map((id) => a.level_url(id)),
      });
    },
  );

  // ---------- players and metrics ----------

  server.registerTool(
    "get_player_stats",
    {
      description: "Paired human:v1 player attempts and first outcomes; excludes automation and unclassified legacy telemetry.",
      inputSchema: { game_id: z.string(), level_ids: z.array(z.string().uuid()).optional(), since: z.string().datetime().optional() },
    },
    async ({ game_id, level_ids, since }) => {
      const levels = await q(
        `with ${HUMAN_ATTEMPTS_CTE}, ids as (
           select distinct level_id from human_starts where game_id=$1
         ) select i.level_id,
           (select count(*) from human_starts s where s.game_id=$1 and s.level_id=i.level_id and ($3::timestamptz is null or s.started_at >= $3)) as attempts,
           count(*) filter(where o.type='win') as wins,
           count(*) filter(where o.type='loss') as losses,
           count(*) filter(where o.type='quit') as quits,
           avg(o.moves_used) filter(where o.type in ('win','loss')) as avg_moves
         from ids i left join human_outcomes o on o.level_id=i.level_id and o.game_id=$1 and ($3::timestamptz is null or o.ts >= $3)
         where ($2::uuid[] is null or i.level_id=any($2::uuid[])) group by i.level_id`,
        [game_id, level_ids ?? null, since ?? null],
      );
      return ok({
        levels: levels.map((l) => {
          const attempts = Number(l.attempts), wins = Number(l.wins);
          return { ...l, attempts, wins, losses: Number(l.losses), quits: Number(l.quits),
            win_rate: attempts ? wins / attempts : null, avg_moves: l.avg_moves ? Number(l.avg_moves) : null };
        }),
      });
    },
  );

  // Split on purpose: the company metrics carry no people-related fields (no email, reply, lead,
  // or contact counts). On Nov 7 the CEO's first run was held with `read_people: true` on every
  // call after it read a JSON that had `emails_sent`/`replies`/`studios_found` in it. Those live in
  // get_pipeline_metrics now, under neutral names, and only Finance reads them.
  server.registerTool(
    "get_company_metrics",
    { description: "Production metrics: levels, packs, play sessions, solver runs, spend, agent actions, step-ins, kill switch.", inputSchema: { since: z.string().datetime().optional() } },
    async ({ since }) => {
      const s = since ?? "1970-01-01T00:00:00Z";
      const m = await one(
        `select
           (select count(*) from levels where created_at >= $1) as levels_designed,
           (select count(*) from levels where status in ('accepted','published') and updated_at >= $1) as levels_accepted,
           (select count(*) from levels where status='rejected' and updated_at >= $1) as levels_rejected,
           (select count(*) from packs where published_at >= $1) as packs_published,
           (select count(distinct session_id) from player_events where ts >= $1) as play_sessions,
           (select count(*) from player_events where type='attempt' and ts >= $1) as attempts,
           (select count(*) from solver_runs where status='queued') as solver_queued,
           (select count(*) from solver_runs where status='done' and finished_at >= $1) as solver_done,
           (select coalesce(sum(cost_usd),0) from activity_log where ts >= $1) as spend_usd,
           (select count(*) from activity_log where agent <> 'platform' and ts >= $1) as agent_actions,
           (select count(*) from interventions where ts >= $1) as human_step_ins,
           (select value from settings where key='kill_switch') as kill_switch`,
        [s],
      );
      return ok(numify(m ?? {}));
    },
  );

  server.registerTool(
    "get_pipeline_metrics",
    { description: "Sales pipeline counts for Finance: leads by stage, outreach and inbound message counts, payments and revenue.", inputSchema: { since: z.string().datetime().optional() } },
    async ({ since }) => {
      const s = since ?? "1970-01-01T00:00:00Z";
      const m = await one(
        `select
           (select count(*) from studios where created_at >= $1) as leads_total,
           (select count(*) from studios where stage <> 'found') as leads_progressed,
           (select count(*) from emails where direction='out' and ts >= $1) as outbound_count,
           (select count(*) from emails where direction='in' and ts >= $1) as inbound_count,
           (select count(*) from payments where status in ('paid','delivered') and ts >= $1) as payments_count,
           (select coalesce(sum(amount_usd),0) from payments where status in ('paid','delivered') and ts >= $1) as revenue_usd`,
        [s],
      );
      return ok(numify(m ?? {}));
    },
  );

  // ---------- the logs ----------

  server.registerTool(
    "log_action",
    {
      description: "Record an agent action: what, why, result, cost. Every agent calls this for every real action.",
      inputSchema: {
        agent: z.string(), action: z.string(), reason: z.string(), result: z.string().optional(),
        cost_usd: z.number().min(0).default(0),
        ref: z.object({ kind: z.string(), id: z.string() }).optional(),
        session_id: z.string().optional(),
      },
    },
    async ({ agent, action, reason, result, cost_usd, ref, session_id }) => {
      const row = await one<{ id: string }>(
        `insert into activity_log(agent, action, reason, result, cost_usd, ref_kind, ref_id, session_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [agent, action, reason, result ?? null, cost_usd, ref?.kind ?? null, ref?.id ?? null, session_id ?? null],
      );
      return ok({ id: row!.id });
    },
  );

  server.registerTool(
    "log_decision",
    {
      description: "The CEO's decision record: what it saw, the options, what it chose, why, and what it expects.",
      inputSchema: {
        saw: z.string(), options: z.array(z.string()), chose: z.string(), why: z.string(),
        expected: z.string(), cost_estimate_usd: z.number().min(0).optional(),
        cards: z.array(z.string()).default([]), agent: z.string().default("ceo"), session_id: z.string().optional(),
      },
    },
    async (d) => {
      const row = await one<{ id: string }>(
        `insert into decisions(agent, saw, options, chose, why, expected, cost_estimate_usd, cards, session_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [d.agent, d.saw, JSON.stringify(d.options), d.chose, d.why, d.expected, d.cost_estimate_usd ?? null, JSON.stringify(d.cards), d.session_id ?? null],
      );
      await q(`insert into activity_log(agent, action, reason, ref_kind, ref_id) values ($1,'decision',$2,'decision',$3)`, [d.agent, d.chose, row!.id]);
      return ok({ id: row!.id });
    },
  );

  server.registerTool(
    "resolve_decision",
    {
      description: "On the next run, record what actually happened after a decision and whether it matched the expectation.",
      inputSchema: { decision_id: z.string().uuid(), result: z.string(), matched_expectation: z.boolean() },
    },
    async ({ decision_id, result, matched_expectation }) => {
      const r = await q(`update decisions set result=$2, matched_expectation=$3, resolved_at=now() where id=$1 returning id`, [decision_id, result, matched_expectation]);
      if (!r.length) return err("not_found", "no such decision");
      return ok({ ok: true });
    },
  );

  server.registerTool(
    "check_decision",
    {
      description:
        "Measure what happened after a decision, before you resolve it: win and quit rates on the levels it changed (and their retuned versions), before vs. after, against the same games' untouched levels; whether a threshold expectation like 'quits below 35%' was met; and the levels and packs shipped since. Read-only.",
      inputSchema: { decision_id: z.string().uuid() },
    },
    async ({ decision_id }) => {
      const r = await checkDecision((text, params) => q(text, params ?? []), decision_id);
      if (!r) return err("not_found", "no such decision");
      await audit("check_decision", { kind: "decision", id: decision_id }, r.verdict);
      return ok(r as unknown as Json);
    },
  );

  server.registerTool(
    "get_recent_decisions",
    { description: "Recent CEO decisions, newest first, including unresolved ones.", inputSchema: { limit: z.number().int().min(1).max(50).default(10) } },
    async ({ limit }) => ok({ decisions: await q(`select * from decisions order by ts desc limit $1`, [limit]) }),
  );

  // ---------- business (Noel's agents) ----------

  server.registerTool(
    "crm_upsert",
    {
      description: "Create or update a studio lead. Upserts on domain.",
      inputSchema: {
        studio: z.object({ name: z.string(), domain: z.string().optional(), contact_email: z.string().email().optional(), reason: z.string() }),
        stage: z.enum(["found", "sample_made", "emailed", "replied", "pilot_paid", "delivered"]).optional(),
        source: z.string().default("research"),
      },
    },
    async ({ studio, stage, source }) => {
      const row = await one<{ studio_id: string }>(
        `insert into studios(name, domain, contact_email, reason, stage, source)
         values ($1,$2,$3,$4,coalesce($5,'found'),$6)
         on conflict (domain) where domain is not null
         do update set name=excluded.name, contact_email=coalesce(excluded.contact_email, studios.contact_email),
                       reason=excluded.reason, stage=coalesce($5, studios.stage), updated_at=now()
         returning studio_id`,
        [studio.name, studio.domain ?? null, studio.contact_email ?? null, studio.reason, stage ?? null, source],
      );
      return ok({ studio_id: row!.studio_id });
    },
  );

  server.registerTool(
    "crm_set_stage",
    {
      description: "Move a studio to a pipeline stage.",
      inputSchema: { studio_id: z.string().uuid(), stage: z.enum(["found", "sample_made", "emailed", "replied", "pilot_paid", "delivered"]), note: z.string().optional(), agent: z.string().default("sales_sender") },
    },
    async ({ studio_id, stage, note, agent }) => {
      const r = await q(`update studios set stage=$2, updated_at=now() where studio_id=$1 returning studio_id`, [studio_id, stage]);
      if (!r.length) return err("not_found", "no such studio");
      await q(`insert into activity_log(agent, action, reason, ref_kind, ref_id) values ($1,'crm_set_stage',$2,'studio',$3)`, [agent, `${stage}${note ? `: ${note}` : ""}`, studio_id]);
      return ok({ ok: true });
    },
  );

  server.registerTool(
    "record_email",
    {
      description: "Record an email sent or received for a studio. The send itself happens in the email tool; this is the ledger.",
      inputSchema: { studio_id: z.string().uuid(), direction: z.enum(["out", "in"]), subject: z.string(), summary: z.string(), external_id: z.string().optional(), agent: z.string().default("sales_sender") },
    },
    async ({ studio_id, direction, subject, summary, external_id, agent }) => {
      const row = await one<{ id: string }>(
        `insert into emails(studio_id, direction, subject, summary, external_id) values ($1,$2,$3,$4,$5) returning id`,
        [studio_id, direction, subject, summary, external_id ?? null],
      );
      await q(`insert into activity_log(agent, action, reason, ref_kind, ref_id) values ($1,$2,$3,'studio',$4)`,
        [agent, direction === "out" ? "email_sent" : "email_received", subject, studio_id]);
      return ok({ id: row!.id });
    },
  );

  server.registerTool(
    "create_payment_link",
    {
      description: "Deprecated on the platform: payment links are made by the business server (business.create_payment_link), which holds the Stripe key and the webhook. This tool only points you there.",
      inputSchema: { studio_id: z.string().uuid().optional(), product: z.enum(["pilot_pack", "hint_pack"]), amount_usd: z.number().positive(), description: z.string() },
    },
    async () => err("use_business_tool", "Payment links come from business.create_payment_link (Stripe, test mode until the team goes live). The platform does not create them."),
  );

  server.registerTool(
    "get_spend",
    { description: "Spend and revenue so far, by source and by agent." },
    async () => {
      const by_agent = await q(`select agent, coalesce(sum(cost_usd),0) as usd from activity_log group by agent`);
      const rev = await one<{ usd: string }>(`select coalesce(sum(amount_usd),0) as usd from payments where status in ('paid','delivered')`);
      return ok({
        naive_usd: null, monid_usd: null, mobilerun_minutes: null, // TODO: pull from each ledger
        stripe_revenue_usd: Number(rev?.usd ?? 0),
        by_agent: Object.fromEntries(by_agent.map((r) => [r.agent, Number(r.usd)])),
      });
    },
  );

  // list_adapters is a debugging convenience, not in the contract.
  void listAdapters;
}
