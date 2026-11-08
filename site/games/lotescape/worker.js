"use strict";
(() => {
  // src/engine.ts
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

  // src/solver.ts
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

  // ui/worker.ts
  var scope = globalThis;
  scope.onmessage = (event) => scope.postMessage(runJob(event.data));
})();
