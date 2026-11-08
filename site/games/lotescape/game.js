// src/engine.ts
function initialState(level2) {
  return { vehicles: level2.vehicles.map((v) => ({ ...v })), moves: 0, won: level2.vehicles.length === 0 };
}
var BLOCKED = -2;
var EXITS = -1;
function stepAlongLane(size, vehicle, direction, occupied) {
  const horizontal = vehicle.axis === "h";
  if (horizontal ? direction !== "left" && direction !== "right" : direction !== "up" && direction !== "down") return BLOCKED;
  const forward = direction === "right" || direction === "down";
  const at = horizontal ? vehicle.x : vehicle.y, laneAt = horizontal ? vehicle.y : vehicle.x;
  const lead = forward ? at + vehicle.length : at - 1;
  if (lead < 0 || lead >= size) return direction === vehicle.exit ? EXITS : BLOCKED;
  if (horizontal ? occupied(lead, laneAt) : occupied(laneAt, lead)) return BLOCKED;
  return forward ? at + 1 : at - 1;
}
function covers(v, x, y) {
  return v.axis === "h" ? y === v.y && x >= v.x && x < v.x + v.length : x === v.x && y >= v.y && y < v.y + v.length;
}
function move(level2, state2, id, direction) {
  if (state2.won) return state2;
  const index = state2.vehicles.findIndex((v) => v.id === id), vehicle = state2.vehicles[index];
  if (!vehicle) return state2;
  const to = stepAlongLane(level2.size, vehicle, direction, (x, y) => state2.vehicles.some((other, i) => i !== index && covers(other, x, y)));
  if (to === BLOCKED) return state2;
  const vehicles = state2.vehicles.slice();
  if (to === EXITS) vehicles.splice(index, 1);
  else vehicles[index] = vehicle.axis === "h" ? { ...vehicle, x: to } : { ...vehicle, y: to };
  return { vehicles, moves: state2.moves + 1, won: vehicles.length === 0 };
}
function distanceToExit(size, vehicle) {
  switch (vehicle.exit) {
    case "right":
      return size - vehicle.x - vehicle.length + 1;
    case "left":
      return vehicle.x + 1;
    case "down":
      return size - vehicle.y - vehicle.length + 1;
    case "up":
      return vehicle.y + 1;
  }
}
function axisDirections(vehicle) {
  return vehicle.axis === "h" ? ["left", "right"] : ["up", "down"];
}
function slideLimit(level2, state2, id, direction) {
  let current = state2, steps = 0;
  const cap = level2.size + 3;
  while (steps < cap) {
    const next = move(level2, current, id, direction);
    if (next === current) break;
    steps++;
    current = next;
    if (!current.vehicles.some((v) => v.id === id)) return { steps, exits: true };
  }
  return { steps, exits: false };
}
function slide(level2, state2, id, direction, steps) {
  let current = state2;
  for (let i = 0; i < steps; i++) {
    const next = move(level2, current, id, direction);
    if (next === current) break;
    current = next;
    if (!current.vehicles.some((v) => v.id === id)) break;
  }
  return current;
}

// src/levels.ts
var LEVELS = [
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
    { id: "mini", x: 1, y: 5, length: 2, axis: "h", exit: "left", color: "coral" }
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
    { id: "wagon", x: 4, y: 2, length: 2, axis: "v", exit: "up", color: "lagoon" }
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
    { id: "taxi", x: 1, y: 4, length: 2, axis: "v", exit: "down", color: "sunshine" }
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
    { id: "buggy", x: 0, y: 1, length: 2, axis: "h", exit: "right", color: "lagoon" }
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
    { id: "hatch", x: 4, y: 5, length: 2, axis: "h", exit: "right", color: "sunshine" }
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
    { id: "coupe", x: 4, y: 4, length: 2, axis: "h", exit: "left", color: "peach" }
  ] }
];
var BUILT_IN_BEST = [26, 35, 38, 43, 47, 53];

