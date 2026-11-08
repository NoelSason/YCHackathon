// Turbo Lanes: the rules. Pure and deterministic, so the same code runs in Node (solver, bots,
// adapter) and in the browser game.
//
// The track is a grid: `lanes` across, `length` rows long. The car starts at row 0 and moves one
// row per tick (two while boosted). Each tick the driver may steer one lane left or right
// (then must wait `lane_change_cooldown` ticks before steering again). Driving into a car or a
// cone is a crash: the car stops for `crash_penalty` ticks. Boost pads give BOOST_TICKS ticks of
// double speed. Coins are for score only. The level is won by crossing the finish row within
// `time_limit` ticks. On screen one tick lasts 1/speed seconds.

export const KINDS = ["car", "cone", "boost", "coin"] as const;
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
}

export interface StepEvents {
  crashed: boolean;
  boosted: boolean;
  coins: number;
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

/** Object lookup by cell. Rows × 8 + lane (lanes ≤ 5 fits in 8). */
export type Grid = Map<number, Kind>;
export function buildGrid(level: Level): Grid {
  const g: Grid = new Map();
  for (const o of level.objects) g.set(o.row * 8 + o.lane, o.kind);
  return g;
}

export const isObstacle = (k: Kind | undefined): boolean => k === "car" || k === "cone";

export function startState(level: Level): CarState {
  return { row: 0, lane: level.start_lane ?? Math.floor(level.lanes / 2), tick: 0, cooldown: 0, boost: 0, stun: 0 };
}

export const finished = (level: Level, s: CarState): boolean => s.row >= level.length;

/** Whether steering is possible this tick. */
export const canSteer = (s: CarState): boolean => s.stun === 0 && s.cooldown === 0;

/**
 * Advance one tick. Returns the new state and what happened. `coinTaken` lets callers count each
 * coin once (rows only increase, so a coin cell is entered at most once anyway).
 */
export function step(level: Level, grid: Grid, s: CarState, action: Action): { next: CarState; ev: StepEvents } {
  const ev: StepEvents = { crashed: false, boosted: false, coins: 0 };
  const n: CarState = { ...s, tick: s.tick + 1 };
  if (s.stun > 0) {
    n.stun = s.stun - 1;
    return { next: n, ev };
  }
  if (action !== 0 && s.cooldown === 0) {
    const lane = s.lane + action;
    if (lane >= 0 && lane < level.lanes) {
      n.lane = lane;
      n.cooldown = level.lane_change_cooldown;
    }
  } else if (s.cooldown > 0) {
    n.cooldown = s.cooldown - 1;
  }
  const rows = s.boost > 0 ? 2 : 1;
  if (s.boost > 0) n.boost = s.boost - 1;
  for (let k = 0; k < rows; k++) {
    n.row += 1;
    if (n.row >= level.length) break;
    const kind = grid.get(n.row * 8 + n.lane);
    if (isObstacle(kind)) {
      ev.crashed = true;
      n.stun = level.crash_penalty;
      n.boost = 0;
      break;
    }
    if (kind === "boost") {
      ev.boosted = true;
      n.boost = BOOST_TICKS;
    } else if (kind === "coin") {
      ev.coins += 1;
    }
  }
  return { next: n, ev };
}
