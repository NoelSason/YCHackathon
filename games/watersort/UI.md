# Splash Sort client

The mineral-glass interface is original CSS: responsive tubes, numbered positions, completed-tube
checkmarks, valid-target markers, visible color completion and remaining pours, and reduced-motion
support. The goal remains sorting all colors before the pour limit.

Each attempt has three optional Reveal a hint assists. The existing exact solver searches the
current board (bounded to 50,000 states) and highlights the next source and destination. A hint
never changes the board, grants moves, or changes the win condition. Failure to find a hint
consumes nothing. Bot difficulty measurements describe unassisted play.

Rules follow the water-sort genre (`RULES.md`). Each tube is drawn exactly `capacity` units tall, so
every tube in a level is the same size, and each run of one color is one continuous band of liquid.
Tubes sit in one row when they fit, otherwise in two balanced rows, and shrink to fit an 11-tube
board on a 390 px phone. A picked tube lifts, and the tubes it can pour into get a ring. A pour tips
the source tube toward its target while a stream falls and the levels move.

Each attempt has three undos. An undo puts back the board and the pour count. When no pour is left,
the board stays open and the Undo button is highlighted. With no undo left, the attempt ends as a
loss. Restarting or leaving a stuck board reports a loss, not a quit, the same way the bots count
it. Illegal taps explain themselves ("red can't go on blue", "Tube 3 is full"). On desktop the
keyboard works too: 1 to 9, 0 and - pick tubes, arrows move focus, Esc cancels, U undoes, and R
restarts.

LevelOps continues using the registered watersort adapter and the same level JSON and rules.
`?level=<id>`, `?data=<base64url JSON>`, samples, autoplay and player events are preserved.
Practice plays do not emit platform events. Level switches record quits on platform attempts;
old autoplay callbacks and result overlays cannot mutate a newly loaded board.

Build with `npm run build`. Hosting and live platform availability need the respective owners'
deployment; no deployment is implied by a source push.

### Color labels and practice collection

The Color labels toggle adds three-letter color names to every liquid band, so players can
identify colors without relying on hue. The preference is saved locally when browser storage is
available; the control still works if storage is blocked. Level cards display actual color counts
and pour limits from the built-in levels. Saved platform levels hide this practice collection.
