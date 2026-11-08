import type { Level } from "./engine.js";
export const LEVELS: Level[] = [
  { title: "Morning Rush", size: 6, move_limit: 26, vehicles: [
    { id: "coral", x: 0, y: 0, length: 2, axis: "h", exit: "right", color: "coral" },
    { id: "sunshine", x: 3, y: 0, length: 2, axis: "v", exit: "up", color: "sunshine" },
    { id: "lagoon", x: 1, y: 2, length: 2, axis: "h", exit: "left", color: "lagoon" },
    { id: "mint", x: 4, y: 3, length: 2, axis: "v", exit: "down", color: "mint" },
    { id: "violet", x: 0, y: 5, length: 3, axis: "h", exit: "right", color: "violet" },
  ] },
  { title: "Market Street", size: 6, move_limit: 30, vehicles: [
    { id: "cherry", x: 2, y: 0, length: 3, axis: "v", exit: "down", color: "coral" },
    { id: "lemon", x: 0, y: 1, length: 2, axis: "h", exit: "right", color: "sunshine" },
    { id: "bluebird", x: 4, y: 1, length: 2, axis: "v", exit: "up", color: "lagoon" },
    { id: "avocado", x: 1, y: 3, length: 3, axis: "h", exit: "left", color: "mint" },
    { id: "plum", x: 5, y: 3, length: 2, axis: "v", exit: "down", color: "violet" },
    { id: "peach", x: 0, y: 5, length: 2, axis: "h", exit: "left", color: "peach" },
  ] },
];
