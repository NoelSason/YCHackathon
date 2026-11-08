// Turbo Lanes: the rules. Pure and deterministic, so the same code runs in Node (solver, bots,
// adapter) and in the browser game. RULES.md explains each rule and the genre conventions behind it.
//
// The track is a grid: `lanes` across, `length` rows long. A cell is one lane by one row.
// - The player's car starts at row 0 and moves one row per tick (two while boosted). Its `row` is
//   its front bumper; like every vehicle it is VEHICLE_ROWS (2) rows long, so it covers the cells
//   `row - 1` and `row` of its lane.
// - Traffic (`car`) covers the cell it is placed in and the one ahead of it. Cones, oil, and pickups
//   cover one cell.
// - Each tick the driver may steer one lane left or right (then wait `lane_change_cooldown` ticks).
//   A steer moves the car sideways first, then forward. Moving sideways into a hazard is a side
//   crash: the car bounces back to its own lane and loses `crash_penalty` ticks.
// - Driving forward into a hazard (car, cone, oil) is a crash: the car stops for `crash_penalty`
//   ticks and loses its boost, then drives on through the wreck.
// - Boost pads give BOOST_TICKS ticks of double speed. A shield absorbs the next hazard (no crash,
//   no lost boost) and does not stack. Coins are score only.
// - The level is won by crossing the finish row within `time_limit` ticks. On screen one tick
//   lasts 1/speed seconds.
//
// Collision is overlap: two things collide exactly when their cells overlap in the same lane, and
// the sprites the browser draws (GEOMETRY / spriteBox) are sized so that they overlap exactly then.

export const KINDS = ["car", "cone", "oil", "shield", "boost", "coin"] as const;
export type Kind = (typeof KINDS)[number];
export const BOOST_TICKS = 4;

export interface TrackObject {
  row: number;
  lane: number;
  kind: Kind;
}

export interface Level {
  lanes: number;
  length: number;               // rows; the finish line is at row = length
  speed: number;                // rows per second on screen (how fast it feels)
  time_limit: number;           // ticks allowed
  crash_penalty: number;        // ticks lost per crash
  lane_change_cooldown: number; // ticks to wait after steering before steering again
  objects: TrackObject[];
  start_lane?: number;          // default: the middle lane
  title?: string;
}

export type Action = -1 | 0 | 1;

/** Everything that changes during a run. Rows only increase, so nothing behind the car matters. */
export interface CarState {
  row: number;
  lane: number;
  tick: number;
  cooldown: number;
  boost: number;
  stun: number;
  shield: number; // 0 or 1: absorbs the next obstacle
  /**
   * The other lane the car's back half covers, or -1. After a lane change the car's rear cell in
   * the lane it left was already driven over, so steering straight back must not touch it again.
   */
  rear: number;
  /** Cleared anchors in this row and the two behind it (5 lane bits per row). */
  cleared?: number;
}

export interface StepEvents {
  crashed: boolean;
  boosted: boolean;
  coins: number;
  shielded: boolean;
  protected: boolean;
  sideswipe: boolean; // the crash came from steering into a hazard; the car stayed in its lane
  hit: number[];      // cellKey of each hazard touched this tick
  cleared: number[];  // cellKey of each object that is gone after this tick (wrecks, coins, shields)
}

export const LIMITS = {
  minLanes: 3, maxLanes: 5,
  minLength: 20, maxLength: 400,
  minSpeed: 4, maxSpeed: 16,
  maxTimeLimit: 1000,
  maxCrashPenalty: 10,
  maxCooldown: 3,
  maxObjects: 600,
} as const;

export const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Turbo Lanes level",
  type: "object",
  additionalProperties: false,
  required: ["lanes", "length", "speed", "time_limit", "crash_penalty", "lane_change_cooldown", "objects"],
  properties: {
    title: { type: "string", maxLength: 40 },
    lanes: { type: "integer", minimum: LIMITS.minLanes, maximum: LIMITS.maxLanes },
    length: { type: "integer", minimum: LIMITS.minLength, maximum: LIMITS.maxLength },
    speed: { type: "number", minimum: LIMITS.minSpeed, maximum: LIMITS.maxSpeed },
    time_limit: { type: "integer", minimum: 1, maximum: LIMITS.maxTimeLimit },
    crash_penalty: { type: "integer", minimum: 1, maximum: LIMITS.maxCrashPenalty },
    lane_change_cooldown: { type: "integer", minimum: 0, maximum: LIMITS.maxCooldown },
    start_lane: { type: "integer", minimum: 0, maximum: LIMITS.maxLanes - 1 },
    objects: {
      type: "array",
      maxItems: LIMITS.maxObjects,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["row", "lane", "kind"],
        properties: {
          row: { type: "integer", minimum: 1 },
          lane: { type: "integer", minimum: 0, maximum: LIMITS.maxLanes - 1 },
          kind: { enum: [...KINDS] },
        },
      },
    },
  },
} as const;

