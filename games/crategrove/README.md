# Crate Grove (`crategrove`)

Crate Grove is an original Sokoban-style puzzle. Push every crate onto a lantern in as few moves
as possible. It contains its own small browser game, practice levels, seeded `human` and `random`
bots, and an exact breadth-first solver. The same pure engine runs in the browser, solver, and
platform adapter.

## Run locally

```sh
cd games/crategrove
npm install
npm run dev
npm run typecheck
npm run build
```

Open `http://localhost:5176/`. Use arrow keys, WASD, touch swipes, or the on-screen controls.
Undo and restart are available; `?demo=0`, `?demo=1`, and `?demo=2` select practice levels.

## Platform URL and events

`?level=<uuid>` loads a saved level through the public platform `GET /levels/:id` endpoint. Set
`window.STUDIO_API` to the platform origin before loading the game to enable saved-level reads and
player events. Without it, the local practice levels still work. `adapter/index.ts` returns the
`${GAMES_BASE_URL}/crategrove/?level=<uuid>` URL used by the platform.

## Files

- `src/engine.ts`: shared movement rules and rendering state.
- `src/solver.ts`: breadth-first shortest-path search.
- `src/bots.ts`: seeded random play and exact-solver play.
- `src/levels.ts`: original practice levels.
- `adapter/index.ts`: platform schema, validation, solve, simulation, and URL.
- `ui/main.ts`, `public/`: responsive keyboard and touch game.
- `SKILL.md`: level authoring guidance for the Designer and Tuner.

The game uses original names and CSS-drawn art. It contains no commercial game assets or copied
levels.
