// Turbo Lanes in the browser. The rules run in fixed ticks with the same step() the solver and the
// bots use; the screen only interpolates between ticks so it scrolls smoothly.
//   ?level=<id>   play a level saved on the platform (sends player events)
//   ?sample=<n>   play a built-in practice track (no events)
//   ?data=<b64>   play a track given inline as base64url JSON (no events)
//   ?autoplay=1   drive the solver's fastest run by itself (for phone playtests and demos)
//   ?api=<url>    override the platform URL
import {
  type Action, type Box, buildGrid, canSteer, type CarState, cellKey, finished, GEOMETRY, type Grid, type Level, playerBox,
  spriteBox, startState, step, validateLevel,
} from "../src/engine.js";
import { SAMPLES } from "../src/levels.js";
import { solveLevel } from "../src/solver.js";

declare const __PLATFORM_URL__: string;

const GAME_ID = "racer";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUEUE_TICKS = 3;   // a steer pressed during a cooldown waits this many ticks at most
const LANE_EASE = 2.5;   // a lane change finishes in the first 1/LANE_EASE of its tick

const params = new URLSearchParams(location.search);
const API = (params.get("api") ?? __PLATFORM_URL__).replace(/\/+$/, "");
const SESSION = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2);

type Status = "ready" | "running" | "won" | "lost";

interface Run {
  level: Level;
  levelId: string | null;
  sample: number | null;
  grid: Grid;
  state: CarState;
  prev: CarState;
  status: Status;
  paused: boolean;
  coins: number;
  crashes: number;
  queue: Array<{ dir: Action; at: number }>;
  autoplay: Action[] | null;
  acc: number;
  last: number;
  startedAt: number;
}

let run: Run;
let ROW = 40;  // px per row
let LANE = 70; // px per lane (always ROW × GEOMETRY.laneAspect)
const nodes = new Map<number, HTMLElement>();

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- player events (platform/CONTRACTS.md §1) ----------

function sendEvent(type: "attempt" | "win" | "loss" | "quit", beacon = false): void {
  if (!run.levelId) return;
  const body = JSON.stringify({
    game_id: GAME_ID,
    level_id: run.levelId,
    session_id: SESSION,
    type,
    ...(type === "attempt" ? {} : { moves_used: run.state.tick, time_seconds: Math.round((run.state.tick / run.level.speed) * 10) / 10 }),
  });
  // text/plain keeps this a simple request (no CORS preflight); the platform parses the JSON body.
  const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
  if (beacon && navigator.sendBeacon?.(`${API}/events`, blob)) return;
  fetch(`${API}/events`, { method: "POST", body: blob, keepalive: true }).catch(() => undefined);
}

// ---------- setup ----------

function load(level: Level, levelId: string | null, sample: number | null): void {
  const s = startState(level);
  run = {
    level, levelId, sample,
    grid: buildGrid(level),
    state: s, prev: s,
    status: "ready",
    paused: false,
    coins: 0, crashes: 0,
    queue: [],
    autoplay: null,
    acc: 0, last: 0, startedAt: 0,
  };
  el<HTMLButtonElement>("pause").disabled = true;
  el("road").classList.remove("paused");
  el("track-title").textContent = level.title ?? "Custom circuit";
  el("objective").textContent = `Reach the finish in ${(level.time_limit / level.speed).toFixed(1)}s · Traffic, cones and oil cost you time · Boosts double your speed · A shield blocks one hit`;
  buildWorld();
  renderSamples();
  hud();
  draw(1);
  const secs = (level.time_limit / level.speed).toFixed(1);
  showOverlay(level.title ?? (sample ? `Track ${sample}` : "Turbo Lanes"), `Cross the finish line in ${secs}s. Dodge traffic and oil. Grab boosts for speed and shields for protection.`, "", "Start", begin);
}