export type Validation = { ok: true } | { ok: false; errors: string[] };

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const inRange = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

export function validateLevel(input: unknown): Validation {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, errors: ["level must be an object"] };
  const l = input as Record<string, unknown>;
  const errors: string[] = [];
  const allowed = ["lanes", "length", "speed", "time_limit", "crash_penalty", "lane_change_cooldown", "objects", "start_lane", "title"];
  for (const k of Object.keys(l)) if (!allowed.includes(k)) errors.push(`unknown field "${k}"`);
  const need = (k: string, ok: boolean, msg: string) => void (ok || errors.push(`${k} ${msg}`));
  need("lanes", isInt(l.lanes) && inRange(l.lanes, LIMITS.minLanes, LIMITS.maxLanes), `must be an integer from ${LIMITS.minLanes} to ${LIMITS.maxLanes}`);
  need("length", isInt(l.length) && inRange(l.length, LIMITS.minLength, LIMITS.maxLength), `must be an integer from ${LIMITS.minLength} to ${LIMITS.maxLength}`);
  need("speed", inRange(l.speed, LIMITS.minSpeed, LIMITS.maxSpeed), `must be a number from ${LIMITS.minSpeed} to ${LIMITS.maxSpeed}`);
  need("time_limit", isInt(l.time_limit) && inRange(l.time_limit, 1, LIMITS.maxTimeLimit), `must be an integer from 1 to ${LIMITS.maxTimeLimit}`);
  need("crash_penalty", isInt(l.crash_penalty) && inRange(l.crash_penalty, 1, LIMITS.maxCrashPenalty), `must be an integer from 1 to ${LIMITS.maxCrashPenalty}`);
  need("lane_change_cooldown", isInt(l.lane_change_cooldown) && inRange(l.lane_change_cooldown, 0, LIMITS.maxCooldown), `must be an integer from 0 to ${LIMITS.maxCooldown}`);
  if (l.title !== undefined && (typeof l.title !== "string" || l.title.length > 40)) errors.push("title must be a string of at most 40 characters");
  if (errors.length) return { ok: false, errors };

  const lanes = l.lanes as number;
  const length = l.length as number;
  if (l.start_lane !== undefined && !(isInt(l.start_lane) && inRange(l.start_lane, 0, lanes - 1))) {
    errors.push(`start_lane must be an integer from 0 to ${lanes - 1}`);
  }
  if (!Array.isArray(l.objects)) return { ok: false, errors: [...errors, "objects must be an array"] };
  if (l.objects.length > LIMITS.maxObjects) errors.push(`at most ${LIMITS.maxObjects} objects`);
  const seen = new Set<number>();
  l.objects.forEach((o: unknown, i: number) => {
    const ob = o as Record<string, unknown>;
    if (!ob || typeof ob !== "object") return void errors.push(`objects[${i}] must be an object`);
    if (!isInt(ob.row) || ob.row < 1 || ob.row >= length) errors.push(`objects[${i}].row must be an integer from 1 to ${length - 1}`);
    if (!isInt(ob.lane) || ob.lane < 0 || ob.lane >= lanes) errors.push(`objects[${i}].lane must be an integer from 0 to ${lanes - 1}`);
    if (!KINDS.includes(ob.kind as Kind)) errors.push(`objects[${i}].kind must be one of ${KINDS.join(", ")}`);
    if (isInt(ob.row) && isInt(ob.lane)) {
      const key = ob.row * 8 + ob.lane;
      if (seen.has(key)) errors.push(`two objects share row ${ob.row}, lane ${ob.lane}`);
      seen.add(key);
    }
  });
  return errors.length ? { ok: false, errors } : { ok: true };
}

