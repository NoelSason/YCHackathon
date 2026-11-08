import { axisDirections, initialState, move, slide, slideLimit, type Direction, type Level, type State, type Vehicle } from "../src/engine.js";
import { BUILT_IN_BEST, LEVELS } from "../src/levels.js";
import { runJob, type Job, type JobRequest, type JobResult } from "./jobs.js";

declare global { interface Window { STUDIO_API?: string } }
const board = document.querySelector<HTMLDivElement>("#board")!;
const selectedLabel = document.querySelector<HTMLElement>("#selected")!;
const titleLabel = document.querySelector<HTMLElement>("#level-title")!;
const movesLabel = document.querySelector<HTMLElement>("#moves")!;
const message = document.querySelector<HTMLElement>("#message")!;
const indicator = document.querySelector<HTMLElement>("#level-indicator")!;
const limitLabel = document.querySelector<HTMLElement>("#limit")!;
const bestLabel = document.querySelector<HTMLElement>("#best")!;
const building = document.querySelector<HTMLElement>("#building")!;
const endlessToggle = document.querySelector<HTMLInputElement>("#endless")!;
const api = (window.STUDIO_API ?? "").replace(/\/$/, "");
const HINT = "Each car has a marked exit. Clear its lane to let it leave.";
const BLOCKED = "That lane is blocked. Try sliding another car first.";
let level: Level = LEVELS[0]!; let state: State = initialState(level); let selected = state.vehicles[0]?.id ?? "";
let levelId: string | undefined; let activeIndex = 0; let best: number | undefined; let ended = false; let sessionId = crypto.randomUUID();
const cars = new Map<string, HTMLButtonElement>();
const exits = new Map<string, HTMLElement>();
const lane = document.createElement("div"); lane.className = "lane";

function event(type: "attempt" | "win" | "loss" | "quit") { if (!api) return; const body = JSON.stringify({ game_id: "lotescape", level_id: levelId ?? null, session_id: sessionId, type, moves_used: state.moves }); if (type === "quit" && navigator.sendBeacon) navigator.sendBeacon(`${api}/events`, new Blob([body], { type: "application/json" })); else void fetch(`${api}/events`, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {}); }

