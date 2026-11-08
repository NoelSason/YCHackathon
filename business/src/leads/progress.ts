/**
 * Live progress for one signup or playtest order, shown on the page right after the form is sent
 * ("Reading your newest reviews…", "Email sent"). Kept in memory on the long-running server, with
 * old entries dropped after an hour.
 */
export type StepState = "done" | "active" | "failed";
export interface Step { at: string; text: string; state: StepState }
interface Entry { steps: Step[]; done: boolean; updated: number }

const entries = new Map<string, Entry>();
const TTL_MS = 60 * 60 * 1000;

function sweep(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, e] of entries) if (e.updated < cutoff) entries.delete(id);
}

/** Marks the previous active step done and adds a new one. */
export function step(id: string, text: string, state: StepState = "active"): void {
  sweep();
  const e = entries.get(id) ?? { steps: [], done: false, updated: Date.now() };
  for (const s of e.steps) if (s.state === "active") s.state = "done";
  e.steps.push({ at: new Date().toISOString(), text, state });
  e.updated = Date.now();
  entries.set(id, e);
}

/**
 * Starts a fresh run for this id. A repeat signup from the same address reuses its lead id, and
 * without this its page would show the earlier run's "Email sent" and stop right away.
 */
export function start(id: string, text: string): void {
  entries.delete(id);
  step(id, text);
}

/** Whether this id's current run has finished. */
export function isDone(id: string): boolean {
  return entries.get(id)?.done ?? false;
}

export function finish(id: string, text: string, ok = true): void {
  step(id, text, ok ? "done" : "failed");
  const e = entries.get(id);
  if (e) e.done = true;
}

export function status(id: string): { steps: Step[]; done: boolean } {
  const e = entries.get(id);
  return e ? { steps: e.steps, done: e.done } : { steps: [], done: false };
}

/** Test helper. */
export function resetProgress(): void {
  entries.clear();
}
