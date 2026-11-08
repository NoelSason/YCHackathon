// Lot Escape rules shared by the browser game, bots, solver, and adapter.
export type Axis = "h" | "v";
export type Direction = "left" | "right" | "up" | "down";
export interface Vehicle { id: string; x: number; y: number; length: number; axis: Axis; exit: Direction; color: string }
export interface Level { title: string; size: number; vehicles: Vehicle[]; move_limit: number }
export interface State { vehicles: Vehicle[]; moves: number; won: boolean }
export const DIRECTIONS: Direction[] = ["left", "right", "up", "down"];
const DELTA: Record<Direction, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

export function initialState(level: Level): State { return { vehicles: level.vehicles.map((v) => ({ ...v })), moves: 0, won: level.vehicles.length === 0 }; }
export function cells(vehicle: Vehicle): Array<[number, number]> {
  return Array.from({ length: vehicle.length }, (_, i) => [vehicle.x + (vehicle.axis === "h" ? i : 0), vehicle.y + (vehicle.axis === "v" ? i : 0)]);
}
function overlaps(a: Vehicle, b: Vehicle, size: number): boolean {
  const bCells = new Set(cells(b).filter(([x, y]) => x >= 0 && y >= 0 && x < size && y < size).map(([x, y]) => `${x},${y}`));
  return cells(a).some(([x, y]) => x >= 0 && y >= 0 && x < size && y < size && bCells.has(`${x},${y}`));
}
export function move(level: Level, state: State, id: string, direction: Direction): State {
  if (state.won) return state;
  const index = state.vehicles.findIndex((v) => v.id === id), vehicle = state.vehicles[index];
  if (!vehicle || (vehicle.axis === "h" && direction !== "left" && direction !== "right") || (vehicle.axis === "v" && direction !== "up" && direction !== "down")) return state;
  const [dx, dy] = DELTA[direction], next = { ...vehicle, x: vehicle.x + dx, y: vehicle.y + dy };
  const outside = cells(next).some(([x, y]) => x < 0 || y < 0 || x >= level.size || y >= level.size);
  if (outside && direction !== vehicle.exit) return state;
  if (state.vehicles.some((other, i) => i !== index && overlaps(next, other, level.size))) return state;
  const escaped = outside;
  const vehicles = state.vehicles.slice();
  if (escaped) vehicles.splice(index, 1); else vehicles[index] = next;
  return { vehicles, moves: state.moves + 1, won: vehicles.length === 0 };
}
export function legalMoves(level: Level, state: State): Array<{ id: string; direction: Direction }> {
  return state.vehicles.flatMap((v) => DIRECTIONS.flatMap((direction) => {
    const next = move(level, state, v.id, direction);
    return next === state ? [] : [{ id: v.id, direction }];
  }));
}
export function stateKey(state: State): string { return state.vehicles.slice().sort((a, b) => a.id.localeCompare(b.id)).map((v) => `${v.id}:${v.x},${v.y}`).join("|"); }
