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
function axisDirections(vehicle) {
  return vehicle.axis === "h" ? ["left", "right"] : ["up", "down"];
}
function slideLimit(level2, state2, id, direction) {
  let current = state2, steps = 0;
  const cap = level2.size + 3;
  while (steps < cap) {
    const next = move(level2, current, id, direction);
    if (next === current) break;
    steps++;
    current = next;
    if (!current.vehicles.some((v) => v.id === id)) return { steps, exits: true };
  }
  return { steps, exits: false };
}
function slide(level2, state2, id, direction, steps) {
  let current = state2;
  for (let i = 0; i < steps; i++) {
    const next = move(level2, current, id, direction);
    if (next === current) break;
    current = next;
    if (!current.vehicles.some((v) => v.id === id)) break;
  }
  return current;
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
var HINT = "Each car has a marked exit. Clear its lane to let it leave.";
var BLOCKED = "That lane is blocked. Try sliding another car first.";
var level = LEVELS[0];
var state = initialState(level);
var selected = state.vehicles[0]?.id ?? "";
var levelId;
var activeIndex = 0;
var ended = false;
var sessionId = crypto.randomUUID();
var cars = /* @__PURE__ */ new Map();
var exits = /* @__PURE__ */ new Map();
var lane = document.createElement("div");
lane.className = "lane";
function event(type) {
  if (!api) return;
  const body = JSON.stringify({ game_id: "lotescape", level_id: levelId ?? null, session_id: sessionId, type, moves_used: state.moves });
  if (type === "quit" && navigator.sendBeacon) navigator.sendBeacon(`${api}/events`, new Blob([body], { type: "application/json" }));
  else void fetch(`${api}/events`, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {
  });
}
function vehicleSvg(vehicle) {
  const W = vehicle.length * 100, horizontal = vehicle.axis === "h";
  const turn = { right: "", left: `translate(${W} 0) scale(-1 1)`, down: "translate(100 0) rotate(90)", up: `translate(0 ${W}) rotate(-90)` }[vehicle.exit];
  const wheels = [W * 0.2, W - (vehicle.length === 3 ? 62 : W * 0.2) - 20].map((x) => `<rect x="${x}" y="4" width="22" height="10" rx="4"/><rect x="${x}" y="86" width="22" height="10" rx="4"/>`).join("");
  const nose = `<rect x="${W - 15}" y="20" width="7" height="14" rx="3" fill="#fff4c2"/><rect x="${W - 15}" y="66" width="7" height="14" rx="3" fill="#fff4c2"/>`;
  const tail = `<rect x="8" y="20" width="5" height="12" rx="2" fill="#5a1620"/><rect x="8" y="68" width="5" height="12" rx="2" fill="#5a1620"/>`;
  const chevron = (cx) => `<path d="M${cx - 9} 36 L${cx + 7} 50 L${cx - 9} 64" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" opacity=".92"/>`;
  const body = vehicle.length === 3 ? `<rect x="8" y="9" width="${W - 116}" height="82" rx="12" fill="currentColor"/><rect x="18" y="20" width="${W - 136}" height="60" rx="7" fill="#fff" opacity=".2"/><rect x="${W - 104}" y="11" width="96" height="78" rx="20" fill="currentColor"/><rect x="${W - 46}" y="20" width="16" height="60" rx="6" fill="#d9efff" opacity=".92"/>${nose}${tail}${chevron(W * 0.4)}` : `<rect x="8" y="9" width="${W - 16}" height="82" rx="24" fill="currentColor"/><rect x="${W * 0.3}" y="20" width="${W * 0.42}" height="60" rx="13" fill="#0d1a2b" opacity=".18"/><rect x="${W * 0.64}" y="21" width="${W * 0.09}" height="58" rx="7" fill="#d9efff" opacity=".92"/><rect x="${W * 0.25}" y="23" width="${W * 0.06}" height="54" rx="6" fill="#d9efff" opacity=".7"/>${nose}${tail}${chevron(W * 0.5)}`;
  return `<svg viewBox="0 0 ${horizontal ? W : 100} ${horizontal ? 100 : W}" aria-hidden="true"><g transform="${turn}"><g fill="#16202f">${wheels}</g>${body}</g></svg>`;
}
var pct = (n) => `${n * 100 / level.size}%`;
function place(el, vehicle, offset = 0) {
  const dx = vehicle.axis === "h" ? offset : 0, dy = vehicle.axis === "v" ? offset : 0;
  el.style.left = pct(vehicle.x + dx);
  el.style.top = pct(vehicle.y + dy);
  el.style.width = pct(vehicle.axis === "h" ? vehicle.length : 1);
  el.style.height = pct(vehicle.axis === "v" ? vehicle.length : 1);
}
function placeExit(el, vehicle) {
  const lanePos = pct(vehicle.axis === "h" ? vehicle.y : vehicle.x);
  el.className = `exit ${vehicle.exit} ${vehicle.color}`;
  el.removeAttribute("style");
  if (vehicle.axis === "h") {
    el.style.top = lanePos;
    el.style.height = pct(1);
  } else {
    el.style.left = lanePos;
    el.style.width = pct(1);
  }
}
function carFor(vehicle) {
  let car = cars.get(vehicle.id);
  if (car) return car;
  car = document.createElement("button");
  car.type = "button";
  car.dataset.id = vehicle.id;
  car.dataset.exit = vehicle.exit;
  car.dataset.length = String(vehicle.length);
  car.className = `car ${vehicle.axis === "h" ? "horizontal" : "vertical"} ${vehicle.length === 3 ? "truck" : "sedan"} ${vehicle.color}`;
  car.setAttribute("aria-label", `${vehicle.id}, ${vehicle.length === 3 ? "truck" : "car"}, exits ${vehicle.exit}`);
  car.innerHTML = vehicleSvg(vehicle);
  car.addEventListener("click", () => select(vehicle.id));
  car.addEventListener("focus", () => select(vehicle.id));
  board.append(car);
  cars.set(vehicle.id, car);
  const marker = document.createElement("div");
  marker.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4l8 6-8 6" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  board.append(marker);
  exits.set(vehicle.id, marker);
  return car;
}
function render() {
  board.style.setProperty("--size", String(level.size));
  const present = new Set(state.vehicles.map((v) => v.id));
  for (const vehicle of state.vehicles) {
    const car = carFor(vehicle);
    place(car, vehicle);
    car.classList.toggle("selected", vehicle.id === selected);
    placeExit(exits.get(vehicle.id), vehicle);
    exits.get(vehicle.id).classList.toggle("selected", vehicle.id === selected);
  }
  for (const [id, car] of cars) if (!present.has(id)) driveOff(id, car);
  drawLane();
  movesLabel.textContent = `${state.moves} / ${level.move_limit}`;
  updateSelected();
}
function driveOff(id, car) {
  cars.delete(id);
  exits.get(id)?.remove();
  exits.delete(id);
  const step = (Number(car.dataset.length) + 1) * 100 / level.size, exit = car.dataset.exit;
  const left = parseFloat(car.style.left), top = parseFloat(car.style.top);
  car.classList.add("leaving");
  car.disabled = true;
  requestAnimationFrame(() => {
    if (exit === "right") car.style.left = `${left + step}%`;
    if (exit === "left") car.style.left = `${left - step}%`;
    if (exit === "down") car.style.top = `${top + step}%`;
    if (exit === "up") car.style.top = `${top - step}%`;
  });
  setTimeout(() => car.remove(), 420);
}
function drawLane() {
  const vehicle = state.vehicles.find((v) => v.id === selected);
  if (!vehicle || ended) {
    lane.remove();
    return;
  }
  lane.className = `lane ${vehicle.color}`;
  lane.removeAttribute("style");
  const from = vehicle.exit === "right" ? vehicle.x + vehicle.length : vehicle.exit === "down" ? vehicle.y + vehicle.length : 0;
  const to = vehicle.exit === "left" ? vehicle.x : vehicle.exit === "up" ? vehicle.y : level.size;
  if (to <= from) {
    lane.remove();
    return;
  }
  if (vehicle.axis === "h") {
    lane.style.left = pct(from);
    lane.style.width = pct(to - from);
    lane.style.top = pct(vehicle.y);
    lane.style.height = pct(1);
  } else {
    lane.style.top = pct(from);
    lane.style.height = pct(to - from);
    lane.style.left = pct(vehicle.x);
    lane.style.width = pct(1);
  }
  if (!lane.isConnected) board.prepend(lane);
}
function select(id) {
  if (selected === id || !state.vehicles.some((v) => v.id === id)) return;
  selected = id;
  render();
}
function updateSelected() {
  const car = state.vehicles.find((v) => v.id === selected);
  selectedLabel.textContent = car ? `${car.id.toUpperCase()} \xB7 EXIT ${car.exit.toUpperCase()}` : "Choose a car";
  for (const button of document.querySelectorAll("[data-dir]")) {
    const dir = button.dataset.dir;
    button.disabled = !car || ended || !axisDirections(car).includes(dir) || slideLimit(level, state, car.id, dir).steps === 0;
  }
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
    message.className = "message bad";
    event("loss");
  }
}
function commit(next) {
  state = next;
  if (!state.vehicles.some((v) => v.id === selected)) selected = state.vehicles[0]?.id ?? "";
  if (message.textContent === BLOCKED) message.textContent = HINT;
  finish();
  render();
}
function restart() {
  for (const car of cars.values()) car.remove();
  for (const marker of exits.values()) marker.remove();
  cars.clear();
  exits.clear();
  state = initialState(level);
  selected = state.vehicles[0]?.id ?? "";
  ended = false;
  sessionId = crypto.randomUUID();
  message.textContent = HINT;
  message.className = "message";
  render();
  event("attempt");
}
function act(direction) {
  if (!selected || ended) return;
  const next = move(level, state, selected, direction);
  if (next === state) {
    message.textContent = BLOCKED;
    return;
  }
  commit(next);
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
document.addEventListener("keydown", (e) => {
  const map = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", a: "left", d: "right", w: "up", s: "down" };
  const dir = map[e.key];
  if (dir) {
    e.preventDefault();
    act(dir);
    return;
  }
  if (e.key === "n" || e.key === "]" || e.key === "[") {
    const ids = state.vehicles.map((v) => v.id), at = ids.indexOf(selected);
    const id = ids[(at + (e.key === "[" ? ids.length - 1 : 1)) % ids.length];
    if (id) {
      select(id);
      cars.get(id)?.focus();
    }
  }
});
var drag;
board.addEventListener("pointerdown", (e) => {
  const car = e.target.closest(".car");
  const vehicle = car && !ended ? state.vehicles.find((v) => v.id === car.dataset.id) : void 0;
  if (!car || !vehicle) return;
  e.preventDefault();
  select(vehicle.id);
  const [neg, pos] = axisDirections(vehicle), left = level.move_limit - state.moves;
  const back = slideLimit(level, state, vehicle.id, neg), ahead = slideLimit(level, state, vehicle.id, pos);
  const min = -Math.min(back.steps, left), max = Math.min(ahead.steps, left);
  const exitAt = back.exits && back.steps <= left ? min : ahead.exits && ahead.steps <= left ? max : void 0;
  drag = { pointer: e.pointerId, id: vehicle.id, start: vehicle.axis === "h" ? e.clientX : e.clientY, cell: board.clientWidth / level.size, min, max, exitAt, offset: 0, moved: false };
  car.setPointerCapture(e.pointerId);
  car.classList.add("dragging");
});
board.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.pointer) return;
  const vehicle = state.vehicles.find((v) => v.id === drag.id), car = cars.get(drag.id);
  if (!vehicle || !car) return;
  const raw = ((vehicle.axis === "h" ? e.clientX : e.clientY) - drag.start) / drag.cell;
  if (Math.abs(raw) > 0.08) drag.moved = true;
  drag.offset = Math.max(drag.min - 0.12, Math.min(drag.max + 0.12, raw));
  if (raw > drag.max + 0.3 || raw < drag.min - 0.3) message.textContent = BLOCKED;
  place(car, vehicle, drag.offset);
});
function endDrag(e) {
  if (!drag || e.pointerId !== drag.pointer) return;
  const { id, offset, exitAt, min, max } = drag;
  drag = void 0;
  const car = cars.get(id), vehicle = state.vehicles.find((v) => v.id === id);
  car?.classList.remove("dragging");
  if (!vehicle) return;
  let steps = Math.max(min, Math.min(max, Math.round(offset)));
  if (exitAt !== void 0 && Math.sign(offset) === Math.sign(exitAt) && Math.abs(offset) >= Math.abs(exitAt) - 0.6) steps = exitAt;
  if (!steps) {
    render();
    return;
  }
  const [neg, pos] = axisDirections(vehicle);
  commit(slide(level, state, id, steps < 0 ? neg : pos, Math.abs(steps)));
}
board.addEventListener("pointerup", endDrag);
board.addEventListener("pointercancel", endDrag);
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
    } catch {
    }
  }
  loadLevel(Number(new URLSearchParams(location.search).get("demo")) === 1 ? 1 : 0);
  if (id) message.textContent = "That saved lot could not load, so here is a practice lot.";
})();
window.addEventListener("beforeunload", () => {
  if (!ended) event("quit");
});
