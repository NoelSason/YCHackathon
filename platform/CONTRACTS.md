# Platform contracts

Owner: **Abhinav**. These are the three contracts the platform owns, due 3:00 PM Sat. Once agreed,
changes must stay backward compatible or be flagged in `log.md`.

1. [How a game adapter plugs in](#1-game-adapter-how-it-plugs-into-the-platform) (with Max, Pinara)
2. [The MCP tool list](#2-mcp-tool-list) (with Pinara, Noel)
3. [The activity log and step-in log](#3-activity-log-and-step-in-log) (with everyone)

Tables are in `platform/db/schema.sql`. The MCP server is in `platform/mcp/`.

---

## 1. Game adapter: how it plugs into the platform

Max owns each adapter's contents (`README.md` → "The shared contract: the game adapter"). This
section only fixes **where it lives and how the platform calls it**, so the Solver and the MCP
server share one copy of each game's rules.

- Each game is a directory `games/<game_id>/` with its **adapter as an ESM module** at
  `games/<game_id>/adapter/index.ts` (or `.js`). `game_id` is a short slug: `match3`, `board`,
  `runner`.
- The module's default export:

```ts
export interface Adapter {
  game_id: string;                       // same as the directory name
  name: string;                          // our fork's own name (never the original game's)
  schema: object;                        // JSON Schema for one level
  validate(level: unknown): { ok: true } | { ok: false; errors: string[] };
  simulate(level: object, bot: string, seed: number): { won: boolean; moves_used: number; detail?: object };
  solve?(level: object): { solvable: boolean; min_moves?: number; inputs?: unknown };
  bots: string[];                        // bot names accepted by simulate(), e.g. ["random", "greedy", "search"]
  level_url(level_id: string): string;   // public URL that opens that level in the browser game
}
```

- `simulate` and `solve` run in **Node with no DOM**. Nothing in the adapter may touch `window`,
  `document`, canvas, or timers.
- **Player events** are POSTed by the browser game to the platform API:
  `POST /events` with JSON `{ game_id, level_id, session_id, type: "attempt"|"win"|"loss"|"quit", moves_used?, time_seconds? }`.
  Fire `attempt` when a level starts, exactly one of `win`/`loss`/`quit` when it ends.
- **Saved level loading:** `GET /levels/:level_id` returns `{ level_id, game_id, level, status }` for
  public play URLs. Level IDs are random UUIDs; level writes remain authenticated through MCP.
- `games/<game_id>/SKILL.md` is the Naïve skill for the Designer and Tuner. The platform pushes it
  with `naive skill push --slug game-<game_id>`.

The platform imports adapters by `game_id` from a registry (`platform/mcp/src/adapters.ts`). Until
an adapter lands, the registry has a `stub` game whose `validate` always passes and whose
`simulate` returns a coin flip, so agents can be built against it.

---

## 2. MCP tool list

One server, `platform/mcp`, exposed over Streamable HTTP at `https://<host>/mcp`. Naïve attaches
it as an MCP toolset; the bearer token is in Naïve's vault keyed to that URL (Naïve rejects inline
auth headers). Tool names below are what Pinara and Noel put in each agent's `tools.configs`.
**Naïve defaults MCP tools to `ask`**, so every tool an agent uses must be set to `allow` by
name, per agent, or the overnight run stops. Nothing here needs to be `ask`.

Every tool: input is a JSON object, output is a JSON object. Errors come back as
`{ error: { code, message } }`, never as a thrown tool error, so the agent can read them.

| Tool | Input | Output | Permission | Used by |
|---|---|---|---|---|
| `list_games` | `{}` | `{ games: [{ game_id, name, bots, schema_url, targets: { default_win_rate } }] }` | allow | all |
| `validate_level` | `{ game_id, level }` | `{ ok, errors[] }` | allow | Designer, Tuner |
| `save_level` | `{ game_id, level, target_win_rate, notes?, parent_level_id? }` | `{ level_id, url }` | allow | Designer, Tuner |
| `get_level` | `{ level_id }` | `{ level_id, game_id, level, target_win_rate, status, measured_win_rate?, solver_runs: [...] }` | allow | Tuner, CEO |
| `solve_level` | `{ level_id, bots?: string[], runs?: number }` (default all bots, 200 runs each) | `{ run_id, status: "queued" }` | allow | Tuner |
| `get_solver_run` | `{ run_id }` | `{ run_id, status: "queued"\|"running"\|"done"\|"failed", results?: { [bot]: { runs, wins, win_rate, avg_moves } }, solvable?, min_moves?, error? }` | allow | Tuner |
| `accept_level` | `{ level_id, measured_win_rate, reason }` | `{ ok }` | allow | Tuner |
| `reject_level` | `{ level_id, reason }` | `{ ok }` | allow | Tuner |
| `publish_pack` | `{ game_id, level_ids[], name }` | `{ pack_id, url, level_urls[] }` | allow | CEO (board `publish` card) |
| `get_player_stats` | `{ game_id, level_ids?, since?: iso }` | `{ levels: [{ level_id, attempts, wins, losses, quits, win_rate, avg_moves }] }` | allow | CEO, Tuner |
| `get_company_metrics` | `{ since?: iso }` | `{ levels_designed, levels_accepted, levels_rejected, packs_published, play_sessions, attempts, solver_queued, solver_done, spend_usd, agent_actions, human_step_ins, kill_switch }` — **no people-related fields** (see note) | allow | CEO, Finance |
| `get_pipeline_metrics` | `{ since?: iso }` | `{ leads_total, leads_progressed, outbound_count, inbound_count, payments_count, revenue_usd }` | allow | Finance only |
| `log_action` | `{ agent, action, reason, result?, cost_usd?, ref?: { kind, id } }` | `{ id }` | allow | all |
| `log_decision` | the decision record (§3) | `{ id }` | allow | CEO |
| `resolve_decision` | `{ decision_id, result, matched_expectation: boolean }` | `{ ok }` | allow | CEO |
| `get_recent_decisions` | `{ limit? }` | `{ decisions: [...] }` | allow | CEO |
| `crm_upsert` | `{ studio: { name, domain?, contact_email?, reason }, stage? }` | `{ studio_id }` | allow | Research, Sales |
| `crm_set_stage` | `{ studio_id, stage, note? }` | `{ ok }` | allow | Sales |
| `record_email` | `{ studio_id, direction: "out"\|"in", subject, summary, external_id? }` | `{ id }` | allow | Sales Sender, Sales Reader |
| `create_payment_link` | `{ studio_id?, product: "pilot_pack"\|"hint_pack", amount_usd, description }` | `{ url, payment_link_id }` | allow (test mode) | Sales, Finance |
| `get_spend` | `{}` | `{ naive_usd, monid_usd, mobilerun_minutes, stripe_revenue_usd, by_agent: {...} }` | allow | Finance, CEO |

**People-data rule (Nov 7, 17:00):** Naïve held every call in the CEO's chat with `read_people:
true` after one tool returned JSON containing `emails_sent`, `replies`, and `studios_found`. So
tool outputs the CEO or Tuner read must not carry email, reply, lead, or contact counts or text.
Those live in `get_pipeline_metrics` and the business tools, read by Finance and Sales only.

Solver execution is **Pinara's harness**. `solve_level` only inserts a `solver_runs` row with
`status = 'queued'`; the harness claims queued rows, runs the adapter, and writes results. The
Tuner polls `get_solver_run`. Keep `solve_level` async: a synchronous tool that takes 90 s will
time out.

Human-only actions (kill switch, step-ins) are **not** MCP tools. They go through the dashboard
or `platform/bin/` scripts and write to `interventions`.

**Stage names** (CRM): `found → sample_made → emailed → replied → pilot_paid → delivered`.

---

## 3. Activity log and step-in log

Three tables, one shape each. The dashboard and the demo read these; nothing is typed in by hand.

**`activity_log`** — every agent action (via `log_action`, and written by the platform itself
for every tool call):

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `ts` | timestamptz | server time |
| `agent` | text | `ceo`, `designer`, `tuner`, `playtest`, `research`, `sales_sender`, `sales_reader`, `finance`, `platform` |
| `action` | text | short verb phrase: `save_level`, `email_sent`, `pack_published` |
| `reason` | text | why, in the agent's words |
| `result` | text | what happened; null if pending |
| `cost_usd` | numeric | 0 if unknown; Finance reconciles later |
| `ref_kind`, `ref_id` | text | optional pointer: `level`, `pack`, `studio`, `solver_run`, `card` |
| `session_id` | text | Naïve session id when known |

**`decisions`** — the CEO's decision record (from `docs/agent-plan.md`), one row per decision:

| Field | Type |
|---|---|
| `id` | uuid |
| `ts` | timestamptz |
| `agent` | text (`ceo`) |
| `saw` | text |
| `options` | jsonb (string[]) |
| `chose` | text |
| `why` | text |
| `expected` | text |
| `cost_estimate_usd` | numeric |
| `cards` | jsonb (string[]) |
| `result` | text, filled by `resolve_decision` on the next run |
| `matched_expectation` | boolean, null until resolved |
| `resolved_at` | timestamptz |

**`interventions`** — every human step-in:

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `ts` | timestamptz | |
| `who` | text | first name |
| `what` | text | what the human did |
| `why` | text | why it was needed |
| `ref_kind`, `ref_id` | text | optional |
| `kind` | text | `approval` (clicked a Naïve approval), `fix` (changed code or data), `kill` (kill switch), `manual` (did an agent's job by hand) |

**Autonomy number** on the dashboard = `count(activity_log where agent != 'platform') / (that + count(interventions))` over the unattended window. Never typed in.
