# Lot Escape level design

Lot Escape is a lane-sliding vehicle evacuation puzzle. The board is an `N × N` lot (`size` 5–8). A vehicle has an ID, integer origin (`x`, `y`), length 2 or 3, axis `h` or `v`, a matching `exit` direction, and one of the six supported colors. Vehicles never turn; each move slides exactly one cell along the vehicle's axis. A vehicle exits when its front reaches its marked edge. The player wins only when every vehicle has exited.

The level object is `{ title, size, vehicles, move_limit }`. Each car's `exit` must match its axis: `left` or `right` for horizontal, `up` or `down` for vertical. Give each car a unique slug ID, keep all starting cells inside the lot, and do not overlap cars. `move_limit` must be at least the exact minimum from `adapter.solve`; the adapter rejects unsolvable or over-budget designs.

Design readable lots with one clear first move, meaningful blockers, and a compact solution. Check that every vehicle can eventually reach an edge along its own lane. Use the shared adapter for validation and the exact solver for minimum moves; do not duplicate movement rules. The seeded `random` bot is a noisy play signal, while `search` returns the exact solution when it fits the limit.
