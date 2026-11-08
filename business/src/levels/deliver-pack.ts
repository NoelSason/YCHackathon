import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import type { ToolContext } from "../mcp/tools.js";
import type { Query } from "../store.js";
import type { Lead } from "../types.js";
import { enqueue } from "../leads/playtest-offer.js";
import { idempotencyKey } from "../outreach/send.js";
import { MARKET_GAMES, runWork, type LoopResult, type LoopWork } from "../mobile/loop.js";
import * as E from "../email/html.js";
import { PACK_GAME_IDS, type MadeLevel, type MakeProgress, type MakeRequest, type MakeResult, type PackDifficulty, type PackGameId, type PackMaker } from "./pack-types.js";

/**
 * Level pack delivery, with no person in the loop. A paid pack (or one subscription half-month, or a
 * demo run) becomes a row in biz_pack_deliveries; this worker then:
 *
 *   1. studies the customer's own game on the main phone (Mobilerun, through the shared phone queue)
 *      to see how fast it gets harder: "studying <game> on the iPhone to set the difficulty curve";
 *   2. turns that and the chosen difficulty into a curve: a target win rate for each of the levels,
 *      from 85% at level 1 down to the hard point by the last level;
 *   3. builds the levels in OUR engine for the customer's genre, one at a time, in a worker thread
 *      (pack-maker.ts: the game's generator, the game's bots, the solver's tuning rule), logging
 *      "level pack for <studio>: level k of 20 accepted at X% (target Y%)";
 *   4. saves them as published levels plus a pack (one statement), with each level's measurement as a
 *      solver_runs row;
 *   5. emails the customer the play link and the JSON link, with each level's target vs. measured;
 *   6. has the main phone open level 1 of the pack in our player and play it.
 *
 * Short of the full count within the caps, it delivers what passed, says so, and logs a step-in
 * request. Each delivery runs once (state on the row, the email keyed to the row), and rows a
 * restart interrupted go back in the queue on boot.
 *
 * Honest limits, also in the email: levels are made in our own games for the customer's genre and
 * calibrated to how their game played on our phone. Nothing is built inside the customer's game.
 */

export const AGENT = "level-delivery";
export const CURVE_START = 0.85;
/** Where each difficulty's curve ends by the last level (reference bot win rate). */
export const CURVE_END: Record<PackDifficulty, number> = { easy: 0.55, medium: 0.4, hard: 0.28 };
/** Days between the two halves of a subscription month. */
export const SECOND_HALF_DAYS = 14;
const MAX_MINUTES = Number(process.env.PACK_MAX_MINUTES ?? 40);

export const GENRES: Record<PackGameId, { label: string; game: string; howToPlay: string }> = {
  match3: { label: "match-3", game: "Gem Garden", howToPlay: "swap two neighboring gems to make a line of three or more of the same color. The goal and the moves left are shown on the screen." },
  watersort: { label: "water-sort", game: "Splash Sort", howToPlay: "tap a tube, then tap another tube to pour the top color into it. The level is won when every tube holds one color." },
  racer: { label: "lane-racer", game: "Turbo Lanes", howToPlay: "tap the left or right arrow buttons (or swipe) to change lanes, dodge cars and cones, and reach the finish before the timer runs out." },
  lotescape: { label: "parking-puzzle", game: "Lot Escape", howToPlay: "drag a car along its lane (or tap it and use the arrows) to drive every car out through its marked exit within the move limit." },
};

/**
 * Whether we can make packs for a game today. Parking puzzles wait for the Lot Escape generator
 * (games/lotescape/src/generate.ts), which a teammate is adding.
 */
export function packGameOpen(game: PackGameId): boolean {
  if (game !== "lotescape") return true;
  return ["generate.ts", "generate.js"].some((f) => existsSync(new URL(`../../../games/lotescape/src/${f}`, import.meta.url)));
}

