# Solver harness

Owner: **Pinara** (package 8 in `docs/master-plan.md`). It turns "is this level too hard?" into
numbers.

## What it does

`platform/CONTRACTS.md` §2: the `solve_level` tool only queues a row in `solver_runs`. This worker:

1. **Claims** the oldest queued run (`status = 'running'`, `claimed_by`, `started_at`). Several
   workers can run at once, because the claim uses `for update skip locked`.
2. **Plays** the level with each requested bot, `runs_per_bot` times. It uses the game's adapter
   from the platform's own registry, `platform/mcp/src/adapters.ts`, so the harness and the MCP
   server run the same rules. It calls `validate` first, and `solve` once if the adapter has it.
3. **Writes** `results`, `solvable`, and `min_moves` (`status = 'done'`), or a readable `error`
   (`status = 'failed'`). It also adds one `activity_log` row as agent `platform`
   (`solver_run.done` or `solver_run.failed`), the same as the platform's own audit rows, so the
   autonomy number isn't affected.

It never changes `levels`. The Tuner accepts or rejects them.

### Results per bot

```json
{ "random": { "runs": 200, "wins": 80, "win_rate": 0.4, "avg_moves": 7.4,
              "ci95_low": 0.3338, "ci95_high": 0.4699, "first_seed": 1313858495 } }
```

`runs`, `wins`, `win_rate`, and `avg_moves` are the contract's shape. The other fields are
additive:

- `ci95_low` and `ci95_high` are the 95% Wilson interval of the win rate.
- `first_seed` is the first of the seeds used.
- `budget_hit` and `runs_requested` appear only when the time budget ended play early. Then
  `runs` is the number actually played.

### Slow games: parallel play and a time budget

The worker plays 3 games first to time the game.

- **Slow games go parallel.** If the remaining games would take over 2 s, it splits them across
  worker threads. The default is `SOLVER_THREADS` = cores − 2.
- **Results don't change.** Every game keeps its seed, so the numbers are identical to
  single-threaded play.
- **Each run has a time budget.** The default is `SOLVER_MAX_SECONDS` = 240, shared fairly between
  the bots, with at least 20 games per bot.
- **Why the budget is needed.** Match-3's `greedy` bot takes about 1.7 s a game:

  | Match-3 `greedy`, 200 games | Time |
  |---|---|
  | One thread | about 6 minutes |
  | 6 threads | about 2 minutes |

  A run of 1,000 or more games would pass the 15-minute stuck rule without a budget.

**Seeds** come from the run id: `first_seed`, `first_seed + 1`, and so on. Every bot gets the same
seeds, so bots are compared on equal luck, and anyone can replay a run exactly.

### Stuck runs

A run left `running` for more than `STALE_MINUTES` (default 15) is marked `failed`, with the
error "harness stopped before finishing". Without this, the Tuner would poll a dead run forever.

### Which games a worker knows, and the heartbeat

A worker knows only the games that were in the adapter registry when it started. **After a pull
that adds or changes a game, restart the worker.** It claims only runs for games it knows. A run
for any other game stays queued for an up-to-date worker instead of failing, because a failed run
makes the Tuner reject a level that was fine. The worker logs `queued_for_unknown_games` when
this happens.

Every 30 s the worker writes a heartbeat to `settings` under `solver_worker:<WORKER_ID>`, as
`{ worker, games, started_at, at }`, and adds `stopped: true` on a clean stop. The
`solver_queue` readiness check reads it. The check fails when no worker has written in 3 minutes
(after switch-on), or when a game has queued runs that no live worker knows.

### The automatic Tuner (`src/autotune.ts`)

**Why it's a program.** Naïve flags a chat after its first MCP read. From then on, every MCP call
in that chat waits for a person, even at `allow` (Naïve docs, tools.md, "Once a chat has read
people's data"). An LLM Tuner's loop (solve → read → adjust → save → accept) therefore can't run
unattended.

**How the work is split.** The Designer agent saves one level per chat with a single `save_level`
call. When its queue is idle, the worker tunes each new Designer level:
1. Claim it (`draft` → `solving`, `for update skip locked`).
2. Measure the reference bot. Each measurement is a `solver_runs` row with the usual seeds.
3. Move the game's knob, and save the new version with `parent_level_id`.
4. Accept within 5 pts of the target in at most 4 rounds, or reject with the reason.

Superseded versions are retired as `rejected`. Each step is an `activity_log` row: agent `tuner`,
reason starting "auto-tuner (program):".

**Knobs:**

| Game | Knob | Floor |
|---|---|---|
| watersort | `move_limit` | the solver's minimum |
| racer | `time_limit` | the solver's minimum |
| match3 | `goal.target` | — (bigger is harder, about 3–5 pts per gem; 100 games per round because `greedy` is slow) |

Games with no knob (platformer) aren't claimed. `AUTOTUNE=0` turns the auto-tuner off on a worker.

## Run it

```bash
cd solver
npm install
cp .env.example .env    # put DATABASE_URL in .env (ask Abhinav). Never commit it.
caffeinate -i npm run worker   # keeps polling; the Mac stays awake for the overnight run
npm run drain                  # processes everything queued, then exits
```

`PGSSL=0` turns TLS off for a local Postgres. Neon needs TLS, so leave it unset for Neon.

## Checks

```bash
npm run typecheck
npm test     # stats, run logic, the queue on platform/db/schema.sql in PGlite, parallel = sequential
```

## What adapters must do for the harness

These come from `platform/CONTRACTS.md` §1:

- `simulate(level, bot, seed)` must be **deterministic for a given seed**, run with no DOM, and
  return `{ won: boolean, moves_used: number }`. A malformed result fails the run.
- `simulate` should be fast: the default run is 200 games for each bot. A game slower than about
  50 ms makes every tuning round take minutes, even with parallel play.
- **Restart the worker after pulling a new or changed adapter.** It loads the registry at start. A
  game it doesn't know fails with "no adapter for game X in this worker; pull and restart the
  worker".
- `solve`, if present, runs inline in the worker. It must stop on its own, for example with a step
  limit, or it blocks the queue.

## Not decided yet

- **Where the worker runs overnight.** The platform runs as a Neon Function, which suits
  request/response, not a polling worker. Render was dropped. Until the team decides, run it on a
  laptop that stays awake.