// src/solver.ts
function solveLevel(level2, maxStates = 25e4) {
  const size = level2.size, vehicles = level2.vehicles, n = vehicles.length;
  if (n === 0) return { solvable: true, min_moves: 0, inputs: [], explored: 1 };
  const horizontal = vehicles.map((v) => v.axis === "h");
  const directions = vehicles.map((v) => axisDirections(v));
  const towardExit = vehicles.map((v, j) => directions[j][1] === v.exit ? 1 : 0);
  const probes = vehicles.map((v) => ({ ...v }));
  const packed = n <= 13;
  const pow = Array.from({ length: n }, (_, i) => 16 ** i);
  const keyOf = (pos) => {
    if (!packed) return pos.join(",");
    let key = 0;
    for (let i = 0; i < n; i++) key += (pos[i] + 1) * pow[i];
    return key;
  };
  let pool = new Int8Array(n * 1024), cost = new Int16Array(1024), parent = new Int32Array(1024), via = new Int16Array(1024);
  let count = 0;
  const add = (pos) => {
    if (count === cost.length) {
      const grow = cost.length * 2;
      const p2 = new Int8Array(n * grow);
      p2.set(pool);
      pool = p2;
      const c2 = new Int16Array(grow);
      c2.set(cost);
      cost = c2;
      const a2 = new Int32Array(grow);
      a2.set(parent);
      parent = a2;
      const v2 = new Int16Array(grow);
      v2.set(via);
      via = v2;
    }
    pool.set(pos, count * n);
    return count++;
  };
  const start = new Int8Array(vehicles.map((v) => v.axis === "h" ? v.x : v.y));
  const first = add(start);
  cost[first] = 0;
  parent[first] = -1;
  via[first] = -1;
  const index = /* @__PURE__ */ new Map([[keyOf(start), first]]);
  const grid = new Int16Array(size * size), cur = new Int8Array(n);
  const occupied = (x, y) => grid[y * size + x] !== 0;
  let layer = [first], next = [], backSteps = 0, found = -1;
  while (layer.length && found < 0 && count <= maxStates) {
    while (layer.length && found < 0 && count <= maxStates) {
      const i = layer.pop();
      if (cost[i] !== backSteps) continue;
      for (let j = 0; j < n; j++) cur[j] = pool[i * n + j];
      grid.fill(0);
      for (let j = 0; j < n; j++) {
        const at = cur[j];
        if (at < 0) continue;
        const v = vehicles[j], lane2 = horizontal[j] ? v.y : v.x;
        for (let k = 0; k < v.length; k++) grid[horizontal[j] ? lane2 * size + at + k : (at + k) * size + lane2] = j + 1;
      }
      for (let j = 0; j < n && found < 0; j++) {
        const at = cur[j];
        if (at < 0) continue;
        const probe = probes[j];
        if (horizontal[j]) probe.x = at;
        else probe.y = at;
        for (let d = 0; d < 2; d++) {
          const to = stepAlongLane(size, probe, directions[j][d], occupied);
          if (to === BLOCKED) continue;
          const c = backSteps + (d === towardExit[j] ? 0 : 1);
          cur[j] = to === EXITS ? -1 : to;
          const key = keyOf(cur);
          let s = index.get(key);
          if (s === void 0) {
            s = add(cur);
            index.set(key, s);
            cost[s] = 32767;
          }
          if (c < cost[s]) {
            cost[s] = c;
            parent[s] = i;
            via[s] = j * 2 + d;
            (c === backSteps ? layer : next).push(s);
            if (to === EXITS && cur.every((p) => p < 0)) {
              found = s;
              cur[j] = at;
              break;
            }
          }
          cur[j] = at;
        }
      }
    }
    if (found < 0) {
      layer = next;
      next = [];
      backSteps++;
    }
  }
  if (found < 0) return count > maxStates ? { solvable: false, explored: index.size, truncated: true } : { solvable: false, explored: index.size };
  const inputs = [];
  for (let at = found; parent[at] >= 0; at = parent[at]) {
    const edge = via[at], j = edge >> 1;
    inputs.push({ id: vehicles[j].id, direction: directions[j][edge & 1] });
  }
  inputs.reverse();
  return { solvable: true, min_moves: inputs.length, inputs, explored: index.size };
}