function buildWorld(): void {
  const world = el("world");
  world.replaceChildren();
  nodes.clear();
  const { level } = run;
  for (let k = 1; k < level.lanes; k++) {
    const line = document.createElement("div");
    line.className = "lane-line";
    line.dataset.k = String(k);
    world.appendChild(line);
  }
  const finish = document.createElement("div");
  finish.className = "finish";
  world.appendChild(finish);
  // Pads and slicks lie on the road, so they go under the cars.
  const order = (k: string) => (k === "boost" || k === "oil" ? 0 : k === "car" ? 2 : 1);
  for (const o of [...level.objects].sort((a, b) => order(a.kind) - order(b.kind))) {
    const n = document.createElement("div");
    const paint = o.kind === "car" ? ` vehicle paint-${(o.row * 7 + o.lane * 3) % 3}` : "";
    n.className = `obj ${o.kind}${paint}`;
    n.dataset.row = String(o.row);
    n.dataset.lane = String(o.lane);
    n.dataset.kind = o.kind;
    if (o.kind === "car") n.append(document.createElement("i"), document.createElement("b"));
    world.appendChild(n);
    nodes.set(cellKey(o.row, o.lane), n);
  }
  layout();
}

/** Places a sprite box (track units) on screen; y is measured from the world's origin. */
function place(node: HTMLElement, b: Box): void {
  node.style.left = `${b.x0 * LANE}px`;
  node.style.width = `${(b.x1 - b.x0) * LANE}px`;
  node.style.bottom = `${b.y0 * ROW}px`;
  node.style.height = `${(b.y1 - b.y0) * ROW}px`;
}

/**
 * Sizes the road from the engine's GEOMETRY: a lane is always laneAspect rows wide, so every car
 * keeps the same shape and size relative to its lane on any screen. The road is as wide as that
 * allows while showing at least minVisibleRows rows; the space left over is roadside.
 */
function layout(): void {
  const road = el("road");
  const { lanes } = run.level;
  ROW = Math.min(road.clientHeight / GEOMETRY.minVisibleRows, road.clientWidth / (lanes * GEOMETRY.laneAspect));
  LANE = ROW * GEOMETRY.laneAspect;
  const root = document.documentElement.style;
  root.setProperty("--row", `${ROW}px`);
  root.setProperty("--lane", `${LANE}px`);
  root.setProperty("--road-w", `${lanes * LANE}px`);
  const world = el("world");
  for (const child of Array.from(world.children) as HTMLElement[]) {
    if (child.classList.contains("lane-line")) {
      child.style.left = `${Number(child.dataset.k) * LANE}px`;
      child.style.height = `${(run.level.length + 2 * GEOMETRY.minVisibleRows) * ROW}px`;
    } else if (child.classList.contains("finish")) {
      child.style.bottom = `${run.level.length * ROW}px`;
    } else {
      place(child, spriteBox(child.dataset.kind as Level["objects"][number]["kind"], Number(child.dataset.row), Number(child.dataset.lane)));
    }
  }
  // The player's car: same sprite rules as traffic, drawn in lane 0 and moved across by draw().
  const car = el("car");
  const box = playerBox(0, 0);
  place(car, { ...box, y0: box.y0 + 1 + GEOMETRY.cameraRows, y1: box.y1 + 1 + GEOMETRY.cameraRows });
  draw(1);
}

// ---------- the run ----------

function begin(): void {
  if (run.status !== "ready") return;
  el("overlay").classList.add("hidden");
  run.status = "running";
  el<HTMLButtonElement>("pause").disabled = false;
  run.last = performance.now();
  run.acc = 0;
  run.startedAt = Date.now();
  sendEvent("attempt");
}

function pause(): void {
  if (!run || run.status !== "running" || run.paused) return;
  run.paused = true;
  run.queue = [];
  el("road").classList.add("paused");
  showOverlay("Take a pit stop.", "Your race is paused. Resume when you’re ready to find your line.", "", "Resume race", resume);
}

function resume(): void {
  if (run.status !== "running" || !run.paused) return;
  run.paused = false;
  run.last = performance.now();
  el("overlay").classList.add("hidden");
  el("road").classList.remove("paused");
  el("pause").focus();
}

function restart(): void {
  if (run.status === "running") sendEvent("quit");
  load(run.level, run.levelId, run.sample);
}

function steer(dir: Action): void {
  if (run.status === "ready" && !run.autoplay) begin();
  if (run.status !== "running" || run.paused || run.autoplay || dir === 0) return;
  if (run.queue.length < 2) run.queue.push({ dir, at: run.state.tick });
  const btn = el(dir < 0 ? "left" : "right");
  btn.classList.add("on");
  window.setTimeout(() => btn.classList.remove("on"), 120);
}