// Top-down vehicle art drawn in a frame that matches the vehicle's cells exactly (100 units per
// cell), so every vehicle is the same thickness and a car is two cells long, a truck three. The
// art is drawn facing right and turned so its nose points at its exit.
function vehicleSvg(vehicle: Vehicle): string {
  const W = vehicle.length * 100, horizontal = vehicle.axis === "h";
  const turn = { right: "", left: `translate(${W} 0) scale(-1 1)`, down: "translate(100 0) rotate(90)", up: `translate(0 ${W}) rotate(-90)` }[vehicle.exit];
  const wheels = [W * 0.2, W - (vehicle.length === 3 ? 62 : W * 0.2) - 20].map((x) => `<rect x="${x}" y="4" width="22" height="10" rx="4"/><rect x="${x}" y="86" width="22" height="10" rx="4"/>`).join("");
  const nose = `<rect x="${W - 15}" y="20" width="7" height="14" rx="3" fill="#fff4c2"/><rect x="${W - 15}" y="66" width="7" height="14" rx="3" fill="#fff4c2"/>`;
  const tail = `<rect x="8" y="20" width="5" height="12" rx="2" fill="#5a1620"/><rect x="8" y="68" width="5" height="12" rx="2" fill="#5a1620"/>`;
  const chevron = (cx: number) => `<path d="M${cx - 9} 36 L${cx + 7} 50 L${cx - 9} 64" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" opacity=".92"/>`;
  const body = vehicle.length === 3
    ? `<rect x="8" y="9" width="${W - 116}" height="82" rx="12" fill="currentColor"/><rect x="18" y="20" width="${W - 136}" height="60" rx="7" fill="#fff" opacity=".2"/>`
      + `<rect x="${W - 104}" y="11" width="96" height="78" rx="20" fill="currentColor"/><rect x="${W - 46}" y="20" width="16" height="60" rx="6" fill="#d9efff" opacity=".92"/>${nose}${tail}${chevron(W * 0.4)}`
    : `<rect x="8" y="9" width="${W - 16}" height="82" rx="24" fill="currentColor"/><rect x="${W * 0.3}" y="20" width="${W * 0.42}" height="60" rx="13" fill="#0d1a2b" opacity=".18"/>`
      + `<rect x="${W * 0.64}" y="21" width="${W * 0.09}" height="58" rx="7" fill="#d9efff" opacity=".92"/><rect x="${W * 0.25}" y="23" width="${W * 0.06}" height="54" rx="6" fill="#d9efff" opacity=".7"/>${nose}${tail}${chevron(W * 0.5)}`;
  return `<svg viewBox="0 0 ${horizontal ? W : 100} ${horizontal ? 100 : W}" aria-hidden="true"><g transform="${turn}"><g fill="#16202f">${wheels}</g>${body}</g></svg>`;
}
const pct = (n: number) => `${n * 100 / level.size}%`;
function place(el: HTMLElement, vehicle: Vehicle, offset = 0) {
  const dx = vehicle.axis === "h" ? offset : 0, dy = vehicle.axis === "v" ? offset : 0;
  el.style.left = pct(vehicle.x + dx); el.style.top = pct(vehicle.y + dy);
  el.style.width = pct(vehicle.axis === "h" ? vehicle.length : 1); el.style.height = pct(vehicle.axis === "v" ? vehicle.length : 1);
}
function placeExit(el: HTMLElement, vehicle: Vehicle) {
  const lanePos = pct(vehicle.axis === "h" ? vehicle.y : vehicle.x);
  el.className = `exit ${vehicle.exit} ${vehicle.color}`; el.removeAttribute("style");
  if (vehicle.axis === "h") { el.style.top = lanePos; el.style.height = pct(1); } else { el.style.left = lanePos; el.style.width = pct(1); }
}
function carFor(vehicle: Vehicle): HTMLButtonElement {
  let car = cars.get(vehicle.id);
  if (car) return car;
  car = document.createElement("button"); car.type = "button"; car.dataset.id = vehicle.id; car.dataset.exit = vehicle.exit; car.dataset.length = String(vehicle.length);
  car.className = `car ${vehicle.axis === "h" ? "horizontal" : "vertical"} ${vehicle.length === 3 ? "truck" : "sedan"} ${vehicle.color}`;
  car.setAttribute("aria-label", `${vehicle.id}, ${vehicle.length === 3 ? "truck" : "car"}, exits ${vehicle.exit}`);
  car.innerHTML = vehicleSvg(vehicle);
  car.addEventListener("click", () => select(vehicle.id));
  car.addEventListener("focus", () => select(vehicle.id));
  board.append(car); cars.set(vehicle.id, car);
  const marker = document.createElement("div"); marker.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4l8 6-8 6" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  board.append(marker); exits.set(vehicle.id, marker);
  return car;
}
function render() {
  board.style.setProperty("--size", String(level.size));
  const present = new Set(state.vehicles.map((v) => v.id));
  for (const vehicle of state.vehicles) {
    const car = carFor(vehicle); place(car, vehicle); car.classList.toggle("selected", vehicle.id === selected);
    placeExit(exits.get(vehicle.id)!, vehicle); exits.get(vehicle.id)!.classList.toggle("selected", vehicle.id === selected);
  }
  for (const [id, car] of cars) if (!present.has(id)) driveOff(id, car);
  drawLane();
  movesLabel.textContent = `${state.moves} / ${level.move_limit}`;
  updateSelected();
}
// A vehicle that has left keeps moving off the lot past its exit, then fades.
function driveOff(id: string, car: HTMLButtonElement) {
  cars.delete(id); exits.get(id)?.remove(); exits.delete(id);
  const step = (Number(car.dataset.length) + 1) * 100 / level.size, exit = car.dataset.exit as Direction;
  const left = parseFloat(car.style.left), top = parseFloat(car.style.top);
  car.classList.add("leaving"); car.disabled = true;
  requestAnimationFrame(() => {
    if (exit === "right") car.style.left = `${left + step}%`; if (exit === "left") car.style.left = `${left - step}%`;
    if (exit === "down") car.style.top = `${top + step}%`; if (exit === "up") car.style.top = `${top - step}%`;
  });
  setTimeout(() => car.remove(), 420);
}
// The selected vehicle's route to its exit is tinted so the player sees what must be cleared.
function drawLane() {
  const vehicle = state.vehicles.find((v) => v.id === selected);
  if (!vehicle || ended) { lane.remove(); return; }
  lane.className = `lane ${vehicle.color}`; lane.removeAttribute("style");
  const from = vehicle.exit === "right" ? vehicle.x + vehicle.length : vehicle.exit === "down" ? vehicle.y + vehicle.length : 0;
  const to = vehicle.exit === "left" ? vehicle.x : vehicle.exit === "up" ? vehicle.y : level.size;
  if (to <= from) { lane.remove(); return; }
  if (vehicle.axis === "h") { lane.style.left = pct(from); lane.style.width = pct(to - from); lane.style.top = pct(vehicle.y); lane.style.height = pct(1); }
  else { lane.style.top = pct(from); lane.style.height = pct(to - from); lane.style.left = pct(vehicle.x); lane.style.width = pct(1); }
  if (!lane.isConnected) board.prepend(lane);
}
function select(id: string) { if (selected === id || !state.vehicles.some((v) => v.id === id)) return; selected = id; render(); }
function updateSelected() {
  const car = state.vehicles.find((v) => v.id === selected);
  selectedLabel.textContent = car ? `${car.id.toUpperCase()} · EXIT ${car.exit.toUpperCase()}` : "Choose a car";
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-dir]")) {
    const dir = button.dataset.dir as Direction;
    button.disabled = !car || ended || !axisDirections(car).includes(dir) || slideLimit(level, state, car.id, dir).steps === 0;
  }
}
function finish() {
  if (state.won && !ended) {
    ended = true; message.className = "message good"; event("win");
    const lastBuiltIn = mode === "builtin" && activeIndex === LEVELS.length - 1;
    message.textContent = mode === "endless" ? "Lot clear! On to a harder one."
      : mode === "builtin" ? (lastBuiltIn ? "All built-in lots cleared! Generating harder ones…" : "Lot clear! On to the next lot.")
      : "Lot clear! Every car made it out.";
    if (mode === "endless") { const at = endless.level; setTimeout(() => { if (mode === "endless" && endless.level === at && state.won) void advanceEndless(); }, 1100); }
    // Built-in lots advance on their own too; after the last one, endless mode takes over.
    else if (mode === "builtin") {
      const at = activeIndex;
      setTimeout(() => {
        if (mode !== "builtin" || activeIndex !== at || !state.won) return;
        if (lastBuiltIn) { endlessToggle.checked = true; setEndless(true); }
        else loadLevel(at + 1);
      }, 1400);
    }
  }
  else if (state.moves >= level.move_limit && !ended) { ended = true; message.textContent = "Move limit reached. Give the lot another try."; message.className = "message bad"; event("loss"); }
}
function commit(next: State) {
  state = next;
  if (!state.vehicles.some((v) => v.id === selected)) selected = state.vehicles[0]?.id ?? "";
  if (message.textContent === BLOCKED) message.textContent = HINT;
  finish(); render();
}
function restart() {
  for (const car of cars.values()) car.remove(); for (const marker of exits.values()) marker.remove(); cars.clear(); exits.clear();
  state = initialState(level); selected = state.vehicles[0]?.id ?? ""; ended = false; sessionId = crypto.randomUUID();
  message.textContent = HINT; message.className = "message"; render(); event("attempt");
}
function act(direction: Direction) {
  if (!selected || ended) return;
  const next = move(level, state, selected, direction);
  if (next === state) { message.textContent = BLOCKED; return; }
  commit(next);
}
function show(next: Level, label: string, generated: boolean, bestMoves: number | undefined) {
  level = next; best = bestMoves; titleLabel.textContent = level.title;
  indicator.textContent = label; indicator.classList.toggle("generated", generated);
  limitLabel.textContent = `Move limit ${level.move_limit}`;
  bestLabel.textContent = best === undefined ? "Best possible: checking…" : `Best possible: ${best} moves`;
  building.hidden = true; restart();
}
function loadLevel(index: number) {
  mode = "builtin"; activeIndex = index; levelId = undefined; store.set(KEY_BUILTIN, String(index));
  show(LEVELS[index]!, `Level ${index + 1} of ${LEVELS.length} · Built-in`, false, BUILT_IN_BEST[index]);
}

