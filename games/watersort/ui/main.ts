// Splash Sort in the browser. Uses the same rules module as the solver and the bots.
//   ?level=<id>   play a level saved on the platform (sends player events)
//   ?sample=<n>   play a built-in practice level (no events)
//   ?data=<b64>   play a level given inline as base64url JSON (no events)
//   ?autoplay=1   pour the solver's shortest solution by itself (for phone playtests and demos)
//   ?api=<url>    override the platform URL
// Keyboard: 1-9 pick tubes 1-9, 0 picks tube 10, - picks tube 11, arrows move between tubes,
// Esc cancels a selection, U or Ctrl/Cmd+Z undoes, R restarts.
import {
  applyPour, canPourFrom, COLORS, type Color, isComplete, isSolved, isStuck, type Level, pourAmount, pourBlock,
  toTubes, top, type Tubes, validateLevel,
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

/** Undos per attempt. Like hints, an assist: bot measurements describe play without them. */
const UNDOS = 3;
const DEFAULT_HINT = "Tap a tube, then tap the tube to pour into.";

interface LastPour {
  from: number;
  to: number;
  amount: number;
  color: number;
}

interface Game {
  level: Level;
  levelId: string | null; // set only for platform levels; practice plays are not reported
  sample: number | null;
  tubes: Tubes;
  moves: number;
  selected: number | null;
  status: Status;
  startedAt: number;
  lastPour: LastPour | null; // drives the pour animation for one render
  history: Tubes[];          // positions before each pour, for undo
  undos: number;
  stuck: boolean;            // no legal pour left, but an undo is still available
  hints: number;
  hintPair: [number, number] | null;
}

let game: Game;
let colorLabels = false;
try { colorLabels = localStorage.getItem("splash-sort-color-labels") === "true"; } catch { /* Storage can be unavailable in private browsers. */ }

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

function setHint(text: string): void {
  el("hint").textContent = text;
}

function start(level: Level, levelId: string | null, sample: number | null): void {
  window.clearInterval(autoTimer);
  setHint(DEFAULT_HINT);
  game = {
    level, levelId, sample,
    tubes: toTubes(level),
    moves: 0,
    selected: null,
    status: "playing",
    startedAt: Date.now(),
    lastPour: null,
    history: [],
    undos: UNDOS,
    stuck: false,
    hints: 3,
    hintPair: null,
  };
  el("title").textContent = level.title ?? (sample ? `Practice ${sample}` : "Level");
  el("overlay").classList.add("hidden");
  renderSamples();
  render();
  sendEvent("attempt");
}

/** Leaving an attempt that's still open: a stuck board counts as a loss, as it does for the bots. */
function leaveAttempt(beacon = false): void {
  if (game?.status === "playing") sendEvent(game.stuck ? "loss" : "quit", beacon);
}

function restart(): void {
  leaveAttempt();
  start(game.level, game.levelId, game.sample);
}

const colorName = (c: number): string => COLORS[c] ?? "that color";

function tap(i: number): void {
  if (game.status !== "playing") return;
  const cap = game.level.capacity;
  const tube = game.tubes[i];
  if (!tube) return;
  game.hintPair = null;
  game.lastPour = null;

  if (game.stuck) {
    setHint("No pours left. Undo a pour or restart.");
    render();
    return shake(i);
  }
  if (game.selected === null) {
    if (!canPourFrom(game.tubes, cap, i)) {
      setHint(tube.length ? `Tube ${i + 1} is finished.` : `Tube ${i + 1} is empty. Pick a tube with liquid.`);
      render();
      return shake(i);
    }
    game.selected = i;
    setHint(`Tube ${i + 1} picked. Now tap the tube to pour into.`);
    return render();
  }
  if (game.selected === i) {
    game.selected = null;
    setHint(DEFAULT_HINT);
    return render();
  }
  const from = game.selected;
  const block = pourBlock(game.tubes, cap, from, i);
  if (block) {
    const why = block === "full-target"
      ? `Tube ${i + 1} is full.`
      : block === "color-mismatch"
        ? `${colorName(top(game.tubes[from]!))} can't go on ${colorName(top(tube))}.`
        : `Can't pour into tube ${i + 1}.`;
    // Not a legal pour: pick the tapped tube instead if it can be poured from, as players expect.
    if (canPourFrom(game.tubes, cap, i)) {
      game.selected = i;
      setHint(`${why} Picked tube ${i + 1} instead.`);
      return render();
    }
    game.selected = null;
    setHint(why);
    render();
    return shake(i);
  }
  const amount = pourAmount(game.tubes, cap, from, i);
  game.lastPour = { from, to: i, amount, color: top(game.tubes[from]!) };
  game.history.push(game.tubes);
  game.tubes = applyPour(game.tubes, from, i, amount);
  game.moves++;
  game.selected = null;
  setHint(DEFAULT_HINT);

  if (isSolved(game.tubes, cap)) return finish("won");
  if (game.moves >= game.level.move_limit) return finish("lost", "Out of pours", "So close. Try a different order.");
  if (isStuck(game.tubes, cap)) {
    if (game.undos > 0 && game.history.length) {
      game.stuck = true;
      setHint("No pours left. Undo a pour or restart.");
    } else {
      return finish("lost", "No pours left", "Every tube is blocked. Try again.");
    }
  }
  render();
}

/** Take back the last pour: the board and the pour count go back one step. */
function undo(): void {
  if (game.status !== "playing" || game.undos === 0 || !game.history.length) return;
  game.tubes = game.history.pop()!;
  game.moves--;
  game.undos--;
  game.selected = null;
  game.stuck = false;
  game.lastPour = null;
  game.hintPair = null;
  setHint(game.undos ? DEFAULT_HINT : "That was your last undo.");
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
  window.setTimeout(() => {
    if (game !== completedGame) return;
    ov.classList.remove("hidden");
    el("ov-btn").focus();
  }, status === "won" ? 650 : 450);
}

function setButton(label: string, action: () => void): void {
  const b = el<HTMLButtonElement>("ov-btn");
  b.textContent = label;
  b.onclick = action;
}

function tubeButton(i: number): HTMLElement | null {
  return el("board").querySelector<HTMLElement>(`.tube[data-index="${i}"]`);
}

function shake(i: number): void {
  const node = tubeButton(i);
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

/** Runs of one color, bottom to top: the liquid bands a tube is drawn with. */
function bands(t: number[]): Array<{ color: number; n: number }> {
  const out: Array<{ color: number; n: number }> = [];
  for (const c of t) {
    const last = out[out.length - 1];
    if (last && last.color === c) last.n++;
    else out.push({ color: c, n: 1 });
  }
  return out;
}

function liquid(color: number, n: number, fromN?: number): HTMLElement {
  const band = document.createElement("div");
  band.className = "liquid";
  const label = document.createElement("span");
  label.className = "color-code";
  label.textContent = COLORS[color]!.slice(0, 3).toUpperCase();
  label.setAttribute("aria-hidden", "true");
  band.appendChild(label);
  band.style.setProperty("--n", String(n));
  band.style.backgroundColor = HEX[COLORS[color]!];
  if (fromN !== undefined && fromN !== n) {
    band.style.setProperty("--from-n", String(fromN));
    band.classList.add("level");
  }
  return band;
}

/** Tubes per row: one row when they fit, otherwise two rows of nearly equal length. */
function columns(n: number): number {
  const wide = el("board").clientWidth >= 520;
  return n <= (wide ? 7 : 5) ? n : Math.ceil(n / 2);
}

function render(): void {
  document.documentElement.classList.toggle("color-labels", colorLabels);
  el("color-labels").setAttribute("aria-pressed", String(colorLabels));
  const cap = game.level.capacity;
  const board = el("board");
  const focused = (document.activeElement as HTMLElement | null)?.dataset?.index;
  const pour = game.lastPour;
  const rack = document.createElement("div");
  rack.className = "rack";
  rack.style.setProperty("--cols", String(columns(game.tubes.length)));
  rack.style.setProperty("--cap", String(cap));
  rack.append(
    ...game.tubes.map((t, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tube";
      if (game.hintPair?.includes(i)) btn.classList.add("hinted");
      if (game.selected !== null && pourAmount(game.tubes, cap, game.selected, i) > 0) btn.classList.add("available");
      if (game.selected === i) btn.classList.add("selected");
      if (isComplete(t, cap)) btn.classList.add("done");
      btn.setAttribute("aria-label", tubeLabel(t, i, cap));
      btn.setAttribute("aria-pressed", String(game.selected === i));
      btn.dataset.index = String(i);
      const glass = document.createElement("div");
      glass.className = "glass";
      const runs = bands(t);
      runs.forEach((b, k) => {
        const isTop = k === runs.length - 1;
        // Animate the level of the band the last pour changed.
        let fromN: number | undefined;
        if (pour && isTop && i === pour.to) fromN = b.n - pour.amount;
        if (pour && isTop && i === pour.from && b.color === pour.color) fromN = b.n + pour.amount;
        glass.appendChild(liquid(b.color, b.n, fromN));
      });
      if (pour && i === pour.from && (top(t) !== pour.color)) {
        glass.appendChild(liquid(pour.color, 0, pour.amount)); // the poured band draining away
      }
      if (pour && i === pour.to) {
        btn.classList.add("receiving");
        glass.style.setProperty("--stream", HEX[COLORS[pour.color]!]);
        glass.style.setProperty("--fill", String(t.length));
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
  board.replaceChildren(rack);
  if (pour) tilt(pour.from, pour.to);
  if (focused !== undefined) tubeButton(Number(focused))?.focus({ preventScroll: true });

  const complete = game.tubes.filter(t => isComplete(t, cap)).length;
  const total = new Set(game.level.tubes.flat()).size;
  el("objective").textContent = `${complete} / ${total} COLORS SORTED`;
  el("hints").textContent = String(game.hints);
  el<HTMLButtonElement>("hint-btn").disabled = game.hints === 0 || game.status !== "playing" || game.stuck;
  el("undos").textContent = String(game.undos);
  const undoBtn = el<HTMLButtonElement>("undo-btn");
  undoBtn.disabled = game.undos === 0 || !game.history.length || game.status !== "playing";
  undoBtn.classList.toggle("urge", game.stuck);
  const left = game.level.move_limit - game.moves;
  const pill = el("moves");
  pill.textContent = `Pours ${game.moves} / ${game.level.move_limit}`;
  pill.classList.toggle("low", left <= 3 && game.status === "playing");
  el("meter").style.width = `${Math.max(0, (left / game.level.move_limit) * 100)}%`;
}

/** Tip the source tube toward the tube it poured into. */
function tilt(from: number, to: number): void {
  const a = tubeButton(from);
  const b = tubeButton(to);
  if (!a || !b) return;
  const dir = b.getBoundingClientRect().left >= a.getBoundingClientRect().left ? 1 : -1;
  a.style.setProperty("--tilt", `${dir * 24}deg`);
  a.classList.add("pouring");
}

function renderSamples(): void {
  const nav = el("samples");
  el("collection-label").classList.toggle("hidden", game.levelId !== null);
  if (game.levelId) {
    nav.replaceChildren();
    return;
  }
  nav.replaceChildren(
    ...SAMPLES.map((s, n) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn ghost";
      const number = document.createElement("span");
      number.className = "sample-number";
      number.textContent = String(n + 1).padStart(2, "0");
      const title = document.createElement("strong");
      title.textContent = s.title ?? `Level ${n + 1}`;
      const detail = document.createElement("small");
      detail.textContent = `${new Set(s.tubes.flat()).size} colors · ${s.move_limit} pours`;
      b.append(number, title, detail);
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
  leaveAttempt();
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

function moveFocus(step: number): void {
  const n = game.tubes.length;
  const current = Number((document.activeElement as HTMLElement | null)?.dataset?.index ?? (step > 0 ? -1 : n));
  tubeButton((((current + step) % n) + n) % n)?.focus();
}

function onKey(e: KeyboardEvent): void {
  if (!el("overlay").classList.contains("hidden")) return;
  const k = e.key;
  if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === "z") {
    e.preventDefault();
    return undo();
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const digit = "1234567890-".indexOf(k);
  if (digit >= 0 && digit < game.tubes.length) {
    e.preventDefault();
    tap(digit);
    tubeButton(digit)?.focus({ preventScroll: true });
  } else if (k === "ArrowRight" || k === "ArrowDown") {
    e.preventDefault();
    moveFocus(1);
  } else if (k === "ArrowLeft" || k === "ArrowUp") {
    e.preventDefault();
    moveFocus(-1);
  } else if (k === "Escape" && game.selected !== null) {
    game.selected = null;
    setHint(DEFAULT_HINT);
    render();
  } else if (k === "u" || k === "U" || k === "Backspace") {
    e.preventDefault();
    undo();
  } else if (k === "r" || k === "R") {
    window.clearInterval(autoTimer);
    restart();
  }
}

let lastCols = 0;
function onResize(): void {
  if (!game) return;
  const cols = columns(game.tubes.length);
  if (cols !== lastCols) render();
  lastCols = cols;
}

async function boot(): Promise<void> {
  el("color-labels").addEventListener("click", () => {
    colorLabels = !colorLabels;
    try { localStorage.setItem("splash-sort-color-labels", String(colorLabels)); } catch { /* Keep the preference for this page. */ }
    game.lastPour = null;
    render();
  });
  el("hint-btn").addEventListener("click", revealHint);
  el("undo-btn").addEventListener("click", undo);
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", onResize);
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

window.addEventListener("pagehide", () => leaveAttempt(true));

// Hooks for scripted browser checks (Playwright/CDP playtests). Read-only state plus the same
// actions a player has.
declare global {
  interface Window {
    splashSort: {
      state(): {
        tubes: string[][]; moves: number; move_limit: number; status: Status; level_id: string | null;
        stuck: boolean; undos_left: number;
      };
      tap(i: number): void;
      pour(from: number, to: number): void;
      undo(): void;
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
    stuck: game.stuck,
    undos_left: game.undos,
  }),
  tap,
  pour: (from, to) => {
    game.selected = null;
    tap(from);
    tap(to);
  },
  undo,
  restart,
  autoplay,
};

void boot();