function tick(): void {
  let a: Action = 0;
  if (run.autoplay) {
    a = run.autoplay[run.state.tick] ?? 0;
  } else {
    run.queue = run.queue.filter((q) => run.state.tick - q.at <= QUEUE_TICKS);
    if (run.queue.length && canSteer(run.state)) a = run.queue.shift()!.dir;
  }
  const prev = run.state;
  const { next, ev } = step(run.level, run.grid, prev, a);
  // Hide exactly what the rules say is gone: collected coins and shields, wrecks driven through.
  for (const key of ev.cleared) nodes.get(key)?.classList.add("gone");
  if (ev.sideswipe) bump(a);
  run.prev = prev;
  run.state = next;
  run.coins += ev.coins;
  if (ev.crashed) {
    run.crashes++;
    flash("crash", `${ev.sideswipe ? "SIDE HIT " : ""}−${(run.level.crash_penalty / run.level.speed).toFixed(1)}s`, "#ff5a7a");
  } else if (ev.protected) {
    flash("", "SHIELD SAVE", "#88e7d0");
  } else if (ev.shielded) {
    flash("", "SHIELD ON", "#88e7d0");
  } else if (ev.boosted) {
    flash("", "BOOST", "#20e3ff");
  } else if (ev.coins) {
    flash("", `+${ev.coins}`, "#ffd23f");
  }
  if (finished(run.level, next)) return end(next.tick <= run.level.time_limit);
  if (next.tick >= run.level.time_limit) return end(false);
}

function end(won: boolean): void {
  run.status = won ? "won" : "lost";
  el<HTMLButtonElement>("pause").disabled = true;
  sendEvent(won ? "win" : "loss");
  hud();
  const secs = (run.state.tick / run.level.speed).toFixed(1);
  const next = run.sample !== null && run.sample < SAMPLES.length ? run.sample + 1 : null;
  if (won) {
    const stars = run.crashes === 0 ? 3 : run.crashes <= 2 ? 2 : 1;
    const starsHtml = [1, 2, 3].map((n) => `<span class="${n <= stars ? "" : "off"}">★</span>`).join("");
    showOverlay("Finished!", `${secs}s · ${run.coins} coins · ${run.crashes} crash${run.crashes === 1 ? "" : "es"}`, starsHtml,
      next ? "Next track" : "Race again", () => (next ? loadSample(next) : restart()));
  } else {
    const pct = Math.min(99, Math.floor((run.state.row / run.level.length) * 100));
    showOverlay("Time's up!", `You made it ${pct}% of the way. Fewer crashes, more boosts.`, "", "Try again", restart);
  }
}

// ---------- drawing ----------

function frame(now: number): void {
  if (run?.status === "running" && !run.paused) {
    const tickMs = 1000 / run.level.speed;
    run.acc += now - run.last;
    run.last = now;
    if (run.acc > tickMs * 5) run.acc = tickMs; // after a tab switch, don't fast-forward
    while (run.acc >= tickMs && run.status === "running") {
      run.acc -= tickMs;
      tick();
    }
    draw(run.status === "running" ? run.acc / tickMs : 1);
    hud();
  }
  requestAnimationFrame(frame);
}

const easeOut = (t: number): number => 1 - (1 - t) ** 3;

function draw(alpha: number): void {
  const { prev, state } = run;
  const row = prev.row + (Math.min(state.row, run.level.length + 1) - prev.row) * alpha;
  // Lane changes ease out and finish early in the tick, so a late dodge clears the hazard it
  // dodged on screen as well as in the rules.
  const lane = prev.lane + (state.lane - prev.lane) * easeOut(Math.min(1, alpha * LANE_EASE));
  // The world scrolls so the player's rear bumper sits cameraRows above the road's bottom edge.
  const scroll = (row - 1 - GEOMETRY.cameraRows) * ROW;
  el("world").style.transform = `translate3d(0, ${scroll}px, 0)`;
  el("road").style.setProperty("--scroll", `${scroll}px`);
  const car = el("car");
  car.style.transform = `translate3d(${lane * LANE}px, 0, 0)`;
  car.classList.toggle("left", state.lane < prev.lane && alpha < 1);
  car.classList.toggle("right", state.lane > prev.lane && alpha < 1);
  car.classList.toggle("stunned", state.stun > 0);
  car.classList.toggle("shielded", state.shield > 0);
  el("road").classList.toggle("boost", state.boost > 0 && run.status === "running");
}

