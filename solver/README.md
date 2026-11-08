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

`runs`, `wins`, `win_rate`, and `avg_moves` are the contract's shape. The other three fields are
additive:

- `ci95_low` and `ci95_high` are the 95% Wilson interval of the win rate.
- `first_seed` is the first of the seeds used.

**Seeds** come from the run id: `first_seed`, `first_seed + 1`, and so on. Every bot gets the same
seeds, so bots are compared on equal luck, and anyone can replay a run exactly.

### Stuck runs

A run left `running` for more than `STALE_MINUTES` (default 15) is marked `failed`, with the
error "harness stopped before finishing". Without this, the Tuner would poll a dead run forever.

## Run it

```bash
cd solver
npm install
cp .env.example .env    # put DATABASE_URL in .env (ask Abhinav). Never commit it.
npm run worker          # keeps polling; use this for the overnight run
npm run drain           # processes everything queued, then exits
```

`PGSSL=0` turns TLS off for a local Postgres. Neon needs TLS, so leave it unset for Neon.

## Checks

```bash
npm run typecheck
npm test     # stats, the run logic, and the queue against platform/db/schema.sql in PGlite
```

## What adapters must do for the harness

These come from `platform/CONTRACTS.md` §1:

- `simulate(level, bot, seed)` must be **deterministic for a given seed**, run with no DOM, and
  return `{ won: boolean, moves_used: number }`. A malformed result fails the run.
- `simulate` should be fast. The default run is 200 games for each bot.
- `solve`, if present, runs inline in the worker. It must stop on its own, for example with a step
  limit, or it blocks the queue.

## Not decided yet

- **Where the worker runs overnight.** The platform runs as a Neon Function, which suits
  request/response, not a polling worker. Render was dropped. Until the team decides, run it on a
  laptop that stays awake.