// ---- Endless mode: each lot is generated in the browser, one notch harder than the last. --------
// Preferences live in localStorage. Storage can be missing or blocked, so every access is guarded
// and the game works without it.
const KEY_ENDLESS = "lotescape:endless", KEY_BUILTIN = "lotescape:builtin", KEY_RUN = "lotescape:endless-run";
const store = {
  get(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* storage unavailable: nothing is remembered */ } },
};
type Mode = "builtin" | "endless" | "saved";
interface EndlessRun { seed: string; level: number; lot?: Level; best?: number }
let mode: Mode = "builtin";
let endless: EndlessRun = readRun();
let upcoming: { level: number; result: Promise<JobResult> } | undefined;
function readRun(): EndlessRun {
  try {
    const raw = JSON.parse(store.get(KEY_RUN) ?? "null") as Partial<EndlessRun> | null;
    if (raw && typeof raw.seed === "string" && Number.isInteger(raw.level) && (raw.level as number) >= 1) {
      const lot = raw.lot && Array.isArray(raw.lot.vehicles) && Number.isInteger(raw.lot.size) && Number.isInteger(raw.lot.move_limit) ? raw.lot : undefined;
      return { seed: raw.seed, level: raw.level as number, lot, best: lot && typeof raw.best === "number" ? raw.best : undefined };
    }
  } catch { /* unreadable: start a new run */ }
  return { seed: Math.random().toString(36).slice(2, 10), level: 1 };
}
function saveRun() { store.set(KEY_RUN, JSON.stringify(endless)); }

