import { advanceTicks, applyAction, createGame, legalActions, statusOf } from "../../games/match3/engine/houseki-gem-swap/gem-swap/engine.js";
import type { Action } from "../../games/match3/engine/houseki-gem-swap/gem-swap/types-actions.js";
import type { GameState } from "../../games/match3/engine/houseki-gem-swap/gem-swap/types-state.js";
import type { Gem, GemColour } from "../../games/match3/engine/houseki-gem-swap/gem-swap/types-pieces.js";
import { toCreateOptions } from "./level.js";
import { loadPlaylist, NotFound, type Playlist, type PublicLevel } from "./api.js";
import { Attempt } from "./events.js";
import { rememberWin, seriesPosition } from "./series.js";

/**
 * The public match-3 player (site/play.html). The game runs entirely in this tab: the engine in
 * games/match3/engine plays the level the Solver measured, with a fresh board seed per attempt.
 */

const COLOUR_NAMES: Record<GemColour, string> = { red: "red", blue: "blue", green: "green", gold: "yellow", purple: "purple", teal: "teal" };
const TICK_MS = 26; // engine ticks are 60 Hz; slightly slower reads better on a phone
const SWAP_MS = 180; // one leg of a swap; matches the .gem transform transition in play.css
const SHUFFLE_MS = 450;
const HINT_MS = 9000; // idle time before the board points out a possible swap
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const main = $("main");
const eventsUrl = main.dataset.eventsUrl || null;
const shell = $("play-shell");
const empty = $("play-empty");
const boardEl = $("board");
const slotsEl = $("slots");
const sealsEl = $("seals");
const gemsEl = $("gems");
const ringEl = $("ring");
const resultEl = $("result");
const msgEl = $("msg");

let playlist: Playlist = { title: null, levels: [] };
let mode: "level" | "pack" | "latest" = "latest";
let index = 0;
let level: PublicLevel | null = null;
let state: GameState | null = null;
let attempt: Attempt | null = null;
let busy = false;
let ended = false;
let selected = -1;
let cursor = -1;
let timer = 0;
let lastSeals = "";
let hintTimer = 0;
const gems = new Map<number, HTMLElement>();

// ---------- helpers ----------

const W = () => state!.settings.width;
const H = () => state!.settings.height;
const tr = (x: number, y: number) => `translate(${x * 100}%, ${y * 100}%)`;
const pct = (r: number) => Math.round(r * 100);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const active = (i: number) => !!state && i >= 0 && i < state.board.length && state.settings.mask[i] === true && state.board[i] !== null;

function say(text: string) {
  msgEl.textContent = text;
}

function neighbour(i: number, dx: number, dy: number): number {
  const x = (i % W()) + dx;
  const y = Math.floor(i / W()) + dy;
  return x < 0 || y < 0 || x >= W() || y >= H() ? -1 : y * W() + x;
}

const adjacent = (a: number, b: number) =>
  [neighbour(a, 1, 0), neighbour(a, -1, 0), neighbour(a, 0, 1), neighbour(a, 0, -1)].includes(b);

/** Runs the engine until the board is stable. `shuffled` is true if it reshuffled a dead board. */
function settle(s: GameState): { state: GameState; shuffled: boolean } {
  let shuffled = false;
  for (let i = 0; i < 3600 && s.phase !== "ready" && s.phase !== "finished"; i++) {
    const t = advanceTicks(s, 1);
    shuffled ||= t.events.some((e) => e.type === "board-reshuffled");
    s = t.state;
  }
  return { state: s, shuffled };
}

const isSwap = (a: Action): a is Extract<Action, { kind: "swap" }> => a.kind === "swap";

function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]!;
}

function makeTile(kind: string, colour?: GemColour): HTMLElement {
  const el = document.createElement("div");
  el.className = kind;
  if (colour) el.dataset.k = colour;
  el.append(document.createElement("i"));
  return el;
}

// ---------- rendering ----------