/** Object lookup by cell: `cellKey(row, lane)` → kind, keyed by the cell the object is placed in. */
export type Grid = Map<number, Kind>;
export const cellKey = (row: number, lane: number): number => row * 8 + lane; // lanes ≤ 5 fits in 8
export function buildGrid(level: Level): Grid {
  const g: Grid = new Map();
  for (const o of level.objects) g.set(cellKey(o.row, o.lane), o.kind);
  return g;
}

export const isObstacle = (k: Kind | undefined): boolean => k === "car" || k === "cone" || k === "oil";

/** Every vehicle, the player's and the traffic's, is this many rows long. */
export const VEHICLE_ROWS = 2;

/** Rows an object covers, starting at the row it is placed in. */
export const footprintRows = (k: Kind): number => (k === "car" ? VEHICLE_ROWS : 1);

/** The objects (by cellKey of the cell they are placed in) whose footprint covers this cell. */
export function objectsAt(grid: Grid, row: number, lane: number): number[] {
  const out: number[] = [];
  for (let d = 0; d < VEHICLE_ROWS; d++) {
    const key = cellKey(row - d, lane);
    const kind = grid.get(key);
    if (kind !== undefined && footprintRows(kind) > d) out.push(key);
  }
  return out;
}

export function startState(level: Level): CarState {
  return { row: 0, lane: level.start_lane ?? Math.floor(level.lanes / 2), tick: 0, cooldown: 0, boost: 0, stun: 0, shield: 0, rear: -1, cleared: 0 };
}

export const finished = (level: Level, s: CarState): boolean => s.row >= level.length;

/** Whether steering is possible this tick. */
export const canSteer = (s: CarState): boolean => s.stun === 0 && s.cooldown === 0;

/**
 * Advance one tick. Returns the new state and what happened. Each object is touched at most once:
 * rows only increase; a bounded history also remembers cleared traffic whose second cell
 * can still overlap the car after a lane change. The shared grid remains immutable.
 */
export function step(level: Level, grid: Grid, s: CarState, action: Action): { next: CarState; ev: StepEvents } {
  const ev: StepEvents = { crashed: false, boosted: false, coins: 0, shielded: false, protected: false, sideswipe: false, hit: [], cleared: [] };
  const n: CarState = { ...s, tick: s.tick + 1 };
  if (s.stun > 0) {
    n.stun = s.stun - 1;
    return { next: n, ev };
  }
  // Decay before pickups: a pad touched sideways must refresh even an active boost.
  n.boost = Math.max(0, s.boost - 1);
  const wasCleared = (key: number): boolean => {
    const offset = s.row - Math.floor(key / 8);
    return ev.cleared.includes(key) || (offset >= 0 && offset <= 2 &&
      ((s.cleared ?? 0) & (1 << (offset * 5 + key % 8))) !== 0);
  };
  const collect = (key: number): void => {
    if (wasCleared(key)) return;
    const kind = grid.get(key);
    if (kind === "shield") {
      n.shield = 1;
      ev.shielded = true;
      ev.cleared.push(key);
    } else if (kind === "boost") {
      ev.boosted = true;
      n.boost = BOOST_TICKS; // the pad stays on the road
    } else if (kind === "coin") {
      ev.coins += 1;
      ev.cleared.push(key);
    }
  };

  const startLane = s.lane;
  if (action !== 0 && s.cooldown === 0) {
    const target = s.lane + action;
    if (target >= 0 && target < level.lanes) {
      n.cooldown = level.lane_change_cooldown;
      // Sideways first: the car's body (rows row-1 and row) slides into the target lane.
      const keys: number[] = [];
      for (let r = s.row - VEHICLE_ROWS + 1; r <= s.row; r++) {
        if (r < s.row && target === s.rear) continue; // already driven over in that lane
        for (const k of objectsAt(grid, r, target)) if (!wasCleared(k) && !keys.includes(k)) keys.push(k);
      }
      keys.sort((a, b) => a - b); // rear to front
      let shield = n.shield;
      let blocked = false;
      for (const k of keys) {
        const kind = grid.get(k);
        if (kind === "shield") shield = 1;
        else if (isObstacle(kind)) {
          if (shield) shield = 0;
          else blocked = true;
        }
      }
      const hazards = keys.filter((k) => isObstacle(grid.get(k)));
      if (blocked) {
        // Side crash: bounce back into the own lane, no forward movement this tick.
        ev.crashed = true;
        ev.sideswipe = true;
        ev.hit.push(...hazards);
        n.stun = level.crash_penalty;
        n.boost = 0;
        n.shield = 0;
        return { next: n, ev };
      }
      for (const k of keys) {
        if (isObstacle(grid.get(k))) {
          n.shield = 0;
          ev.protected = true;
          ev.hit.push(k);
          ev.cleared.push(k);
        } else collect(k);
      }
      n.lane = target;
    }
  } else if (s.cooldown > 0) {
    n.cooldown = s.cooldown - 1;
  }

  // Then forward. Only the cell an object is placed in needs checking here: a car's second cell
  // can't be reached from behind without first meeting the car itself.
  const rows = s.boost > 0 ? 2 : 1;
  let advanced = 0;
  for (let k = 0; k < rows; k++) {
    n.row += 1;
    advanced += 1;
    if (n.row >= level.length) break;
    const key = cellKey(n.row, n.lane);
    if (wasCleared(key)) continue;
    const kind = grid.get(key);
    if (isObstacle(kind) && n.shield > 0) {
      n.shield = 0;
      ev.protected = true;
      ev.hit.push(key);
      ev.cleared.push(key);
      continue;
    }
    if (isObstacle(kind)) {
      ev.crashed = true;
      ev.hit.push(key);
      ev.cleared.push(key);
      n.stun = level.crash_penalty;
      n.boost = 0;
      break;
    }
    collect(key);
  }
  // Lanes the car covered on the row now behind its front: the one it started in and the one it
  // is in. Two rows forward (boost) leaves only the current lane.
  n.rear = advanced === 1 && startLane !== n.lane ? startLane : -1;
  n.cleared = ((s.cleared ?? 0) << (advanced * 5)) & 0x7fff;
  for (const key of ev.cleared) {
    const offset = n.row - Math.floor(key / 8);
    if (offset >= 0 && offset <= 2) n.cleared |= 1 << (offset * 5 + key % 8);
  }
  return { next: n, ev };
}

