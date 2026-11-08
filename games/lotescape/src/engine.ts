// Lot Escape rules shared by the browser game, bots, solver, and adapter.
export type Axis = "h" | "v";
export type Direction = "left" | "right" | "up" | "down";
export interface Vehicle { id: string; x: number; y: number; length: number; axis: Axis; exit: Direction; color: string }
export interface Level { title: string; size: number; vehicles: Vehicle[]; move_limit: number }
export interface State { vehicles: Vehicle[]; moves: number; won: boolean }
export const DIRECTIONS: Direction[] = ["left", "right", "up", "down"];

export function initialState(level: Level): State { return { vehicles: level.vehicles.map((v) => ({ ...v })), moves: 0, won: level.vehicles.length === 0 }; }
export function cells(vehicle: Vehicle): Array<[number, number]> {
  return Array.from({ length: vehicle.length }, (_, i) => [vehicle.x + (vehicle.axis === "h" ? i : 0), vehicle.y + (vehicle.axis === "v" ? i : 0)]);
}
/** `stepAlongLane` result: the slide is illegal. */
export const BLOCKED = -2;
/** `stepAlongLane` result: the slide takes the vehicle out through its exit. */
export const EXITS = -1;
/**
 * The one movement rule. Every caller (the browser, `move`, the solver, the generator) goes
 * through it, so they cannot disagree. A one-cell slide is legal only along the vehicle's own
 * axis. It enters exactly one new cell, the one ahead of its front: that cell must be inside the
 * lot and empty, or, if it lies past the edge, that edge must be the vehicle's exit, in which
 * case the vehicle leaves. Returns the vehicle's new position along its axis (`x` for "h", `y`
 * for "v"), `EXITS`, or `BLOCKED`. `occupied(x, y)` reports in-lot cells held by other vehicles.
 */
export function stepAlongLane(size: number, vehicle: Pick<Vehicle, "x" | "y" | "length" | "axis" | "exit">, direction: Direction, occupied: (x: number, y: number) => boolean): number {
  const horizontal = vehicle.axis === "h";
  if (horizontal ? direction !== "left" && direction !== "right" : direction !== "up" && direction !== "down") return BLOCKED;
  const forward = direction === "right" || direction === "down";
  const at = horizontal ? vehicle.x : vehicle.y, laneAt = horizontal ? vehicle.y : vehicle.x;
  const lead = forward ? at + vehicle.length : at - 1;
  if (lead < 0 || lead >= size) return direction === vehicle.exit ? EXITS : BLOCKED;
  if (horizontal ? occupied(lead, laneAt) : occupied(laneAt, lead)) return BLOCKED;
  return forward ? at + 1 : at - 1;
}
function covers(v: Vehicle, x: number, y: number): boolean {
  return v.axis === "h" ? y === v.y && x >= v.x && x < v.x + v.length : x === v.x && y >= v.y && y < v.y + v.length;
}
export function move(level: Level, state: State, id: string, direction: Direction): State {
  if (state.won) return state;
  const index = state.vehicles.findIndex((v) => v.id === id), vehicle = state.vehicles[index];
  if (!vehicle) return state;
  const to = stepAlongLane(level.size, vehicle, direction, (x, y) => state.vehicles.some((other, i) => i !== index && covers(other, x, y)));
  if (to === BLOCKED) return state;
  const vehicles = state.vehicles.slice();
  if (to === EXITS) vehicles.splice(index, 1); else vehicles[index] = vehicle.axis === "h" ? { ...vehicle, x: to } : { ...vehicle, y: to };
  return { vehicles, moves: state.moves + 1, won: vehicles.length === 0 };
}
/** Cells a vehicle must still travel to leave: the fewest moves it needs if nothing were in the way. */
export function distanceToExit(size: number, vehicle: Vehicle): number {
  switch (vehicle.exit) {
    case "right": return size - vehicle.x - vehicle.length + 1;
    case "left": return vehicle.x + 1;
    case "down": return size - vehicle.y - vehicle.length + 1;
    case "up": return vehicle.y + 1;
  }
}
export function legalMoves(level: Level, state: State): Array<{ id: string; direction: Direction }> {
  return state.vehicles.flatMap((v) => DIRECTIONS.flatMap((direction) => {
    const next = move(level, state, v.id, direction);
    return next === state ? [] : [{ id: v.id, direction }];
  }));
}
/** The two directions a vehicle may slide along its own axis. Only its `exit` side is open; the other end is a wall. */
export function axisDirections(vehicle: Vehicle): [Direction, Direction] { return vehicle.axis === "h" ? ["left", "right"] : ["up", "down"]; }
/**
 * How far a vehicle can slide in one direction from this state, counted in one-cell steps, and
 * whether the last of those steps takes it out through its exit. Built on `move`, so the browser
 * drag, the arrow buttons, and the solver all follow the same rules.
 */
export function slideLimit(level: Level, state: State, id: string, direction: Direction): { steps: number; exits: boolean } {
  let current = state, steps = 0;
  const cap = level.size + 3;
  while (steps < cap) {
    const next = move(level, current, id, direction);
    if (next === current) break;
    steps++; current = next;
    if (!current.vehicles.some((v) => v.id === id)) return { steps, exits: true };
  }
  return { steps, exits: false };
}
/** Slides a vehicle up to `steps` cells, one counted move per cell, stopping early when blocked or out. */
export function slide(level: Level, state: State, id: string, direction: Direction, steps: number): State {
  let current = state;
  for (let i = 0; i < steps; i++) {
    const next = move(level, current, id, direction);
    if (next === current) break;
    current = next;
    if (!current.vehicles.some((v) => v.id === id)) break;
  }
  return current;
}
export function stateKey(state: State): string { return state.vehicles.slice().sort((a, b) => a.id.localeCompare(b.id)).map((v) => `${v.id}:${v.x},${v.y}`).join("|"); }
