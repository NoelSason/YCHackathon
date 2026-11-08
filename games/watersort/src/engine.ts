// Splash Sort: the rules. Pure and deterministic, so the same code runs in Node (solver, bots,
// adapter) and in the browser game.
//
// A level is a row of tubes. Each tube holds up to `capacity` units of colored liquid, listed
// bottom to top. A pour moves the top run of one color from one tube onto another tube that is
// empty or whose top color matches, as much as fits. The level is solved when every tube is either
// empty or full of a single color. The player has `move_limit` pours.

export const COLORS = [
  "red", "orange", "yellow", "lime", "green", "teal",
  "sky", "blue", "purple", "pink", "brown", "gray",
] as const;
export type Color = (typeof COLORS)[number];

export interface Level {
  capacity: number;   // units per tube
  tubes: Color[][];   // bottom → top
  move_limit: number; // pours allowed
  title?: string;
}

/** Tubes as color indexes into COLORS, bottom → top. */
export type Tubes = number[][];

export interface Pour {
  from: number;
  to: number;
  amount: number;
}

// Bounds keep every valid level small enough for the exact solver to finish.
export const LIMITS = {
  minCapacity: 2,
  maxCapacity: 5,
  minColors: 2,
  maxColors: 9,
  maxSpareTubes: 2,
  maxMoveLimit: 300,
} as const;

export const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Splash Sort level",
  type: "object",
  additionalProperties: false,
  required: ["capacity", "tubes", "move_limit"],
  properties: {
    title: { type: "string", maxLength: 40 },
    capacity: { type: "integer", minimum: LIMITS.minCapacity, maximum: LIMITS.maxCapacity },
    move_limit: { type: "integer", minimum: 1, maximum: LIMITS.maxMoveLimit },
    tubes: {
      type: "array",
      minItems: LIMITS.minColors + 1,
      maxItems: LIMITS.maxColors + LIMITS.maxSpareTubes,
      items: { type: "array", maxItems: LIMITS.maxCapacity, items: { enum: [...COLORS] } },
    },
  },
} as const;

export type Validation = { ok: true } | { ok: false; errors: string[] };

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

export function validateLevel(input: unknown): Validation {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["level must be an object"] };
  }
  const l = input as Record<string, unknown>;
  for (const k of Object.keys(l)) {
    if (!["capacity", "tubes", "move_limit", "title"].includes(k)) errors.push(`unknown field "${k}"`);
  }
  if (l.title !== undefined && (typeof l.title !== "string" || l.title.length > 40)) {
    errors.push("title must be a string of at most 40 characters");
  }
  const cap = l.capacity;
  if (!isInt(cap) || cap < LIMITS.minCapacity || cap > LIMITS.maxCapacity) {
    errors.push(`capacity must be an integer from ${LIMITS.minCapacity} to ${LIMITS.maxCapacity}`);
  }
  if (!isInt(l.move_limit) || l.move_limit < 1 || l.move_limit > LIMITS.maxMoveLimit) {
    errors.push(`move_limit must be an integer from 1 to ${LIMITS.maxMoveLimit}`);
  }
  if (!Array.isArray(l.tubes)) {
    errors.push("tubes must be an array of tubes, each an array of colors from bottom to top");
    return { ok: false, errors };
  }
  const counts = new Map<string, number>();
  l.tubes.forEach((t, i) => {
    if (!Array.isArray(t)) {
      errors.push(`tube ${i} must be an array`);
      return;
    }
    if (isInt(cap) && t.length > cap) errors.push(`tube ${i} holds ${t.length} units, more than capacity ${cap}`);
    for (const c of t) {
      if (!COLORS.includes(c as Color)) errors.push(`tube ${i} has unknown color "${String(c)}" (use: ${COLORS.join(", ")})`);
      else counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  });
  const colors = counts.size;
  if (colors < LIMITS.minColors || colors > LIMITS.maxColors) {
    errors.push(`use from ${LIMITS.minColors} to ${LIMITS.maxColors} colors (found ${colors})`);
  }
  if (isInt(cap)) {
    for (const [c, n] of counts) {
      if (n !== cap) errors.push(`color "${c}" appears ${n} times; every color must appear exactly capacity (${cap}) times`);
    }
  }
  const spare = l.tubes.length - colors;
  if (spare < 1) errors.push(`need at least one more tube than colors (found ${l.tubes.length} tubes for ${colors} colors)`);
  if (spare > LIMITS.maxSpareTubes) errors.push(`at most ${LIMITS.maxSpareTubes} more tubes than colors (found ${spare})`);
  if (!errors.length && isInt(cap) && isSolved(toTubes(l as unknown as Level), cap)) {
    errors.push("level is already solved");
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function toTubes(level: Level): Tubes {
  return level.tubes.map((t) => t.map((c) => COLORS.indexOf(c)));
}

export const top = (t: number[]): number => (t.length ? t[t.length - 1]! : -1);

/** Length of the run of the top color. */
export function topRun(t: number[]): number {
  if (!t.length) return 0;
  const c = t[t.length - 1];
  let n = 1;
  while (n < t.length && t[t.length - 1 - n] === c) n++;
  return n;
}

export const isUniform = (t: number[]): boolean => t.every((c) => c === t[0]);
export const isComplete = (t: number[], cap: number): boolean => t.length === cap && isUniform(t);

/** Units that would move from `from` to `to`; 0 if the pour is not allowed. */
export function pourAmount(tubes: Tubes, cap: number, from: number, to: number): number {
  if (from === to) return 0;
  const a = tubes[from];
  const b = tubes[to];
  if (!a || !b || !a.length || b.length >= cap) return 0;
  if (b.length && top(b) !== top(a)) return 0;
  return Math.min(topRun(a), cap - b.length);
}

/** A copy of the tubes after the pour. */
export function applyPour(tubes: Tubes, from: number, to: number, amount: number): Tubes {
  const next = tubes.map((t) => t.slice());
  const a = next[from]!;
  const b = next[to]!;
  for (let i = 0; i < amount; i++) b.push(a.pop()!);
  return next;
}

export function isSolved(tubes: Tubes, cap: number): boolean {
  return tubes.every((t) => t.length === 0 || isComplete(t, cap));
}

/**
 * A legal pour that can never help: moving out of a finished tube, or moving a whole
 * single-color tube into an empty tube (that only relabels the tubes).
 */
export function isPointless(tubes: Tubes, cap: number, from: number, to: number): boolean {
  const a = tubes[from]!;
  return isComplete(a, cap) || (isUniform(a) && tubes[to]!.length === 0);
}

/**
 * Pours worth considering. Empty tubes are interchangeable, so only the first one is offered
 * as a target for each source.
 */
export function usefulPours(tubes: Tubes, cap: number): Pour[] {
  const out: Pour[] = [];
  const firstEmpty = tubes.findIndex((t) => t.length === 0);
  for (let from = 0; from < tubes.length; from++) {
    for (let to = 0; to < tubes.length; to++) {
      if (tubes[to]!.length === 0 && to !== firstEmpty) continue;
      const amount = pourAmount(tubes, cap, from, to);
      if (amount > 0 && !isPointless(tubes, cap, from, to)) out.push({ from, to, amount });
    }
  }
  return out;
}

/** Order-independent key: two positions that differ only by tube order are the same. */
export function stateKey(tubes: Tubes): string {
  return tubes.map((t) => String.fromCharCode(...t.map((c) => 97 + c))).sort().join("|");
}
