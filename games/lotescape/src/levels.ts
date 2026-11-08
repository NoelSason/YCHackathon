import type { Level } from "./engine.js";

// Six original lots on a difficulty ramp, made with the seeded generator (src/generate.ts) and
// then checked by hand: each one is readable, its trucks sit across key lanes, and its best
// solution needs vehicles to back up (except the first). The exact solver proves every one, and
// the test suite checks the recorded best against it. Each move_limit is the best plus about 20%.
export const LEVELS: Level[] = [
  // 26 moves best (limit 31); 0 back-steps, blocking depth 3, 9 vehicles, 4 trucks.
  { title: "Maple Row", size: 6, move_limit: 31, vehicles: [
    { id: "camper", x: 1, y: 4, length: 3, axis: "h", exit: "left", color: "mint" },
    { id: "hauler", x: 1, y: 1, length: 3, axis: "v", exit: "down", color: "violet" },
    { id: "buggy", x: 3, y: 3, length: 2, axis: "h", exit: "right", color: "peach" },
    { id: "tanker", x: 2, y: 2, length: 3, axis: "h", exit: "left", color: "coral" },
    { id: "wagon", x: 5, y: 3, length: 2, axis: "v", exit: "up", color: "sunshine" },
    { id: "bus", x: 2, y: 0, length: 3, axis: "h", exit: "right", color: "lagoon" },
    { id: "sedan", x: 0, y: 4, length: 2, axis: "v", exit: "up", color: "violet" },
    { id: "coupe", x: 2, y: 1, length: 2, axis: "h", exit: "right", color: "peach" },
    { id: "mini", x: 1, y: 5, length: 2, axis: "h", exit: "left", color: "coral" },
  ] },
  // 35 moves best (limit 42); 1 back-step, blocking depth 6, 10 vehicles, 4 trucks.
  { title: "Juniper Wharf", size: 6, move_limit: 42, vehicles: [
    { id: "loader", x: 0, y: 5, length: 3, axis: "h", exit: "left", color: "violet" },
    { id: "mover", x: 2, y: 1, length: 3, axis: "h", exit: "left", color: "peach" },
    { id: "jeep", x: 0, y: 3, length: 2, axis: "h", exit: "right", color: "coral" },
    { id: "bus", x: 3, y: 5, length: 3, axis: "h", exit: "left", color: "sunshine" },
    { id: "buggy", x: 3, y: 0, length: 2, axis: "h", exit: "left", color: "lagoon" },
    { id: "mini", x: 5, y: 3, length: 2, axis: "v", exit: "up", color: "mint" },
    { id: "hatch", x: 2, y: 3, length: 2, axis: "v", exit: "up", color: "peach" },
    { id: "taxi", x: 5, y: 0, length: 2, axis: "v", exit: "up", color: "coral" },
    { id: "hauler", x: 1, y: 0, length: 3, axis: "v", exit: "down", color: "sunshine" },
    { id: "wagon", x: 4, y: 2, length: 2, axis: "v", exit: "up", color: "lagoon" },
  ] },
  // 38 moves best (limit 46); 2 back-steps, blocking depth 5, 10 vehicles, 4 trucks.
  { title: "Saffron Terrace", size: 6, move_limit: 46, vehicles: [
    { id: "camper", x: 4, y: 0, length: 3, axis: "v", exit: "down", color: "mint" },
    { id: "jeep", x: 2, y: 2, length: 2, axis: "h", exit: "right", color: "violet" },
    { id: "sedan", x: 0, y: 3, length: 2, axis: "h", exit: "left", color: "peach" },
    { id: "hauler", x: 2, y: 3, length: 3, axis: "v", exit: "up", color: "coral" },
    { id: "cab", x: 0, y: 1, length: 2, axis: "v", exit: "down", color: "sunshine" },
    { id: "truck", x: 5, y: 2, length: 3, axis: "v", exit: "up", color: "lagoon" },
    { id: "bus", x: 3, y: 3, length: 3, axis: "v", exit: "up", color: "mint" },
    { id: "hatch", x: 4, y: 5, length: 2, axis: "h", exit: "left", color: "violet" },
    { id: "scout", x: 0, y: 0, length: 2, axis: "h", exit: "right", color: "peach" },
    { id: "taxi", x: 1, y: 4, length: 2, axis: "v", exit: "down", color: "sunshine" },
  ] },
  // 43 moves best (limit 52); 3 back-steps, blocking depth 6, 12 vehicles, 3 trucks.
  { title: "Cobalt Yard", size: 6, move_limit: 52, vehicles: [
    { id: "bus", x: 2, y: 2, length: 3, axis: "h", exit: "right", color: "mint" },
    { id: "camper", x: 5, y: 0, length: 3, axis: "v", exit: "down", color: "violet" },
    { id: "cab", x: 4, y: 4, length: 2, axis: "h", exit: "left", color: "peach" },
    { id: "roadster", x: 2, y: 1, length: 2, axis: "h", exit: "right", color: "coral" },
    { id: "scout", x: 2, y: 4, length: 2, axis: "v", exit: "down", color: "sunshine" },
    { id: "sedan", x: 4, y: 3, length: 2, axis: "h", exit: "left", color: "lagoon" },
    { id: "wagon", x: 0, y: 3, length: 2, axis: "h", exit: "left", color: "mint" },
    { id: "racer", x: 3, y: 3, length: 2, axis: "v", exit: "up", color: "violet" },
    { id: "mini", x: 0, y: 4, length: 2, axis: "h", exit: "left", color: "peach" },
    { id: "hauler", x: 3, y: 5, length: 3, axis: "h", exit: "right", color: "coral" },
    { id: "hatch", x: 0, y: 0, length: 2, axis: "h", exit: "right", color: "sunshine" },
    { id: "buggy", x: 0, y: 1, length: 2, axis: "h", exit: "right", color: "lagoon" },
  ] },
  // 47 moves best (limit 56); 5 back-steps, blocking depth 7, 11 vehicles, 6 trucks.
  { title: "Marigold Mews", size: 6, move_limit: 56, vehicles: [
    { id: "jeep", x: 3, y: 4, length: 2, axis: "v", exit: "up", color: "lagoon" },
    { id: "tanker", x: 2, y: 0, length: 3, axis: "v", exit: "down", color: "mint" },
    { id: "mover", x: 0, y: 2, length: 3, axis: "v", exit: "down", color: "violet" },
    { id: "racer", x: 0, y: 0, length: 2, axis: "h", exit: "right", color: "peach" },
    { id: "buggy", x: 4, y: 4, length: 2, axis: "h", exit: "left", color: "coral" },
    { id: "loader", x: 3, y: 1, length: 3, axis: "h", exit: "left", color: "sunshine" },
    { id: "hauler", x: 1, y: 3, length: 3, axis: "h", exit: "left", color: "peach" },
    { id: "van", x: 0, y: 5, length: 3, axis: "h", exit: "right", color: "mint" },
    { id: "cab", x: 4, y: 0, length: 2, axis: "h", exit: "right", color: "violet" },
    { id: "truck", x: 3, y: 2, length: 3, axis: "h", exit: "left", color: "coral" },
    { id: "hatch", x: 4, y: 5, length: 2, axis: "h", exit: "right", color: "sunshine" },
  ] },
  // 53 moves best (limit 64); 7 back-steps, blocking depth 10, 11 vehicles, 6 trucks.
  { title: "Lantern Court", size: 6, move_limit: 64, vehicles: [
    { id: "hauler", x: 3, y: 2, length: 3, axis: "v", exit: "up", color: "coral" },
    { id: "van", x: 2, y: 0, length: 3, axis: "h", exit: "left", color: "sunshine" },
    { id: "mover", x: 1, y: 1, length: 3, axis: "h", exit: "right", color: "lagoon" },
    { id: "jeep", x: 0, y: 5, length: 2, axis: "h", exit: "right", color: "mint" },
    { id: "loader", x: 2, y: 3, length: 3, axis: "v", exit: "up", color: "violet" },
    { id: "bus", x: 0, y: 0, length: 3, axis: "v", exit: "down", color: "peach" },
    { id: "roadster", x: 1, y: 2, length: 2, axis: "h", exit: "left", color: "sunshine" },
    { id: "truck", x: 5, y: 0, length: 3, axis: "v", exit: "down", color: "lagoon" },
    { id: "racer", x: 0, y: 3, length: 2, axis: "v", exit: "down", color: "violet" },
    { id: "buggy", x: 4, y: 1, length: 2, axis: "v", exit: "down", color: "mint" },
    { id: "coupe", x: 4, y: 4, length: 2, axis: "h", exit: "left", color: "peach" },
  ] },
];

/** The solver's fewest moves for each lot in LEVELS, in order. The tests check these against the solver. */
export const BUILT_IN_BEST: readonly number[] = [26, 35, 38, 43, 47, 53];