/** "match-3", "Match3", "sort", "parking"… → our game id, or null. */
export function packGameFor(input: string | null | undefined): PackGameId | null {
  const s = (input ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if ((PACK_GAME_IDS as readonly string[]).includes(s)) return s as PackGameId;
  if (/^match3|candy|gem/.test(s)) return "match3";
  if (/sort|water/.test(s)) return "watersort";
  if (/rac|lane/.test(s)) return "racer";
  if (/park|lot|car/.test(s)) return "lotescape";
  return null;
}

/**
 * Where a pack plays. Match-3, sort, and racer players open a whole pack (?pack=). Lot Escape's
 * player opens one level (?level=) until it learns ?pack=, so its link is level 1 and the email
 * links every level.
 */
export const playUrl = (site: string, game: PackGameId, packId: string, firstLevelId?: string): string =>
  game === "match3" ? `${site}/play?pack=${packId}`
    : game === "lotescape" && firstLevelId ? `${site}/games/lotescape/?level=${firstLevelId}`
    : `${site}/games/${game}/?pack=${packId}`;
export const levelUrl = (site: string, game: PackGameId, levelId: string): string =>
  game === "match3" ? `${site}/play?level=${levelId}` : `${site}/games/${game}/?level=${levelId}`;
export const jsonUrl = (site: string, packId: string): string => `${site}/api/packs/${packId}`;
const pct = (x: number): string => `${Math.round(x * 100)}%`;
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err)).slice(0, 200);

// ---------- the difficulty curve ----------

export interface PackStudy {
  ok: boolean;
  game: string;
  movesBeforeRamp: number | null;
  levelReached: number | null;
  stuckAt: string | null;
  designNote: string | null;
  won: boolean | null;
  summary: string;
  taskId: string | null;
}

export interface PackCurve {
  start: number;
  end: number;
  /** Levels held at the start rate before the ramp begins. */
  plateau: number;
  targets: number[];
  /** One sentence on where the curve came from, for the log and the email. */
  basis: string;
}

/**
 * The pack's curve: a target win rate per level. Starts at 85% and holds for `plateau` levels, then
 * falls in a straight line to the difficulty's end point by the last level. The phone study moves
 * both: a game that got harder within a few moves gets a short plateau and a slightly harder end;
 * one that never got harder gets a longer plateau and a gentler end. A heuristic, said as one.
 */
export function curveFor(difficulty: PackDifficulty, count: number, study: PackStudy | null): PackCurve {
  let end = CURVE_END[difficulty];
  let plateau = 3;
  let basis = `No phone study, so this is our standard ${difficulty} curve.`;
  if (study?.ok) {
    if (study.movesBeforeRamp !== null) {
      plateau = Math.max(1, Math.min(6, Math.round(study.movesBeforeRamp / 2)));
      if (study.movesBeforeRamp <= 5) end -= 0.05;
      basis = `${study.game} got harder after ${study.movesBeforeRamp} moves on our iPhone${study.stuckAt ? ` (stuck: ${study.stuckAt})` : ""}, so the first ${plateau} level${plateau === 1 ? "" : "s"} hold at ${pct(CURVE_START)} before the ramp.`;
    } else {
      plateau = 5;
      end += 0.08;
      basis = `${study.game} didn't get noticeably harder in our iPhone session, so the pack starts gently and ends a little easier.`;
    }
  }
  end = Math.round(Math.max(0.2, Math.min(0.7, end)) * 100) / 100;
  plateau = Math.min(plateau, Math.max(1, count - 1));
  const ramp = Math.max(1, count - plateau);
  const targets = Array.from({ length: count }, (_, i) =>
    i < plateau ? CURVE_START : Math.round((CURVE_START - ((CURVE_START - end) * (i - plateau + 1)) / ramp) * 100) / 100);
  return { start: CURVE_START, end, plateau, targets, basis: `${basis} It ramps to ${pct(end)} by level ${count}.` };
}

// ---------- the rows ----------

export interface PackDelivery {
  id: string;
  paymentId: string | null;
  part: number;
  leadId: string | null;
  plan: "level_pack" | "subscription";
  gameId: PackGameId;
  difficulty: PackDifficulty;
  levelsOwed: number;
  studiedGame: string | null;
  gameUrl: string | null;
  bundleId: string | null;
  test: boolean;
  demo: boolean;
  state: "queued" | "working" | "delivered" | "partial" | "failed";
  study: PackStudy | null;
  curve: PackCurve | null;
  packId: string | null;
  levelsDelivered: number | null;
}

type Row = Record<string, unknown>;
const json = <T>(v: unknown): T | null => (v === null || v === undefined ? null : ((typeof v === "string" ? JSON.parse(v) : v) as T));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function toDelivery(r: Row): PackDelivery {
  return {
    id: String(r.id), paymentId: strOrNull(r.payment_id), part: Number(r.part), leadId: strOrNull(r.studio_id),
    plan: r.plan === "subscription" ? "subscription" : "level_pack", gameId: r.game_id as PackGameId, difficulty: r.difficulty as PackDifficulty,
    levelsOwed: Number(r.levels_owed), studiedGame: strOrNull(r.studied_game), gameUrl: strOrNull(r.game_url), bundleId: strOrNull(r.bundle_id),
    test: Boolean(r.test_order), demo: Boolean(r.demo), state: r.state as PackDelivery["state"],
    study: json<PackStudy>(r.study), curve: json<PackCurve>(r.curve), packId: strOrNull(r.pack_id),
    levelsDelivered: r.levels_delivered === null || r.levels_delivered === undefined ? null : Number(r.levels_delivered),
  };
}