// Generation runs in a Web Worker so the board never freezes. If workers are unavailable, the same
// job runs on the main thread after the "Building" state has painted.
let worker: Worker | undefined;
try { worker = new Worker(new URL("./worker.js", import.meta.url)); } catch { worker = undefined; }
let jobId = 0;
const waiting = new Map<number, (result: JobResult) => void>();
worker?.addEventListener("message", (e: MessageEvent<JobResult>) => { waiting.get(e.data.id)?.(e.data); waiting.delete(e.data.id); });
worker?.addEventListener("error", () => { worker = undefined; for (const [id, done] of waiting) done({ id, kind: "error", message: "worker failed" }); waiting.clear(); });
function runInBackground(job: JobRequest): Promise<JobResult> {
  const full: Job = { ...job, id: ++jobId };
  if (!worker) return new Promise((resolve) => setTimeout(() => resolve(runJob(full)), 50));
  return new Promise((resolve) => { waiting.set(full.id, resolve); worker!.postMessage(full); });
}
function generate(levelNumber: number): Promise<JobResult> {
  if (upcoming?.level === levelNumber) return upcoming.result;
  const result = runInBackground({ kind: "generate", seed: `${endless.seed}:${levelNumber}`, difficulty: levelNumber, timeLimitMs: 6000 });
  upcoming = { level: levelNumber, result };
  return result;
}
async function playEndless(levelNumber: number) {
  mode = "endless"; levelId = undefined;
  if (endless.level === levelNumber && endless.lot && endless.best !== undefined) { showEndless(); return; }
  building.hidden = false; ended = true; updateSelected();
  const result = await generate(levelNumber);
  if (mode !== "endless") return; // switched back to built-ins while it was building
  if (result.kind !== "generate") { upcoming = undefined; building.hidden = true; message.textContent = "The next lot could not be built. Turn endless off and on to try again."; message.className = "message bad"; return; }
  endless = { seed: endless.seed, level: levelNumber, lot: result.level, best: result.best }; saveRun();
  showEndless();
}
function showEndless() {
  show(endless.lot!, `Level ${endless.level} · Generated`, true, endless.best);
  void generate(endless.level + 1); // start on the next lot while this one is played
}
async function advanceEndless() { await playEndless(endless.level + 1); }
function setEndless(on: boolean) {
  endlessToggle.checked = on; store.set(KEY_ENDLESS, on ? "1" : "0");
  if (on) void playEndless(endless.level); else loadLevel(activeIndex);
}
endlessToggle.addEventListener("change", () => setEndless(endlessToggle.checked));
document.querySelectorAll<HTMLButtonElement>("[data-dir]").forEach((button) => button.addEventListener("click", () => act(button.dataset.dir as Direction)));
document.querySelector<HTMLButtonElement>("#reset")!.addEventListener("click", restart);
document.querySelector<HTMLButtonElement>("#next")!.addEventListener("click", () => { if (mode === "endless") void advanceEndless(); else loadLevel((activeIndex + 1) % LEVELS.length); });
document.addEventListener("keydown", (e) => {
  const map: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", a: "left", d: "right", w: "up", s: "down" };
  const dir = map[e.key];
  if (dir) { e.preventDefault(); act(dir); return; }
  if (e.key === "n" || e.key === "]" || e.key === "[") {
    const ids = state.vehicles.map((v) => v.id), at = ids.indexOf(selected);
    const id = ids[(at + (e.key === "[" ? ids.length - 1 : 1)) % ids.length]; if (id) { select(id); cars.get(id)?.focus(); }
  }
});

