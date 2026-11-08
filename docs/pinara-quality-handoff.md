# Pinara quality completion and host handoff

Scope: master-plan packages 8, 10 and 11 and Pinara's two game clients. The separate local
`forge/` game-building chatbot and unfinished main-checkout edits are excluded.

## Implemented

- One shared adapter per game for browser, bots and exact solvers; all five adapters supported.
- Queue claims, heartbeats, seed replay, time limits and graceful resume. Automatic Tuner keeps
  the Designer's target, records each version/measurement, and accepts only current payload/rules
  evidence with at least 200 completed reference games. Twelve bounded tuning rounds; rejection
  is an honest outcome when the target cannot be reached.
- A zero-win measurement without an exact solvability proof cannot be accepted.
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

- All **31** off-target racer positions now have accepted child revisions in production Neon, each
  with 200 independent verification games. Together with the 69 originals, **100/100** opening
  catalog positions satisfy current policy. The committed manifest selects these revisions.
  The new pack remains unpublished until the corrected client is deployed.
- Pinara's processes run committed source; the two buffer watchers are pinned to `5b4468a`.
  The solver worker's heartbeat id identifies its exact quality commit. All five buffers are healthy
  without new generation. No surplus stock was removed. Other people's processes were untouched.
- Designer reached Naïve **v14** and Tuner **v13**, with five game-specific Designer schedules. Existing
  caps/tools preserved. The five initial verification sessions consumed **$0.228678**.
  Four authored roots were saved. Lot Escape's save failed because its live backend adapter is
  missing. An older remote worker accepted match-3/racer without current evidence; a guarded
  repair rechecked those leaves. Current 200-game results versus the unchanged 50% target:
  **match-3 56%**, **racer 51%**, **platformer 45.5%**, **watersort 53.5%**. The match-3
  result uses the documented confidence-interval allowance; it is 6 points from target.
  Splash Sort accepted on the third authored layout; the two genuinely untunable layouts remain
  rejected, not hidden. All **seven** verification sessions consumed **$0.340456** total.
  See [machine-readable proof](evidence/pinara-quality-2026-11-08.json) for sessions, roots and run ids.
- Pinara's readiness check now excludes compiler stock and incomplete/old rules evidence; it
  reports missing real authored proof honestly. At 04:03 PT only **Lot Escape** lacks the live
  authored path because the hosted backend has no adapter for it; the five-game local harness
  and generator regressions pass. This is an external deployment handoff, not a passed demo gate.

The rollout/repair commands below are idempotent or resumable. A source-code change, dry run or
cleanly ended session is not production proof.

## Commands for the hosting owners

**Abhinav:** deploy the current platform MCP/HTTP source, which adds the missing Lot Escape
adapter and the acceptance/publication guards. The live `/games/lotescape/schema` returned 404
while the other four schemas returned 200. Repin the CEO roster's Designer/Tuner versions after
the scoped quality rollout; do not rerun the entire team setup just to deploy Pinara's prompts.
Restart your own old worker from committed source. Our worker restart does not update Noel's.
Old public packs remain playable. New acceptance/publication requires current evidence: to use
legacy unversioned stock in a new pack, remeasure it first with `solver/src/production/remeasure.ts`
(`--game <id> --write`) and retune any off-target result. Do not relabel old evidence as fresh.

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

## Final verification

146 tests passed: solver 61, evals 13, racer 23, watersort 14, lotescape 20, platformer 7,
match-3 8. The final playability guard also passed 14 targeted acceptance/tuner regressions and
the explicit zero-win/no-exact-proof case. All affected packages typecheck. Browser checks cover
manual takeover, cancellation, undo, full solver replay, first-input telemetry, paired outcomes,
restart identity and engine isolation; match-3 won a real saved level with seven pointer swaps,
advanced and resumed. QA transports were intercepted.