function layoutBoard() {
  const s = state!;
  boardEl.style.setProperty("--w", String(W()));
  boardEl.style.setProperty("--h", String(H()));
  boardEl.parentElement?.style.setProperty("--ratio", String(W() / H()));
  boardEl.setAttribute("aria-label", `Game board, ${W()} by ${H()}. Use the arrow keys to move and Enter to pick two neighbors to swap.`);
  slotsEl.replaceChildren();
  s.settings.mask.forEach((on, i) => {
    if (!on) return;
    const slot = document.createElement("div");
    slot.className = "slot";
    slot.style.transform = tr(i % W(), Math.floor(i / W()));
    slotsEl.append(slot);
  });
  gemsEl.replaceChildren();
  gems.clear();
  lastSeals = "";
}

function renderSeals() {
  const s = state!;
  const key = JSON.stringify(s.seals);
  if (key === lastSeals) return;
  lastSeals = key;
  sealsEl.replaceChildren(
    ...s.seals.filter((seal) => seal.layers > 0).map((seal) => {
      const el = document.createElement("div");
      el.className = "seal";
      el.dataset.layers = String(seal.layers);
      el.style.transform = tr(seal.cell % W(), Math.floor(seal.cell / W()));
      if (seal.layers > 1) {
        const b = document.createElement("b");
        b.textContent = String(seal.layers);
        el.append(b);
      }
      return el;
    }),
  );
}

function render(initial = false) {
  const s = state!;
  const shown: readonly (Gem | null)[] = s.phase === "gravity" && s.gravityBoard ? s.gravityBoard : s.board;
  const marked = s.phase === "clear-mark" ? new Set(s.pendingCells) : new Set<number>();
  const seen = new Set<number>();
  const fresh: Array<{ el: HTMLElement; x: number; y: number }> = [];
  const newPerColumn = new Map<number, number>();

  shown.forEach((g, i) => {
    if (!g) return;
    seen.add(g.id);
    const x = i % W();
    const y = Math.floor(i / W());
    let el = gems.get(g.id);
    if (!el) {
      el = makeTile("gem", g.colour);
      gems.set(g.id, el);
      gemsEl.append(el);
      if (!initial && !reduceMotion) {
        newPerColumn.set(x, (newPerColumn.get(x) ?? 0) + 1);
        fresh.push({ el, x, y });
      }
    }
    el.dataset.k = g.colour;
    if (g.kind) el.dataset.s = g.kind;
    else delete el.dataset.s;
    el.classList.toggle("marked", marked.has(i));
    el.classList.toggle("sel", i === selected);
    const t = tr(x, y);
    if (el.dataset.t !== t) {
      el.style.transform = t;
      el.dataset.t = t;
    }
  });

  // New gems slide in from above their column, as far as the gap they fill.
  for (const f of fresh) {
    const drop = newPerColumn.get(f.x) ?? 1;
    f.el.classList.add("still");
    f.el.style.transform = tr(f.x, f.y - drop);
    void f.el.offsetWidth;
    f.el.classList.remove("still");
    f.el.style.transform = tr(f.x, f.y);
  }

  for (const [id, el] of gems) {
    if (seen.has(id)) continue;
    gems.delete(id);
    el.classList.add("pop");
    window.setTimeout(() => el.remove(), reduceMotion ? 0 : 240);
  }

  renderSeals();
  renderHud();
  if (cursor >= 0) ringEl.style.transform = tr(cursor % W(), Math.floor(cursor / W()));
}

function renderHud() {
  const st = statusOf(state!);
  const left = st.remainingMoves ?? 0;
  $("moves-left").textContent = String(left);
  $("moves-card").classList.toggle("low", left <= 3 && !ended);
  const list = $("goal-list");
  list.replaceChildren(
    ...st.goalProgress.map((g) => {
      const row = document.createElement("div");
      row.className = `goal${g.complete ? " done" : ""}`;
      const icon = g.kind === "collect" ? makeTile("mini", g.colour) : makeTile("mini seal-mini");
      const label = document.createElement("span");
      label.className = "goal-label";
      label.textContent = g.kind === "collect" ? `${COLOUR_NAMES[g.colour ?? "red"]} tiles` : "ice";
      const count = document.createElement("strong");
      count.textContent = `${Math.min(g.current, g.target)}/${g.target}`;
      const bar = document.createElement("span");
      bar.className = "goal-bar";
      const fill = document.createElement("span");
      fill.style.width = `${Math.min(100, (g.current / Math.max(1, g.target)) * 100)}%`;
      bar.append(fill);
      row.append(icon, label, count, bar);
      return row;
    }),
  );
}