function hud(): void {
  el("distance").textContent = `${Math.min(100, Math.floor(run.state.row / run.level.length * 100))}% COMPLETE`;
  el("boost-status").textContent = run.state.boost > 0 ? `⚡ BOOST ×2 · ${run.state.boost} TICKS` : `${run.state.shield ? "◈ SHIELD ON" : "◈ NO SHIELD"} · ${run.crashes} CRASH${run.crashes === 1 ? "" : "ES"}`;
  const left = Math.max(0, (run.level.time_limit - run.state.tick) / run.level.speed);
  el("time").textContent = left.toFixed(1);
  el("time").parentElement!.classList.toggle("low", left < 3 && run.status === "running");
  el("coins").textContent = String(run.coins);
  el("progress").style.width = `${Math.min(100, (run.state.row / run.level.length) * 100)}%`;
}

/** A side crash: the car nudges toward the lane it tried to take, then settles back. */
function bump(dir: Action): void {
  const car = el("car");
  car.style.setProperty("--bump", `${dir * LANE * 0.22}px`);
  car.classList.remove("bump");
  void car.offsetWidth;
  car.classList.add("bump");
}

function flash(roadClass: string, text: string, color: string): void {
  const road = el("road");
  if (roadClass) {
    road.classList.remove(roadClass);
    void road.offsetWidth;
    road.classList.add(roadClass);
  }
  const f = el("float");
  f.textContent = text;
  f.style.color = color;
  f.classList.remove("show");
  void f.offsetWidth;
  f.classList.add("show");
}

function showOverlay(title: string, text: string, starsHtml: string, button: string, action: () => void): void {
  el("ov-title").textContent = title;
  el("ov-text").textContent = text;
  el("ov-stars").innerHTML = starsHtml;
  const b = el<HTMLButtonElement>("ov-btn");
  b.textContent = button;
  b.onclick = action;
  el("overlay").classList.remove("hidden");
  b.focus();
}

function renderSamples(): void {
  const nav = el("samples");
  el("collection-label").classList.toggle("hidden", run.levelId !== null);
  if (run.levelId) return void nav.replaceChildren();
  nav.replaceChildren(
    ...SAMPLES.map((s, n) => {
      const b = document.createElement("button");
      b.type = "button";
      const number = document.createElement("span");
      number.className = "sample-number";
      number.textContent = String(n + 1).padStart(2, "0");
      const title = document.createElement("strong");
      title.textContent = s.title ?? `Track ${n + 1}`;
      const detail = document.createElement("small");
      detail.textContent = `${s.lanes} lanes · ${(s.time_limit / s.speed).toFixed(1)}s`;
      b.append(number, title, detail);
      b.setAttribute("aria-label", `Practice track ${n + 1}: ${s.title ?? ""}`);
      if (run.sample === n + 1) b.setAttribute("aria-current", "true");
      b.addEventListener("click", () => loadSample(n + 1));
      return b;
    }),
  );
}

function notice(text: string): void {
  const n = el("notice");
  n.textContent = text;
  n.classList.remove("hidden");
}

// ---------- input ----------