export interface NewDelivery {
  paymentId: string | null;
  part?: number;
  leadId: string | null;
  plan: "level_pack" | "subscription";
  gameId: PackGameId;
  difficulty: PackDifficulty;
  levelsOwed: number;
  studiedGame: string | null;
  gameUrl: string | null;
  bundleId: string | null;
  test: boolean;
  demo?: boolean;
  dueAt?: Date;
}

/** Adds a delivery. Null when this payment's part is already on file (webhooks retry). */
export async function addPackDelivery(q: Query, d: NewDelivery): Promise<PackDelivery | null> {
  const r = await q(
    `insert into biz_pack_deliveries (payment_id, part, studio_id, plan, game_id, difficulty, levels_owed, studied_game, game_url, bundle_id, test_order, demo, due_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     on conflict (payment_id, part) where payment_id is not null do nothing returning *`,
    [d.paymentId, d.part ?? 1, d.leadId, d.plan, d.gameId, d.difficulty, d.levelsOwed, d.studiedGame, d.gameUrl, d.bundleId, d.test, d.demo ?? false, (d.dueAt ?? new Date()).toISOString()],
  );
  return r[0] ? toDelivery(r[0]) : null;
}

export async function getPackDelivery(q: Query, id: string): Promise<PackDelivery | null> {
  const r = await q(`select * from biz_pack_deliveries where id::text = $1`, [id]);
  return r[0] ? toDelivery(r[0]) : null;
}

async function claimNext(q: Query): Promise<PackDelivery | null> {
  const r = await q(
    `update biz_pack_deliveries set state = 'working', started_at = coalesce(started_at, now())
      where id = (select id from biz_pack_deliveries where state = 'queued' and due_at <= now() order by due_at, created_at limit 1 for update skip locked)
      returning *`,
  );
  return r[0] ? toDelivery(r[0]) : null;
}

async function patch(q: Query, id: string, cols: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(cols);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  await q(`update biz_pack_deliveries set ${sets.join(", ")} where id = $1`, [id, ...keys.map((k) => {
    const v = cols[k];
    return v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v;
  })]);
}

/** Saves the levels (published), their measurements (solver_runs), and the pack, in one statement. */
async function savePack(q: Query, packId: string, gameId: PackGameId, name: string, made: MadeLevel[]): Promise<string[]> {
  // Levels and packs reference games(game_id). The platform adds rows for registered adapters;
  // Lot Escape isn't registered there yet, so make sure the row exists (never changes an existing one).
  const bots = { match3: ["random", "greedy"], watersort: ["human", "greedy", "random"], racer: ["human", "greedy", "random"], lotescape: ["search", "random"] }[gameId];
  await q(`insert into games (game_id, name, bots, default_win_rate) values ($1, $2, $3::jsonb, 0.40) on conflict do nothing`, [gameId, GENRES[gameId].game, JSON.stringify(bots)]);
  const input = made.map((m, i) => ({
    level_id: randomUUID(), ord: i, level: m.level, target: m.target, measured: m.measured_win_rate,
    notes: `level pack ${packId}, level ${i + 1}: ${m.bot} bot ${m.measured_win_rate === null ? `fewest moves ${m.min_moves}` : `${m.wins}/${m.runs} wins`}`,
    run_id: m.run_id, bot: m.bot, runs: m.runs, results: m.results, solvable: m.solvable, min_moves: m.min_moves,
  }));
  await q(
    `with input as (
       select * from jsonb_to_recordset($1::jsonb) as x(level_id uuid, ord int, level jsonb, target numeric, measured numeric, notes text,
                                                        run_id uuid, bot text, runs int, results jsonb, solvable boolean, min_moves int)
     ), l as (
       insert into levels (level_id, game_id, level, target_win_rate, status, measured_win_rate, notes, created_by)
       select level_id, $2, level, target, 'published', measured, notes, 'pack-delivery' from input returning level_id
     ), s as (
       insert into solver_runs (run_id, level_id, bots, runs_per_bot, status, results, solvable, min_moves, claimed_by, started_at, finished_at)
       select run_id, level_id, jsonb_build_array(bot), runs, 'done', results, solvable, min_moves, 'pack-delivery', now(), now() from input returning run_id
     )
     insert into packs (pack_id, game_id, name, level_ids)
     values ($3, $2, $4, (select jsonb_agg(level_id order by ord) from input))`,
    [JSON.stringify(input), gameId, packId, name],
  );
  return input.map((x) => x.level_id);
}

