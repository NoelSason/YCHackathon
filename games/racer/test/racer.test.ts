import assert from "node:assert/strict";
import { test } from "node:test";
import adapter from "../adapter/index.js";
import { drive, humanDriver, mulberry32 } from "../src/bots.js";
import {
  type Action, BOOST_TICKS, boxesOverlap, buildGrid, cellKey, finished, footprintRows, GEOMETRY, isObstacle, KINDS, type Level,
  LIMITS, playerBox, spriteBox, startState, step, type TrackObject, validateLevel, VEHICLE_ROWS,
} from "../src/engine.js";
import { generateTrack, SAMPLES } from "../src/levels.js";
import { solveLevel } from "../src/solver.js";
import { runLevel } from "../../../solver/src/run.js";

/** CPU time since `since`, in ms. Wall time fails under load (a solver worker can fill every core). */
const cpuMs = (since: NodeJS.CpuUsage): number => {
  const d = process.cpuUsage(since);
  return (d.user + d.system) / 1000;
};

const base: Level = { lanes: 3, length: 20, speed: 8, time_limit: 40, crash_penalty: 3, lane_change_cooldown: 0, objects: [] };

test("samples are valid and beatable within their time limits", () => {
  for (const s of SAMPLES) {
    assert.deepEqual(validateLevel(s), { ok: true }, s.title);
    assert.ok(solveLevel(s).min_ticks <= s.time_limit, `${s.title} is impossible`);
  }
});

test("validation explains what is wrong", () => {
  const bad = (level: unknown, re: RegExp) => {
    const v = validateLevel(level);
    assert.equal(v.ok, false);
    assert.ok(!v.ok && v.errors.some((e) => re.test(e)), `expected ${re} in ${JSON.stringify(v)}`);
  };
  bad({ ...base, objects: [{ row: 5, lane: 3, kind: "car" }] }, /lane must be/);
  bad({ ...base, objects: [{ row: 25, lane: 0, kind: "car" }] }, /row must be/);
  bad({ ...base, objects: [{ row: 5, lane: 0, kind: "truck" }] }, /kind must be/);
  bad({ ...base, objects: [{ row: 5, lane: 0, kind: "car" }, { row: 5, lane: 0, kind: "coin" }] }, /share row 5/);
  bad({ ...base, lanes: 7 }, /lanes/);
  bad({ ...base, nitro: true }, /unknown field "nitro"/);
});

test("a crash costs crash_penalty ticks, a boost doubles speed, coins count once", () => {
  const level: Level = {
    ...base,
    objects: [{ row: 2, lane: 1, kind: "coin" }, { row: 3, lane: 1, kind: "boost" }, { row: 10, lane: 1, kind: "car" }],
  };
  const grid = buildGrid(level);
  let s = startState(level);
  let coins = 0;
  const log: string[] = [];
  while (!finished(level, s) && s.tick < 50) {
    const { next, ev } = step(level, grid, s, 0);
    coins += ev.coins;
    if (ev.boosted) log.push(`boost@${next.row}`);
    if (ev.crashed) log.push(`crash@${next.row}`);
    s = next;
  }
  assert.equal(coins, 1);
  assert.deepEqual(log, ["boost@3", "crash@10"]);
  // 3 ticks to the boost, BOOST_TICKS ticks at 2 rows (rows 4-11) but the car crashes at row 10.
  assert.ok(BOOST_TICKS === 4);
  assert.equal(s.tick, 3 + 4 + 3 + 10, "rows 1-3, rows 4-10 in 4 ticks, 3 stunned, rows 11-20");
});

test("steering respects the cooldown and the road edges", () => {
  const level: Level = { ...base, lane_change_cooldown: 2 };
  const grid = buildGrid(level);
  let s = startState(level); // lane 1
  s = step(level, grid, s, -1).next;
  assert.equal(s.lane, 0);
  s = step(level, grid, s, 1).next;
  assert.equal(s.lane, 0, "cooldown blocks steering");
  s = step(level, grid, s, 1).next;
  assert.equal(s.lane, 0, "still cooling down");
  s = step(level, grid, s, -1).next;
  assert.equal(s.lane, 0, "can't leave the road");
});

