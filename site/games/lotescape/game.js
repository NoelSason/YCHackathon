// src/engine.ts
var DELTA = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
function initialState(level2) {
  return { vehicles: level2.vehicles.map((v) => ({ ...v })), moves: 0, won: level2.vehicles.length === 0 };
}
function cells(vehicle) {
  return Array.from({ length: vehicle.length }, (_, i) => [vehicle.x + (vehicle.axis === "h" ? i : 0), vehicle.y + (vehicle.axis === "v" ? i : 0)]);
}
function overlaps(a, b, size) {
  const bCells = new Set(cells(b).filter(([x, y]) => x >= 0 && y >= 0 && x < size && y < size).map(([x, y]) => `${x},${y}`));
  return cells(a).some(([x, y]) => x >= 0 && y >= 0 && x < size && y < size && bCells.has(`${x},${y}`));
}
function move(level2, state2, id, direction) {
  if (state2.won) return state2;
  const index = state2.vehicles.findIndex((v) => v.id === id), vehicle = state2.vehicles[index];
  if (!vehicle || vehicle.axis === "h" && direction !== "left" && direction !== "right" || vehicle.axis === "v" && direction !== "up" && direction !== "down") return state2;
  const [dx, dy] = DELTA[direction], next = { ...vehicle, x: vehicle.x + dx, y: vehicle.y + dy };
  const outside = cells(next).some(([x, y]) => x < 0 || y < 0 || x >= level2.size || y >= level2.size);
  if (outside && direction !== vehicle.exit) return state2;
  if (state2.vehicles.some((other, i) => i !== index && overlaps(next, other, level2.size))) return state2;
  const escaped = outside;
  const vehicles = state2.vehicles.slice();
  if (escaped) vehicles.splice(index, 1);
  else vehicles[index] = next;
  return { vehicles, moves: state2.moves + 1, won: vehicles.length === 0 };
}

// src/levels.ts
var LEVELS = [
  { title: "Morning Rush", size: 6, move_limit: 26, vehicles: [
    { id: "coral", x: 0, y: 0, length: 2, axis: "h", exit: "right", color: "coral" },
    { id: "sunshine", x: 3, y: 0, length: 2, axis: "v", exit: "up", color: "sunshine" },
    { id: "lagoon", x: 1, y: 2, length: 2, axis: "h", exit: "left", color: "lagoon" },
    { id: "mint", x: 4, y: 3, length: 2, axis: "v", exit: "down", color: "mint" },
    { id: "violet", x: 0, y: 5, length: 3, axis: "h", exit: "right", color: "violet" }
  ] },
  { title: "Market Street", size: 6, move_limit: 30, vehicles: [
    { id: "cherry", x: 2, y: 0, length: 3, axis: "v", exit: "down", color: "coral" },
    { id: "lemon", x: 0, y: 1, length: 2, axis: "h", exit: "right", color: "sunshine" },
    { id: "bluebird", x: 4, y: 1, length: 2, axis: "v", exit: "up", color: "lagoon" },
    { id: "avocado", x: 1, y: 3, length: 3, axis: "h", exit: "left", color: "mint" },
    { id: "plum", x: 5, y: 3, length: 2, axis: "v", exit: "down", color: "violet" },
    { id: "peach", x: 0, y: 5, length: 2, axis: "h", exit: "left", color: "peach" }
  ] }
];