// Drag: the vehicle follows the finger along its lane, clamped to the cells it can legally reach,
// then settles on the nearest cell. Each cell travelled is one move, the same as the arrow buttons.
let drag: { pointer: number; id: string; start: number; cell: number; min: number; max: number; exitAt?: number; offset: number; moved: boolean } | undefined;
board.addEventListener("pointerdown", (e) => {
  const car = (e.target as HTMLElement).closest<HTMLButtonElement>(".car");
  const vehicle = car && !ended ? state.vehicles.find((v) => v.id === car.dataset.id) : undefined;
  if (!car || !vehicle) return;
  e.preventDefault(); select(vehicle.id);
  const [neg, pos] = axisDirections(vehicle), left = level.move_limit - state.moves;
  const back = slideLimit(level, state, vehicle.id, neg), ahead = slideLimit(level, state, vehicle.id, pos);
  const min = -Math.min(back.steps, left), max = Math.min(ahead.steps, left);
  const exitAt = back.exits && back.steps <= left ? min : ahead.exits && ahead.steps <= left ? max : undefined;
  drag = { pointer: e.pointerId, id: vehicle.id, start: vehicle.axis === "h" ? e.clientX : e.clientY, cell: board.clientWidth / level.size, min, max, exitAt, offset: 0, moved: false };
  car.setPointerCapture(e.pointerId); car.classList.add("dragging");
});
board.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.pointer) return;
  const vehicle = state.vehicles.find((v) => v.id === drag!.id), car = cars.get(drag.id); if (!vehicle || !car) return;
  const raw = ((vehicle.axis === "h" ? e.clientX : e.clientY) - drag.start) / drag.cell;
  if (Math.abs(raw) > 0.08) drag.moved = true;
  drag.offset = Math.max(drag.min - 0.12, Math.min(drag.max + 0.12, raw));
  if (raw > drag.max + 0.3 || raw < drag.min - 0.3) message.textContent = BLOCKED;
  place(car, vehicle, drag.offset);
});
function endDrag(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.pointer) return;
  const { id, offset, exitAt, min, max } = drag; drag = undefined;
  const car = cars.get(id), vehicle = state.vehicles.find((v) => v.id === id);
  car?.classList.remove("dragging");
  if (!vehicle) return;
  let steps = Math.max(min, Math.min(max, Math.round(offset)));
  // Pulling a car most of the way out of its exit counts as leaving.
  if (exitAt !== undefined && Math.sign(offset) === Math.sign(exitAt) && Math.abs(offset) >= Math.abs(exitAt) - 0.6) steps = exitAt;
  if (!steps) { render(); return; }
  const [neg, pos] = axisDirections(vehicle);
  commit(slide(level, state, id, steps < 0 ? neg : pos, Math.abs(steps)));
}
board.addEventListener("pointerup", endDrag);
board.addEventListener("pointercancel", endDrag);

async function loadSaved(id: string) {
  const response = await fetch(`${api}/levels/${encodeURIComponent(id)}`); if (!response.ok) throw new Error(`Could not load saved level (${response.status}).`);
  const result = await response.json() as { game_id: string; level: Level }; if (result.game_id !== "lotescape") throw new Error("This saved level belongs to another game.");
  mode = "saved"; levelId = id; endlessToggle.checked = false; show(result.level, "Studio level", false, undefined);
  const saved = result.level, solved = await runInBackground({ kind: "solve", level: saved });
  if (level === saved) bestLabel.textContent = solved.kind === "solve" && solved.best !== undefined ? `Best possible: ${solved.best} moves` : "Best possible: not checked";
}
void (async () => {
  const params = new URLSearchParams(location.search), id = params.get("level");
  const stored = Number(store.get(KEY_BUILTIN));
  activeIndex = params.get("demo") === "1" ? 1 : Number.isInteger(stored) && stored >= 0 && stored < LEVELS.length ? stored : 0;
  if (id) { try { await loadSaved(id); return; } catch { /* falls back to a practice lot below */ } }
  if (store.get(KEY_ENDLESS) === "1" && !params.has("demo")) setEndless(true); else loadLevel(activeIndex);
  if (id) message.textContent = "That saved lot could not load, so here is a practice lot.";
})();
window.addEventListener("beforeunload", () => { if (!ended) event("quit"); });
