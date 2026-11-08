// Turbo Lanes in the browser. The rules run in fixed ticks with the same step() the solver and the
// bots use; the screen only interpolates between ticks so it scrolls smoothly.
//   ?level=<id>   play a level saved on the platform (sends player events)
//   ?sample=<n>   play a built-in practice track (no events)
//   ?data=<b64>   play a track given inline as base64url JSON (no events)
//   ?autoplay=1   drive the solver's fastest run by itself (for phone playtests and demos)
//   ?api=<url>    override the platform URL
import {
  type Action, buildGrid, canSteer, type CarState, finished, type Grid, isObstacle, type Level, startState, step, validateLevel,
} from "../src/engine.js";
import { SAMPLES } from "../src/levels.js";
import { solveLevel } from "../src/solver.js";

declare const __PLATFORM_URL__: string;

const GAME_ID = "racer";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VISIBLE_ROWS = 12;
const CAR_OFFSET = 1.95; // rows between the bottom of the road and the car's middle
const QUEUE_TICKS = 3;   // a steer pressed during a cooldown waits this many ticks at most

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
  coins: number;
  crashes: number;
  queue: Array<{ dir: Action; at: number }>;
  autoplay: Action[] | null;
  acc: number;
  last: number;
  startedAt: number;
}

let run: Run;
let ROW = 40;
let LANE = 80;
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
    coins: 0, crashes: 0,
    queue: [],
    autoplay: null,
    acc: 0, last: 0, startedAt: 0,
  };
  buildWorld();
  renderSamples();
  hud();
  draw(1);
  const secs = (level.time_limit / level.speed).toFixed(1);
  showOverlay(level.title ?? (sample ? `Track ${sample}` : "Turbo Lanes"), `Cross the finish line in ${secs}s. Dodge cars and cones, grab boosts.`, "", "Start", begin);
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
  for (const o of level.objects) {
    const n = document.createElement("div");
    n.className = `obj ${o.kind}${o.kind === "car" && (o.row + o.lane) % 3 === 0 ? " alt" : ""}`;
    n.dataset.row = String(o.row);
    n.dataset.lane = String(o.lane);
    n.appendChild(document.createElement("i"));
    world.appendChild(n);
    nodes.set(o.row * 8 + o.lane, n);
  }
  layout();
}

function layout(): void {
  const road = el("road");
  ROW = road.clientHeight / VISIBLE_ROWS;
  LANE = road.clientWidth / run.level.lanes;
  const root = document.documentElement.style;
  root.setProperty("--row", `${ROW}px`);
  root.setProperty("--lane", `${LANE}px`);
  const world = el("world");
  for (const child of Array.from(world.children) as HTMLElement[]) {
    if (child.classList.contains("lane-line")) {
      child.style.left = `${Number(child.dataset.k) * LANE}px`;
      child.style.height = `${(run.level.length + VISIBLE_ROWS) * ROW}px`;
    } else if (child.classList.contains("finish")) {
      child.style.bottom = `${run.level.length * ROW}px`;
    } else {
      child.style.left = `${Number(child.dataset.lane) * LANE}px`;
      child.style.bottom = `${Number(child.dataset.row) * ROW}px`;
    }
  }
  draw(1);
}

// ---------- the run ----------

function begin(): void {
  el("overlay").classList.add("hidden");
  run.status = "running";
  run.last = performance.now();
  run.acc = 0;
  run.startedAt = Date.now();
  sendEvent("attempt");
}

function restart(): void {
  if (run.status === "running") sendEvent("quit");
  load(run.level, run.levelId, run.sample);
}

function steer(dir: Action): void {
  if (run.status !== "running" || run.autoplay || dir === 0) return;
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
  // Hide what the car just collected or smashed (the same cells step() looked at).
  for (let r = prev.row + 1; r <= Math.min(next.row, run.level.length - 1); r++) {
    const kind = run.grid.get(r * 8 + next.lane);
    const node = nodes.get(r * 8 + next.lane);
    if (node && (kind === "coin" || (isObstacle(kind) && ev.crashed && r === next.row))) node.classList.add("gone");
  }
  run.prev = prev;
  run.state = next;
  run.coins += ev.coins;
  if (ev.crashed) {
    run.crashes++;
    flash("crash", `−${(run.level.crash_penalty / run.level.speed).toFixed(1)}s`, "#ff5a7a");
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
  if (run?.status === "running") {
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

function draw(alpha: number): void {
  const { prev, state } = run;
  const row = prev.row + (Math.min(state.row, run.level.length + 1) - prev.row) * alpha;
  const lane = prev.lane + (state.lane - prev.lane) * Math.min(1, alpha * 2.2);
  el("world").style.transform = `translate3d(0, ${(row - CAR_OFFSET) * ROW}px, 0)`;
  const car = el("car");
  car.style.transform = `translate3d(${(lane + 0.5) * LANE}px, 0, 0)`;
  car.classList.toggle("left", state.lane < prev.lane && alpha < 1);
  car.classList.toggle("right", state.lane > prev.lane && alpha < 1);
  car.classList.toggle("stunned", state.stun > 0);
  el("road").classList.toggle("boost", state.boost > 0 && run.status === "running");
}

function hud(): void {
  const left = Math.max(0, (run.level.time_limit - run.state.tick) / run.level.speed);
  el("time").textContent = left.toFixed(1);
  el("time").parentElement!.classList.toggle("low", left < 3 && run.status === "running");
  el("coins").textContent = String(run.coins);
  el("progress").style.width = `${Math.min(100, (run.state.row / run.level.length) * 100)}%`;
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
}

function renderSamples(): void {
  const nav = el("samples");
  if (run.levelId) return void nav.replaceChildren();
  nav.replaceChildren(
    ...SAMPLES.map((s, n) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = String(n + 1);
      b.setAttribute("aria-label", `Practice track ${n + 1}: ${s.title ?? ""}`);
      if (run.sample === n + 1) b.setAttribute("aria-current", "true");
      b.addEventListener("click", () => {
        if (run.status === "running") sendEvent("quit");
        loadSample(n + 1);
      });
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
  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") steer(-1);
    else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") steer(1);
    else if ((e.key === " " || e.key === "Enter") && run.status !== "running") el<HTMLButtonElement>("ov-btn").click();
  });
  // Swipe on the road, or tap its left/right half.
  const road = el("road");
  let x0 = 0;
  road.addEventListener("pointerdown", (e) => (x0 = e.clientX));
  road.addEventListener("pointerup", (e) => {
    const dx = e.clientX - x0;
    if (Math.abs(dx) > 28) steer(dx < 0 ? -1 : 1);
    else {
      const r = road.getBoundingClientRect();
      steer(e.clientX < r.left + r.width / 2 ? -1 : 1);
    }
  });
  window.addEventListener("resize", layout);
}

// ---------- loading ----------

function loadSample(n: number): void {
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
