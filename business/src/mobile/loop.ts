import type Mobilerun from "@mobilerun/sdk";
import { z } from "zod";
import type { ToolContext } from "../mcp/tools.js";
import { enqueue } from "../leads/playtest-offer.js";
import { captureScreen, isBlank } from "./screen.js";

/**
 * The overnight playtest loop: keeps the cloud iPhone doing real playtest work between paid orders.
 *
 * Each cycle:
 *  1. Skips when a paid order is queued or running (they share the order queue in
 *     leads/playtest-offer.ts, so paid work always goes first), or when any task is already active
 *     on the phone (an order on another server, or a run_playtest call).
 *  2. Picks work: our own web-player level if one exists, otherwise a market study of a free web
 *     puzzle game from MARKET_GAMES (least recently played first, judged from the activity log).
 *  3. Opens the page in Safari with a deep link and checks a real screenshot until the game shows.
 *     A page still blank after ~12 s is logged as "didn't load on the phone" and the cycle tries the
 *     next game (at most MAX_TRIES per cycle).
 *  4. Runs one Mobilerun Agent task (vision on, capped steps and wall time, structured result). If
 *     the screen stays blank for BLANK_POLLS polls in a row mid-run, the task is stopped and logged
 *     as failed rather than "played" from the accessibility tree.
 *  5. Leaves the phone on the game's board if it's showing something, otherwise on the home screen.
 *  6. Logs start, result, and failures as agent "playtest-lead". Results start with "playtested "
 *     because /public-stats counts that prefix; failures start with "playtest failed for ".
 *
 * Log wording is what the demo console turns into its labels, so it uses a human game name and
 * never a URL slug or "<name>'s app" for a web game.
 *
 * Our web player posts its own player events from the page, so a phone run of our level already
 * lands in player_events. We don't post them a second time from here.
 */

export interface MarketGame {
  /** Human name shown in the log and on the demo stage. */
  name: string;
  url: string;
  genre: string;
  /** One or two sentences the phone agent needs to play it. */
  howToPlay: string;
  /** Set for a native iOS app (installed from Mobilerun's catalog); `url` is then its App Store page. */
  bundleId?: string;
}

/**
 * Free, publicly hosted web puzzle games. Each one was opened on our cloud iPhone in Safari on
 * Nov 7, 2026 between 5:37 and 5:48 PM, and a screenshot showed its board within 4 s. We play them
 * only to study level design: no sign-ins, no purchases, no ads.
 * Dropped after checking: say.games Ball Sort (404 on the phone).
 */
export const MARKET_GAMES: MarketGame[] = [
  {
    name: "2048",
    url: "https://play2048.co/",
    genre: "2048-style",
    howToPlay: "Swipe up, down, left, or right to slide all tiles; equal tiles merge. Start a fresh game first with the circular-arrow (new game) button at the top right. Each swipe is one move.",
  },
  {
    name: "Gemline",
    url: "https://app.cinevva.com/arcade/gemline",
    genre: "match-3",
    howToPlay: "Tap \"Play now\" (never \"Sign In\"). Tap two neighboring gems to swap them and make a line of three or more of the same color. The moves left are shown on the board.",
  },
  {
    name: "Water Sort",
    url: "https://water-sort.netlify.app/",
    genre: "sort puzzle",
    howToPlay: "Tap a tube, then tap another tube to pour the top color into it. A level is won when every tube holds one color. The game has numbered levels; after a win, tap the next-level button.",
  },
  {
    name: "Flood",
    url: "https://www.chiark.greenend.org.uk/~sgtatham/puzzles/js/flood.html",
    genre: "move-limited color puzzle",
    howToPlay: "Tap a square to flood-fill the top-left region with that square's color. Make the whole grid one color within the move limit shown under the grid (for example \"0 / 23 moves\"). The page is small, so zoom in if a tap misses.",
  },
  // Native iOS apps from Mobilerun's catalog, installed on the main phone Nov 7, 7:35 PM. We study how the
  // genre leaders ramp difficulty; we never use their names, art, or levels in our own games.
  {
    name: "Candy Crush Saga",
    url: "https://apps.apple.com/app/id553834731",
    bundleId: "com.midasplayer.apps.candycrushsaga",
    genre: "match-3 (genre leader)",
    howToPlay: "If a tutorial or popup appears, follow or close it (never buy anything, never connect an account; tap 'Not now' or the X). Swap two neighboring candies to make a line of three or more. Play the current level; the goal and moves left are shown at the top.",
  },
  {
    name: "Sudoku.com",
    url: "https://apps.apple.com/app/id1193508329",
    bundleId: "com.easybrain.sudoku",
    genre: "sudoku",
    howToPlay: "Close any popups (never buy, never subscribe; tap X or 'No thanks'). Start an Easy game. Tap a cell, then tap a number to fill it.",
  },
];

