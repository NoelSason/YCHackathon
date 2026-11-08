# Evals and the CEO's decision check

Owner: **Pinara** (package 11 in `docs/master-plan.md`). It answers two questions with numbers:
**is the level pipeline any good**, and **did each CEO decision work**.

Everything here is read-only: it never writes to the database.

## Commands

```bash
cd evals
npm install
cp ../solver/.env .env               # the same DATABASE_URL as the harness; never commit .env
npm run report                       # pipeline evals per game (add -- --json for the dashboard)
npm run report -- --since=2026-11-08T02:00:00-08:00   # only what happened since a time
npm run decision -- <decision_id>    # the CEO's "did it work?" check for one decision
npm run tunability                   # offline eval set, no database or agents (a few minutes)
npm test && npm run typecheck
```

## The CEO's decision check (`check_decision`)

It's the MCP tool `check_decision` (in `platform/mcp/src/tools.ts`), and `npm run decision` here.
Given a decision:

1. **Scope.** It reads the level ids and game ids named in the decision's text and cards, then
   adds the newer versions the Tuner made from those levels after the decision.
2. **Effect.** It compares players' win and quit rates on those levels before and after the
   decision, in equal windows of up to 6 h, **against the same game's untouched levels**. That's a
   difference-in-differences, so a busier or quieter hour doesn't look like an effect. A |z| of 2
   or more counts as a clear change.
3. **Expectation.** A threshold like "quits below 35%" or "win rate above 40%" is checked
   automatically, and reported as `meets_expectation`.
4. **Honesty.** It returns `not_enough_data` below 15 finished plays per group, and says why. It
   returns `too early` for decisions under 15 minutes old.
5. **Pipeline since the decision.** It counts levels designed, accepted, and rejected, packs
   published, and the error against target.
6. **No person-like fields.** The output uses only counts and rates, so it shouldn't trip Naïve's
   people-data rule.

The CEO's prompt (`platform/naive/src/roster.ts`, step 2) calls `check_decision` before
`resolve_decision`. It sets `matched_expectation` from these numbers, and leaves a decision
unresolved until there's enough data. After 6 h, it resolves it as "Not enough data: …".

**Tested end to end** on a local Postgres through the deployed handler (`fn.ts`). A retuned
Splash Sort level's quits fell from 50% to 19.5% while an untouched level stayed flat:

| Measure | Result |
|---|---|
| Effect on quits | −30.5 pts (z −2.27) |
| Expectation "below 35%" | met |
| Decision | resolved as matched |

## The pipeline report (`npm run report`)

Per game:

- **Hit rate.** A design hits when a version tuned from it is accepted within **4 versions** and
  **5 points** of its target. Hit rate = hits ÷ (accepted + rejected designs).
- **Rounds to accept** and the **mean error** of accepted levels against their target.
- **Solver runs** done and failed.
- **Calibration.** For accepted or published levels with 15 or more finished plays: the reference
  bot's predicted win rate against real players. This is the demo's strongest proof that the bots
  predict people. The reference bot is the first of `human`, `search`, `greedy` that the game has.
- **Cost per accepted level,** from the Designer's and Tuner's `cost_usd` in `activity_log`. It's
  $0 if the agents don't report cost.

## The eval set (`npm run tunability`)

There are 5 targets per game (20%, 35%, 50%, 65%, 80%), on fixed levels. A scripted ideal Tuner
moves only the main knob, for at most 4 solver rounds, and hits when within 5 points. This shows
what each game *can* do, and it's the baseline for the LLM Tuner.

Results on Nov 7, 5:30 PM:

| Game | Hits | What it showed |
|---|---|---|
| Turbo Lanes | 7–8 / 10 | About 3.5 points per tick of `time_limit`. Misses come from the 4-round limit on curved tracks. |
| Splash Sort | **8 / 10** (was 4 / 10) | The first human bot played almost perfectly, so each extra pour jumped 30 to 50 points. The bot now wastes about 3 pours in 10, as people do, so each pour is 15 to 19 points. |
| Match-3 (Max) | 0 / 5 | `greedy` jumps from 26% to 43% to 60% to 100% between 6 and 11 moves, and takes about 1.7 s per game. See `log.md`. |

### Running it on the real agents

The master plan says to run it after every prompt change. To do that:

1. Give the Designer one design card per game and target from this set.
2. Let the Tuner work.
3. Run `npm run report -- --since=<when you started>`.

Keep a prompt change only if the hit rate and error hold or improve.
