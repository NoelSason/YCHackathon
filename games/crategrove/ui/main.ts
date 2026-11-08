import { initialState, move, renderTiles, type Direction, type Level, type State } from "../src/engine.js";
import { LEVELS } from "../src/levels.js";

declare global { interface Window { STUDIO_API?: string } }
const board = document.querySelector<HTMLDivElement>("#board")!;
const label = document.querySelector<HTMLElement>("#level-name")!;
const movesLabel = document.querySelector<HTMLElement>("#moves")!;
const message = document.querySelector<HTMLElement>("#message")!;
const limitLabel = document.querySelector<HTMLElement>("#limit")!;
const api = (window.STUDIO_API ?? "").replace(/\/$/, "");
let level: Level = LEVELS[0]!;
let state: State = initialState(level);
let saved: State[] = [];
let activeIndex = 0;
let levelId: string | undefined;
let sessionId = crypto.randomUUID();
let ended = false;
let loaded: Promise<void>;

function event(type: "attempt" | "win" | "loss" | "quit") {
  if (!api) return;
  const body = JSON.stringify({ game_id: "crategrove", level_id: levelId ?? null, session_id: sessionId, type, moves_used: state.moves });
  if (type === "quit" && navigator.sendBeacon) navigator.sendBeacon(`${api}/events`, new Blob([body], { type: "application/json" }));
  else void fetch(`${api}/events`, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
}
function finishIfNeeded() {
  if (ended) return;
  if (state.won) { ended = true; message.textContent = "Every lantern is lit. Lovely work!"; message.classList.add("good"); event("win"); }
  else if (state.moves >= level.move_limit) { ended = true; message.textContent = "The trail is quiet. Undo a move or start again."; event("loss"); }
}
function draw() {
  const width = level.map[0]!.length;
  board.style.gridTemplateColumns = `repeat(${width}, minmax(0, 1fr))`;
  board.replaceChildren();
  for (const [i, tile] of renderTiles(level, state).entries()) {
    const cell = document.createElement("div");
    cell.className = tile === "#" ? "cell wall" : "cell floor";
    cell.dataset.index = String(i);
    if (["G", "*", "+"].includes(tile)) { const goal = document.createElement("span"); goal.className = "goal-mark"; cell.append(goal); }
    if (["B", "*"].includes(tile)) { const crate = document.createElement("span"); crate.className = `crate${tile === "*" ? " on-goal" : ""}`; cell.append(crate); }
    if (["S", "+"].includes(tile)) { const player = document.createElement("span"); player.className = "player"; cell.append(player); }
    board.append(cell);
  }
  movesLabel.textContent = String(state.moves);
  limitLabel.textContent = `Move limit ${level.move_limit}`;
}
function restart() {
  saved = []; state = initialState(level); sessionId = crypto.randomUUID(); ended = state.won;
  message.textContent = "Use the arrow keys or the grove controls."; message.classList.remove("good");
  draw(); event("attempt"); finishIfNeeded();
}
function take(direction: Direction) {
  if (!loaded || ended) return;
  const next = move(level, state, direction);
  if (next === state) return;
  saved.push(state); state = next; draw(); finishIfNeeded();
}
async function loadSaved(id: string) {
  const response = await fetch(`${api}/levels/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`Could not load saved level (${response.status}).`);
  const result = await response.json() as { game_id: string; level: Level };
  if (result.game_id !== "crategrove") throw new Error("This saved level belongs to another game.");
  level = result.level; levelId = id; label.textContent = level.title; restart();
}
loaded = (async () => {
  const id = new URLSearchParams(location.search).get("level");
  if (id) {
    try { await loadSaved(id); return; }
    catch (error) { message.textContent = error instanceof Error ? error.message : "Could not load level."; }
  }
  const requested = Number(new URLSearchParams(location.search).get("demo"));
  activeIndex = Number.isInteger(requested) && requested >= 0 && requested < LEVELS.length ? requested : 0;
  level = LEVELS[activeIndex]!; label.textContent = level.title; restart();
})();

document.addEventListener("keydown", (e) => {
  const direction: Record<string, Direction> = { ArrowUp: "up", w: "up", ArrowDown: "down", s: "down", ArrowLeft: "left", a: "left", ArrowRight: "right", d: "right" };
  const selected = direction[e.key];
  if (selected) { e.preventDefault(); take(selected); }
  if (e.key === "z" || (e.key === "Backspace" && e.ctrlKey)) { e.preventDefault(); document.querySelector<HTMLButtonElement>("#undo")!.click(); }
});
document.querySelectorAll<HTMLButtonElement>("[data-dir]").forEach((button) => button.addEventListener("click", () => take(button.dataset.dir as Direction)));
document.querySelector<HTMLButtonElement>("#reset")!.addEventListener("click", restart);
document.querySelector<HTMLButtonElement>("#undo")!.addEventListener("click", () => {
  if (ended && state.won) return;
  const previous = saved.pop();
  if (previous) { state = previous; ended = false; message.textContent = "A little backtracking is part of the trail."; message.classList.remove("good"); draw(); }
});
document.querySelector<HTMLButtonElement>("#next")!.addEventListener("click", () => {
  if (levelId) { location.href = `${location.pathname}?demo=0`; return; }
  activeIndex = (activeIndex + 1) % LEVELS.length; level = LEVELS[activeIndex]!; levelId = undefined;
  label.textContent = level.title; restart();
});
let touchStart: { x: number; y: number; index: number } | undefined;
board.addEventListener("pointerdown", (e) => {
  const cell = (e.target as HTMLElement).closest<HTMLElement>("[data-index]");
  if (cell) touchStart = { x: e.clientX, y: e.clientY, index: Number(cell.dataset.index) };
});
board.addEventListener("pointerup", (e) => {
  if (!touchStart) return;
  const dx = e.clientX - touchStart.x, dy = e.clientY - touchStart.y;
  let direction: Direction | undefined;
  if (Math.max(Math.abs(dx), Math.abs(dy)) > 18) direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
  else {
    const { width } = { width: level.map[0]!.length }, from = touchStart.index, to = Number((e.target as HTMLElement).closest<HTMLElement>("[data-index]")?.dataset.index ?? from);
    const diff = to - from;
    if (Math.abs(diff) === 1 && Math.floor(to / width) === Math.floor(from / width)) direction = diff > 0 ? "right" : "left";
    if (Math.abs(diff) === width) direction = diff > 0 ? "down" : "up";
  }
  if (direction) take(direction); touchStart = undefined;
});
window.addEventListener("beforeunload", () => { if (!ended) event("quit"); });
