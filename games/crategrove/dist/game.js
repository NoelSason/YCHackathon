// src/engine.ts
var DELTA = { up: 0, down: 0, left: -1, right: 1 };
var VERTICAL = { up: -1, down: 1, left: 0, right: 0 };
function dimensions(map) {
  return { width: map[0]?.length ?? 0, height: map.length };
}
function indexOf(map, x, y) {
  return y * (map[0]?.length ?? 0) + x;
}
function initialState(level2) {
  const player = level2.map.join("").search(/[S+]/);
  const boxes = [];
  [...level2.map.join("")].forEach((c, i) => {
    if (c === "B" || c === "*") boxes.push(i);
  });
  return { player, boxes: boxes.sort((a, b) => a - b), moves: 0, won: boxes.every((b) => level2.map[Math.floor(b / level2.map[0].length)]?.[b % level2.map[0].length] === "*") };
}
function goals(level2) {
  const out = [];
  level2.map.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === "G" || c === "*" || c === "+") out.push(indexOf(level2.map, x, y));
  }));
  return out;
}
function isWall(level2, index) {
  const { width, height } = dimensions(level2.map);
  const x = index % width, y = Math.floor(index / width);
  return x < 0 || y < 0 || x >= width || y >= height || level2.map[y]?.[x] === "#";
}
function step(level2, index, direction) {
  const { width } = dimensions(level2.map);
  const next = index + DELTA[direction] + VERTICAL[direction] * width;
  if (direction === "left" && index % width === 0 || direction === "right" && index % width === width - 1) return -1;
  return isWall(level2, next) ? -1 : next;
}
function move(level2, state2, direction) {
  if (state2.won) return state2;
  const next = step(level2, state2.player, direction);
  if (next < 0) return state2;
  const boxAt = state2.boxes.indexOf(next);
  let boxes = state2.boxes;
  if (boxAt >= 0) {
    const beyond = step(level2, next, direction);
    if (beyond < 0 || state2.boxes.includes(beyond)) return state2;
    boxes = state2.boxes.slice();
    boxes[boxAt] = beyond;
    boxes.sort((a, b) => a - b);
  }
  const goalSet = new Set(goals(level2));
  return { player: next, boxes, moves: state2.moves + 1, won: boxes.every((b) => goalSet.has(b)) };
}
function renderTiles(level2, state2) {
  const { width, height } = dimensions(level2.map), out = [];
  const goalSet = new Set(goals(level2)), boxSet = new Set(state2.boxes);
  for (let i = 0; i < width * height; i++) {
    const isPlayer = i === state2.player, isBox = boxSet.has(i), isGoal = goalSet.has(i);
    out.push(isPlayer ? isGoal ? "+" : "S" : isBox ? isGoal ? "*" : "B" : level2.map[Math.floor(i / width)][i % width]);
  }
  return out;
}

// src/levels.ts
var LEVELS = [
  { title: "Fern Crossing", move_limit: 18, map: ["########", "#......#", "#S.B.G.#", "#......#", "#......#", "#......#", "########"] },
  { title: "Twin Lanterns", move_limit: 40, map: ["##########", "#........#", "#..G..G..#", "#..B..B..#", "#........#", "#S.......#", "#........#", "##########"] },
  { title: "Mossy Switchback", move_limit: 40, map: ["##########", "#........#", "#.#G.....#", "#.#B.....#", "#...#....#", "#S..#....#", "#........#", "##########"] }
];

