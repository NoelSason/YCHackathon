# Gem Match rules

These are the match-3 rules the engine, the adapter (and so the Solver), and the web player at
`/play` follow. Only genre rules are used here. No commercial game's name, art, levels, or text is
copied (see `AGENTS.md`).

## References

- [Tile-matching video game](https://en.wikipedia.org/wiki/Tile-matching_video_game), Wikipedia:
  swapping two adjacent tiles, legal swaps must create a match, gravity, refill, cascades, goals, and
  move limits in level-based games.
- [Match Game Mechanics: An exhaustive survey](https://www.gamedeveloper.com/design/match-game-mechanics-an-exhaustive-survey),
  Jonathan Bailey, Game Developer (2015): cascades, L/T match shapes, special tiles as rewards,
  shuffle, and win/lose conditions.
- [Bejeweled, Candy Crush and other Match-Three Games are (NP-)Hard](https://arxiv.org/abs/1403.5830),
  Gualà, Leucci, Natale (2014): the swap → match → pop → fall model.
- [Match-3 game genre guide](https://abratabia.com/game-genres/match-3-game.php), Abratabia: an
  invalid swap swaps back, a dead board is reshuffled into a solvable state, 4- and 5-match specials,
  goals within a set number of moves.
- [Phaser match-3 tutorial](https://generalistprogrammer.com/tutorials/phaser-match-3-puzzle-tutorial),
  Generalist Programmer: rejected swaps animate back, input is locked during cascades, and the board
  is shuffled when no valid move is left, without creating free matches.

## The rules

| # | Rule | Where it lives |
|---|---|---|
| 1 | You swap two orthogonally adjacent tiles. Diagonal or distant swaps are not allowed. | Engine `applyAction` (`not-adjacent-active-gems`); player only sends neighbor swaps. |
| 2 | A swap is legal only if it makes a line of 3 or more of one color. Exceptions: two special tiles may always swap, and the color-clear tile may swap with any tile. Swapping two identical tiles is never legal. | Engine `applyAction`, `isValidSpecialSwap`. |
| 3 | An illegal swap costs no move and leaves the board unchanged. On screen the two tiles trade places and slide back. | Engine returns the same state. Player `nope()`. |
| 4 | Every line of 3+ clears at once. Horizontal and vertical lines are both checked. | Engine `findMatches`, `planWave`. |
| 5 | Tiles above fall into the gaps, new random tiles fill from the top, and any new lines clear again (a cascade). This repeats until the board is stable. Each cascade wave scores more. Input is locked until it settles. | Engine `advanceTicks` phases: clear-mark → clear-remove → gravity → refill. Player `busy`. |
| 6 | A starting board has no lines already made and at least one legal swap. | Engine `createGame`. |
| 7 | Special tiles: 4 in a line makes a line tile (a horizontal 4 clears its row, a vertical 4 its column). An L or T shape makes a bomb tile that clears the 3×3 around it. 5 in a line makes a color-clear tile that removes every tile of one color. Specials fire when they are cleared, and swapping two specials together combines them. | Engine `specials.ts` (`row-beam`, `column-beam`, `bomb`, `colour-burst`). |
| 8 | Each level has goals (collect N tiles of one color; clear all ice, when the level has ice) and a move limit. Only legal swaps use a move. | Adapter `levelOptions` → engine Challenge mode. |
| 9 | You win the moment every goal is met. You lose when the last move is used and a goal is still open. | Engine end-of-move check. |
| 10 | If no legal swap is left and moves remain, the board reshuffles itself: same tiles, no free matches, at least one legal swap. It costs no move. The level only ends if no such arrangement exists. | Engine end-of-move check, `shuffledBoard` (Level AI change, below). |
| 11 | Ice sits on a cell, not on the tile, and doesn't block swaps or falling tiles. Clearing a match on that cell removes one layer. | Engine seals. Player calls them "ice". |

## Changes to the Houseki engine

The engine in `engine/houseki-gem-swap/` is Houseki's MIT-licensed Gem Swap engine. One rule
differed from the genre standard and was changed in the smallest way:

- **Dead board in Challenge mode.** Houseki ended a Challenge run as lost when no legal swap was
  left (`no-legal-actions`), even with moves remaining. Only its Relaxed mode could reshuffle, and
  only when the player asked. Now `engine-ticks.ts` reshuffles a dead Challenge board automatically,
  using the same shuffle as Relaxed mode (moved into `shuffledBoard` in `practice.ts`, so the random
  stream is unchanged). The run isn't marked assisted, and it emits `board-reshuffled` with
  `automatic: true`. If the move limit is already used up, the level still ends as lost.
  Effect measured with the adapter's bots on the "Winding Orchard" practice level: random-bot wins
  went from 58/100 to 100/100. Before the change, all 42 of its losses were dead boards with moves
  left.
  Tests: `test/match3.test.ts`.

## One copy of the rules

- The browser player (`player/`, bundled into `site/play.js`) and the adapter both import the engine
  from `engine/` and the level mapping from `adapter/levels.ts` (`levelOptions`). There is no second
  copy of the rules or of the level format.
- Built-in practice levels (`PRACTICE_LEVELS` in `adapter/levels.ts`) use the same level JSON as
  agent-made levels. `/play` offers them only while no agent-made match-3 level is published, and
  labels them as practice. Practice plays aren't sent as player events.