/** Structured result from the phone agent. Nullable numbers are plain .number(): .int().nullable() becomes anyOf, which Mobilerun rejects. */
export const LoopResultSchema = z.object({
  loaded: z.boolean(),
  touchOk: z.boolean(),
  won: z.boolean().nullable(),
  levelReached: z.number().nullable(),
  movesUsed: z.number().nullable(),
  movesBeforeRamp: z.number().nullable(),
  stuckAt: z.string().nullable(),
  designNote: z.string(),
  visualIssues: z.array(z.string()),
});
export type LoopResult = z.infer<typeof LoopResultSchema>;

export type LoopWork =
  | { kind: "own"; name: string; url: string; levelId: string; targetWinRate: number | null; genre?: string; howToPlay?: string }
  | { kind: "market"; name: string; url: string; game: MarketGame };

export type CycleOutcome =
  | { ran: false; reason: string }
  | { ran: true; work: LoopWork; taskId: string | null; status: string; result: LoopResult | null; summary: string; error: string | null; tried: string[] };

export const LOOP_AGENT = "playtest-lead";
export const MAX_STEPS = 25;
export const MAX_SECONDS = 6 * 60;
/** Games tried per cycle when one doesn't load. */
export const MAX_TRIES = 2;
/** Screenshots taken while waiting for a page to show (one per poll). */
export const LOAD_POLLS = 4;
/** Consecutive blank screenshots mid-run that stop the task. */
export const BLANK_POLLS = 3;
const ACTIVE = new Set(["prepared", "queued", "created", "running", "cancelling"]);
const TERMINAL = new Set(["completed", "failed", "cancelled"]);
/** Android accessibility code for "home"; Mobilerun accepts it on our iPhone too (checked Nov 7). */
const GLOBAL_HOME = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The loop's own task on the phone right now (never a paid order's), so on-demand work can cut it short. */
let loopTask: { id: string; name: string; stopReason: string | null } | null = null;

/**
 * Stops the loop's current market study or level playtest early, for on-demand work a person is
 * waiting on (POST /social/post-now). Paid orders are never touched: they don't run through here.
 * Returns the stopped job's name, or null when the loop wasn't using the phone.
 */
export async function stopLoopTask(client: Mobilerun, reason: string): Promise<string | null> {
  if (!loopTask) return null;
  loopTask.stopReason = reason;
  await client.tasks.stop(loopTask.id).catch(() => undefined);
  return loopTask.name;
}
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200);

/** How the log names a job: the label the console shows. */
export function label(work: LoopWork, when: "start" | "result"): string {
  if (work.kind === "own") return work.name;
  const kind = work.game.bundleId ? "iOS app" : "web game";
  return when === "start" ? `${work.name} (${kind}, market study)` : `${work.name} (${kind})`;
}

/** True when the order queue is empty: a no-op job put on it starts within a few milliseconds. */
export async function orderQueueIdle(waitMs = 50): Promise<boolean> {
  let started = false;
  void enqueue(async () => { started = true; });
  await sleep(waitMs);
  return started;
}

/** Any Mobilerun task still active on this phone. */
export async function activePhoneTask(client: Mobilerun, deviceId: string): Promise<string | null> {
  const r = await client.tasks.list({ orderBy: "createdAt", orderByDirection: "desc", pageSize: 20 });
  const hit = (r.items ?? []).find((t) => t.deviceId === deviceId && ACTIVE.has(t.status));
  return hit ? hit.id : null;
}

interface PublicLevelLite { level_id: string; target_win_rate?: number | null; level?: { name?: unknown } | null }