// ---------- the game loop ----------

function startLevel(i: number) {
  window.clearTimeout(timer);
  if (attempt?.inProgress && state) attempt.end("quit", state.swapCount);
  index = i;
  level = playlist.levels[i] ?? null;
  if (!level) return;
  try {
    state = settle(createGame(toCreateOptions(level.level, randomSeed()))).state;
  } catch {
    showMissing("This level can't be played right now", "Try the newest levels instead.");
    return;
  }
  // Practice levels aren't agent-made, so their plays aren't reported as player data.
  attempt = new Attempt(playlist.practice ? null : eventsUrl, level.level_id);
  busy = false;
  ended = false;
  selected = -1;
  resultEl.hidden = true;
  boardEl.classList.remove("finished");

  const n = playlist.levels.length;
  $("lvl-pos").textContent = playlist.practice
    ? `Practice level ${i + 1} of ${n}`
    : playlist.title && n > 1 ? `${playlist.title} · Level ${i + 1} of ${n}` : playlist.title ?? "Free level";
  $("lvl-name").textContent = level.level.name;
  document.title = `${level.level.name} · Level AI`;
  const tuned = $("lvl-tuned");
  tuned.classList.toggle("practice", !!playlist.practice);
  if (playlist.practice) {
    tuned.textContent = "A warm-up level while our agents finish the next set. New levels appear here first.";
    tuned.hidden = false;
  } else if (level.measured_win_rate !== null && level.measured_win_rate !== undefined) {
    tuned.textContent = `Tuned to ${pct(level.target_win_rate)}% wins. Bot simulations won ${pct(level.measured_win_rate)}%.`;
    tuned.hidden = false;
  } else tuned.hidden = true;
  $("skip").hidden = i + 1 >= n;

  layoutBoard();
  render(true);
  boardEl.classList.remove("intro");
  void boardEl.offsetWidth;
  boardEl.classList.add("intro");
  say("Swap two neighboring tiles to line up three or more of a kind.");
  armHint();
}

function trySwap(from: number, to: number) {
  if (busy || ended || !state || !active(from) || !active(to) || !adjacent(from, to)) return;
  attempt?.start();
  clearHint();
  const t = applyAction(state, { kind: "swap", from, to });
  selected = -1;
  if (!t.accepted) {
    say(t.reason === "identical-gems" ? "Those two are the same. Try another pair." : "No match there, so the tiles swap back.");
    render();
    nope(from, to);
    return;
  }
  state = t.state;
  say("");
  render();
  resolve();
}

/** An invalid swap: the two tiles trade places, then slide back. The move isn't counted. */
function nope(a: number, b: number) {
  const ga = state!.board[a];
  const gb = state!.board[b];
  const ea = ga ? gems.get(ga.id) : undefined;
  const eb = gb ? gems.get(gb.id) : undefined;
  if (!ea || !eb) return;
  if (reduceMotion) {
    for (const el of [ea, eb]) {
      el.classList.remove("shake");
      void el.offsetWidth;
      el.classList.add("shake");
    }
    return;
  }
  const ta = ea.style.transform;
  const tb = eb.style.transform;
  ea.style.transform = tb;
  eb.style.transform = ta;
  busy = true;
  window.setTimeout(() => {
    ea.style.transform = ta;
    eb.style.transform = tb;
    window.setTimeout(() => {
      busy = false;
      armHint();
    }, SWAP_MS);
  }, SWAP_MS);
}

