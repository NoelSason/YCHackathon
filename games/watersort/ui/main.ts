// Splash Sort in the browser. Uses the same rules module as the solver and the bots.
//   ?level=<id>   play a level saved on the platform (sends player events)
//   ?sample=<n>   play a built-in practice level (no events)
//   ?data=<b64>   play a level given inline as base64url JSON (no events)
//   ?autoplay=1   pour the solver's shortest solution by itself (for phone playtests and demos)
//   ?api=<url>    override the platform URL
import {
  applyPour, COLORS, type Color, isComplete, isSolved, type Level, pourAmount, toTubes, type Tubes, validateLevel,
} from "../src/engine.js";
import { SAMPLES } from "../src/levels.js";
import { solveLevel } from "../src/solver.js";

declare const __PLATFORM_URL__: string;

const GAME_ID = "watersort";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HEX: Record<Color, string> = {
  red: "#ff4d6d", orange: "#ff9f1c", yellow: "#ffd60a", lime: "#a3e635", green: "#22c55e", teal: "#14b8a6",
  sky: "#38bdf8", blue: "#3b6cff", purple: "#9b5cff", pink: "#f472b6", brown: "#b07a3c", gray: "#9aa7bd",
};

const params = new URLSearchParams(location.search);
const API = (params.get("api") ?? __PLATFORM_URL__).replace(/\/+$/, "");
const SESSION = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2);

type Status = "playing" | "won" | "lost";
interface Game {
  level: Level;
  levelId: string | null; // set only for platform levels; practice plays are not reported
  sample: number | null;
  tubes: Tubes;
  moves: number;
  selected: number | null;
  status: Status;
  startedAt: number;
  fresh: Set<string>; // slots filled by the last pour, for the fill animation
  splash: number | null;
  hints: number;
  hintPair: [number, number] | null;
}

let game: Game;

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- player events (platform/CONTRACTS.md §1) ----------

function sendEvent(type: "attempt" | "win" | "loss" | "quit", beacon = false): void {
  if (!game.levelId) return;
  const body = JSON.stringify({
    game_id: GAME_ID,
    level_id: game.levelId,
    session_id: SESSION,
    type,
    ...(type === "attempt" ? {} : { moves_used: game.moves, time_seconds: Math.round((Date.now() - game.startedAt) / 100) / 10 }),
  });
  // text/plain keeps this a simple request (no CORS preflight); the platform parses the JSON body.
  const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
  if (beacon && navigator.sendBeacon?.(`${API}/events`, blob)) return;
  fetch(`${API}/events`, { method: "POST", body: blob, keepalive: true }).catch(() => undefined);
}

// ---------- game flow ----------

function start(level: Level, levelId: string | null, sample: number | null): void {
  window.clearInterval(autoTimer);
  el("hint").textContent = "Tap a tube, then tap the tube to pour into.";
  game = {
    level, levelId, sample,
    tubes: toTubes(level),
    moves: 0,
    selected: null,
    status: "playing",
    startedAt: Date.now(),
    fresh: new Set(),
    splash: null,
    hints: 3,
    hintPair: null,
  };
  el("title").textContent = level.title ?? (sample ? `Practice ${sample}` : "Level");
  el("overlay").classList.add("hidden");
  renderSamples();
  render();
  sendEvent("attempt");
}

function restart(): void {
  if (game.status === "playing") sendEvent("quit");
  start(game.level, game.levelId, game.sample);
}

function anyPour(tubes: Tubes, cap: number): boolean {
  for (let a = 0; a < tubes.length; a++) for (let b = 0; b < tubes.length; b++) if (pourAmount(tubes, cap, a, b) > 0) return true;
  return false;
}

function tap(i: number): void {
  if (game.status !== "playing") return;
  const cap = game.level.capacity;
  const tube = game.tubes[i];
  if (!tube) return;
  game.hintPair = null;
  game.fresh = new Set();
  game.splash = null;

  if (game.selected === null) {
    if (!tube.length || isComplete(tube, cap)) return shake(i);
    game.selected = i;
    return render();
  }
  if (game.selected === i) {
    game.selected = null;
    return render();
  }
  const from = game.selected;
  const amount = pourAmount(game.tubes, cap, from, i);
  if (amount === 0) {
    // Not a legal pour: pick the tapped tube instead if it can be poured from.
    if (tube.length && !isComplete(tube, cap)) game.selected = i;
    render();
    return shake(i);
  }
  const before = game.tubes[i]!.length;
  game.tubes = applyPour(game.tubes, from, i, amount);
  for (let k = 0; k < amount; k++) game.fresh.add(`${i}:${before + k}`);
  game.splash = i;
  game.moves++;
  game.selected = null;

  if (isSolved(game.tubes, cap)) return finish("won");
  if (game.moves >= game.level.move_limit) return finish("lost", "Out of pours", "So close. Try a different order.");
  if (!anyPour(game.tubes, cap)) return finish("lost", "No pours left", "Every tube is blocked. Try again.");
  render();
}