// ui/main.ts
var board = document.querySelector("#board");
var selectedLabel = document.querySelector("#selected");
var titleLabel = document.querySelector("#level-title");
var movesLabel = document.querySelector("#moves");
var message = document.querySelector("#message");
var api = (window.STUDIO_API ?? "").replace(/\/$/, "");
var level = LEVELS[0];
var state = initialState(level);
var selected = state.vehicles[0]?.id ?? "";
var levelId;
var activeIndex = 0;
var ended = false;
var sessionId = crypto.randomUUID();
var busy = false;
var svg = `<svg viewBox="0 0 120 58" aria-hidden="true"><path d="M14 39 20 22q2-6 10-7h43q7 0 12 7l12 17v8H14z" fill="currentColor"/><path d="m31 20-6 15h26V20zm24 0v15h30l-8-12q-2-3-6-3z" fill="#f6f8f7" opacity=".86"/><circle cx="32" cy="47" r="8" fill="#243249"/><circle cx="82" cy="47" r="8" fill="#243249"/><circle cx="32" cy="47" r="3" fill="#d7e1ea"/><circle cx="82" cy="47" r="3" fill="#d7e1ea"/><path d="M15 38h-6m100 0h-6" stroke="#fff2ca" stroke-width="4" stroke-linecap="round"/></svg>`;
function event(type) {
  if (!api) return;
  const body = JSON.stringify({ game_id: "lotescape", level_id: levelId ?? null, session_id: sessionId, type, moves_used: state.moves });
  if (type === "quit" && navigator.sendBeacon) navigator.sendBeacon(`${api}/events`, new Blob([body], { type: "application/json" }));
  else void fetch(`${api}/events`, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {
  });
}
function draw() {
  board.style.setProperty("--size", String(level.size));
  board.replaceChildren();
  for (const vehicle of state.vehicles) {
    const car = document.createElement("button");
    car.type = "button";
    car.className = `car ${vehicle.axis === "h" ? "horizontal" : "vertical"} ${vehicle.color}${selected === vehicle.id ? " selected" : ""}`;
    car.setAttribute("aria-label", `${vehicle.id}, ${vehicle.axis === "h" ? "horizontal" : "vertical"} car`);
    car.style.left = `${vehicle.x * 100 / level.size}%`;
    car.style.top = `${vehicle.y * 100 / level.size}%`;
    car.style.width = `${(vehicle.axis === "h" ? vehicle.length : 1) * 100 / level.size}%`;
    car.style.height = `${(vehicle.axis === "v" ? vehicle.length : 1) * 100 / level.size}%`;
    car.innerHTML = svg;
    car.addEventListener("click", () => {
      selected = vehicle.id;
      updateSelected();
      draw();
    });
    board.append(car);
  }
  movesLabel.textContent = `${state.moves} / ${level.move_limit}`;
}
function updateSelected() {
  const car = state.vehicles.find((v) => v.id === selected);
  selectedLabel.textContent = car ? `${car.id.toUpperCase()} \xB7 EXIT ${car.exit.toUpperCase()}` : "Choose a car";
  for (const button of document.querySelectorAll("[data-dir]")) button.disabled = !car || (car.axis === "h" ? button.dataset.dir === "up" || button.dataset.dir === "down" : button.dataset.dir === "left" || button.dataset.dir === "right") || ended || busy;
}
function finish() {
  if (state.won && !ended) {
    ended = true;
    message.textContent = "Lot clear! Every car made it out.";
    message.className = "message good";
    event("win");
  } else if (state.moves >= level.move_limit && !ended) {
    ended = true;
    message.textContent = "Move limit reached. Give the lot another try.";
    event("loss");
  }
  updateSelected();
}
function restart() {
  state = initialState(level);
  selected = state.vehicles[0]?.id ?? "";
  ended = false;
  busy = false;
  sessionId = crypto.randomUUID();
  message.textContent = "Each car has a marked exit. Clear its lane to let it leave.";
  message.className = "message";
  draw();
  updateSelected();
  event("attempt");
}
function act(direction) {
  if (!selected || ended || busy) return;
  const next = move(level, state, selected, direction);
  if (next === state) {
    message.textContent = "That lane is blocked. Try sliding another car first.";
    return;
  }
  state = next;
  if (!state.vehicles.some((v) => v.id === selected)) selected = state.vehicles[0]?.id ?? "";
  draw();
  updateSelected();
  finish();
}
function loadLevel(index) {
  activeIndex = index;
  level = LEVELS[index];
  levelId = void 0;
  titleLabel.textContent = level.title;
  restart();
}
document.querySelectorAll("[data-dir]").forEach((button) => button.addEventListener("click", () => act(button.dataset.dir)));
document.querySelector("#reset").addEventListener("click", restart);
document.querySelector("#next").addEventListener("click", () => loadLevel((activeIndex + 1) % LEVELS.length));
document.addEventListener("keydown", (event2) => {
  const map = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
  if (map[event2.key]) {
    event2.preventDefault();
    act(map[event2.key]);
  }
});
var drag;
board.addEventListener("pointerdown", (e) => {
  const car = e.target.closest(".car");
  if (car) {
    selected = state.vehicles.find((v) => v.id === car.getAttribute("aria-label")?.split(",")[0]?.toLowerCase())?.id ?? selected;
    drag = { x: e.clientX, y: e.clientY, id: selected };
    updateSelected();
    draw();
  }
});
board.addEventListener("pointerup", (e) => {
  if (!drag || busy || ended) return;
  const vehicle = state.vehicles.find((v) => v.id === drag.id);
  if (!vehicle) {
    drag = void 0;
    return;
  }
  const rect = board.getBoundingClientRect(), cell = rect.width / level.size;
  const delta = vehicle.axis === "h" ? Math.round((e.clientX - drag.x) / cell) : Math.round((e.clientY - drag.y) / cell);
  const direction = vehicle.axis === "h" ? delta < 0 ? "left" : "right" : delta < 0 ? "up" : "down";
  const steps = Math.min(Math.abs(delta), level.size + vehicle.length);
  drag = void 0;
  if (!steps) return;
  busy = true;
  updateSelected();
  let remaining = steps;
  const tick = () => {
    if (!remaining || ended) {
      busy = false;
      updateSelected();
      return;
    }
    const prior = state;
    const next = move(level, state, vehicle.id, direction);
    if (prior === next) {
      busy = false;
      message.textContent = "That lane is blocked. Try sliding another car first.";
      updateSelected();
      return;
    }
    state = next;
    remaining--;
    if (!state.vehicles.some((v) => v.id === vehicle.id)) selected = state.vehicles[0]?.id ?? "";
    draw();
    finish();
    if (state.won || ended || !state.vehicles.some((v) => v.id === vehicle.id)) {
      busy = false;
      updateSelected();
      return;
    }
    setTimeout(tick, 85);
  };
  tick();
});
async function loadSaved(id) {
  const response = await fetch(`${api}/levels/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`Could not load saved level (${response.status}).`);
  const result = await response.json();
  if (result.game_id !== "lotescape") throw new Error("This saved level belongs to another game.");
  level = result.level;
  levelId = id;
  titleLabel.textContent = level.title;
  restart();
}
void (async () => {
  const id = new URLSearchParams(location.search).get("level");
  if (id) {
    try {
      await loadSaved(id);
      return;
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : "Could not load level.";
    }
  }
  loadLevel(Number(new URLSearchParams(location.search).get("demo")) === 1 ? 1 : 0);
})();
window.addEventListener("beforeunload", () => {
  if (!ended) event("quit");
});