test("the solver finds the fastest run, crashing only when that is faster", () => {
  // A wall with one gap: steer around it, no time lost.
  const gap: Level = { ...base, objects: [{ row: 5, lane: 1, kind: "car" }, { row: 5, lane: 2, kind: "cone" }] };
  const r = solveLevel(gap);
  assert.equal(r.min_ticks, 20);
  assert.equal(r.crashes, 0);
  // Replaying the inputs reaches the finish in exactly min_ticks.
  const grid = buildGrid(gap);
  let s = startState(gap);
  for (const a of r.inputs) s = step(gap, grid, s, a).next;
  assert.ok(finished(gap, s) && s.tick === r.min_ticks);

  // A full wall must be crashed through: one crash penalty.
  const wall: Level = { ...base, objects: [0, 1, 2].map((lane) => ({ row: 8, lane, kind: "cone" as const })) };
  const w = solveLevel(wall);
  assert.deepEqual([w.min_ticks, w.crashes], [20 + 3, 1]);
});

test("bots are reproducible and rank sensibly", () => {
  const level = SAMPLES[1]!;
  assert.deepEqual(drive(level, "human", 9), drive(level, "human", 9));
  const wins = (bot: string) => {
    let w = 0;
    for (let s = 0; s < 120; s++) if (drive(level, bot, s).won) w++;
    return w;
  };
  const human = wins("human");
  assert.ok(human > wins("random"), "human should beat random");
  assert.ok(wins("greedy") >= human, "the mistake-free bot should do at least as well as the human one");
  assert.throws(() => drive(level, "search", 1), /unknown bot/);
});

test("higher speed makes the human bot lose more", () => {
  const level = SAMPLES[1]!;
  const min = solveLevel(level).min_ticks;
  const rate = (speed: number) => {
    let w = 0;
    for (let s = 0; s < 150; s++) if (drive({ ...level, speed, time_limit: min + 10 }, "human", s).won) w++;
    return w;
  };
  assert.ok(rate(5) > rate(14), "a faster track should be harder for a person");
});

test("adapter follows platform/CONTRACTS.md §1 and runs in the solver harness", () => {
  assert.equal(adapter.game_id, "racer");
  assert.deepEqual(adapter.bots, ["human", "greedy", "random"]);
  assert.match(adapter.level_url("abc"), /\/games\/racer\/\?level=abc$/);
  const s = adapter.solve(SAMPLES[0]!);
  assert.equal(s.solvable, true);
  assert.equal(adapter.solve({ ...SAMPLES[0]!, time_limit: s.min_moves - 1 }).solvable, false);

  const c0 = process.cpuUsage();
  const out = runLevel(adapter, SAMPLES[3] as Level, adapter.bots, 200, 3);
  const ms = cpuMs(c0);
  assert.ok(ms < 4000, `200 runs of 3 bots took ${Math.round(ms)} ms of CPU`);
  for (const bot of adapter.bots) assert.equal(out.results[bot]!.runs, 200);
  assert.equal(out.solvable, true);
});

test("a shield absorbs one oil slick; the next obstacle still crashes, and the solver replays it", () => {
  const level: Level = { ...base, objects: [
    { row: 1, lane: 1, kind: "shield" },
    { row: 2, lane: 1, kind: "oil" },
    { row: 3, lane: 1, kind: "cone" },
  ] };
  assert.deepEqual(adapter.validate(level), { ok: true });
  const grid = buildGrid(level);
  const pickup = step(level, grid, startState(level), 0);
  assert.equal(pickup.next.shield, 1);
  assert.equal(pickup.ev.shielded, true);
  const save = step(level, grid, pickup.next, 0);
  assert.equal(save.next.shield, 0);
  assert.equal(save.ev.protected, true);
  assert.equal(save.ev.crashed, false);
  const crash = step(level, grid, save.next, 0);
  assert.equal(crash.ev.crashed, true);
  assert.equal(crash.next.stun, level.crash_penalty);
  const result = solveLevel(level);
  let state = startState(level);
  for (const action of result.inputs) state = step(level, grid, state, action).next;
  assert.equal(state.tick, result.min_ticks);
  assert.ok(finished(level, state));
});