async function packLevelIds(q: Query, packId: string): Promise<string[] | null> {
  const r = await q(`select level_ids from packs where pack_id::text = $1`, [packId]);
  if (!r[0]) return null;
  return json<string[]>(r[0].level_ids) ?? [];
}

/** The saved levels of a pack, in order, as the email needs them. */
async function packLevels(q: Query, packId: string): Promise<Array<{ level_id: string; target: number; measured: number | null; notes: string | null }>> {
  const ids = (await packLevelIds(q, packId)) ?? [];
  if (!ids.length) return [];
  const rows = await q(`select level_id::text as level_id, target_win_rate, measured_win_rate, notes from levels where level_id = any($1::uuid[])`, [ids]);
  const by = new Map(rows.map((r) => [String(r.level_id), r]));
  return ids.map((id) => by.get(id)).filter((r): r is Row => Boolean(r)).map((r) => ({
    level_id: String(r.level_id), target: Number(r.target_win_rate), measured: r.measured_win_rate === null ? null : Number(r.measured_win_rate), notes: strOrNull(r.notes),
  }));
}

// ---------- the maker in a worker thread ----------

/** Runs pack-maker.ts in a worker thread (with tsx when the server runs from source). */
export const workerPackMaker: PackMaker = async (req, onProgress) => {
  const { Worker } = await import("node:worker_threads");
  const fromSource = import.meta.url.endsWith(".ts");
  const worker = new Worker(new URL(`./pack-worker${fromSource ? ".ts" : ".js"}`, import.meta.url), { workerData: req, execArgv: fromSource ? ["--import", "tsx"] : [] });
  let chain: Promise<void> = Promise.resolve();
  return new Promise<MakeResult>((resolve, reject) => {
    worker.on("message", (m: { type: "progress"; progress: MakeProgress } | { type: "done"; result: MakeResult } | { type: "error"; error: string }) => {
      if (m.type === "progress") chain = chain.then(() => onProgress?.(m.progress)).catch(() => undefined);
      else if (m.type === "done") void chain.then(() => { resolve(m.result); void worker.terminate(); });
      else { reject(new Error(m.error)); void worker.terminate(); }
    });
    worker.once("error", reject);
    worker.once("exit", (code) => { if (code !== 0) reject(new Error(`level maker stopped (exit ${code})`)); });
  });
};

// ---------- the phone ----------

/** The phone job for studying the customer's game: a known App Store app by bundle id, or a web game. */
export function studyWork(d: Pick<PackDelivery, "studiedGame" | "gameUrl" | "bundleId" | "gameId">): LoopWork | null {
  const known = MARKET_GAMES.find((g) => (d.bundleId && g.bundleId === d.bundleId) || (d.gameUrl && g.url === d.gameUrl));
  const bundleId = d.bundleId ?? known?.bundleId;
  const url = d.gameUrl ?? known?.url ?? null;
  const name = d.studiedGame ?? known?.name ?? null;
  if (!name || !url) return null;
  // An App Store page we can't start by bundle id isn't playable in Safari.
  if (!bundleId && /apps\.apple\.com|play\.google\.com/.test(url)) return null;
  const genre = GENRES[d.gameId];
  return {
    kind: "market", name, url,
    game: { name, url, genre: `${genre.label} (studied to set a level pack's difficulty curve)`, howToPlay: known?.howToPlay ?? `It's a ${genre.label} game. Close any popups (never buy, never sign in), then play the first level.`, ...(bundleId ? { bundleId } : {}) },
  };
}