function finish(status: "won" | "lost", title?: string, text?: string): void {
  game.status = status;
  render();
  sendEvent(status === "won" ? "win" : "loss");
  const secs = Math.round((Date.now() - game.startedAt) / 1000);
  const ov = el("overlay");
  ov.classList.toggle("lose", status === "lost");
  if (status === "won") {
    const left = (game.level.move_limit - game.moves) / game.level.move_limit;
    const stars = left >= 0.3 ? 3 : left >= 0.12 ? 2 : 1;
    el("ov-title").textContent = "Sorted!";
    el("ov-text").textContent = `${game.moves} pours · ${secs}s`;
    el("ov-stars").innerHTML = [1, 2, 3].map((n) => `<span class="${n <= stars ? "" : "off"}">★</span>`).join("");
    const next = game.sample !== null && game.sample < SAMPLES.length ? game.sample + 1 : null;
    setButton(next ? "Next level" : "Play again", () => (next ? startSample(next) : restart()));
  } else {
    el("ov-title").textContent = title ?? "Try again";
    el("ov-text").textContent = text ?? "";
    el("ov-stars").innerHTML = "";
    setButton("Try again", restart);
  }
  const completedGame = game;
  window.setTimeout(() => { if (game === completedGame) ov.classList.remove("hidden"); }, status === "won" ? 450 : 250);
}

function setButton(label: string, action: () => void): void {
  const b = el<HTMLButtonElement>("ov-btn");
  b.textContent = label;
  b.onclick = action;
}

function shake(i: number): void {
  const node = el("board").children[i];
  if (!node) return;
  node.classList.remove("shake");
  void (node as HTMLElement).offsetWidth; // restart the animation
  node.classList.add("shake");
}

// ---------- rendering ----------

function tubeLabel(t: number[], i: number, cap: number): string {
  if (!t.length) return `Tube ${i + 1}: empty`;
  const names = t.map((c) => COLORS[c]!);
  const free = cap - t.length;
  return `Tube ${i + 1}: ${names.join(", ")} from bottom to top, ${names[names.length - 1]} on top, ${free} free`;
}

function render(): void {
  const cap = game.level.capacity;
  const board = el("board");
  board.replaceChildren(
    ...game.tubes.map((t, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tube";
      if (game.hintPair?.includes(i)) btn.classList.add("hinted");
      if (game.selected !== null && pourAmount(game.tubes, cap, game.selected, i) > 0) btn.classList.add("available");
      if (game.selected === i) btn.classList.add("selected");
      if (isComplete(t, cap)) btn.classList.add("done");
      if (game.splash === i) btn.classList.add("splash");
      btn.setAttribute("aria-label", tubeLabel(t, i, cap));
      btn.setAttribute("aria-pressed", String(game.selected === i));
      btn.dataset.index = String(i);
      const glass = document.createElement("div");
      glass.className = "glass";
      for (let k = 0; k < cap; k++) {
        const slot = document.createElement("div");
        slot.className = "slot";
        const c = t[k];
        if (c !== undefined) {
          slot.classList.add("filled");
          slot.style.backgroundColor = HEX[COLORS[c]!];
          if (game.fresh.has(`${i}:${k}`)) slot.classList.add("new");
        }
        glass.appendChild(slot);
      }
      btn.appendChild(glass);
      const label = document.createElement("span");
      label.className = "tube-number";
      label.textContent = isComplete(t, cap) ? "✓" : String(i + 1).padStart(2, "0");
      btn.appendChild(label);
      btn.addEventListener("click", () => tap(i));
      return btn;
    }),
  );
  const complete = game.tubes.filter(t => isComplete(t, cap)).length;
  const total = new Set(game.level.tubes.flat()).size;
  el("objective").textContent = `${complete} / ${total} COLORS SORTED`;
  el("hints").textContent = String(game.hints);
  el<HTMLButtonElement>("hint-btn").disabled = game.hints === 0 || game.status !== "playing";
  const left = game.level.move_limit - game.moves;
  const pill = el("moves");
  pill.textContent = `Pours ${game.moves} / ${game.level.move_limit}`;
  pill.classList.toggle("low", left <= 3 && game.status === "playing");
  el("meter").style.width = `${Math.max(0, (left / game.level.move_limit) * 100)}%`;
}