function resolve() {
  busy = true;
  if (reduceMotion) {
    const settled = settle(state!);
    state = settled.state;
    render();
    if (settled.shuffled) say("No moves were left, so the board was shuffled.");
    busy = false;
    afterMove();
    return;
  }
  const step = () => {
    if (state!.phase === "ready" || state!.phase === "finished") {
      busy = false;
      render();
      afterMove();
      return;
    }
    const t = advanceTicks(state!, 1);
    state = t.state;
    render();
    if (t.events.some((e) => e.type === "board-reshuffled")) {
      // The engine found no possible swap and shuffled the tiles. Let the tiles slide to their new places.
      say("No moves left. Shuffling the board.");
      timer = window.setTimeout(step, SHUFFLE_MS);
      return;
    }
    timer = window.setTimeout(step, TICK_MS);
  };
  timer = window.setTimeout(step, SWAP_MS);
}

function afterMove() {
  const s = state!;
  if (s.outcome === "won") return finish("won");
  // The engine reshuffles a dead board, so a loss with moves left means no playable shuffle existed.
  if (s.outcome === "lost" || s.outcome === "finished") return finish((statusOf(s).remainingMoves ?? 0) > 0 ? "stuck" : "lost");
  // Same rule as the adapter's bots: a board with no swaps left ends the level.
  if (!legalActions(s).some(isSwap)) return finish("stuck");
  armHint();
}

// ---------- idle hint: after a pause, point out one possible swap ----------

function clearHint() {
  window.clearTimeout(hintTimer);
  for (const el of gemsEl.querySelectorAll(".hint")) el.classList.remove("hint");
}

function armHint() {
  clearHint();
  hintTimer = window.setTimeout(() => {
    if (!state || busy || ended || state.phase !== "ready") return;
    const swap = legalActions(state).find(isSwap);
    if (!swap) return;
    for (const cell of [swap.from, swap.to]) {
      const g = state.board[cell];
      if (g) gems.get(g.id)?.classList.add("hint");
    }
  }, HINT_MS);
}

function finish(kind: "won" | "lost" | "stuck") {
  const s = state!;
  ended = true;
  clearHint();
  attempt?.end(kind === "won" ? "win" : "loss", s.swapCount);
  boardEl.classList.add("finished");
  renderHud();

  const st = statusOf(s);
  const goal = st.goalProgress[0];
  const hasNext = index + 1 < playlist.levels.length;
  const actions: HTMLElement[] = [];
  const button = (label: string, cls: string, onClick: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = label;
    b.addEventListener("click", onClick);
    actions.push(b);
  };
  const link = (label: string, cls: string, href: string) => {
    const a = document.createElement("a");
    a.className = cls;
    a.href = href;
    a.textContent = label;
    actions.push(a);
  };

  let title: string;
  let text: string;
  if (kind === "won") {
    if (level) void seriesPosition(level).then(rememberWin);
    const left = st.remainingMoves ?? 0;
    title = "Level complete";
    text = left > 0 ? `You finished with ${plural(left, "move")} to spare.` : "You did it on your very last move.";
    if (hasNext) {
      button("Next level", "btn", () => startLevel(index + 1));
      button("Play again", "btn small ink", () => startLevel(index));
    } else if (playlist.continuation) {
      link("Next verified level", "btn", `/play?series=${playlist.continuation}`);
      button("Play again", "btn small ink", () => startLevel(index));
    } else if (playlist.practice) {
      text += " That was the last practice level.";
      link("Get levels for your game", "btn", "/join");
      button("Play again", "btn small ink", () => startLevel(0));
    } else if (mode === "level") {
      link("Play more free levels", "btn", "/play");
      button("Play again", "btn small ink", () => startLevel(index));
    } else {
      text += " That was the last level in this set.";
      link("Get levels for your game", "btn", "/join");
      button("Play again", "btn small ink", () => startLevel(0));
    }
  } else {
    title = kind === "stuck" ? "No moves left" : "Out of moves";
    text = kind === "stuck" ? "The board ran out of possible swaps." : goal ? `You collected ${Math.min(goal.current, goal.target)} of ${goal.target}.` : "So close.";
    if (level?.measured_win_rate !== null && level?.measured_win_rate !== undefined) {
      text += ` Bot simulations won ${pct(level.measured_win_rate)}% of the time on this one.`;
    }
    button("Try again", "btn", () => startLevel(index));
    if (hasNext) button("Next level", "btn small ink", () => startLevel(index + 1));
  }
  $("result-title").textContent = title;
  $("result-text").textContent = text;
  $("result-actions").replaceChildren(...actions);
  resultEl.dataset.kind = kind;
  resultEl.hidden = false;
  say(title);
  (actions[0] as HTMLElement | undefined)?.focus({ preventScroll: true });
}