test("shield state is preserved in exact search when every lane has a hazard", () => {
  const level: Level = { ...base, objects: [
    { row: 1, lane: 1, kind: "shield" },
    ...[0, 1, 2].map(lane => ({ row: 5, lane, kind: "oil" as const })),
  ] };
  assert.equal(solveLevel(level).min_ticks, level.length);
  assert.equal(solveLevel(level).crashes, 0);
});

// ---------- genre rules: sizes, lanes, hitboxes (RULES.md) ----------

const kindOf = (level: Level, key: number) => level.objects.find((o) => cellKey(o.row, o.lane) === key)!.kind;

test("every vehicle, the player's and the traffic's, is drawn the same size, centered in its lane", () => {
  const p = playerBox(10, 1);
  const t = spriteBox("car", 10, 2);
  assert.equal(p.x1 - p.x0, t.x1 - t.x0, "same width");
  assert.equal(p.y1 - p.y0, t.y1 - t.y0, "same length");
  assert.ok(t.y1 - t.y0 > 1, "a vehicle is longer than one row");
  // Width is a fixed share of the lane, and the on-screen shape doesn't depend on the lane count.
  const widthPx = (p.x1 - p.x0) * GEOMETRY.laneAspect; // in row units
  const lengthPx = p.y1 - p.y0;
  assert.ok(lengthPx / widthPx > 1.5 && lengthPx / widthPx < 2.2, `car-shaped (length ÷ width = ${(lengthPx / widthPx).toFixed(2)})`);
  for (const kind of KINDS) {
    for (let lane = 0; lane < LIMITS.maxLanes; lane++) {
      const b = spriteBox(kind, 7, lane);
      assert.ok(Math.abs((b.x0 + b.x1) / 2 - (lane + 0.5)) < 1e-9, `${kind} centered in lane ${lane}`);
    }
  }
  for (let lane = 0; lane < LIMITS.maxLanes; lane++) {
    const b = playerBox(3, lane);
    assert.ok(Math.abs((b.x0 + b.x1) / 2 - (lane + 0.5)) < 1e-9, `player centered in lane ${lane}`);
  }
});

test("each sprite fits inside the cells it covers, and pickups and hazards are big enough to read", () => {
  for (const kind of KINDS) {
    const b = spriteBox(kind, 5, 2);
    assert.ok(b.x0 > 2 && b.x1 < 3, `${kind} stays in its lane`);
    assert.ok(b.y0 > 5 && b.y1 < 5 + footprintRows(kind), `${kind} stays in its ${footprintRows(kind)} row(s)`);
    const wRows = (b.x1 - b.x0) * GEOMETRY.laneAspect;
    assert.ok(wRows >= 0.55 && b.y1 - b.y0 >= 0.55, `${kind} is at least about half a row across`);
  }
  const p = playerBox(5, 2);
  assert.ok(p.y0 > 5 - VEHICLE_ROWS + 1 && p.y1 < 6, "the player's car stays in its two cells");
});

test("hitboxes match the sprites: two things overlap on screen exactly when their cells overlap", () => {
  for (const kind of KINDS) {
    for (let lane = 0; lane < 3; lane++) {
      for (let row = 6; row <= 14; row++) {
        const p = 10;
        const cellsOverlap = lane === 1 && row <= p && row + footprintRows(kind) - 1 >= p - VEHICLE_ROWS + 1;
        assert.equal(boxesOverlap(playerBox(p, 1), spriteBox(kind, row, lane)), cellsOverlap, `${kind} at row ${row}, lane ${lane}`);
      }
    }
  }
});

