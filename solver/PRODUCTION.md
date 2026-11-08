# Fast level production (Pinara)

A deterministic content compiler for the existing Naïve company. The Naïve Designer/CEO still own
creative direction and publication; this is a finite generation/testing utility, not another
agent framework. It uses the registered adapters, their existing bots, schemas, and exact solvers.
It does not change game rules or replace Claude's bot/harness work.

## Run

From `solver/`, after installing its existing dependencies:

```sh
# Author a 1,000-position plan for each game; explicitly NOT tested or accepted.
npm run production -- --plan-only

# Generate, tune, independently verify, and checkpoint up to 1,000 per game.
npm run production

# Fill only the next 100 playable positions, using DATABASE_URL in .env.
npm run production -- --database

# Keep checking once a minute; generate only when players reduce the ahead buffer.
npm run production -- --database --watch

# A small run, or a late-game benchmark. --count counts positions from --start.
npm run production -- --count 10
npm run production -- --start 1000 --count 1
```

For live database runs, the 1,000 positions are a ceiling, not a request to fill all stock upfront.

All three games run concurrently, with one CPU worker per game. There is no 10-minute LLM cron
wait between these jobs. A worker has a **55-second wall-clock deadline per position**, including
layout retries; the parent kills an over-budget solver. This targets at least one accepted level
per minute per game, but isn't a throughput guarantee: difficult layouts can fail verification,
CPU contention matters, and failed positions remain unaccepted. Each run is bounded to positions
1–1000. `--games watersort,racer,match3`, `--series 2`, `--max-seconds 55`, and `--out <jsonl>`
control scope, reproducible series, deadline (1–60 s), and checkpoint path.

## Why it is faster

Instead of repeatedly simulating a board while guessing its allowance:

1. Author a seeded layout from the current chapter's recipe.
2. Prove solvability with the existing exact solver where available (sort/racer).
3. Play 64 reference-bot runs to measure a completion-time/collection distribution.
4. Propose a move/time/collection target from its quantile.
5. **Play at least 200 real verification attempts with fresh seeds** on the proposed level. Only
   actual win/loss results can accept a level. A correction gets fresh verification seeds again.
6. Use the existing Tuner acceptance policy: within 5 percentage points, or within 8 points when
   the target lies inside the 95% Wilson interval. Failure retries another layout, never loosens
   this gate or fabricates results.

Collection distributions for match-3 are proposals only: seals and early stopping can change
results, so the independent replay is mandatory. There is no exact solvability claim for match-3.
The production script benefits from Claude's separately committed match-3 and racer speedups.

## Progression and features

Each game has 40 chapters of 25 positions. The opening five target an 85% reference-bot win rate.
Normal levels gradually target 75% → 60%; every tenth level is a challenge (45% → 35%), followed
by a recovery level (85% → 75%). These are targets, with measured rates stored separately.

- **Turbo Lanes:** traffic/cones/coins first; boosts from 8, shields from 20, oil from 35; three,
  four, then five lanes; later higher speed, denser patterns, and occasional steering cooldown.
- **Splash Sort:** three to six colors, then taller tubes and occasional one-buffer challenges;
  different seeded color stacks and pour limits. Existing hint/undo assists stay in the client;
  bots remain unassisted.
- **Match-3:** four to six colors, seals from 20, shaped boards from 50, more seals later, layered
  seals on late challenge levels. Match-created specials use the engine's existing rules.

These are new configurations and combinations of **supported mechanics**, not 1,000 newly coded
mechanics. Layouts are new and deterministic. Sort duplicate detection ignores title, allowance,
tube order, and color relabeling. No commercial game assets or levels are used.

## Resume, stop, and LevelOps

Outputs default to `solver/production/production-v1-<series>.jsonl` (git-ignored). Restart the exact
command to skip completed positions and retry missing/failed ones with fresh deterministic layout
seeds. Each run makes up to three passes over missing slots, without replaying successful ones.
Remaining gaps are reported explicitly and return exit status 2. Each successful result includes
the level, position, features, target, actual measured result, seeds, sample size, interval, and
runtime. A failed candidate never becomes accepted content. A truncated final line is backed up
and recovered. One process owns an output file; a second writer is refused and stale locks from
crashes are recoverable. Ctrl-C/SIGTERM cancels active workers and retains completed checkpoints.

With `--database`, one SQL statement atomically adds the accepted `levels` row, its `solver_runs`
evidence, and an `activity_log` entry. IDs are deterministic by recipe version/series/game/position;
reimporting a checkpoint cannot duplicate these rows. A checkpoint is written before import, so
restarting can finish an interrupted import. Both `settings.kill_switch` and the optional additive
`settings.production_kill_switch` (JSON boolean) stop database production. No schema change is
required. Company logs label this as a deterministic compiler (`platform`), not an LLM decision.

**This never creates packs or publishes automatically.** The existing Naïve CEO/publishing path
handles accepted content. It does not send email, charge cards, or provision phones. Run phone
checks before presenting a new feature combination as phone-tested. **Abhinav/Max:** the new
producer marker `created_by='production'` and JSON notes contain sequence/chapter/features;
existing accepted-level and publish tools keep their interfaces.

For a long-running live job, use a detached git worktree pinned to the tested commit. Do not pull
or rebase in that runtime checkout while it spawns workers: an in-progress rebase can temporarily
remove a job module. Develop and pull in a separate checkout, then stop/resume production on the
new pinned commit using the same checkpoint.

## Demand-driven stock rule

Live database production maintains **100 positions ahead of the completed sequence**, separately
for each game and production series. With no wins it prepares positions 1–100. Completing positions 1–50 means the target is 150. A one-off win on a late level does not
pretend that all earlier levels were completed. Only missing positions 51–150 are requested; already completed
positions are not regenerated. Attempts, losses, and solver runs do not advance this frontier.
The 1,000-position ceiling remains (at position 950, only positions 951–1000 remain).

`--database` fills that window once and exits. `--database --watch` rechecks every 60 seconds
(`--poll-seconds` can change the interval). A full buffer starts no CPU worker or bot simulations.
Existing surplus, including content made by the old bulk run, remains untouched: production pauses
until progress reaches a window with gaps. The importer applies the same guard, so restarting an
old checkpoint cannot import new excess levels. Existing accepted/published content is never
removed, retired, or trimmed by this rule. Offline plans/benchmarks remain explicitly finite tasks.

Progress is taken from `player_events` wins joined to the production sequence metadata in level
notes. The contiguous completed prefix across recorded wins sets the shared catalog's frontier; earlier players retain all previous levels. Unsequenced Designer/studio-order content is not assigned an invented
position, and the separate studio pack-delivery workflow is unchanged. No API/schema change.
