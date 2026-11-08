# Splash Sort rules reference

Splash Sort follows the standard rules of the water-sort genre. This page lists those rules, the
sources they come from, and the few places where Splash Sort differs on purpose. Only rules and
mechanics are borrowed. The name, look, colors, and every level are our own (`AGENTS.md`).

The rules live in one place, `src/engine.ts`. The browser game, the bots, the exact solver, and the
platform adapter all import them, so they can't disagree.

## Sources

- **[S1]** Ito, Kawahara, Minato, Otachi, Saitoh, Suzuki, Uehara, Uno, Yamanaka, Yasui. "Sorting
  Balls and Water: Equivalence and Computational Complexity." FUN 2022.
  [arXiv:2202.09495](https://arxiv.org/abs/2202.09495). The formal definition of the water-sort
  puzzle: n + k bins of capacity h, n of them full and k empty. A move pours the top color onto
  an empty bin or a matching top color. If the target has room, all the water of that color
  moves; otherwise only as much as fits. The goal is every bin full of one color, or empty. The
  paper also shows that deciding whether a deal can be solved is NP-complete.
- **[S2]** Puzzle Madness, [Ball sort](https://puzzlemadness.co.uk/ballsort/medium). The same rules
  for the ball variant: you can't overfill a container, most puzzles hold 4 per container, you can
  always move into an empty container, and only onto the same color.
- **[S3]** Visu, [Water Sort](https://visu.network/games/water-sort-puzzle/). Pour only onto the
  same color or into an empty tube, and only while there's room. You can undo or restart. The game
  says when no moves are left. Every puzzle is checked for a solution before you play it.

No Wikipedia article covers the genre, so it isn't cited.

## The rules we follow

| # | Rule | Source | Where in the code |
|---|---|---|---|
| 1 | A tube holds `capacity` units, **4 by default** (levels may use 2 to 5). | S1, S2 | `Level.capacity`, `LIMITS` |
| 2 | Only the top of a tube can move. | S1, S2 | `top`, `topRun` |
| 3 | You may pour only into an **empty tube** or onto the **same top color**, and only if there's room. | S1, S2, S3 | `pourBlock`, `pourAmount` |
| 4 | A pour moves the **whole top run** of one color, **or as much as fits**. The rest stays behind. | S1 | `pourAmount` |
| 5 | A tube is **done** when it's full of one color. | S1 | `isComplete` |
| 6 | You **win** when every tube is sorted or empty. | S1, S2, S3 | `isSolved` |
| 7 | A deal has one tube per color plus **spare tubes, usually 2 empty ones**. Every color exactly fills one tube. | S1, S2 | `validateLevel` |
| 8 | When **no pour is left**, the game says so and you can undo or restart. | S3 | `isStuck`, `ui/main.ts` |
| 9 | **Undo** takes back the last pour. | S3 | `ui/main.ts` |
| 10 | A published level is **checked for a solution** first. | S1, S3 | `solveLevel`, `generateSolvableLevel`, `adapter.solve` |

## Where Splash Sort differs on purpose

- **Pour limit.** Each level has `move_limit` pours. Running out is a loss. Most water-sort games
  have no limit. Ours is the difficulty knob the Tuner moves, so it stays.
- **Finished tubes are sealed.** You can't pour out of a full one-color tube. Most games behave this
  way, and pouring out of a finished tube never helps.
- **Undo is limited to 3 per attempt.** Undo puts back both the board and the pour count, so
  unlimited undo would make the pour limit meaningless. Hints work the same way: 3 per attempt.
  Bot win rates measure play without undo or hints.
- **Stuck counts as a loss.** If no pour is left and no undo remains, the attempt ends as a loss,
  the same way the bots count it. If you restart or leave while stuck, that's also reported as a
  loss, not a quit.
- **Spare tubes don't have to start empty.** A level may spread its liquid over the spare tubes.
  The validator only checks the totals: exactly `capacity` units of each color, and one or two more
  tubes than colors.

## Controls

- **Phone:** tap a tube to pick it up, then tap the tube to pour into. If you tap a tube you can't
  pour into, it's picked instead, and a short message says why the pour wasn't allowed.
- **Desktop:** click, as on a phone, or use the keyboard. Keys 1 to 9 pick tubes 1 to 9, 0 picks
  tube 10, and - picks tube 11. Arrow keys move between tubes, and Enter or Space taps the tube
  that has focus. Esc cancels a pick, U or Ctrl/Cmd+Z undoes, and R restarts.
