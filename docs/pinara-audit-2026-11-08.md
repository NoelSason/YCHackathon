# Pinara audit — November 8, 2026, around midnight PT

Scope: master-plan packages 8, 10 and 11, plus the game UI/mechanics work Pinara explicitly requested. Work was isolated from the main checkout's unfinished Claude edits. No Naïve agents, schemas, levels, or teammate commits were removed.

## Fixed and checked

- Turbo Lanes: a cleared traffic car could collide again after a lane switch; the shared engine now retains bounded cleared-object history, and bot/search state keys include it. A sideways boost pad also failed to refresh an already active boost; decay now occurs before pickup collection.
- Splash Sort: manual input, hint or undo cancels both the solver interval and its pending delayed pour. Full uninterrupted replay still wins.
- Lot Escape: canceling a drag restores the board without spending moves. Manual input cancels autoplay, and restart drops any in-progress drag.
- Mosslight Trails: a player's legal landing cancels autoplay. Scripted restart preserves verified-series position.
- Tuner: simulation exceptions immediately finish and log the measurement as failed instead of leaving it running.
- Production: an import cannot silently report success when the deterministic ID already holds different content or difficulty. Existing content is preserved. Accepted checkpoints are remembered before an inventory race can stop their import, preventing redundant generation.
- CEO evals: inclusive thresholds accept equality; impossible percentages are rejected; later retunes are discovered through intermediate versions made before the decision.
- Match-3: default play resumes the ordered verified catalog; the last level in a verified pack offers the next catalog position, through 1,000. Saved-level loading can use the already-hosted platform API when the laptop's public API fails. Missing difficulty metadata stays unreported, and the UI identifies simulation results as bots.

Verification: 128 tests across solver, evals, the five game adapters and the player API; typechecks; rebuilt bundles. Browser regressions cover takeover, undo, cancel, restart and winning replay. A real saved production level was replayed to a win in each of sort, racer, lot and platformer. The rebuilt match-3 client played Garden 0001 with seven real pointer swaps using a deterministic board seed, won, offered Garden 0002 and resumed it after reload, using the actual hosted fallback API. All QA player-event requests were blocked.

The catalog remains finite: maintain 100 ahead of the contiguous completed prefix, cap at 1,000, preserve old excess stock, and run no generation while stocked. Existing buffer regressions cover all five games.

## Production snapshot

Read from Neon at 23:57 PT, not manually entered into the product:

| Game | Accepted or published levels | Published subset |
|---|---:|---:|
| Splash Sort | 578 | 116 |
| Turbo Lanes | 102 | 100 |
| Gem Garden | 233 | 220 |
| Lot Escape | 118 | 18 |
| Mosslight Trails | 100 | 0 |

All 1,250 recorded solver runs were done; none queued, running or failed. The eval report's mean absolute bot-target error was 3.2 percentage points. Its historical hit benchmark remains the stricter four-round/five-point benchmark; it has not been relaxed to inflate results.

All five production HTML routes returned 200. The public `/levels-latest` endpoint then repeatedly returned 530, while the separately hosted platform `/health` and saved-level endpoints worked. Route availability alone is not an end-to-end pass. New GitHub bundles must still be deployed by the hosting operator.

## Remaining work and owners

| Work | Owner / evidence needed |
|---|---|
| Deploy the rebuilt site, including `site/play.js`; restore the public list/pack API behind the laptop tunnel | Noel/Max. This machine has no Vercel project link, CLI login or token; a GitHub push is not proof of deployment. Recheck all five routes, list API, saved-level play and pack progression afterward. |
| Human difficulty calibration | Pinara, with Noel's real phone playtests. The production eval returned zero calibration points for every game: no level has the minimum 15 completed plays needed by the report. Raw events include tests/autoplay and must not be presented as unique humans. |
| Validate old racer difficulty evidence against the corrected mechanics | Pinara. Existing evidence describes older rules; new solver/generator runs use the corrected shared engine. Do not relabel old evidence as freshly remeasured. |
| Full Naïve Designer → Tuner → Solver demonstration and prompt eval after changes | Pinara/Abhinav. The deterministic compiler is a utility, not proof that an autonomous Naïve session made a decision. Keep agent budgets and audit logs. |
| Expected-vs-result evidence for the latest CEO decision | Pinara/Abhinav. Decision `91d3b2a2-3b53-4612-9ab4-9702a2dc6fb5` returned `not_enough_data`, with 0 scoped completions before and after. |
| Real phone check/recording and full demo readiness command | Noel/Max/Abhinav, under the master-plan checklist. Headless desktop checks do not replace Mobilerun evidence. |
| Runtime rollout | The producer processes load source at startup. Restart only the owning process deliberately; do not kill or replace Claude's separate lot/platformer watcher. |

Five previously verified authored platformer drafts remain staged separately from the 100 production levels. Their pack launch should be finished after the public pack API is healthy; do not claim a broken pack URL as shipped.

The report's recorded agent cost was zero because those rows do not contain provider billing. That is not a claim that total credits or this coding session cost zero.
