// Built by sample-generator/build.mjs from src/. Don't edit by hand.

// src/handler.ts
import { createHmac, timingSafeEqual } from "node:crypto";

// ../games/lotescape/src/engine.ts
var DIRECTIONS = ["left", "right", "up", "down"];
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
function move(level, state, id, direction) {
  if (state.won) return state;
  const index = state.vehicles.findIndex((v) => v.id === id), vehicle = state.vehicles[index];
  if (!vehicle) return state;
  const to = stepAlongLane(level.size, vehicle, direction, (x, y) => state.vehicles.some((other, i) => i !== index && covers(other, x, y)));
  if (to === BLOCKED) return state;
  const vehicles = state.vehicles.slice();
  if (to === EXITS) vehicles.splice(index, 1);
  else vehicles[index] = vehicle.axis === "h" ? { ...vehicle, x: to } : { ...vehicle, y: to };
  return { vehicles, moves: state.moves + 1, won: vehicles.length === 0 };
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
function legalMoves(level, state) {
  return state.vehicles.flatMap((v) => DIRECTIONS.flatMap((direction) => {
    const next = move(level, state, v.id, direction);
    return next === state ? [] : [{ id: v.id, direction }];
  }));
}
function axisDirections(vehicle) {
  return vehicle.axis === "h" ? ["left", "right"] : ["up", "down"];
}

// ../games/lotescape/src/solver.ts
function solveLevel(level, maxStates = 25e4) {
  const size = level.size, vehicles = level.vehicles, n = vehicles.length;
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
        const v = vehicles[j], lane = horizontal[j] ? v.y : v.x;
        for (let k = 0; k < v.length; k++) grid[horizontal[j] ? lane * size + at + k : (at + k) * size + lane] = j + 1;
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

// ../games/lotescape/src/generate.ts
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
function rateLevel(level, solution = solveLevel(level)) {
  if (!solution.solvable || solution.min_moves === void 0) return void 0;
  const free = level.vehicles.reduce((sum, v) => sum + distanceToExit(level.size, v), 0);
  const backups = (solution.min_moves - free) / 2;
  const { depth, blocked } = blocking(level);
  const trucks = level.vehicles.filter((v) => v.length === 3).length;
  return { min_moves: solution.min_moves, free_moves: free, backups, blocking_depth: depth, blocked, vehicles: level.vehicles.length, trucks, score: 8 * backups + 2 * Math.min(depth, 6) + level.vehicles.length + trucks };
}
function generateLevel(options) {
  const profile = difficultyProfile(options.difficulty);
  const rand = rng(`${options.seed}|${profile.difficulty}`);
  const maxAttempts = options.maxAttempts ?? 4e3, deadline = Date.now() + (options.timeLimitMs ?? 8e3);
  const [lo, hi] = profile.score;
  const distance = (score) => score < lo ? lo - score : score > hi ? score - hi : 0;
  let best;
  let current;
  let attempts = 0, stale = 0, stopped = "budget";
  while (attempts < maxAttempts) {
    if (Date.now() > deadline && best) {
      stopped = "time";
      break;
    }
    attempts++;
    if (stale >= 150) {
      stale = 0;
      current = best && rand() < 0.5 ? { vehicles: shake(best.vehicles, profile, rand), distance: Infinity } : void 0;
    }
    const vehicles = current ? mutate(current.vehicles, profile, rand) : randomLot(profile, rand);
    if (!vehicles) continue;
    const level2 = { title: "candidate", size: profile.size, vehicles, move_limit: 300 };
    const solution = solveLevel(level2, CANDIDATE_STATES);
    const rating = rateLevel(level2, solution);
    if (!rating) {
      stale++;
      continue;
    }
    const d = distance(rating.score);
    if (!best || d < distance(best.rating.score)) best = { vehicles, rating, solution };
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
  while (!best) {
    const vehicles = randomLot({ ...profile, vehicles: [5, 5], trucks: 1 }, rand);
    if (!vehicles) continue;
    const solution = solveLevel({ title: "candidate", size: profile.size, vehicles, move_limit: 300 }, CANDIDATE_STATES);
    const rating = rateLevel({ title: "candidate", size: profile.size, vehicles, move_limit: 300 }, solution);
    if (rating) best = { vehicles, rating, solution };
  }
  const level = finish(best.vehicles, profile.size, best.rating.min_moves, options.title, rand);
  const rename = new Map(best.vehicles.map((v, i) => [v.id, level.vehicles[i].id]));
  const inputs = (best.solution.inputs ?? []).map((input) => ({ id: rename.get(input.id), direction: input.direction }));
  return { level, rating: best.rating, inputs, difficulty: profile.difficulty, seed: options.seed, attempts, stopped };
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
  const along = Math.floor(rand() * (size - length + 1)), lane = Math.floor(rand() * size);
  const exit = axis === "h" ? rand() < 0.5 ? "left" : "right" : rand() < 0.5 ? "up" : "down";
  return { id, x: axis === "h" ? along : lane, y: axis === "h" ? lane : along, length, axis, exit, color: "coral" };
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
function blocking(level) {
  const owner = /* @__PURE__ */ new Map();
  level.vehicles.forEach((v, i) => cellsOf(v).forEach((c) => owner.set(c, i)));
  const blockers = level.vehicles.map((v) => [...new Set(route(v, level.size).flatMap((c) => owner.has(c) ? [owner.get(c)] : []))]);
  const longest = (i, path) => {
    let best = 0;
    for (const j of blockers[i]) {
      if (path.has(j)) {
        best = Math.max(best, 1);
        continue;
      }
      path.add(j);
      best = Math.max(best, 1 + longest(j, path));
      path.delete(j);
    }
    return best;
  };
  return { depth: Math.max(0, ...level.vehicles.map((_, i) => longest(i, /* @__PURE__ */ new Set([i])))), blocked: blockers.filter((b) => b.length > 0).length };
}
function touching(a, b) {
  const near = new Set(cellsOf(a).flatMap((c) => [c - 1, c + 1, c - 16, c + 16]));
  return cellsOf(b).some((c) => near.has(c));
}
function finish(vehicles, size, minMoves, title, rand) {
  const cars = [...CAR_NAMES], trucks = [...TRUCK_NAMES], offset = Math.floor(rand() * COLORS.length);
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
  const named = vehicles.map((v, i) => ({ ...v, id: take(v.length === 3 ? trucks : cars, v.length === 3 ? "truck" : "car", i), color: colors[i] }));
  return { title: (title ?? `${pick(rand, PLACE_A)} ${pick(rand, PLACE_B)}`).slice(0, 48), size, vehicles: named, move_limit: moveLimitFor(minMoves) };
}

// ../games/lotescape/src/bots.ts
var BOTS = ["search", "random"];
function random(seed) {
  return () => {
    seed |= 0;
    seed = seed + 1831565813 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function playOut(level, bot, seed) {
  const solved = bot === "search" ? solveLevel(level) : void 0;
  if (solved?.solvable && solved.inputs) return { won: solved.min_moves <= level.move_limit, moves_used: solved.min_moves, detail: { bot, explored: solved.explored } };
  let state = { vehicles: level.vehicles.map((v) => ({ ...v })), moves: 0, won: level.vehicles.length === 0 };
  const rand = random(seed);
  while (!state.won && state.moves < level.move_limit) {
    const moves = legalMoves(level, state);
    if (!moves.length) break;
    const action = moves[Math.floor(rand() * moves.length)];
    state = move(level, state, action.id, action.direction);
  }
  return { won: state.won, moves_used: state.moves, detail: { bot } };
}

// ../games/lotescape/adapter/index.ts
var BASE_URL = process.env.GAMES_BASE_URL ?? "http://localhost:3000";
var schema = { $schema: "https://json-schema.org/draft/2020-12/schema", title: "Lot Escape level", type: "object", additionalProperties: false, required: ["title", "size", "vehicles", "move_limit"], properties: { title: { type: "string", minLength: 1, maxLength: 48 }, size: { type: "integer", minimum: 5, maximum: 8 }, move_limit: { type: "integer", minimum: 1, maximum: 300 }, vehicles: { type: "array", minItems: 1, maxItems: 12, items: { type: "object", additionalProperties: false, required: ["id", "x", "y", "length", "axis", "exit", "color"], properties: { id: { type: "string", pattern: "^[a-z][a-z0-9-]{0,15}$" }, x: { type: "integer" }, y: { type: "integer" }, length: { type: "integer", minimum: 2, maximum: 3 }, axis: { enum: ["h", "v"] }, exit: { enum: DIRECTIONS }, color: { enum: ["coral", "sunshine", "lagoon", "mint", "violet", "peach"] } } } } } };
function validateLevel(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, errors: ["level must be an object"] };
  const l = value, errors = [];
  if (Object.keys(l).some((k) => !["title", "size", "vehicles", "move_limit"].includes(k))) errors.push("level has an unknown field");
  if (typeof l.title !== "string" || !l.title.trim() || l.title.length > 48) errors.push("title must be 1-48 characters");
  if (!Number.isInteger(l.size) || l.size < 5 || l.size > 8) errors.push("size must be an integer from 5 to 8");
  if (!Number.isInteger(l.move_limit) || l.move_limit < 1 || l.move_limit > 300) errors.push("move_limit must be an integer from 1 to 300");
  if (!Array.isArray(l.vehicles) || l.vehicles.length < 1 || l.vehicles.length > 12) errors.push("vehicles must contain 1-12 cars");
  if (Array.isArray(l.vehicles) && Number.isInteger(l.size)) {
    const ids = /* @__PURE__ */ new Set(), occupied = /* @__PURE__ */ new Set(), size = l.size;
    for (const raw of l.vehicles) {
      if (!raw || typeof raw !== "object") {
        errors.push("each vehicle must be an object");
        continue;
      }
      const v = raw;
      if (!/^[a-z][a-z0-9-]{0,15}$/.test(v.id) || ids.has(v.id)) errors.push("vehicle ids must be unique slugs");
      else ids.add(v.id);
      if (!Number.isInteger(v.length) || v.length < 2 || v.length > 3 || !Number.isInteger(v.x) || !Number.isInteger(v.y) || !["h", "v"].includes(v.axis) || (v.axis === "h" ? v.exit !== "left" && v.exit !== "right" : v.exit !== "up" && v.exit !== "down") || !["coral", "sunshine", "lagoon", "mint", "violet", "peach"].includes(v.color)) {
        errors.push(`vehicle ${v.id} has invalid properties`);
        continue;
      }
      if (v.x < 0 || v.y < 0 || (v.axis === "h" ? v.x + v.length : v.y + v.length) > size || (v.axis === "h" ? v.y : v.x) >= size) errors.push(`vehicle ${v.id} is outside the lot`);
      for (let i = 0; i < v.length; i++) {
        const key = `${v.x + (v.axis === "h" ? i : 0)},${v.y + (v.axis === "v" ? i : 0)}`;
        if (occupied.has(key)) errors.push(`vehicles overlap at ${key}`);
        occupied.add(key);
      }
    }
    if (!errors.length) {
      const solved = solveLevel(l);
      if (solved.truncated) errors.push("the lot is too large to check exactly; use fewer or shorter vehicles");
      else if (!solved.solvable) errors.push("all vehicles cannot reach an exit");
      else if ((solved.min_moves ?? Infinity) > l.move_limit) errors.push(`clearing the lot needs ${solved.min_moves} moves, above move_limit`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}
var adapter = { game_id: "lotescape", name: "Lot Escape", schema, bots: [...BOTS], validate: validateLevel, simulate(level, bot, seed) {
  return playOut(level, bot, seed);
}, solve(value) {
  const check = validateLevel(value);
  if (!check.ok) return { solvable: false };
  const result = solveLevel(value);
  return { solvable: result.solvable, min_moves: result.min_moves, inputs: result.inputs };
}, level_url(id) {
  return `${BASE_URL}/lotescape/?level=${encodeURIComponent(id)}`;
} };

// src/lot.ts
var MAX_NOTCH = 8;
var notchFor = (difficulty) => 1 + Math.round(clamp01(difficulty) * (MAX_NOTCH - 1));
var slackFor = (difficulty, minMoves) => Math.max(1, Math.round(minMoves * (0.85 - 0.8 * clamp01(difficulty))));
function clamp01(x) {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0.5;
}
function generate(seed, difficulty) {
  const notch = notchFor(difficulty);
  const g = generateLevel({ seed, difficulty: notch, timeLimitMs: 4e3 });
  const min = g.rating.min_moves;
  const level = { ...g.level, move_limit: Math.min(300, min + slackFor(difficulty, min)) };
  return { level, meta: { notch, min_moves: min, move_limit: level.move_limit, score: g.rating.score, generator: "Lot Escape sample generator" } };
}
function rng2(seed) {
  let s = seed >>> 0;
  return () => {
    s = s + 1831565813 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var SLIP_RATE = 0.3;
var BOT = "casual-player";
function playOnce(level, seed) {
  const rand = rng2(seed);
  let state = { vehicles: level.vehicles.map((v) => ({ ...v })), moves: 0, won: level.vehicles.length === 0 };
  let plan = [];
  while (!state.won && state.moves < level.move_limit) {
    if (rand() < SLIP_RATE) {
      const moves = legalMoves(level, state);
      if (!moves.length) break;
      const m = moves[Math.floor(rand() * moves.length)];
      state = move(level, state, m.id, m.direction);
      plan = [];
      continue;
    }
    if (!plan.length) {
      const s = solveLevel({ ...level, vehicles: state.vehicles }, 6e4);
      if (!s.solvable || !s.inputs?.length) break;
      plan = s.inputs;
    }
    const next = plan.shift();
    const after = move(level, state, next.id, next.direction);
    if (after === state) {
      plan = [];
      continue;
    }
    state = after;
  }
  return { won: state.won, moves: state.moves };
}
function evaluate(level, runs, seed) {
  const exact = solveLevel(level);
  let wins = 0;
  for (let i = 0; i < runs; i++) if (playOnce(level, seed + i).won) wins++;
  return { wins, runs, solvable: exact.solvable, ...exact.min_moves !== void 0 ? { min_moves: exact.min_moves } : {}, bot: BOT };
}
function validate(level) {
  const r = validateLevel(level);
  return r.ok ? { ok: true, errors: [] } : { ok: false, errors: r.errors };
}

// src/handler.ts
function verifyLevelAiSignature(secret, rawBody, header) {
  const parts = Object.fromEntries((header ?? "").split(",").map((p) => p.trim().split("=", 2)));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1 || Math.abs(Date.now() / 1e3 - t) > 300) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"));
  const given = Buffer.from(String(parts.v1));
  return given.length === expected.length && timingSafeEqual(given, expected);
}
var reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
var num = (v, lo, hi, fallback) => typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
async function handle(request, op2) {
  const secret = process.env.LEVELAI_SIGNING_SECRET;
  if (!secret) return reply(503, { error: "not configured: set LEVELAI_SIGNING_SECRET" });
  if (request.method !== "POST") return reply(405, { error: "use POST" });
  const raw = await request.text();
  if (raw.length > 2e5) return reply(413, { error: "body too large" });
  if (!verifyLevelAiSignature(secret, raw, request.headers.get("x-levelai-signature"))) return reply(401, { error: "bad signature" });
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply(400, { error: "body must be JSON" });
  }
  const t0 = Date.now();
  try {
    if (op2 === "generate") {
      const out = generate(Math.floor(num(body.seed, 0, 2 ** 31, 1)), num(body.difficulty, 0, 1, 0.5));
      console.log(`generate d=${body.difficulty} notch=${out.meta.notch} min=${out.meta.min_moves} ${Date.now() - t0}ms`);
      return reply(200, out);
    }
    if (op2 === "validate") return reply(200, validate(body.level));
    if (op2 === "evaluate") {
      const check = validate(body.level);
      if (!check.ok) return reply(422, { error: `not a valid Lot Escape level: ${check.errors.join("; ")}` });
      const runs = Math.floor(num(body.runs, 1, 300, 100));
      const out = evaluate(body.level, runs, Math.floor(num(body.seed, 0, 2 ** 31, 1)));
      console.log(`evaluate runs=${runs} wins=${out.wins} ${Date.now() - t0}ms`);
      return reply(200, out);
    }
    return reply(404, { error: "unknown operation" });
  } catch (err) {
    return reply(500, { error: err instanceof Error ? err.message.slice(0, 200) : "failed" });
  }
}

// src/entry.ts
var op = (request) => new URL(request.url).searchParams.get("op") ?? "";
function POST(request) {
  return handle(request, op(request));
}
function GET(request) {
  return handle(request, op(request));
}
export {
  GET,
  POST
};