// ---------- input: tap, swipe, keyboard ----------

let drag: { cell: number; x: number; y: number; moved: boolean } | null = null;

function cellAt(e: PointerEvent): number {
  const r = gemsEl.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * W());
  const y = Math.floor(((e.clientY - r.top) / r.height) * H());
  return x < 0 || y < 0 || x >= W() || y >= H() ? -1 : y * W() + x;
}

function tap(cell: number) {
  if (busy || ended) return;
  armHint();
  if (selected < 0 || selected === cell) selected = selected === cell ? -1 : cell;
  else if (adjacent(selected, cell)) return trySwap(selected, cell);
  else selected = cell;
  render();
}

boardEl.addEventListener("pointerdown", (e) => {
  if (!state || busy || ended || e.button > 0) return;
  const cell = cellAt(e);
  if (!active(cell)) return;
  attempt?.start();
  drag = { cell, x: e.clientX, y: e.clientY, moved: false };
  boardEl.setPointerCapture(e.pointerId);
  e.preventDefault();
});

boardEl.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  const size = gemsEl.getBoundingClientRect().width / W();
  if (Math.max(Math.abs(dx), Math.abs(dy)) < size * 0.38) return;
  const from = drag.cell;
  drag = null;
  const to = Math.abs(dx) > Math.abs(dy) ? neighbour(from, Math.sign(dx), 0) : neighbour(from, 0, Math.sign(dy));
  trySwap(from, to);
});

boardEl.addEventListener("pointerup", () => {
  if (drag && !drag.moved) tap(drag.cell);
  drag = null;
});
boardEl.addEventListener("pointercancel", () => { drag = null; });

boardEl.addEventListener("keydown", (e) => {
  if (!state) return;
  const moves: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
  const m = moves[e.key];
  if (m) {
    e.preventDefault();
    if (cursor < 0) cursor = state.settings.mask.findIndex(Boolean);
    else {
      const next = neighbour(cursor, m[0], m[1]);
      if (next >= 0) cursor = next;
    }
    ringEl.hidden = false;
    render();
  } else if ((e.key === "Enter" || e.key === " ") && cursor >= 0) {
    e.preventDefault();
    attempt?.start();
    tap(cursor);
  }
});
boardEl.addEventListener("blur", () => { ringEl.hidden = true; });

$("restart").addEventListener("click", () => startLevel(index));
$("skip").addEventListener("click", () => startLevel(index + 1));
window.addEventListener("pagehide", () => {
  if (attempt?.inProgress && state) attempt.end("quit", state.swapCount);
});

// ---------- loading ----------

function showMissing(title: string, text: string, action: { label: string; href: string } = { label: "Play the newest levels", href: "/play" }) {
  shell.hidden = true;
  empty.hidden = false;
  $("empty-title").textContent = title;
  $("empty-text").textContent = text;
  const a = $<HTMLAnchorElement>("empty-action");
  a.textContent = action.label;
  a.href = action.href;
  main.classList.add("is-empty");
}

async function boot() {
  const params = new URLSearchParams(location.search);
  mode = params.get("level") ? "level" : params.get("pack") ? "pack" : "latest";
  try {
    playlist = await loadPlaylist(params);
  } catch (err) {
    if (err instanceof NotFound) {
      showMissing(mode === "pack" ? "We couldn't find that set" : "We couldn't find that level", "It may have been replaced by a newer one.");
    } else {
      showMissing("We couldn't load the levels", "Check your connection and try again.", { label: "Try again", href: location.href });
    }
    return;
  }
  if (!playlist.levels.length) {
    showMissing(
      "New levels are on the way",
      "Our agents are designing and testing the next set right now. Check back soon, or get levels made for your own game.",
      { label: "Get levels for your game", href: "/join" },
    );
    return;
  }
  shell.hidden = false;
  startLevel(0);
}

void boot();
