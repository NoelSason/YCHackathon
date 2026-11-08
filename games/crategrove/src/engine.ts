// Crate Grove rules. This module is shared by the browser, bots, solver, and platform adapter.
export const TILES = ["#", ".", "S", "B", "G", "*", "+"] as const;
export type Tile = (typeof TILES)[number];
export type Direction = "up" | "down" | "left" | "right";
export interface Level { title: string; map: string[]; move_limit: number }
export interface State { player: number; boxes: number[]; moves: number; won: boolean }
export const DELTA: Record<Direction, number> = { up: 0, down: 0, left: -1, right: 1 };
const VERTICAL: Record<Direction, number> = { up: -1, down: 1, left: 0, right: 0 };
export const DIRECTIONS: Direction[] = ["up", "right", "down", "left"];

export function dimensions(map: string[]) { return { width: map[0]?.length ?? 0, height: map.length }; }
export function indexOf(map: string[], x: number, y: number) { return y * (map[0]?.length ?? 0) + x; }
export function baseMap(map: string[]): string[] {
  return map.map((row) => [...row].map((c) => {
    if (c === "S" || c === "B") return ".";
    if (c === "+" || c === "*") return "G";
    return c;
  }).join(""));
}
export function initialState(level: Level): State {
  const player = level.map.join("").search(/[S+]/);
  const boxes: number[] = [];
  [...level.map.join("")].forEach((c, i) => { if (c === "B" || c === "*") boxes.push(i); });
  return { player, boxes: boxes.sort((a, b) => a - b), moves: 0, won: boxes.every((b) => level.map[Math.floor(b / level.map[0]!.length)]?.[b % level.map[0]!.length] === "*") };
}
export function goals(level: Level): number[] {
  const out: number[] = [];
  level.map.forEach((row, y) => [...row].forEach((c, x) => { if (c === "G" || c === "*" || c === "+") out.push(indexOf(level.map, x, y)); }));
  return out;
}
export function isWall(level: Level, index: number): boolean {
  const { width, height } = dimensions(level.map);
  const x = index % width, y = Math.floor(index / width);
  return x < 0 || y < 0 || x >= width || y >= height || level.map[y]?.[x] === "#";
}
function step(level: Level, index: number, direction: Direction): number {
  const { width } = dimensions(level.map);
  const next = index + DELTA[direction] + VERTICAL[direction] * width;
  if ((direction === "left" && index % width === 0) || (direction === "right" && index % width === width - 1)) return -1;
  return isWall(level, next) ? -1 : next;
}
export function move(level: Level, state: State, direction: Direction): State {
  if (state.won) return state;
  const next = step(level, state.player, direction);
  if (next < 0) return state;
  const boxAt = state.boxes.indexOf(next);
  let boxes = state.boxes;
  if (boxAt >= 0) {
    const beyond = step(level, next, direction);
    if (beyond < 0 || state.boxes.includes(beyond)) return state;
    boxes = state.boxes.slice(); boxes[boxAt] = beyond; boxes.sort((a, b) => a - b);
  }
  const goalSet = new Set(goals(level));
  return { player: next, boxes, moves: state.moves + 1, won: boxes.every((b) => goalSet.has(b)) };
}
export function legalMoves(level: Level, state: State): Direction[] {
  return DIRECTIONS.filter((d) => move(level, state, d) !== state);
}
export function stateKey(state: State): string { return `${state.player}|${state.boxes.join(",")}`; }
export function renderTiles(level: Level, state: State): Tile[] {
  const { width, height } = dimensions(level.map), out: Tile[] = [];
  const ground = baseMap(level.map);
  const goalSet = new Set(goals(level)), boxSet = new Set(state.boxes);
  for (let i = 0; i < width * height; i++) {
    const isPlayer = i === state.player, isBox = boxSet.has(i), isGoal = goalSet.has(i);
    out.push(isPlayer ? (isGoal ? "+" : "S") : isBox ? (isGoal ? "*" : "B") : ground[Math.floor(i / width)]![i % width] as Tile);
  }
  return out;
}