async function studyGame(ctx: ToolContext, d: PackDelivery, company: string, pollMs?: number): Promise<PackStudy | null> {
  const log = (action: string, why: string | null, result: string | null) => ctx.store.logActivity({ at: new Date().toISOString(), agent: AGENT, action, why, result, costUsd: null, human: false });
  const work = studyWork(d);
  const name = d.studiedGame ?? "their game";
  const client = ctx.mobilerun;
  const deviceId = ctx.config.MOBILERUN_DEVICE_ID;
  if (!work || !client || !deviceId) {
    await log(`couldn't study ${name} on the iPhone; using the standard ${d.difficulty} curve`, `level pack for ${company}`, !work ? "no playable link or App Store bundle id on the order" : "the phone isn't set up on this server");
    return null;
  }
  await log(`studying ${work.name} on the iPhone to set the difficulty curve`, `level pack for ${company}`, null);
  // The shared phone queue: paid playtests, the playtest loop, and this never collide.
  const out = await enqueue(() => runWork(ctx, client, deviceId, work, { maxSeconds: 5 * 60, ...(pollMs ? { pollMs } : {}) })).catch((err: unknown) => ({ error: errText(err), result: null as LoopResult | null, taskId: null as string | null, summary: "" }));
  const r = out && "result" in out ? out.result : null;
  if (!r) {
    await log(`couldn't study ${work.name} on the iPhone; using the standard ${d.difficulty} curve`, `level pack for ${company}`, (out && "error" in out && out.error) || "the phone didn't return a result");
    return { ok: false, game: work.name, movesBeforeRamp: null, levelReached: null, stuckAt: null, designNote: null, won: null, summary: "no result", taskId: out?.taskId ?? null };
  }
  const study: PackStudy = {
    ok: true, game: work.name, movesBeforeRamp: r.movesBeforeRamp, levelReached: r.levelReached, stuckAt: r.stuckAt, designNote: r.designNote || null,
    won: r.won, summary: out?.summary ?? "", taskId: out?.taskId ?? null,
  };
  const ramp = r.movesBeforeRamp !== null ? `gets harder after ${r.movesBeforeRamp} moves` : "didn't get noticeably harder in our session";
  await log(`${work.name}: ${ramp}${r.stuckAt ? `; players get stuck at ${r.stuckAt}` : ""}`.slice(0, 300), `phone study for ${company}'s level pack`, r.designNote ? `Design note: ${r.designNote.slice(0, 300)}` : null);
  return study;
}

/** The closing shot: the main phone opens level 1 of the pack in our player and plays it. */
async function playtestPack(ctx: ToolContext, d: PackDelivery, company: string, packId: string, firstLevelId: string, pollMs?: number): Promise<void> {
  const client = ctx.mobilerun;
  const deviceId = ctx.config.MOBILERUN_DEVICE_ID;
  if (!client || !deviceId) return;
  const genre = GENRES[d.gameId];
  const site = ctx.config.SITE_URL.replace(/\/+$/, "");
  await enqueue(() => runWork(ctx, client, deviceId, {
    kind: "own", name: `level 1 of ${company}'s ${genre.label} pack`, url: playUrl(site, d.gameId, packId, firstLevelId), levelId: firstLevelId,
    targetWinRate: d.curve?.targets[0] ?? null, genre: genre.label, howToPlay: genre.howToPlay,
  }, { maxSeconds: 4 * 60, ...(pollMs ? { pollMs } : {}) }));
}

// ---------- the email ----------