function bindInput(): void {
  el("left").addEventListener("pointerdown", (e) => (e.preventDefault(), steer(-1)));
  el("right").addEventListener("pointerdown", (e) => (e.preventDefault(), steer(1)));
  // One lane per key press: held keys don't auto-repeat into extra lane changes.
  window.addEventListener("keydown", (e) => {
    if ((e.key === "Escape" || e.key.toLowerCase() === "p") && run?.status === "running" && !e.repeat) {
      e.preventDefault();
      return run.paused ? resume() : pause();
    }
    if (!el("overlay").classList.contains("hidden") && e.key === "Tab") {
      e.preventDefault();
      return el("ov-btn").focus();
    }
    const left = e.key === "ArrowLeft" || e.key === "a" || e.key === "A";
    const right = e.key === "ArrowRight" || e.key === "d" || e.key === "D";
    if (left || right) {
      e.preventDefault();
      if (!e.repeat) steer(left ? -1 : 1);
    } else if ((e.key === " " || e.key === "Enter") && run.status !== "running" && !e.repeat) {
      e.preventDefault();
      el<HTMLButtonElement>("ov-btn").click();
    }
  });
  // Swipe on the road (fires as soon as the finger has moved far enough), or tap its left or
  // right half. One lane per gesture.
  const road = el("road");
  const SWIPE_PX = 24;
  let x0 = 0;
  let down = false;
  let swiped = false;
  road.addEventListener("pointerdown", (e) => {
    x0 = e.clientX;
    down = true;
    swiped = false;
  });
  road.addEventListener("pointermove", (e) => {
    if (!down || swiped) return;
    const dx = e.clientX - x0;
    if (Math.abs(dx) >= SWIPE_PX) {
      swiped = true;
      steer(dx < 0 ? -1 : 1);
    }
  });
  road.addEventListener("pointerup", (e) => {
    if (down && !swiped) {
      const r = road.getBoundingClientRect();
      steer(e.clientX < r.left + r.width / 2 ? -1 : 1);
    }
    down = false;
  });
  road.addEventListener("pointercancel", () => (down = false));
  // Re-fit whenever the road's box changes (rotation, resize, or the panels above it reflowing).
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => run && layout()).observe(road);
  else window.addEventListener("resize", layout);
}

// ---------- loading ----------

function loadSample(n: number): void {
  if (run?.status === "running") sendEvent("quit");
  const i = Number.isInteger(n) && n >= 1 && n <= SAMPLES.length ? n : 1;
  load(SAMPLES[i - 1]!, null, i);
}

function decodeBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)));
}

function checked(level: unknown): Level {
  const v = validateLevel(level);
  if (!v.ok) throw new Error(v.errors[0]);
  return level as Level;
}

async function fetchLevel(id: string): Promise<Level> {
  const res = await fetch(`${API}/levels/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`the platform answered ${res.status}`);
  const body = (await res.json()) as { game_id?: string; level?: unknown };
  if (body.game_id && body.game_id !== GAME_ID) throw new Error(`that level belongs to ${body.game_id}`);
  return checked(body.level ?? body);
}

function startAutoplay(): void {
  run.autoplay = solveLevel(run.level).inputs;
  begin();
}

async function boot(): Promise<void> {
  bindInput();
  el("restart").addEventListener("click", restart);
  el("pause").addEventListener("click", pause);
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
  const id = params.get("level");
  const data = params.get("data");
  let loaded = false;
  if (id) {
    try {
      load(await fetchLevel(id), UUID_RE.test(id) ? id : null, null);
      loaded = true;
    } catch (e) {
      notice(`Couldn't load level ${id} (${e instanceof Error ? e.message : String(e)}). Playing a practice track instead.`);
    }
  } else if (data) {
    try {
      load(checked(JSON.parse(decodeBase64Url(data))), null, null);
      loaded = true;
    } catch (e) {
      notice(`That level link is broken (${e instanceof Error ? e.message : String(e)}). Playing a practice track instead.`);
    }
  }
  if (!loaded) loadSample(Number(params.get("sample") ?? 1));
  if (params.get("autoplay") === "1") startAutoplay();
  requestAnimationFrame(frame);
}

window.addEventListener("pagehide", () => {
  if (run?.status === "running") sendEvent("quit", true);
});

// Hooks for scripted browser checks (Playwright/CDP playtests).
declare global {
  interface Window {
    turboLanes: {
      state(): { row: number; lane: number; tick: number; status: Status; coins: number; crashes: number; time_limit: number; level_id: string | null };
      start(): void;
      steer(dir: -1 | 1): void;
      restart(): void;
      autoplay(): void;
    };
  }
}
window.turboLanes = {
  state: () => ({
    row: run.state.row, lane: run.state.lane, tick: run.state.tick, status: run.status,
    coins: run.coins, crashes: run.crashes, time_limit: run.level.time_limit, level_id: run.levelId,
  }),
  start: () => (run.status === "ready" ? begin() : undefined),
  steer,
  restart,
  autoplay: () => {
    if (run.status !== "ready") load(run.level, run.levelId, run.sample);
    startAutoplay();
  },
};

void boot();