// src/generate.ts
var CANDIDATE_STATES = 4e4;
var CEILING = 12;
var COLORS = ["coral", "sunshine", "lagoon", "mint", "violet", "peach"];
var CAR_NAMES = ["coupe", "taxi", "mini", "jeep", "wagon", "cab", "roadster", "hatch", "sedan", "buggy", "racer", "scout"];
var TRUCK_NAMES = ["truck", "bus", "van", "hauler", "tanker", "camper", "loader", "mover"];
var PLACE_A = ["Copper", "Harbor", "Juniper", "Cobalt", "Maple", "Lantern", "Granite", "Willow", "Saffron", "Beacon", "Orchard", "Tidal", "Ember", "Quarry", "Linden", "Marigold"];
var PLACE_B = ["Lane", "Row", "Yard", "Court", "Alley", "Square", "Depot", "Crossing", "Terrace", "Garage", "Wharf", "Mews"];
function moveLimitFor(minMoves) {
  return minMoves + Math.max(2, Math.round(minMoves * 0.2));
}
function difficultyProfile(difficulty) {
  const d = Math.max(1, Math.floor(Number.isFinite(difficulty) ? difficulty : 1));
  const top = Math.min(d, CEILING);
  const lo = 14 + 5 * (top - 1);
  return {
    difficulty: d,
    size: 6,
    vehicles: [Math.min(7 + Math.floor(top / 2), 11), Math.min(8 + Math.floor(top / 2), 12)],
    score: [lo, d >= CEILING ? Number.POSITIVE_INFINITY : lo + 7],
    trucks: Math.min(1 + Math.floor(top / 3), 4)
  };
}
function rateLevel(level2, solution = solveLevel(level2)) {
  if (!solution.solvable || solution.min_moves === void 0) return void 0;
  const free = level2.vehicles.reduce((sum, v) => sum + distanceToExit(level2.size, v), 0);
  const backups = (solution.min_moves - free) / 2;
  const { depth, blocked } = blocking(level2);
  const trucks = level2.vehicles.filter((v) => v.length === 3).length;
  return { min_moves: solution.min_moves, free_moves: free, backups, blocking_depth: depth, blocked, vehicles: level2.vehicles.length, trucks, score: 8 * backups + 2 * Math.min(depth, 6) + level2.vehicles.length + trucks };
}
function generateLevel(options) {
  const profile = difficultyProfile(options.difficulty);
  const rand = rng(`${options.seed}|${profile.difficulty}`);
  const maxAttempts = options.maxAttempts ?? 4e3, deadline = Date.now() + (options.timeLimitMs ?? 8e3);
  const [lo, hi] = profile.score;
  const distance = (score) => score < lo ? lo - score : score > hi ? score - hi : 0;
  let best2;
  let current;
  let attempts = 0, stale = 0, stopped = "budget";
  while (attempts < maxAttempts) {
    if (Date.now() > deadline && best2) {
      stopped = "time";
      break;
    }
    attempts++;
    if (stale >= 150) {
      stale = 0;
      current = best2 && rand() < 0.5 ? { vehicles: shake(best2.vehicles, profile, rand), distance: Infinity } : void 0;
    }
    const vehicles = current ? mutate(current.vehicles, profile, rand) : randomLot(profile, rand);
    if (!vehicles) continue;
    const level3 = { title: "candidate", size: profile.size, vehicles, move_limit: 300 };
    const solution = solveLevel(level3, CANDIDATE_STATES);
    const rating = rateLevel(level3, solution);
    if (!rating) {
      stale++;
      continue;
    }
    const d = distance(rating.score);
    if (!best2 || d < distance(best2.rating.score)) best2 = { vehicles, rating, solution };
    if (d === 0) {
      stopped = "target";
      break;
    }
    if (!current || d < current.distance) {
      current = { vehicles, distance: d };
      stale = 0;
    } else {
      if (d === current.distance || rand() < 0.03) current = { vehicles, distance: d };
      stale++;
    }
  }
  while (!best2) {
    const vehicles = randomLot({ ...profile, vehicles: [5, 5], trucks: 1 }, rand);
    if (!vehicles) continue;
    const solution = solveLevel({ title: "candidate", size: profile.size, vehicles, move_limit: 300 }, CANDIDATE_STATES);
    const rating = rateLevel({ title: "candidate", size: profile.size, vehicles, move_limit: 300 }, solution);
    if (rating) best2 = { vehicles, rating, solution };
  }
  const level2 = finish(best2.vehicles, profile.size, best2.rating.min_moves, options.title, rand);
  const rename = new Map(best2.vehicles.map((v, i) => [v.id, level2.vehicles[i].id]));
  const inputs = (best2.solution.inputs ?? []).map((input) => ({ id: rename.get(input.id), direction: input.direction }));
  return { level: level2, rating: best2.rating, inputs, difficulty: profile.difficulty, seed: options.seed, attempts, stopped };
}
function rng(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var pick = (rand, items) => items[Math.floor(rand() * items.length)];
function cellsOf(v) {
  return Array.from({ length: v.length }, (_, i) => (v.y + (v.axis === "v" ? i : 0)) * 16 + v.x + (v.axis === "h" ? i : 0));
}
function headOn(a, b) {
  if (a.axis !== b.axis || (a.axis === "h" ? a.y !== b.y : a.x !== b.x)) return false;
  const [first, second] = (a.axis === "h" ? a.x < b.x : a.y < b.y) ? [a, b] : [b, a];
  return (first.exit === "right" || first.exit === "down") && (second.exit === "left" || second.exit === "up");
}
function fits(vehicles, candidate, size, skip = -1) {
  if (candidate.x < 0 || candidate.y < 0) return false;
  if (candidate.axis === "h" ? candidate.x + candidate.length > size || candidate.y >= size : candidate.y + candidate.length > size || candidate.x >= size) return false;
  const taken = new Set(vehicles.flatMap((v, i) => i === skip ? [] : cellsOf(v)));
  if (cellsOf(candidate).some((c) => taken.has(c))) return false;
  return !vehicles.some((v, i) => i !== skip && headOn(v, candidate));
}
function randomVehicle(id, size, rand, length = rand() < 0.3 ? 3 : 2) {
  const axis = rand() < 0.5 ? "h" : "v";
  const along = Math.floor(rand() * (size - length + 1)), lane2 = Math.floor(rand() * size);
  const exit = axis === "h" ? rand() < 0.5 ? "left" : "right" : rand() < 0.5 ? "up" : "down";
  return { id, x: axis === "h" ? along : lane2, y: axis === "h" ? lane2 : along, length, axis, exit, color: "coral" };
}
function randomLot(profile, rand) {
  const [min, max] = profile.vehicles, target = min + Math.floor(rand() * (max - min + 1));
  const vehicles = [];
  for (let tries = 0; vehicles.length < target && tries < 400; tries++) {
    const truck = vehicles.length < profile.trucks || rand() < 0.2;
    const v = randomVehicle(`v${vehicles.length}`, profile.size, rand, truck ? 3 : 2);
    if (fits(vehicles, v, profile.size)) vehicles.push(v);
  }
  return vehicles.length >= min ? vehicles : void 0;
}
function mutate(source, profile, rand) {
  const vehicles = source.map((v) => ({ ...v }));
  const [min, max] = profile.vehicles, trucks = () => vehicles.filter((v) => v.length === 3).length;
  for (let tries = 0; tries < 30; tries++) {
    const roll = rand(), i = Math.floor(rand() * vehicles.length), v = vehicles[i];
    if (roll < 0.1 && vehicles.length < max) {
      const added = randomVehicle(`v${vehicles.length}`, profile.size, rand);
      if (fits(vehicles, added, profile.size)) {
        vehicles.push(added);
        return vehicles;
      }
    } else if (roll < 0.18 && vehicles.length > min && (v.length === 2 || trucks() > profile.trucks)) {
      vehicles.splice(i, 1);
      return vehicles.map((x, k) => ({ ...x, id: `v${k}` }));
    } else if (roll < 0.45) {
      const step = rand() < 0.5 ? -1 : 1;
      const moved = { ...v, x: v.axis === "h" ? v.x + step : v.x, y: v.axis === "v" ? v.y + step : v.y };
      if (fits(vehicles, moved, profile.size, i)) {
        vehicles[i] = moved;
        return vehicles;
      }
    } else if (roll < 0.6) {
      const flipped = { ...v, exit: { left: "right", right: "left", up: "down", down: "up" }[v.exit] };
      if (fits(vehicles, flipped, profile.size, i)) {
        vehicles[i] = flipped;
        return vehicles;
      }
    } else {
      const keepTruck = v.length === 3 && trucks() <= profile.trucks;
      const replaced = randomVehicle(v.id, profile.size, rand, keepTruck ? 3 : void 0);
      if (fits(vehicles, replaced, profile.size, i)) {
        vehicles[i] = replaced;
        return vehicles;
      }
    }
  }
  return void 0;
}
function shake(source, profile, rand) {
  let vehicles = source;
  for (let i = 0; i < 4; i++) vehicles = mutate(vehicles, profile, rand) ?? vehicles;
  return vehicles;
}
function route(v, size) {
  const out = [];
  if (v.exit === "right") for (let x = v.x + v.length; x < size; x++) out.push(v.y * 16 + x);
  if (v.exit === "left") for (let x = 0; x < v.x; x++) out.push(v.y * 16 + x);
  if (v.exit === "down") for (let y = v.y + v.length; y < size; y++) out.push(y * 16 + v.x);
  if (v.exit === "up") for (let y = 0; y < v.y; y++) out.push(y * 16 + v.x);
  return out;
}
function blocking(level2) {
  const owner = /* @__PURE__ */ new Map();
  level2.vehicles.forEach((v, i) => cellsOf(v).forEach((c) => owner.set(c, i)));
  const blockers = level2.vehicles.map((v) => [...new Set(route(v, level2.size).flatMap((c) => owner.has(c) ? [owner.get(c)] : []))]);
  const longest = (i, path) => {
    let best2 = 0;
    for (const j of blockers[i]) {
      if (path.has(j)) {
        best2 = Math.max(best2, 1);
        continue;
      }
      path.add(j);
      best2 = Math.max(best2, 1 + longest(j, path));
      path.delete(j);
    }
    return best2;
  };
  return { depth: Math.max(0, ...level2.vehicles.map((_, i) => longest(i, /* @__PURE__ */ new Set([i])))), blocked: blockers.filter((b) => b.length > 0).length };
}
function touching(a, b) {
  const near = new Set(cellsOf(a).flatMap((c) => [c - 1, c + 1, c - 16, c + 16]));
  return cellsOf(b).some((c) => near.has(c));
}
function finish(vehicles, size, minMoves, title, rand) {
  const cars2 = [...CAR_NAMES], trucks = [...TRUCK_NAMES], offset = Math.floor(rand() * COLORS.length);
  const take = (names, fallback, i) => names.length ? names.splice(Math.floor(rand() * names.length), 1)[0] : `${fallback}-${i}`;
  const colors = [], used = /* @__PURE__ */ new Map();
  vehicles.forEach((v, i) => {
    const near = new Set(vehicles.slice(0, i).flatMap((u, k) => touching(u, v) ? [colors[k]] : []));
    const order = COLORS.map((_, k) => COLORS[(i + offset + k) % COLORS.length]);
    const free = order.filter((c) => !near.has(c));
    const color = (free.length ? free : order).reduce((a, b) => (used.get(b) ?? 0) < (used.get(a) ?? 0) ? b : a);
    colors.push(color);
    used.set(color, (used.get(color) ?? 0) + 1);
  });
  const named = vehicles.map((v, i) => ({ ...v, id: take(v.length === 3 ? trucks : cars2, v.length === 3 ? "truck" : "car", i), color: colors[i] }));
  return { title: (title ?? `${pick(rand, PLACE_A)} ${pick(rand, PLACE_B)}`).slice(0, 48), size, vehicles: named, move_limit: moveLimitFor(minMoves) };
}

// ui/jobs.ts
function runJob(job) {
  try {
    if (job.kind === "generate") {
      const made = generateLevel({ seed: job.seed, difficulty: job.difficulty, timeLimitMs: job.timeLimitMs });
      return { id: job.id, kind: "generate", level: made.level, best: made.rating.min_moves, stopped: made.stopped };
    }
    const solved = solveLevel(job.level);
    return { id: job.id, kind: "solve", best: solved.solvable ? solved.min_moves : void 0 };
  } catch (error) {
    return { id: job.id, kind: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

// ui/main.ts
var board = document.querySelector("#board");
var selectedLabel = document.querySelector("#selected");
var titleLabel = document.querySelector("#level-title");
var movesLabel = document.querySelector("#moves");
var message = document.querySelector("#message");
var indicator = document.querySelector("#level-indicator");
var limitLabel = document.querySelector("#limit");
var bestLabel = document.querySelector("#best");
var building = document.querySelector("#building");
var endlessToggle = document.querySelector("#endless");
var api = (window.STUDIO_API ?? "").replace(/\/$/, "");
var HINT = "Each car has a marked exit. Clear its lane to let it leave.";
var BLOCKED2 = "That lane is blocked. Try sliding another car first.";
var level = LEVELS[0];
var state = initialState(level);
var selected = state.vehicles[0]?.id ?? "";
var levelId;
var activeIndex = 0;
var best;
var ended = false;
var sessionId = crypto.randomUUID();
var cars = /* @__PURE__ */ new Map();
var exits = /* @__PURE__ */ new Map();
var lane = document.createElement("div");
lane.className = "lane";
function event(type) {
  if (!api) return;
  const body = JSON.stringify({ game_id: "lotescape", level_id: levelId ?? null, session_id: sessionId, type, moves_used: state.moves });
  if (type === "quit" && navigator.sendBeacon) navigator.sendBeacon(`${api}/events`, new Blob([body], { type: "application/json" }));
  else void fetch(`${api}/events`, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {
  });
}
function vehicleSvg(vehicle) {
  const W = vehicle.length * 100, horizontal = vehicle.axis === "h";
  const turn = { right: "", left: `translate(${W} 0) scale(-1 1)`, down: "translate(100 0) rotate(90)", up: `translate(0 ${W}) rotate(-90)` }[vehicle.exit];
  const wheels = [W * 0.2, W - (vehicle.length === 3 ? 62 : W * 0.2) - 20].map((x) => `<rect x="${x}" y="4" width="22" height="10" rx="4"/><rect x="${x}" y="86" width="22" height="10" rx="4"/>`).join("");
  const nose = `<rect x="${W - 15}" y="20" width="7" height="14" rx="3" fill="#fff4c2"/><rect x="${W - 15}" y="66" width="7" height="14" rx="3" fill="#fff4c2"/>`;
  const tail = `<rect x="8" y="20" width="5" height="12" rx="2" fill="#5a1620"/><rect x="8" y="68" width="5" height="12" rx="2" fill="#5a1620"/>`;
  const chevron = (cx) => `<path d="M${cx - 9} 36 L${cx + 7} 50 L${cx - 9} 64" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" opacity=".92"/>`;
  const body = vehicle.length === 3 ? `<rect x="8" y="9" width="${W - 116}" height="82" rx="12" fill="currentColor"/><rect x="18" y="20" width="${W - 136}" height="60" rx="7" fill="#fff" opacity=".2"/><rect x="${W - 104}" y="11" width="96" height="78" rx="20" fill="currentColor"/><rect x="${W - 46}" y="20" width="16" height="60" rx="6" fill="#d9efff" opacity=".92"/>${nose}${tail}${chevron(W * 0.4)}` : `<rect x="8" y="9" width="${W - 16}" height="82" rx="24" fill="currentColor"/><rect x="${W * 0.3}" y="20" width="${W * 0.42}" height="60" rx="13" fill="#0d1a2b" opacity=".18"/><rect x="${W * 0.64}" y="21" width="${W * 0.09}" height="58" rx="7" fill="#d9efff" opacity=".92"/><rect x="${W * 0.25}" y="23" width="${W * 0.06}" height="54" rx="6" fill="#d9efff" opacity=".7"/>${nose}${tail}${chevron(W * 0.5)}`;
  return `<svg viewBox="0 0 ${horizontal ? W : 100} ${horizontal ? 100 : W}" aria-hidden="true"><g transform="${turn}"><g fill="#16202f">${wheels}</g>${body}</g></svg>`;
}
var pct = (n) => `${n * 100 / level.size}%`;
function place(el, vehicle, offset = 0) {
  const dx = vehicle.axis === "h" ? offset : 0, dy = vehicle.axis === "v" ? offset : 0;
  el.style.left = pct(vehicle.x + dx);
  el.style.top = pct(vehicle.y + dy);
  el.style.width = pct(vehicle.axis === "h" ? vehicle.length : 1);
  el.style.height = pct(vehicle.axis === "v" ? vehicle.length : 1);
}
function placeExit(el, vehicle) {
  const lanePos = pct(vehicle.axis === "h" ? vehicle.y : vehicle.x);
  el.className = `exit ${vehicle.exit} ${vehicle.color}`;
  el.removeAttribute("style");
  if (vehicle.axis === "h") {
    el.style.top = lanePos;
    el.style.height = pct(1);
  } else {
    el.style.left = lanePos;
    el.style.width = pct(1);
  }
}
function carFor(vehicle) {
  let car = cars.get(vehicle.id);
  if (car) return car;
  car = document.createElement("button");
  car.type = "button";
  car.dataset.id = vehicle.id;
  car.dataset.exit = vehicle.exit;
  car.dataset.length = String(vehicle.length);
  car.className = `car ${vehicle.axis === "h" ? "horizontal" : "vertical"} ${vehicle.length === 3 ? "truck" : "sedan"} ${vehicle.color}`;
  car.setAttribute("aria-label", `${vehicle.id}, ${vehicle.length === 3 ? "truck" : "car"}, exits ${vehicle.exit}`);
  car.innerHTML = vehicleSvg(vehicle);
  car.addEventListener("click", () => select(vehicle.id));
  car.addEventListener("focus", () => select(vehicle.id));
  board.append(car);
  cars.set(vehicle.id, car);
  const marker = document.createElement("div");
  marker.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4l8 6-8 6" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  board.append(marker);
  exits.set(vehicle.id, marker);
  return car;
}
function render() {
  board.style.setProperty("--size", String(level.size));
  const present = new Set(state.vehicles.map((v) => v.id));
  for (const vehicle of state.vehicles) {
    const car = carFor(vehicle);
    place(car, vehicle);
    car.classList.toggle("selected", vehicle.id === selected);
    placeExit(exits.get(vehicle.id), vehicle);
    exits.get(vehicle.id).classList.toggle("selected", vehicle.id === selected);
  }
  for (const [id, car] of cars) if (!present.has(id)) driveOff(id, car);
  drawLane();
  movesLabel.textContent = `${state.moves} / ${level.move_limit}`;
  updateSelected();
}
function driveOff(id, car) {
  cars.delete(id);
  exits.get(id)?.remove();
  exits.delete(id);
  const step = (Number(car.dataset.length) + 1) * 100 / level.size, exit = car.dataset.exit;
  const left = parseFloat(car.style.left), top = parseFloat(car.style.top);
  car.classList.add("leaving");
  car.disabled = true;
  requestAnimationFrame(() => {
    if (exit === "right") car.style.left = `${left + step}%`;
    if (exit === "left") car.style.left = `${left - step}%`;
    if (exit === "down") car.style.top = `${top + step}%`;
    if (exit === "up") car.style.top = `${top - step}%`;
  });
  setTimeout(() => car.remove(), 420);
}
function drawLane() {
  const vehicle = state.vehicles.find((v) => v.id === selected);
  if (!vehicle || ended) {
    lane.remove();
    return;
  }
  lane.className = `lane ${vehicle.color}`;
  lane.removeAttribute("style");
  const from = vehicle.exit === "right" ? vehicle.x + vehicle.length : vehicle.exit === "down" ? vehicle.y + vehicle.length : 0;
  const to = vehicle.exit === "left" ? vehicle.x : vehicle.exit === "up" ? vehicle.y : level.size;
  if (to <= from) {
    lane.remove();
    return;
  }
  if (vehicle.axis === "h") {
    lane.style.left = pct(from);
    lane.style.width = pct(to - from);
    lane.style.top = pct(vehicle.y);
    lane.style.height = pct(1);
  } else {
    lane.style.top = pct(from);
    lane.style.height = pct(to - from);
    lane.style.left = pct(vehicle.x);
    lane.style.width = pct(1);
  }
  if (!lane.isConnected) board.prepend(lane);
}
function select(id) {
  if (selected === id || !state.vehicles.some((v) => v.id === id)) return;
  selected = id;
  render();
}
function updateSelected() {
  const car = state.vehicles.find((v) => v.id === selected);
  selectedLabel.textContent = car ? `${car.id.toUpperCase()} \xB7 EXIT ${car.exit.toUpperCase()}` : "Choose a car";
  for (const button of document.querySelectorAll("[data-dir]")) {
    const dir = button.dataset.dir;
    button.disabled = !car || ended || !axisDirections(car).includes(dir) || slideLimit(level, state, car.id, dir).steps === 0;
  }
}
function finish2() {
  if (state.won && !ended) {
    ended = true;
    message.className = "message good";
    event("win");
    const lastBuiltIn = mode === "builtin" && activeIndex === LEVELS.length - 1;
    message.textContent = mode === "endless" ? "Lot clear! On to a harder one." : mode === "builtin" ? lastBuiltIn ? "All built-in lots cleared! Generating harder ones\u2026" : "Lot clear! On to the next lot." : "Lot clear! Every car made it out.";
    if (mode === "endless") {
      const at = endless.level;
      setTimeout(() => {
        if (mode === "endless" && endless.level === at && state.won) void advanceEndless();
      }, 1100);
    } else if (mode === "builtin") {
      const at = activeIndex;
      setTimeout(() => {
        if (mode !== "builtin" || activeIndex !== at || !state.won) return;
        if (lastBuiltIn) {
          endlessToggle.checked = true;
          setEndless(true);
        } else loadLevel(at + 1);
      }, 1400);
    }
  } else if (state.moves >= level.move_limit && !ended) {
    ended = true;
    message.textContent = "Move limit reached. Give the lot another try.";
    message.className = "message bad";
    event("loss");
  }
}
function commit(next) {
  state = next;
  if (!state.vehicles.some((v) => v.id === selected)) selected = state.vehicles[0]?.id ?? "";
  if (message.textContent === BLOCKED2) message.textContent = HINT;
  finish2();
  render();
}
function restart() {
  for (const car of cars.values()) car.remove();
  for (const marker of exits.values()) marker.remove();
  cars.clear();
  exits.clear();
  state = initialState(level);
  selected = state.vehicles[0]?.id ?? "";
  ended = false;
  sessionId = crypto.randomUUID();
  message.textContent = HINT;
  message.className = "message";
  render();
  event("attempt");
}
function act(direction) {
  if (!selected || ended) return;
  const next = move(level, state, selected, direction);
  if (next === state) {
    message.textContent = BLOCKED2;
    return;
  }
  commit(next);
}
function show(next, label, generated, bestMoves) {
  level = next;
  best = bestMoves;
  titleLabel.textContent = level.title;
  indicator.textContent = label;
  indicator.classList.toggle("generated", generated);
  limitLabel.textContent = `Move limit ${level.move_limit}`;
  bestLabel.textContent = best === void 0 ? "Best possible: checking\u2026" : `Best possible: ${best} moves`;
  building.hidden = true;
  restart();
}
function loadLevel(index) {
  mode = "builtin";
  activeIndex = index;
  levelId = void 0;
  store.set(KEY_BUILTIN, String(index));
  show(LEVELS[index], `Level ${index + 1} of ${LEVELS.length} \xB7 Built-in`, false, BUILT_IN_BEST[index]);
}
var KEY_ENDLESS = "lotescape:endless";
var KEY_BUILTIN = "lotescape:builtin";
var KEY_RUN = "lotescape:endless-run";
var store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
    }
  }
};
var mode = "builtin";
var endless = readRun();
var upcoming;
function readRun() {
  try {
    const raw = JSON.parse(store.get(KEY_RUN) ?? "null");
    if (raw && typeof raw.seed === "string" && Number.isInteger(raw.level) && raw.level >= 1) {
      const lot = raw.lot && Array.isArray(raw.lot.vehicles) && Number.isInteger(raw.lot.size) && Number.isInteger(raw.lot.move_limit) ? raw.lot : void 0;
      return { seed: raw.seed, level: raw.level, lot, best: lot && typeof raw.best === "number" ? raw.best : void 0 };
    }
  } catch {
  }
  return { seed: Math.random().toString(36).slice(2, 10), level: 1 };
}
function saveRun() {
  store.set(KEY_RUN, JSON.stringify(endless));
}
var worker;
try {
  worker = new Worker(new URL("./worker.js", import.meta.url));
} catch {
  worker = void 0;
}
var jobId = 0;
var waiting = /* @__PURE__ */ new Map();
worker?.addEventListener("message", (e) => {
  waiting.get(e.data.id)?.(e.data);
  waiting.delete(e.data.id);
});
worker?.addEventListener("error", () => {
  worker = void 0;
  for (const [id, done] of waiting) done({ id, kind: "error", message: "worker failed" });
  waiting.clear();
});
function runInBackground(job) {
  const full = { ...job, id: ++jobId };
  if (!worker) return new Promise((resolve) => setTimeout(() => resolve(runJob(full)), 50));
  return new Promise((resolve) => {
    waiting.set(full.id, resolve);
    worker.postMessage(full);
  });
}
function generate(levelNumber) {
  if (upcoming?.level === levelNumber) return upcoming.result;
  const result = runInBackground({ kind: "generate", seed: `${endless.seed}:${levelNumber}`, difficulty: levelNumber, timeLimitMs: 6e3 });
  upcoming = { level: levelNumber, result };
  return result;
}
async function playEndless(levelNumber) {
  mode = "endless";
  levelId = void 0;
  if (endless.level === levelNumber && endless.lot && endless.best !== void 0) {
    showEndless();
    return;
  }
  building.hidden = false;
  ended = true;
  updateSelected();
  const result = await generate(levelNumber);
  if (mode !== "endless") return;
  if (result.kind !== "generate") {
    upcoming = void 0;
    building.hidden = true;
    message.textContent = "The next lot could not be built. Turn endless off and on to try again.";
    message.className = "message bad";
    return;
  }
  endless = { seed: endless.seed, level: levelNumber, lot: result.level, best: result.best };
  saveRun();
  showEndless();
}
function showEndless() {
  show(endless.lot, `Level ${endless.level} \xB7 Generated`, true, endless.best);
  void generate(endless.level + 1);
}
async function advanceEndless() {
  await playEndless(endless.level + 1);
}
function setEndless(on) {
  endlessToggle.checked = on;
  store.set(KEY_ENDLESS, on ? "1" : "0");
  if (on) void playEndless(endless.level);
  else loadLevel(activeIndex);
}
endlessToggle.addEventListener("change", () => setEndless(endlessToggle.checked));
document.querySelectorAll("[data-dir]").forEach((button) => button.addEventListener("click", () => act(button.dataset.dir)));
document.querySelector("#reset").addEventListener("click", restart);
document.querySelector("#next").addEventListener("click", () => {
  if (mode === "endless") void advanceEndless();
  else loadLevel((activeIndex + 1) % LEVELS.length);
});
document.addEventListener("keydown", (e) => {
  const map = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", a: "left", d: "right", w: "up", s: "down" };
  const dir = map[e.key];
  if (dir) {
    e.preventDefault();
    act(dir);
    return;
  }
  if (e.key === "n" || e.key === "]" || e.key === "[") {
    const ids = state.vehicles.map((v) => v.id), at = ids.indexOf(selected);
    const id = ids[(at + (e.key === "[" ? ids.length - 1 : 1)) % ids.length];
    if (id) {
      select(id);
      cars.get(id)?.focus();
    }
  }
});
var drag;
board.addEventListener("pointerdown", (e) => {
  const car = e.target.closest(".car");
  const vehicle = car && !ended ? state.vehicles.find((v) => v.id === car.dataset.id) : void 0;
  if (!car || !vehicle) return;
  e.preventDefault();
  select(vehicle.id);
  const [neg, pos] = axisDirections(vehicle), left = level.move_limit - state.moves;
  const back = slideLimit(level, state, vehicle.id, neg), ahead = slideLimit(level, state, vehicle.id, pos);
  const min = -Math.min(back.steps, left), max = Math.min(ahead.steps, left);
  const exitAt = back.exits && back.steps <= left ? min : ahead.exits && ahead.steps <= left ? max : void 0;
  drag = { pointer: e.pointerId, id: vehicle.id, start: vehicle.axis === "h" ? e.clientX : e.clientY, cell: board.clientWidth / level.size, min, max, exitAt, offset: 0, moved: false };
  car.setPointerCapture(e.pointerId);
  car.classList.add("dragging");
});
board.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.pointer) return;
  const vehicle = state.vehicles.find((v) => v.id === drag.id), car = cars.get(drag.id);
  if (!vehicle || !car) return;
  const raw = ((vehicle.axis === "h" ? e.clientX : e.clientY) - drag.start) / drag.cell;
  if (Math.abs(raw) > 0.08) drag.moved = true;
  drag.offset = Math.max(drag.min - 0.12, Math.min(drag.max + 0.12, raw));
  if (raw > drag.max + 0.3 || raw < drag.min - 0.3) message.textContent = BLOCKED2;
  place(car, vehicle, drag.offset);
});
function endDrag(e) {
  if (!drag || e.pointerId !== drag.pointer) return;
  const { id, offset, exitAt, min, max } = drag;
  drag = void 0;
  const car = cars.get(id), vehicle = state.vehicles.find((v) => v.id === id);
  car?.classList.remove("dragging");
  if (!vehicle) return;
  let steps = Math.max(min, Math.min(max, Math.round(offset)));
  if (exitAt !== void 0 && Math.sign(offset) === Math.sign(exitAt) && Math.abs(offset) >= Math.abs(exitAt) - 0.6) steps = exitAt;
  if (!steps) {
    render();
    return;
  }
  const [neg, pos] = axisDirections(vehicle);
  commit(slide(level, state, id, steps < 0 ? neg : pos, Math.abs(steps)));
}
board.addEventListener("pointerup", endDrag);
board.addEventListener("pointercancel", endDrag);
async function loadSaved(id) {
  const response = await fetch(`${api}/levels/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`Could not load saved level (${response.status}).`);
  const result = await response.json();
  if (result.game_id !== "lotescape") throw new Error("This saved level belongs to another game.");
  mode = "saved";
  levelId = id;
  endlessToggle.checked = false;
  show(result.level, "Studio level", false, void 0);
  const saved = result.level, solved = await runInBackground({ kind: "solve", level: saved });
  if (level === saved) bestLabel.textContent = solved.kind === "solve" && solved.best !== void 0 ? `Best possible: ${solved.best} moves` : "Best possible: not checked";
}
void (async () => {
  const params = new URLSearchParams(location.search), id = params.get("level");
  const stored = Number(store.get(KEY_BUILTIN));
  activeIndex = params.get("demo") === "1" ? 1 : Number.isInteger(stored) && stored >= 0 && stored < LEVELS.length ? stored : 0;
  if (id) {
    try {
      await loadSaved(id);
      return;
    } catch {
    }
  }
  if (store.get(KEY_ENDLESS) === "1" && !params.has("demo")) setEndless(true);
  else loadLevel(activeIndex);
  if (id) message.textContent = "That saved lot could not load, so here is a practice lot.";
})();
window.addEventListener("beforeunload", () => {
  if (!ended) event("quit");
});