export function composePackEmail(args: {
  name: string | null; company: string; gameId: PackGameId; difficulty: PackDifficulty; owed: number;
  levels: Array<{ target: number; measured: number | null; notes: string | null; url: string }>; curve: PackCurve; studiedGame: string | null; studied: boolean;
  playUrl: string; jsonUrl: string; siteUrl: string; test: boolean; companyName: string; postalAddress: string; replyTo: string; bot: string; runs: number;
}): { subject: string; body: string; html: string } {
  const first = args.name ? args.name.split(" ")[0]! : args.company;
  const g = GENRES[args.gameId];
  const n = args.levels.length;
  const short = n < args.owed;
  const measured = args.levels.map((l) => l.measured).filter((x): x is number => x !== null);
  const range = measured.length ? `${pct(Math.min(...measured))}–${pct(Math.max(...measured))}` : null;
  const botName = args.bot === "human" ? "human-like test bot" : args.bot === "greedy" ? "greedy test bot" : `${args.bot} bot`;
  const what = `${n} ${g.label} level${n === 1 ? "" : "s"}`;
  const lines = args.levels.map((l, i) => `Level ${i + 1}: target ${pct(l.target)}, ${l.measured === null ? `exact puzzle, ${l.notes?.replace(/^.*: search bot /, "") ?? "fewest moves checked"}` : `measured ${pct(l.measured)}`}: ${l.url}`);
  const calibration = args.studied && args.studiedGame
    ? `Before building, our iPhone played ${args.studiedGame} to see how quickly it gets harder. ${args.curve.basis}`
    : args.curve.basis;
  const honest = `These levels are made in our own ${g.label} game (${g.game}) for your genre, calibrated to how your game plays. They aren't built inside your game: you get playable previews plus JSON in a documented format (${args.siteUrl}/developers#formats) to adapt to your engine.`;
  const shortNote = short
    ? `We promised ${args.owed} levels and ${n} passed testing in the time we allow, so this pack has ${n}. A person on our team will follow up with the rest.`
    : null;
  const testNote = args.test ? "This was a test order, so no money was charged." : null;
  const footerReason = "You're getting it because you ordered a level pack.";
  const body = [
    `Hi ${first},`,
    "",
    `Your level pack is ready: ${what}, each played by our ${botName} until it landed on its target win rate${range ? ` (measured ${range})` : ""}.`,
    "",
    `Play them: ${args.playUrl}`,
    `JSON for all levels: ${args.jsonUrl}`,
    "",
    calibration,
    "",
    honest,
    "",
    ...(shortNote ? [shortNote, ""] : []),
    `Each level, target vs. measured (${args.runs} plays each by the ${botName}):`,
    ...lines,
    "",
    `Questions, or a different curve? Reply to this email or write to ${args.replyTo}.`,
    "",
    ...(testNote ? [testNote, ""] : []),
    args.companyName,
    "",
    "—",
    `${args.companyName} is a small studio where AI agents design and test levels, and this email was written by one of them. ${footerReason}`,
    args.postalAddress,
  ].join("\n");
  const html = E.layout({
    preheader: `${what}, measured ${range ?? "by our bots"}. Play them in your browser.`,
    companyName: args.companyName, postalAddress: args.postalAddress, footerReason,
    body: [
      E.eyebrow(short ? `Level pack · ${n} of ${args.owed} levels` : args.test ? "Level pack ready · test order" : "Level pack ready", short ? E.C.yellow : E.C.green),
      E.heading(`Your ${g.label} levels are ready, ${first}`),
      E.text(`${what}, each played by our ${botName} until it landed on its target win rate.`, { color: E.C.muted }),
      E.button("Play your levels", args.playUrl),
      E.button("Download the JSON", args.jsonUrl, E.C.green),
      E.panel(E.rows([
        E.checkRow("Levels", short ? `${n} of ${args.owed}` : String(n), short ? "fail" : "pass"),
        E.checkRow("Difficulty curve", `${pct(args.curve.start)} → ${pct(args.curve.end)}`, "info"),
        ...(range ? [E.checkRow("Measured win rates", range, "info")] : []),
        E.checkRow("Plays per level", `${args.runs} by the ${botName}`, "info"),
      ].join(""))),
      E.text(calibration),
      E.text(honest, { color: E.C.muted }),
      ...(shortNote ? [E.text(shortNote, { weight: 800 })] : []),
      E.panel(E.rows(args.levels.map((l, i) => E.checkRow(`Level ${i + 1} · target ${pct(l.target)}`, l.measured === null ? (l.notes?.replace(/^.*: search bot /, "") ?? "exact puzzle") : `measured ${pct(l.measured)}`, "pass")).join(""))),
      E.text(`Questions, or a different curve? Reply to this email or write to ${args.replyTo}.`, { color: E.C.muted }),
      ...(testNote ? [E.text(testNote, { color: E.C.muted })] : []),
    ].join(""),
  });
  const subject = short ? `Your level pack: ${n} of ${args.owed} levels ready` : `Your level pack is ready: ${what}`;
  return { subject: args.test ? `[Test order] ${subject}` : subject, body, html };
}

// ---------- one delivery ----------

export interface RunOptions {
  maker?: PackMaker;
  /** Skip the closing phone playtest (tests). */
  closingPlaytest?: boolean;
  maxMinutes?: number;
  /** Phone polling interval (tests use a few ms). */
  phonePollMs?: number;
}