/** Our playable levels, as the site serves them. Empty when there are none or the site is down. */
export async function fetchOwnLevels(siteUrl: string, fetchImpl: typeof fetch = fetch): Promise<PublicLevelLite[]> {
  try {
    const r = await fetchImpl(`${siteUrl.replace(/\/$/, "")}/levels-latest?game=match3`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return [];
    const j = (await r.json()) as { levels?: PublicLevelLite[] };
    return (j.levels ?? []).filter((l) => typeof l.level_id === "string");
  } catch {
    return [];
  }
}

/**
 * Jobs for this cycle, best first: our levels the phone hasn't played yet (then the rest), followed
 * by market games, least recently played first. The cycle takes the first one that loads.
 */
export async function pickWork(ctx: ToolContext, fetchImpl: typeof fetch = fetch): Promise<LoopWork[]> {
  const site = ctx.config.SITE_URL.replace(/\/$/, "");
  const recent = (await ctx.store.listActivity(500)).filter((a) => a.agent === LOOP_AGENT && /^playtest(ed|ing| failed for) /.test(a.action));
  const played = (needle: string) => recent.findIndex((a) => a.action.includes(needle));
  const own: LoopWork[] = (await fetchOwnLevels(site, fetchImpl))
    .map((l): LoopWork => {
      // The console reads "our <game> level <name>" as one of our own levels (demo/src/moments.ts).
      const title = typeof l.level?.name === "string" && l.level.name.trim() ? l.level.name.trim().slice(0, 40) : l.level_id.slice(0, 8);
      return {
        kind: "own",
        name: `our Gem Garden level ${title}`,
        url: `${site}/play?level=${encodeURIComponent(l.level_id)}`,
        levelId: l.level_id,
        targetWinRate: typeof l.target_win_rate === "number" ? l.target_win_rate : null,
      };
    })
    .sort((a, b) => Number(played(a.name) !== -1) - Number(played(b.name) !== -1));
  // Activity is newest first, so a higher index means played longer ago. Never played sorts first.
  const age = (g: MarketGame) => {
    const i = played(`${g.name} (${g.bundleId ? "iOS app" : "web game"}`);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  const market = [...MARKET_GAMES]
    .map((g, order) => ({ g, order, age: age(g) }))
    .sort((a, b) => (a.age === b.age ? a.order - b.order : b.age - a.age))
    .map(({ g }): LoopWork => ({ kind: "market", name: g.name, url: g.url, game: g }));
  return [...own, ...market];
}

const RULES = [
  "Close any popup, cookie banner, tutorial overlay, or ad with its X, \"Close\", or \"No thanks\".",
  "Never sign in, create an account, type a password, buy anything, watch an ad for a reward, tap an ad, allow notifications or location, or share. If a screen asks for any of these, close it or go back.",
  "Don't open other websites or apps.",
  "Look at the screen itself. If the page is blank or the game isn't visible, wait 5 seconds; if it's still blank, stop and report loaded = false. Never guess moves on a blank screen.",
];

export function workToTask(work: LoopWork, moves = 15): string {
  const bundle = work.kind === "market" ? work.game.bundleId : undefined;
  const open = bundle
    ? `The app "${work.name}" should already be open. If it isn't, go to the home screen and open "${work.name}".`
    : `Safari should already show ${work.url}. If it doesn't, open Safari, tap the address bar, type ${work.url}, and press Go.`;
  const play =
    work.kind === "own"
      ? [
          `Goal: playtest one ${work.genre ?? "match-3"} level made by our level designer, as a first-time player would.`,
          open,
          `How to play: ${work.howToPlay ?? "swap two neighboring tiles to make a line of three or more of the same kind. The goals and the moves left are shown at the top."}`,
          `Play until you win, run out of moves, or have made ${moves} moves. Count every move.`,
        ]
      : [
          `Goal: study the ${work.game.bundleId ? "iOS puzzle app" : "free web puzzle game"} "${work.name}" (${work.game.genre}) the way a new player would, for game-design research.`,
          open,
          `How to play: ${work.game.howToPlay}`,
          `Play for up to ${moves} moves, or until you lose or the game clearly gets hard. Count every move, and note the level number you reach if the game has levels.`,
        ];
  return [
    ...play,
    ...RULES,
    "Report: loaded (did the game appear on screen), touchOk (did taps and swipes work), won (true or false, or null if there's no win yet), levelReached (highest level number reached, or null if the game has no levels), movesUsed, movesBeforeRamp (how many moves, or levels if it has levels, before it became noticeably harder; null if it never did), stuckAt (where and why a player would get stuck, or null), designNote (one concrete lesson a level designer could use), and visualIssues (anything that looked broken; empty if none).",
    "When you're done, leave the game on screen.",
  ].join("\n");
}

/** One line for the activity log, e.g. "solved 3 levels in 18 moves; stuck: needs a 3-move combo". */
export function summarize(r: LoopResult): string {
  if (!r.loaded) return "didn't load on the phone";
  const parts: string[] = [];
  const moves = r.movesUsed != null ? ` in ${r.movesUsed} moves` : "";
  if (r.won === true) parts.push(r.levelReached != null ? `won, reached level ${r.levelReached}${moves}` : `won${moves}`);
  else if (r.won === false) parts.push(r.levelReached != null ? `lost at level ${r.levelReached}${moves}` : `lost${moves}`);
  else parts.push(r.levelReached != null ? `reached level ${r.levelReached}${moves}` : `played${moves || " (moves not counted)"}`);
  if (r.movesBeforeRamp != null) parts.push(`got harder after ${r.movesBeforeRamp}`);
  if (r.stuckAt) parts.push(`stuck: ${r.stuckAt}`);
  if (!r.touchOk) parts.push("touch problems");
  if (r.visualIssues.length) parts.push(`${r.visualIssues.length} visual issue${r.visualIssues.length === 1 ? "" : "s"}`);
  return parts.join("; ").slice(0, 300);
}

async function goHome(client: Mobilerun, deviceId: string): Promise<void> {
  await client.devices.actions.global(deviceId, { action: GLOBAL_HOME }).catch(() => undefined);
}

/** Blank, showing, or unknown (no screenshot). */
async function screenState(client: Mobilerun, deviceId: string): Promise<"blank" | "showing" | "unknown"> {
  const png = await captureScreen(client, deviceId);
  return png ? (isBlank(png) ? "blank" : "showing") : "unknown";
}

/** Opens the page and waits for it to show. False only when every screenshot was blank. */
async function openAndWait(client: Mobilerun, deviceId: string, url: string, pollMs: number): Promise<boolean> {
  await client.devices.deepLink.executeDeepLink(deviceId, { deepLink: url }).catch(() => undefined);
  let sawBlank = false;
  for (let i = 0; i < LOAD_POLLS; i++) {
    await sleep(pollMs);
    const s = await screenState(client, deviceId);
    if (s === "showing") return true;
    if (s === "blank") sawBlank = true;
  }
  // No screenshots at all: we can't tell, so let the agent (vision on) judge.
  return !sawBlank;
}

/** For native apps (already started): wait until the screen shows something. */
async function waitForScreen(client: Mobilerun, deviceId: string, pollMs: number): Promise<boolean> {
  let sawBlank = false;
  for (let i = 0; i < LOAD_POLLS; i++) {
    await sleep(pollMs);
    const s = await screenState(client, deviceId);
    if (s === "showing") return true;
    if (s === "blank") sawBlank = true;
  }
  return !sawBlank;
}

/** `moves` and `maxSteps` shorten a run (a pack's phone study must finish within its time limit). */
type Opts = { pollMs?: number; maxSeconds?: number; deadlineMs?: number; moves?: number; maxSteps?: number };

/**
 * Runs one job on the phone and logs it. Returns null (after logging the failure) when the page
 * never showed, so the caller can try the next game.
 */
export async function runWork(ctx: ToolContext, client: Mobilerun, deviceId: string, work: LoopWork, opts: Opts = {}): Promise<Omit<CycleOutcome & { ran: true }, "tried"> | null> {
  const log = (action: string, why: string | null, result: string | null) =>
    ctx.store.logActivity({ at: new Date().toISOString(), agent: LOOP_AGENT, action, why, result, costUsd: null, human: false });
  const pollMs = opts.pollMs ?? 3000;
  const maxSeconds = opts.maxSeconds ?? MAX_SECONDS;
  const why = work.kind === "own" ? `Level AI match-3 level ${work.levelId.slice(0, 8)}` : `${work.name} (${work.game.bundleId ? "iOS app from the App Store" : "free web game"})`;

  const bundleId = work.kind === "market" ? work.game.bundleId : undefined;
  if (bundleId) await client.devices.apps?.start?.(bundleId, { deviceId })?.catch(() => undefined);
  if (!(await (bundleId ? waitForScreen(client, deviceId, pollMs) : openAndWait(client, deviceId, work.url, pollMs)))) {
    await goHome(client, deviceId);
    await log(`playtest failed for ${label(work, "result")}`, why, "didn't load on the phone: the page stayed blank");
    return null;
  }

  await log(`playtesting ${label(work, "start")} on the iPhone`, why, null);
  let taskId: string | null = null;
  let status = "not started";
  let result: LoopResult | null = null;
  let error: string | null = null;
  try {
    const task = await client.tasks.run({
      deviceId,
      task: workToTask(work, opts.moves),
      llmModel: ctx.config.MOBILERUN_MODEL,
      maxSteps: opts.maxSteps ?? MAX_STEPS,
      executionTimeout: maxSeconds,
      vision: true,
      outputSchema: z.toJSONSchema(LoopResultSchema) as Record<string, unknown>,
      recordingEnabled: false,
    });
    taskId = task.id;
    loopTask = { id: task.id, name: work.name, stopReason: null };
    // Mobilerun enforces executionTimeout itself; this is a backstop with 30 s of slack.
    const deadline = Date.now() + (opts.deadlineMs ?? (maxSeconds + 30) * 1000);
    let blanks = 0;
    let s = await client.tasks.getStatus(task.id);
    while (!TERMINAL.has(s.status) && Date.now() < deadline) {
      await sleep(pollMs);
      blanks = (await screenState(client, deviceId)) === "blank" ? blanks + 1 : 0;
      if (blanks >= BLANK_POLLS) break;
      s = await client.tasks.getStatus(task.id);
    }
    status = s.status;
    if (loopTask?.stopReason) {
      error = `stopped early: ${loopTask.stopReason}`;
    } else if (blanks >= BLANK_POLLS) {
      await client.tasks.stop(task.id).catch(() => undefined);
      status = "stopped";
      error = "the page went blank on the phone, so the run was stopped";
    } else if (!TERMINAL.has(s.status)) {
      await client.tasks.stop(task.id).catch(() => undefined);
      error = `ran past ${Math.round(maxSeconds / 60)} minutes and was stopped`;
    } else {
      const parsed = LoopResultSchema.safeParse(s.output);
      if (parsed.success && parsed.data.loaded) result = parsed.data;
      else if (parsed.success) error = "didn't load on the phone";
      else error = s.status === "completed" ? "the phone finished without a readable result" : (s.message ?? `task ${s.status}`).slice(0, 200);
    }
  } catch (err) {
    error = errText(err);
  } finally {
    loopTask = null;
    // Leave the board up if it's showing something; otherwise the home screen. Never a blank tab.
    if (!result || (await screenState(client, deviceId)) === "blank") await goHome(client, deviceId);
  }

  const summary = result ? summarize(result) : (error ?? "no result");
  const ref = taskId ? ` (task ${taskId})` : "";
  if (result) {
    await log(`playtested ${label(work, "result")}: ${summary}`, why, `${result.designNote ? `Design note: ${result.designNote.slice(0, 300)}` : "No design note"}${ref}`);
  } else {
    await log(`playtest failed for ${label(work, "result")}`, why, `${summary}${ref}`);
  }
  return { ran: true, work, taskId, status, result, summary, error };
}

/** One loop cycle: check the phone is free, pick work, run it through the order queue. */
export async function runLoopCycle(ctx: ToolContext, opts: Opts & { fetchImpl?: typeof fetch } = {}): Promise<CycleOutcome> {
  const deviceId = ctx.config.MOBILERUN_DEVICE_ID;
  const client = ctx.mobilerun;
  if (!client || !deviceId) return { ran: false, reason: "phone not configured" };
  if (!(await orderQueueIdle())) return { ran: false, reason: "a paid playtest order is queued or running" };
  try {
    const active = await activePhoneTask(client, deviceId);
    if (active) return { ran: false, reason: `another task is running on the phone (${active})` };
  } catch (err) {
    return { ran: false, reason: `couldn't check the phone: ${errText(err)}` };
  }
  const jobs = await pickWork(ctx, opts.fetchImpl);
  // Run through the order queue, so an order that arrives mid-run waits for the phone instead of colliding.
  const queuedAt = Date.now();
  return enqueue(async (): Promise<CycleOutcome> => {
    if (Date.now() - queuedAt > 1000) return { ran: false, reason: "a paid playtest order went first" };
    const tried: string[] = [];
    for (const work of jobs.slice(0, MAX_TRIES)) {
      // Holding the queue keeps this server's orders out; this catches one started anywhere else.
      const active = await activePhoneTask(client, deviceId).catch(() => "unknown (check failed)");
      if (active) return { ran: false, reason: `another task is running on the phone (${active})` };
      tried.push(work.name);
      const r = await runWork(ctx, client, deviceId, work, opts);
      if (r) return { ...r, tried };
    }
    return { ran: false, reason: `nothing loaded on the phone (tried ${tried.join(", ")})` };
  });
}

/** Starts the loop on the long-running server. Returns a stop function. */
export function startPlaytestLoop(ctx: ToolContext, minutes: number, firstDelayMs = 60_000): () => void {
  let running = false;
  const cycle = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runLoopCycle(ctx);
      console.log(r.ran ? `playtest loop: ${r.work.name}: ${r.summary}` : `playtest loop: skipped (${r.reason})`);
    } catch (err) {
      console.error("playtest loop failed:", errText(err));
    } finally {
      running = false;
    }
  };
  const first = setTimeout(cycle, firstDelayMs);
  const every = setInterval(cycle, minutes * 60_000);
  return () => { clearTimeout(first); clearInterval(every); };
}
