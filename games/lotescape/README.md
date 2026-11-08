# Lot Escape (`lotescape`)

An original lane-sliding parking puzzle. Each vehicle has a marked exit. Slide it along its fixed lane; if another car blocks the route, clear that car first. Evacuate every vehicle within the move limit. The browser and the level adapter use the same engine, and the breadth-first solver reports the fewest car-step moves.

## Play locally

```sh
cd games/lotescape
npm install
npm run dev
npm run typecheck
```

Open `http://localhost:5179/`. Select a car and use the arrow buttons or keyboard arrows. Drag a car to slide it several cells. `?demo=1` opens the second practice lot. A saved platform level uses `?level=<uuid>`.

## Adapter

`adapter/index.ts` exports the platform `Adapter`: schema, overlap and solvability validation, exact solve, seeded simulation, and URL loading. The game ID is `lotescape`. Browser events use the standard `/events` contract when `PLATFORM_URL` is configured.

## Files

- `src/engine.ts`: shared movement rules and state.
- `src/solver.ts`: shortest-move breadth-first solver.
- `src/levels.ts`: authored practice layouts.
- `src/bots.ts`: deterministic random and solver-backed simulations.
- `adapter/index.ts`: platform schema, validate, solve, simulate, and URL.
- `ui/main.ts`, `public/`: responsive playable game with original SVG car art.
- `SKILL.md`: Designer/Tuner level authoring guidance.