/** Makes, saves, and emails one claimed delivery. Never throws; failures are logged as step-ins. */
export async function runPackDelivery(ctx: ToolContext, d: PackDelivery, opts: RunOptions = {}): Promise<PackDelivery["state"]> {
  const q = ctx.db!;
  const log = (action: string, why: string | null, result: string | null) => ctx.store.logActivity({ at: new Date().toISOString(), agent: AGENT, action, why, result, costUsd: null, human: false });
  const mode = d.test ? " (test order)" : "";
  const lead: Lead | null = d.leadId ? await ctx.store.getLead(d.leadId) : null;
  const company = lead?.company ?? "a customer";
  const genre = GENRES[d.gameId];
  const site = ctx.config.SITE_URL.replace(/\/+$/, "");
  const stepIn = async (why: string, state: "partial" | "failed", detail: string) => {
    await log(`step-in needed: level pack for ${company}`, why, `left for a person${mode}`);
    await patch(q, d.id, { state, detail, finished_at: new Date() });
    return state;
  };

  try {
    let packId = d.packId;
    let study = d.study;
    let curve = d.curve;
    let made: MakeResult | null = null;
    if (!packId || !(await packLevelIds(q, packId))) {
      if (!study) study = await studyGame(ctx, d, company, opts.phonePollMs);
      curve = curveFor(d.difficulty, d.levelsOwed, study);
      packId = packId ?? randomUUID();
      await patch(q, d.id, { study, curve, pack_id: packId });
      await log(`designing level pack for ${company}: ${d.levelsOwed} ${genre.label} levels`, curve.basis, `targets ${curve.targets.map(pct).join(", ")}${mode}`);

      const req: MakeRequest = {
        gameId: d.gameId, difficulty: d.difficulty, targets: curve.targets, seed: Number.parseInt(d.id.replace(/-/g, "").slice(0, 8), 16) >>> 0,
        maxSeconds: (opts.maxMinutes ?? MAX_MINUTES) * 60, maxCandidates: d.levelsOwed * 6, threads: Math.max(1, availableParallelism() - 4),
      };
      const maker = opts.maker ?? ctx.packMaker ?? workerPackMaker;
      made = await maker(req, async (p) => {
        if (p.kind === "accepted") {
          const l = p.level;
          await log(
            `level pack for ${company}: level ${l.slot} of ${p.of} accepted at ${l.measured_win_rate === null ? `${l.min_moves} moves` : pct(l.measured_win_rate)} (target ${pct(l.target)})`,
            `${l.bot} bot, ${l.measured_win_rate === null ? "exact solver" : `${l.wins}/${l.runs} wins`}, ${l.rounds} measurement${l.rounds === 1 ? "" : "s"}, candidate ${l.candidates}`,
            `run ${l.run_id}`,
          );
        } else {
          await log(`level pack for ${company}: level ${p.slot} candidate missed its ${pct(p.target)} target; trying a new one`, p.reason, null);
        }
      });
      if (!made.levels.length) {
        return await stepIn(`no level passed testing (${made.candidates} candidates, ${Math.round(made.elapsedMs / 1000)} s, stopped by ${made.stoppedBy})`, "failed", "no levels passed");
      }
      const name = `${company}: ${genre.label} level pack${d.plan === "subscription" ? `, part ${d.part}` : ""}`;
      await savePack(q, packId, d.gameId, name.slice(0, 120), made.levels);
      const rates = made.levels.map((l) => l.measured_win_rate).filter((x): x is number => x !== null);
      await log(
        `level pack for ${company}: ${made.levels.length} levels, measured ${rates.length ? `${pct(Math.min(...rates))}–${pct(Math.max(...rates))}` : "by fewest moves"} vs ${pct(curve.start)} → ${pct(curve.end)} curve`,
        `${made.candidates} candidates in ${Math.round(made.elapsedMs / 60000 * 10) / 10} min${made.stoppedBy !== "done" ? `; stopped by the ${made.stoppedBy} cap` : ""}`,
        `pack ${packId}${mode}`,
      );
    }
    curve = curve ?? curveFor(d.difficulty, d.levelsOwed, study);
    const saved = await packLevels(q, packId);
    const levelsDelivered = saved.length;
    const play = playUrl(site, d.gameId, packId, saved[0]?.level_id);
    const short = levelsDelivered < d.levelsOwed;

    // Email: once per delivery (AgentMail dedupes on the key, so a retry after a crash doesn't resend).
    const to = lead?.email ?? null;
    let messageId: string | null = null;
    if (!to || !ctx.mail) {
      await log(`level pack not emailed: ${company}`, !to ? "no email address on the order" : "no mail sender on this server", `left for a person${mode}`);
    } else if (await ctx.store.isSuppressed(to)) {
      await log(`level pack not emailed: ${company}`, "the customer opted out of email", `nothing sent${mode}`);
    } else {
      const firstMade = made?.levels[0];
      const mail = composePackEmail({
        name: lead?.contactName ?? null, company, gameId: d.gameId, difficulty: d.difficulty, owed: d.levelsOwed, levels: saved.map((l) => ({ ...l, url: levelUrl(site, d.gameId, l.level_id) })), curve,
        studiedGame: study?.game ?? d.studiedGame, studied: Boolean(study?.ok), playUrl: play, jsonUrl: jsonUrl(site, packId),
        siteUrl: site, test: d.test, companyName: ctx.config.COMPANY_NAME, postalAddress: ctx.config.COMPANY_POSTAL_ADDRESS ?? "",
        replyTo: ctx.config.AGENTMAIL_INBOX_ID ?? "levelai@agentmail.to", bot: firstMade?.bot ?? (d.gameId === "match3" ? "greedy" : d.gameId === "lotescape" ? "search" : "human"),
        runs: firstMade?.runs ?? (d.gameId === "match3" ? 100 : 200),
      });
      try {
        messageId = (await ctx.mail.send({ to, subject: mail.subject, text: mail.body, html: mail.html, idempotencyKey: idempotencyKey("level-pack", d.id) })).messageId;
        if (lead) await ctx.store.addOutreach({ leadId: lead.id, to, subject: mail.subject, body: mail.body, status: "sent", blockedReason: null, providerMessageId: messageId });
      } catch (err) {
        await log(`couldn't email ${company} their level pack`, errText(err), `pack ${packId} saved; left for a person${mode}`);
      }
    }

    const state = short ? "partial" : "delivered";
    await patch(q, d.id, { state, levels_delivered: levelsDelivered, email_message_id: messageId, finished_at: new Date(), detail: short ? `${levelsDelivered} of ${d.levelsOwed} levels` : null });
    if (messageId) await log(`delivered level pack to ${company}`, `${levelsDelivered} ${genre.label} levels: ${play}`, `message ${messageId}${mode}`);
    if (short) await log(`step-in needed: level pack for ${company}`, `delivered ${levelsDelivered} of ${d.levelsOwed} levels within the caps`, `left for a person${mode}`);
    if (d.paymentId && !short && messageId) {
      // The payment is delivered once every part of it is.
      const open = await q(`select count(*)::int as n from biz_pack_deliveries where payment_id = $1 and state not in ('delivered')`, [d.paymentId]);
      if (Number(open[0]?.n ?? 1) === 0) await ctx.store.addDelivery({ paymentId: d.paymentId, leadId: d.leadId, status: "delivered", detail: `level pack ${packId}` });
    }
    if (lead && messageId) await ctx.store.setStage(lead.id, "delivered");

    if (opts.closingPlaytest !== false && saved[0]) {
      await playtestPack(ctx, { ...d, curve }, company, packId, saved[0].level_id, opts.phonePollMs).catch((err: unknown) =>
        log(`playtest failed for level 1 of ${company}'s ${genre.label} pack`, errText(err), null));
    }
    return state;
  } catch (err) {
    return stepIn(errText(err), "failed", errText(err)).catch(() => "failed" as const);
  }
}