function renderSamples(): void {
  const nav = el("samples");
  if (game.levelId) {
    nav.replaceChildren();
    return;
  }
  nav.replaceChildren(
    ...SAMPLES.map((s, n) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn ghost";
      b.textContent = String(n + 1);
      b.setAttribute("aria-label", `Practice level ${n + 1}: ${s.title ?? ""}`);
      if (game.sample === n + 1) b.setAttribute("aria-current", "true");
      b.addEventListener("click", () => startSample(n + 1));
      return b;
    }),
  );
}

function notice(text: string): void {
  const n = el("notice");
  n.textContent = text;
  n.classList.remove("hidden");
}

// ---------- loading ----------

function startSample(n: number): void {
  window.clearInterval(autoTimer);
  if (game?.status === "playing") sendEvent("quit");
  const i = Number.isInteger(n) && n >= 1 && n <= SAMPLES.length ? n : 1;
  start(SAMPLES[i - 1]!, null, i);
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

let autoTimer: number | undefined;

/** Pour the solver's shortest solution, one pour at a time, so a phone or a screen can show it. */
function autoplay(): void {
  window.clearInterval(autoTimer);
  if (game.status !== "playing" || game.moves > 0) start(game.level, game.levelId, game.sample);
  let inputs: Array<[number, number]> | undefined;
  try {
    inputs = solveLevel(game.level).inputs;
  } catch (e) {
    return notice(`Autoplay stopped: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!inputs) return notice("Autoplay: this level has no solution.");
  const replayGame = game;
  let k = 0;
  autoTimer = window.setInterval(() => {
    const pourStep = inputs![k++];
    if (game.status !== "playing" || !pourStep) return window.clearInterval(autoTimer);
    game.selected = null;
    tap(pourStep[0]);
    window.setTimeout(() => { if (game === replayGame && game.status === "playing") tap(pourStep[1]); }, 260);
  }, 700);
}

function revealHint(): void {
  if (game.status !== "playing" || game.hints === 0) return;
  try {
    const result = solveLevel({ ...game.level, tubes: game.tubes.map(t => t.map(c => COLORS[c]!)) }, 50000);
    const pair = result.inputs?.[0];
    if (!pair) return notice("No solution from here. Restart to try a different route.");
    game.hints--;
    game.hintPair = pair;
    game.selected = null;
    render();
    el("hint").textContent = `Pour tube ${pair[0] + 1} into tube ${pair[1] + 1}.`;
  } catch {
    notice("This position needs a deeper search. No hint was used.");
  }
}

async function boot(): Promise<void> {
  el("hint-btn").addEventListener("click", revealHint);
  el("restart").addEventListener("click", () => {
    window.clearInterval(autoTimer);
    restart();
  });
  const id = params.get("level");
  const data = params.get("data");
  let loaded = false;
  if (id) {
    try {
      start(await fetchLevel(id), UUID_RE.test(id) ? id : null, null);
      loaded = true;
    } catch (e) {
      notice(`Couldn't load level ${id} (${e instanceof Error ? e.message : String(e)}). Playing a practice level instead.`);
    }
  } else if (data) {
    try {
      start(checked(JSON.parse(decodeBase64Url(data))), null, null);
      loaded = true;
    } catch (e) {
      notice(`That level link is broken (${e instanceof Error ? e.message : String(e)}). Playing a practice level instead.`);
    }
  }
  if (!loaded) startSample(Number(params.get("sample") ?? 1));
  if (params.get("autoplay") === "1") autoplay();
}

window.addEventListener("pagehide", () => {
  if (game?.status === "playing") sendEvent("quit", true);
});

// Hooks for scripted browser checks (Playwright/CDP playtests). Read-only state plus the same
// actions a player has.
declare global {
  interface Window {
    splashSort: {
      state(): { tubes: string[][]; moves: number; move_limit: number; status: Status; level_id: string | null };
      tap(i: number): void;
      pour(from: number, to: number): void;
      restart(): void;
      autoplay(): void;
    };
  }
}
window.splashSort = {
  state: () => ({
    tubes: game.tubes.map((t) => t.map((c) => COLORS[c]!)),
    moves: game.moves,
    move_limit: game.level.move_limit,
    status: game.status,
    level_id: game.levelId,
  }),
  tap,
  pour: (from, to) => {
    game.selected = null;
    tap(from);
    tap(to);
  },
  restart,
  autoplay,
};

void boot();
