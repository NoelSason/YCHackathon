# Splash Sort client

The mineral-glass interface is original CSS: responsive tubes, numbered positions, completed-tube
checkmarks, valid-target markers, visible color completion and remaining pours, and reduced-motion
support. The goal remains sorting all colors before the pour limit.

Each attempt has three optional Reveal a hint assists. The existing exact solver searches the
current board (bounded to 50,000 states) and highlights the next source and destination. A hint
never changes the board, grants moves, or changes the win condition. Failure to find a hint
consumes nothing. Bot difficulty measurements describe unassisted play.

LevelOps continues using the registered watersort adapter and the same level JSON and rules.
`?level=<id>`, `?data=<base64url JSON>`, samples, autoplay and player events are preserved.
Practice plays do not emit platform events. Level switches record quits on platform attempts;
old autoplay callbacks and result overlays cannot mutate a newly loaded board.

Build with `npm run build`. Hosting and live platform availability need the respective owners'
deployment; no deployment is implied by a source push.
