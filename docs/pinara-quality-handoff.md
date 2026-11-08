# Pinara quality completion and host handoff

Scope: master-plan packages 8, 10 and 11 and Pinara's two game clients. The separate local
`forge/` game-building chatbot and unfinished main-checkout edits are excluded.

## Implemented

- One shared adapter per game for browser, bots and exact solvers; all five adapters supported.
- Queue claims, heartbeats, seed replay, time limits and graceful resume. Automatic Tuner keeps
  the Designer's target, records each version/measurement, and accepts only current payload/rules
  evidence with at least 200 completed reference games. Twelve bounded tuning rounds; rejection
  is an honest outcome when the target cannot be reached.
- Shared MCP acceptance/publication guards. Old APIs retain their signatures. Old unversioned
  evidence remains historical and cannot pass a new acceptance check.
- Five explicit Designer schedules and a scoped rollout command that preserves other agents,
  permissions and existing budget caps. Designer writes level JSON only, never new game code.
- Per-attempt telemetry distinguishes manual play, engine replay and `?qa=1` automation. Evals,
  CEO before/after checks and the finite 100-ahead/1,000-cap buffer use paired manual outcomes;
  old events remain stored, unclassified. A client source tag is not authenticated human identity.
- Racer repair creates verified child revisions and a catalog manifest; original URLs, payloads,
  solver history and old packs remain available. Publication waits for the corrected client.

## Completed production maintenance

Executed from committed source `c8defba`, with separate human-intervention records:

- Restored both documented incident chains to the requested **30%** target. The match-3 leaf
  accepted at **34% / 200 games**. The incorrect Splash Sort acceptance was withdrawn; its
  retuned chain rejected because integer move budgets could not meet the original target.
- Replayed all **100** original production racer levels using the corrected shared rules,
  **200 games each**: **69** on target, **31** need a new version. Original levels/runs preserved.

The following rollout/repair commands are idempotent or resumable. Their actual outcomes will
be recorded below after execution; code or a dry run alone is not production proof.

## Commands for the hosting owners

**Abhinav:** deploy the current platform MCP/HTTP source, which adds the missing Lot Escape
adapter and the acceptance/publication guards. The live `/games/lotescape/schema` returned 404
while the other four schemas returned 200. Repin the CEO roster's Designer/Tuner versions after
the scoped quality rollout; do not rerun the entire team setup just to deploy Pinara's prompts.
Restart your own old worker from committed source. Our worker restart does not update Noel's.

**Noel/Max:** deploy the committed `site/` (all game bundles, `play.js`, and
`games/catalog-overrides.json`) through the existing Vercel project. This machine has no Vercel
project link, CLI login or token. A GitHub push does not prove a Vercel deployment.

After deploying the racer bundle, from a clean checkout with solver dependencies and DATABASE_URL:

```sh
cd solver
node --env-file=.env --import tsx src/production/repair-catalog.ts --game racer --write --publish \
  --manifest-out /tmp/racer-catalog.json --out /tmp/racer-repairs.jsonl
```

Existing verified children are reused from Neon. The command checks the deployed racer rules
marker before publishing a new verified 100-level pack. Old packs are retained. Compare the
output manifest with the committed `site/games/catalog-overrides.json`.

Naïve quality operations (requires the existing `platform/naive/.env`, keys never committed):

```sh
cd platform/naive
npm run quality:apply -- --out /tmp/quality-plan.json
npm run quality:apply -- --write --verify --out /tmp/quality-rollout.json
cd ../../solver
node --env-file=../platform/naive/.env --import tsx src/production/quality-proof.ts --in /tmp/quality-rollout.json --out /tmp/quality-proof.json
```

The five explicit verification sessions have a **$0.50 maximum each**, not a spend estimate.
Their consumed provider cost, saved root ids and current accepted descendants are checked by
`quality-proof.ts`. `idle` or `end_turn` alone does not pass. If Lot Escape still fails, deploy the
backend first, then use a new `--label` for a deliberately new verification (not an accidental
retry). All human-requested operations are interventions, not autonomous achievements.

## Evidence still requiring other people or time

- Noel's Mobilerun phone playtests and recordings: append **`qa=1`** to every automated play URL.
  Never call agent taps human calibration. No device was provisioned, reset or released here.
- Real player calibration needs at least 15 paired completed manual attempts per level; zero
  qualifying points must be reported honestly. Pinara cannot manufacture human play.
- The CEO's expected-vs-result check needs real scoped before/after data. `not_enough_data`
  remains the correct result until it exists. No guessed uplift or autonomy number is inserted.
- Abhinav runs the full company demo readiness suite, and Noel records the backup demo.
