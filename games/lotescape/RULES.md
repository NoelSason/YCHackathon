# Lot Escape rules

Lot Escape is an original game in the sliding-vehicle puzzle genre. This file records the genre
rules it follows, where it departs from them, and why. Only rules and mechanics are borrowed. No
commercial game's name, art, graphics, or levels are used.

All rules live in `src/engine.ts`. The browser game (`ui/main.ts`), the solver
(`src/solver.ts`), the bots (`src/bots.ts`), and the adapter (`adapter/index.ts`) all call it, so
they cannot disagree. The tests in `test/lotescape.test.ts` cover each rule below.

## Reference rules

### Sliding-block vehicle puzzle (the classic 6×6 traffic-jam puzzle)

- The board is a 6×6 grid. Every vehicle is one cell wide. Cars are two cells long and trucks
  are three. Sources: [Wikipedia: Rush Hour (puzzle)](https://en.wikipedia.org/wiki/Rush_Hour_(puzzle)),
  [Michael Fogleman, "Solving Rush Hour"](https://www.michaelfogleman.com/rush/).
- Vehicles slide only along their own lane: "forward & backward, not sideways." They never turn,
  and they are never lifted, so a vehicle can't pass through or jump over another one. Source:
  the official rules sheet, ["How to play"](https://lot.ahml.info/Rush_Hour_Rules.pdf)
  (ThinkFun, 2010).
- The goal is to get one marked car out through the single exit.
- Move counting: Fogleman defines a step as moving a piece one cell, and a move as moving one
  piece any number of cells in a single action. Wikipedia gives both counts for the hardest
  starting position.

### Parking-jam / car-escape variant

- Every vehicle has its own way out, shown by the way it faces or by an arrow on it. It can leave
  only in that direction, and the goal is to clear every vehicle from the lot. Sources:
  [Car Escape how-to](https://puzzle-game-io.pages.dev/game/car-escape) ("each car moves straight
  in the direction it faces") and the
  [Traffic Escape guide](https://apps-aup.pages.dev/blog/how-to-play-traffic-escape-guide-tips)
  ("every car has an arrow on top indicating its allowed direction of travel"; "if a car's path
  is blocked by another vehicle, it will stop"; "each level sets a limit on the number of moves").

## The rules Lot Escape uses

1. **Lot.** A square grid of `size` × `size` cells, from 5 to 8. The authored lots are 6×6, the
   classic size.
2. **Vehicles.** Each vehicle is one cell wide and 2 cells long (a car) or 3 cells long (a truck).
   `axis` is `h` (horizontal) or `v` (vertical). `x` and `y` give the cell nearest the top-left.
3. **Lane movement.** A vehicle slides along its own axis only. Each one-cell slide is legal only
   when the cell it moves into is inside the lot and empty. Vehicles never turn, jump, or pass
   through each other.
4. **One exit per vehicle.** `exit` is one end of the vehicle's own lane (`left` or `right` for
   `h`, `up` or `down` for `v`). The vehicle faces that way and carries an arrow toward it, and a
   gate in the same color marks the board edge. The other end of the lane is a wall. A vehicle may
   back up toward the wall to make room, but it can't leave that way.
5. **Leaving.** When a vehicle's front slides past its exit edge, it leaves the lot and stops
   blocking anything.
6. **Goal.** Every vehicle leaves within `move_limit` moves.
7. **Move counting.** Lot Escape counts **steps**: each cell a vehicle travels is one move,
   whether it got there by drag, arrow button, or key. The classic puzzle counts a multi-cell slide
   as one move. Lot Escape keeps step counting because every saved level's `move_limit`, and every
   solver and bot result already stored, is measured in steps. Changing the unit would silently
   change the difficulty of existing levels.
8. **Solver.** A breadth-first search over these rules returns the fewest steps that clear the
   lot, plus the step-by-step inputs. If the search reaches its state cap before finishing, the
   result is marked `truncated`, and the adapter reports that the lot is too large to check. It
   doesn't claim the lot is unsolvable.

## Controls (browser)

- **Drag** a vehicle along its lane. It follows your finger only as far as it can legally go and
  settles on the nearest cell. Dragging most of the way through its exit sends it out.
- **Tap, then arrow.** Tap a vehicle to select it, then use the arrow buttons. A button is
  disabled when the selected vehicle can't move that way.
- **Keyboard.** Arrow keys or WASD move the selected vehicle. Tab, `n`, `]`, and `[` change the
  selection.