// ---------- geometry shared by the rules and the screen ----------

/** A rectangle in track units: x in lanes (0 = left road edge), y in rows (0 = start line). */
export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export type SpriteKind = Kind | "player";

/**
 * How everything is drawn, in track units. One cell is one lane wide and one row long; on screen a
 * lane is always `laneAspect` rows wide, so a sprite keeps its shape on every screen and every lane
 * count. Each sprite is centered in its lane and inset from its cells' ends, so two sprites overlap
 * exactly when their cells do (tested in test/racer.test.ts).
 */
export const GEOMETRY = {
  laneAspect: 1.76,   // lane width ÷ row length on screen
  minVisibleRows: 12, // the road always shows at least this many rows
  cameraRows: 0.6,    // rows of road between the bottom edge and the player's rear bumper
  sprites: {
    // width: share of the lane; inset: rows trimmed from each end of the footprint
    player: { width: 0.58, inset: 0.1 },
    car: { width: 0.58, inset: 0.1 },
    cone: { width: 0.36, inset: 0.12 },
    oil: { width: 0.8, inset: 0.1 },
    shield: { width: 0.42, inset: 0.1 },
    boost: { width: 0.72, inset: 0.08 },
    coin: { width: 0.34, inset: 0.2 },
  } satisfies Record<SpriteKind, { width: number; inset: number }>,
} as const;

/** Where an object's sprite is drawn. */
export function spriteBox(kind: Kind, row: number, lane: number): Box {
  const { width, inset } = GEOMETRY.sprites[kind];
  return { x0: lane + (1 - width) / 2, x1: lane + (1 + width) / 2, y0: row + inset, y1: row + footprintRows(kind) - inset };
}

/** Where the player's car is drawn. `row` is its front bumper's cell, as in CarState. */
export function playerBox(row: number, lane: number): Box {
  const { width, inset } = GEOMETRY.sprites.player;
  return { x0: lane + (1 - width) / 2, x1: lane + (1 + width) / 2, y0: row - VEHICLE_ROWS + 1 + inset, y1: row + 1 - inset };
}

export const boxesOverlap = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