// ui/main.ts
var board = document.querySelector("#board");
var label = document.querySelector("#level-name");
var movesLabel = document.querySelector("#moves");
var message = document.querySelector("#message");
var limitLabel = document.querySelector("#limit");
var api = (window.STUDIO_API ?? "").replace(/\/$/, "");
var level = LEVELS[0];
var state = initialState(level);
var saved = [];
var activeIndex = 0;
var levelId;
var sessionId = crypto.randomUUID();
var ended = false;
var loaded;
function event(type) {
  if (!api) return;
  const body = JSON.stringify({ game_id: "crategrove", level_id: levelId ?? null, session_id: sessionId, type, moves_used: state.moves });
  if (type === "quit" && navigator.sendBeacon) navigator.sendBeacon(`${api}/events`, new Blob([body], { type: "application/json" }));
  else void fetch(`${api}/events`, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {
  });
}
function finishIfNeeded() {
  if (ended) return;
  if (state.won) {
    ended = true;
    message.textContent = "Every lantern is lit. Lovely work!";
    message.classList.add("good");
    event("win");
  } else if (state.moves >= level.move_limit) {
    ended = true;
    message.textContent = "The trail is quiet. Undo a move or start again.";
    event("loss");
  }
}
function draw() {
  const width = level.map[0].length;
  board.style.gridTemplateColumns = `repeat(${width}, minmax(0, 1fr))`;
  board.replaceChildren();
  for (const [i, tile] of renderTiles(level, state).entries()) {
    const cell = document.createElement("div");
    cell.className = tile === "#" ? "cell wall" : "cell floor";
    cell.dataset.index = String(i);
    if (["G", "*", "+"].includes(tile)) {
      const goal = document.createElement("span");
      goal.className = "goal-mark";
      cell.append(goal);
    }
    if (["B", "*"].includes(tile)) {
      const crate = document.createElement("span");
      crate.className = `crate${tile === "*" ? " on-goal" : ""}`;
      cell.append(crate);
    }
    if (["S", "+"].includes(tile)) {
      const player = document.createElement("span");
      player.className = "player";
      cell.append(player);
    }
    board.append(cell);
  }
  movesLabel.textContent = String(state.moves);
  limitLabel.textContent = `Move limit ${level.move_limit}`;
}
function restart() {
  saved = [];
  state = initialState(level);
  sessionId = crypto.randomUUID();
  ended = state.won;
  message.textContent = "Use the arrow keys or the grove controls.";
  message.classList.remove("good");
  draw();
  event("attempt");
  finishIfNeeded();
}
function take(direction) {
  if (!loaded || ended) return;
  const next = move(level, state, direction);
  if (next === state) return;
  saved.push(state);
  state = next;
  draw();
  finishIfNeeded();
}
async function loadSaved(id) {
  const response = await fetch(`${api}/levels/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`Could not load saved level (${response.status}).`);
  const result = await response.json();
  if (result.game_id !== "crategrove") throw new Error("This saved level belongs to another game.");
  level = result.level;
  levelId = id;
  label.textContent = level.title;
  restart();
}
loaded = (async () => {
  const id = new URLSearchParams(location.search).get("level");
  if (id) {
    try {
      await loadSaved(id);
      return;
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : "Could not load level.";
    }
  }
  const requested = Number(new URLSearchParams(location.search).get("demo"));
  activeIndex = Number.isInteger(requested) && requested >= 0 && requested < LEVELS.length ? requested : 0;
  level = LEVELS[activeIndex];
  label.textContent = level.title;
  restart();
})();
document.addEventListener("keydown", (e) => {
  const direction = { ArrowUp: "up", w: "up", ArrowDown: "down", s: "down", ArrowLeft: "left", a: "left", ArrowRight: "right", d: "right" };
  const selected = direction[e.key];
  if (selected) {
    e.preventDefault();
    take(selected);
  }
  if (e.key === "z" || e.key === "Backspace" && e.ctrlKey) {
    e.preventDefault();
    document.querySelector("#undo").click();
  }
});
document.querySelectorAll("[data-dir]").forEach((button) => button.addEventListener("click", () => take(button.dataset.dir)));
document.querySelector("#reset").addEventListener("click", restart);
document.querySelector("#undo").addEventListener("click", () => {
  if (ended && state.won) return;
  const previous = saved.pop();
  if (previous) {
    state = previous;
    ended = false;
    message.textContent = "A little backtracking is part of the trail.";
    message.classList.remove("good");
    draw();
  }
});
document.querySelector("#next").addEventListener("click", () => {
  if (levelId) {
    location.href = `${location.pathname}?demo=0`;
    return;
  }
  activeIndex = (activeIndex + 1) % LEVELS.length;
  level = LEVELS[activeIndex];
  levelId = void 0;
  label.textContent = level.title;
  restart();
});
var touchStart;
board.addEventListener("pointerdown", (e) => {
  const cell = e.target.closest("[data-index]");
  if (cell) touchStart = { x: e.clientX, y: e.clientY, index: Number(cell.dataset.index) };
});
board.addEventListener("pointerup", (e) => {
  if (!touchStart) return;
  const dx = e.clientX - touchStart.x, dy = e.clientY - touchStart.y;
  let direction;
  if (Math.max(Math.abs(dx), Math.abs(dy)) > 18) direction = Math.abs(dx) > Math.abs(dy) ? dx > 0 ? "right" : "left" : dy > 0 ? "down" : "up";
  else {
    const { width } = { width: level.map[0].length }, from = touchStart.index, to = Number(e.target.closest("[data-index]")?.dataset.index ?? from);
    const diff = to - from;
    if (Math.abs(diff) === 1 && Math.floor(to / width) === Math.floor(from / width)) direction = diff > 0 ? "right" : "left";
    if (Math.abs(diff) === width) direction = diff > 0 ? "down" : "up";
  }
  if (direction) take(direction);
  touchStart = void 0;
});
window.addEventListener("beforeunload", () => {
  if (!ended) event("quit");
});