test("collision is overlap: the car never overlaps a hazard on screen without hitting it (random drives)", () => {
  const rnd = mulberry32(2026);
  const kinds = ["car", "car", "cone", "oil", "shield", "boost", "coin"] as const;
  for (let t = 0; t < 300; t++) {
    const lanes = 3 + Math.floor(rnd() * 3);
    const objects: TrackObject[] = [];
    const used = new Set<number>();
    for (let i = 0; i < 18; i++) {
      const row = 1 + Math.floor(rnd() * 28);
      const lane = Math.floor(rnd() * lanes);
      if (used.has(cellKey(row, lane))) continue;
      used.add(cellKey(row, lane));
      objects.push({ row, lane, kind: kinds[Math.floor(rnd() * kinds.length)]! });
    }
    const level: Level = { lanes, length: 30, speed: 8, time_limit: 200, crash_penalty: 2, lane_change_cooldown: Math.floor(rnd() * 2), objects };
    const grid = buildGrid(level);
    const hit = new Set<number>();
    let s = startState(level);
    while (!finished(level, s) && s.tick < 200) {
      const a = (rnd() < 0.45 ? (rnd() < 0.5 ? -1 : 1) : 0) as Action;
      const { next, ev } = step(level, grid, s, a);
      // Where the car's sprite went this tick: sideways (if it steered), then each row forward.
      const seen = [];
      const target = s.lane + a;
      if (a !== 0 && s.stun === 0 && s.cooldown === 0 && target >= 0 && target < lanes) seen.push(playerBox(s.row, target));
      for (let r = s.row + 1; r <= Math.min(next.row, level.length - 1); r++) seen.push(playerBox(r, next.lane));
      for (const key of ev.hit) {
        hit.add(key);
        const o = level.objects.find((x) => cellKey(x.row, x.lane) === key)!;
        assert.ok(isObstacle(o.kind));
        assert.ok(seen.some((b) => boxesOverlap(b, spriteBox(o.kind, o.row, o.lane))), `track ${t}: hit something it never touched`);
      }
      for (const o of objects) {
        if (!isObstacle(o.kind) || hit.has(cellKey(o.row, o.lane))) continue;
        for (const b of seen) assert.ok(!boxesOverlap(b, spriteBox(o.kind, o.row, o.lane)), `track ${t} tick ${next.tick}: drove through a ${o.kind} without hitting it`);
      }
      s = next;
    }
  }
});

test("steering into a car beside you is a side crash: the car bounces back and loses time", () => {
  // Player in lane 1, front at row 5 (covers rows 4-5). Traffic in lane 2 at row 3 covers rows 3-4.
  const level: Level = { ...base, objects: [{ row: 3, lane: 2, kind: "car" }] };
  const grid = buildGrid(level);
  const s = { ...startState(level), row: 5 };
  const { next, ev } = step(level, grid, s, 1);
  assert.equal(ev.crashed, true);
  assert.equal(ev.sideswipe, true);
  assert.equal(next.lane, 1, "bounced back to its own lane");
  assert.equal(next.row, 5, "no forward movement on a side crash");
  assert.equal(next.stun, level.crash_penalty);
  assert.deepEqual(ev.hit, [cellKey(3, 2)]);
  assert.deepEqual(ev.cleared, [], "the other car is still there");
  // Once its rear bumper is past the other car's front (row 7 covers rows 6-7), the lane is free.
  assert.equal(step(level, grid, { ...s, row: 7 }, 1).ev.crashed, false);
  // A shield takes the hit instead, and the car changes lanes.
  const shielded = step(level, grid, { ...s, shield: 1 }, 1);
  assert.deepEqual([shielded.ev.crashed, shielded.ev.protected, shielded.next.lane, shielded.next.shield], [false, true, 2, 0]);
});

test("a traffic car is two rows long: it blocks both rows and costs one crash, not two", () => {
  const level: Level = { ...base, objects: [{ row: 6, lane: 1, kind: "car" }] };
  const grid = buildGrid(level);
  let s = startState(level);
  let crashes = 0;
  while (!finished(level, s)) {
    const { next, ev } = step(level, grid, s, 0);
    if (ev.crashed) crashes++;
    s = next;
  }
  assert.equal(crashes, 1);
  assert.equal(s.tick, level.length + level.crash_penalty);
  // Its second row (7) also blocks a lane change from the side.
  assert.equal(step(level, grid, { ...startState(level), lane: 0, row: 8 }, 1).ev.crashed, true);
  assert.equal(step(level, grid, { ...startState(level), lane: 0, row: 9 }, 1).ev.crashed, false);
});