// ---------- the queue ----------

let draining: Promise<number> | null = null;

/**
 * Runs every due delivery, one at a time (the levels are CPU work and the study needs the phone).
 * A call while it's already running returns the same run.
 */
export function runDueDeliveries(ctx: ToolContext, opts: RunOptions = {}): Promise<number> {
  if (!ctx.db) return Promise.resolve(0);
  if (draining) return draining;
  draining = (async () => {
    let n = 0;
    try {
      for (let d = await claimNext(ctx.db!); d; d = await claimNext(ctx.db!)) {
        await runPackDelivery(ctx, d, opts);
        n++;
      }
    } finally {
      draining = null;
    }
    return n;
  })();
  return draining;
}

/** On boot: deliveries a restart cut off go back in the queue, then the queue runs. */
export async function resumePackDeliveries(ctx: ToolContext, opts: RunOptions = {}): Promise<number> {
  if (!ctx.db) return 0;
  const r = await ctx.db(`update biz_pack_deliveries set state = 'queued' where state = 'working' returning id`);
  for (const row of r) {
    await ctx.store.logActivity({ at: new Date().toISOString(), agent: AGENT, action: "resumed a level pack after a restart", why: "the server restarted before this pack was delivered", result: `delivery ${String(row.id)}`, costUsd: null, human: false });
  }
  void runDueDeliveries(ctx, opts).catch(() => undefined);
  return r.length;
}

/** Checks for due deliveries (the second half of a subscription month) every `minutes`. */
export function startPackDeliveryLoop(ctx: ToolContext, minutes = 10): () => void {
  const t = setInterval(() => void runDueDeliveries(ctx).catch(() => undefined), minutes * 60_000);
  return () => clearInterval(t);
}