test("a quick left-right never collects the same pickup twice", () => {
  const level: Level = { ...base, objects: [
    { row: 3, lane: 1, kind: "shield" }, { row: 4, lane: 1, kind: "coin" }, { row: 6, lane: 1, kind: "boost" },
  ] };
  const grid = buildGrid(level);
  let s = startState(level);
  let coins = 0;
  let shields = 0;
  let boosts = 0;
  const plan: Action[] = [0, 0, 0, 0, -1, 1, 0, 0, -1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const a of plan) {
    const { next, ev } = step(level, grid, s, a);
    coins += ev.coins;
    shields += ev.shielded ? 1 : 0;
    boosts += ev.boosted ? 1 : 0;
    s = next;
  }
  assert.deepEqual([coins, shields, boosts], [1, 1, 1]);
});

test("sliding sideways over a pickup collects it", () => {
  const level: Level = { ...base, objects: [{ row: 4, lane: 2, kind: "coin" }] };
  const { ev } = step(level, buildGrid(level), { ...startState(level), row: 5 }, 1);
  assert.equal(ev.coins, 1);
  assert.deepEqual(ev.cleared, [cellKey(4, 2)]);
});

test("the road shows at least as far ahead as the reference bot plans", () => {
  const ahead = GEOMETRY.minVisibleRows - GEOMETRY.cameraRows - VEHICLE_ROWS;
  let most = 0;
  for (let speed = LIMITS.minSpeed; speed <= LIMITS.maxSpeed; speed++) most = Math.max(most, humanDriver({ ...base, speed }).horizon);
  assert.ok(ahead >= most, `${ahead} rows visible ahead, the human bot plans ${most}`);
});

test("generated tracks keep every object visible: nothing under a car's second row", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const level = generateTrack({ lanes: 4, length: 120, speed: 10, gap: 3, blocked: 3, boosts: 6, coins: 14, time_limit: 200, seed });
    const cells = new Set(level.objects.map((o) => cellKey(o.row, o.lane)));
    for (const o of level.objects) if (o.kind === "car") assert.ok(!cells.has(cellKey(o.row + 1, o.lane)), `seed ${seed}: something under the car at row ${o.row}`);
  }
});

test("older level JSON still validates and plays, even with an object under a car", () => {
  const old: Level = { ...base, objects: [{ row: 5, lane: 1, kind: "car" }, { row: 6, lane: 1, kind: "coin" }, { row: 9, lane: 0, kind: "cone" }] };
  assert.deepEqual(validateLevel(old), { ok: true });
  const r = solveLevel(old);
  assert.ok(r.min_ticks >= old.length);
  assert.equal(kindOf(old, cellKey(5, 1)), "car");
});


test("cleared traffic stays gone when steering back through its second cell", () => {
  const level: Level = { ...base, lane_change_cooldown: 0, objects: [{ row: 5, lane: 1, kind: "car" }] };
  const grid = buildGrid(level);
  let state = { ...startState(level), row: 4, lane: 1 };
  const crash = step(level, grid, state, 0);
  assert.deepEqual(crash.ev.cleared, [cellKey(5, 1)]);
  state = crash.next;
  while (state.stun) state = step(level, grid, state, 0).next;
  state = step(level, grid, state, 1).next;
  const back = step(level, grid, state, -1);
  assert.equal(back.ev.crashed, false, "the wreck hidden by the browser must stay cleared");
  assert.equal(back.next.lane, 1);
  assert.deepEqual(back.ev.hit, []);
});


test("a sideways boost pickup refreshes an active boost for its full duration", () => {
  const level: Level = { ...base, objects: [{ row: 5, lane: 2, kind: "boost" }] };
  const state = { ...startState(level), row: 5, lane: 1, boost: 2 };
  const result = step(level, buildGrid(level), state, 1);
  assert.equal(result.ev.boosted, true);
  assert.equal(result.next.boost, 4);
  assert.equal(result.next.row, 7);
});
