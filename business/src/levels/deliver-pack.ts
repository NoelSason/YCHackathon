import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import type { ToolContext } from "../mcp/tools.js";
import type { Query } from "../store.js";
import type { Lead } from "../types.js";
import { enqueue } from "../leads/playtest-offer.js";
import { idempotencyKey } from "../outreach/send.js";
import { MARKET_GAMES, runWork, type LoopResult, type LoopWork } from "../mobile/loop.js";
import { captureScreen } from "../mobile/screen.js";
import { activePhoneTask, LoopResultSchema, summarize as summarizeLoop } from "../mobile/loop.js";
import { sendCustomerEmail } from "../billing/outbox.js";
import * as E from "../email/html.js";
// BYOG hook (see runPackDelivery): a studio's own registered level generator.
import { externalPackRunner } from "../generators/hook.js";
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
  /** Set when the numbers come from an earlier phone session of the same game (the live one failed). */
  from?: string;
}

export interface PackCurve {
  start: number;
  end: number;
  /** Levels held at the start rate before the ramp begins. */
  plateau: number;
  /** The level with the biggest drop in target: the first level of the ramp. */
  steepest: number;
  targets: number[];
  /** True when the study set the curve; false for the documented default. */
  fromStudy: boolean;
  /** The mapping from what the phone saw to the curve, in one sentence: for the log and both emails. */
  basis: string;
}

/** The default curve, used whenever the study didn't measure a ramp: hold 85% for 3 levels. */
export const DEFAULT_PLATEAU = 3;

/**
 * The pack's curve: a target win rate per level.
 *
 *   - Starts at 85% and holds for a plateau. With a measured ramp, the plateau is half the moves the
 *     studied game took to get harder (1 to 6 levels); a game that got harder within 5 moves also ends
 *     5 points harder. Without one, it's the documented default: 3 levels, and the difficulty's end.
 *   - Then an ease-out ramp to the end point (easy 55%, medium 40%, hard 28%) by the last level: the
 *     biggest step comes first, right where the studied game got harder, and the steps shrink after it.
 *
 * It never invents study numbers: a field the phone didn't report is said to be missing.
 */
export function curveFor(difficulty: PackDifficulty, count: number, study: PackStudy | null): PackCurve {
  let end = CURVE_END[difficulty];
  let plateau = DEFAULT_PLATEAU;
  const ramped = Boolean(study?.ok && study.movesBeforeRamp !== null);
  if (ramped) {
    plateau = Math.max(1, Math.min(6, Math.round(study!.movesBeforeRamp! / 2)));
    if (study!.movesBeforeRamp! <= 5) end -= 0.05;
  }
  end = Math.round(Math.max(0.2, Math.min(0.7, end)) * 100) / 100;
  plateau = Math.min(plateau, Math.max(1, count - 1));
  const ramp = Math.max(1, count - plateau);
  // Ease-out: F(x) = 1 - (1 - x)^2, so the first step down is the biggest.
  const targets = Array.from({ length: count }, (_, i) => {
    if (i < plateau) return CURVE_START;
    const x = (i - plateau + 1) / ramp;
    return Math.round((CURVE_START - (CURVE_START - end) * (1 - (1 - x) ** 2)) * 100) / 100;
  });
  const steepest = Math.min(count, plateau + 1);
  const shape = `pack levels start at ${pct(CURVE_START)} win rate${plateau > 1 ? ` for ${plateau} levels` : ""} and ramp to ${pct(end)} by level ${count}, with the steepest step around level ${steepest}`;
  let basis: string;
  if (study?.ok && ramped) {
    const where = study.levelReached !== null ? ` at level ${study.levelReached}` : "";
    const stuck = study.stuckAt ? `players get stuck at ${study.stuckAt}` : "the phone didn't report a stuck point";
    basis = `${study.game} got harder after ~${study.movesBeforeRamp} moves${where}; ${stuck}${study.from ? ` (from ${study.from})` : ""} → so ${shape}.`;
  } else if (study?.ok) {
    const seen = study.levelReached !== null ? `reached level ${study.levelReached} without it getting noticeably harder` : "didn't see it get noticeably harder";
    basis = `Our iPhone ${seen} in ${study.game}${study.from ? ` (${study.from})` : ""}, so there's no measured ramp → we used our default ${difficulty} curve: ${shape}.`;
  } else {
    basis = `${study ? `Our iPhone couldn't finish a session of ${study.game}` : "No phone study"}, so there's no measured ramp → we used our default ${difficulty} curve: ${shape}.`;
  }
  return { start: CURVE_START, end, plateau, steepest, targets, fromStudy: ramped, basis };
}

/** Rough build time for the "you'll get them in about N minutes" line (measured Nov 7 on this laptop). */
export function etaMinutes(game: PackGameId, levels: number): number {
  const per20 = { match3: 4, watersort: 1, racer: 3, lotescape: 3 }[game]; // match-3 live: 1.4-1.7 min on 12 threads, up to 8 standalone
  return Math.max(1, Math.ceil((per20 * levels) / 20));
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
    `update biz_pack_deliveries set state = 'working', started_at = now()
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

/**
 * The newest successful phone session of this game in the activity log (the playtest loop studies
 * App Store games on its own), parsed back from its summary line. Null when there's none this week.
 */
export async function earlierStudy(ctx: ToolContext, game: string): Promise<PackStudy | null> {
  const week = Date.now() - 7 * 86_400_000;
  const hit = (await ctx.store.listActivity(1000)).find((a) =>
    a.agent === "playtest-lead" && a.action.startsWith(`playtested ${game} (`) && Date.parse(a.at) >= week);
  if (!hit) return null;
  const summary = hit.action.slice(hit.action.indexOf("): ") + 3);
  const num = (re: RegExp): number | null => { const m = summary.match(re); return m ? Number(m[1]) : null; };
  const when = new Date(hit.at).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return {
    ok: true, game, movesBeforeRamp: num(/got harder after (\d+)/), levelReached: num(/level (\d+)/), stuckAt: summary.match(/stuck: ([^;]+)/)?.[1] ?? null,
    designNote: hit.result?.startsWith("Design note: ") ? hit.result.slice(13).replace(/ \(task [^)]+\)$/, "") : null,
    won: /^won/.test(summary) ? true : /^lost/.test(summary) ? false : null, summary, taskId: hit.result?.match(/\(task ([^)]+)\)/)?.[1] ?? null,
    from: `our iPhone's earlier session, ${when} PT`,
  };
}

/** A phone screenshot made small for email: a JPEG under ~150 KB via macOS `sips`, or the PNG as is. */
export async function smallScreenshot(png: Uint8Array): Promise<{ data: Buffer; type: string; ext: string } | null> {
  if (!png.length) return null;
  const { execFile } = await import("node:child_process");
  const { mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "levelai-shot-"));
  try {
    await writeFile(join(dir, "in.png"), png);
    await new Promise<void>((res, rej) => execFile("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "60", "-Z", "640", join(dir, "in.png"), "--out", join(dir, "out.jpg")], { timeout: 15_000 }, (e) => (e ? rej(e) : res())));
    return { data: await readFile(join(dir, "out.jpg")), type: "image/jpeg", ext: "jpg" };
  } catch {
    return png.length <= 1_500_000 ? { data: Buffer.from(png), type: "image/png", ext: "png" } : null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Who a delivery's emails go to, and how they're labeled. */
interface Recipient { to: string | null; first: string; company: string; test: boolean; leadId: string | null }

/** Sends a recap email with an optional inline screenshot. Logs a skipped or failed send; never throws. */
async function sendRecap(ctx: ToolContext, who: Recipient, key: string, mail: { subject: string; body: string; html: string }, shot: { data: Buffer; type: string; ext: string } | null, what: string): Promise<string | null> {
  const log = (action: string, why: string | null, result: string | null) => ctx.store.logActivity({ at: new Date().toISOString(), agent: AGENT, action, why, result, costUsd: null, human: false });
  const mode = who.test ? " (test order)" : "";
  if (!who.to) { await log(`${what} not emailed: ${who.company}`, "no email address on the order", null); return null; }
  if (await ctx.store.isSuppressed(who.to)) { await log(`${what} not emailed: ${who.company}`, "the customer opted out of email", null); return null; }
  // Through the customer outbox: a refused send (e.g. the new-recipient cap) is kept and retried.
  const r = await sendCustomerEmail(ctx, {
    kind: "level-pack", leadId: who.leadId, company: who.company, to: who.to, subject: mail.subject, text: mail.body, html: mail.html,
    idempotencyKey: idempotencyKey("pack-recap", key), test: who.test,
    ...(shot ? { attachments: [{ filename: `iphone.${shot.ext}`, contentType: shot.type, contentBase64: shot.data.toString("base64"), contentId: "iphone-shot", inline: true }] } : {}),
  });
  if (!r.sent) return null;
  if (who.leadId) await ctx.store.addOutreach({ leadId: who.leadId, to: who.to, subject: mail.subject, body: mail.body, status: "sent", blockedReason: null, providerMessageId: r.messageId });
  await log(`emailed the ${what} to ${who.company}`, mail.subject, `message ${r.messageId}${shot ? ", with an iPhone screenshot" : ""}${mode}`);
  return r.messageId;
}

const shotHtml = `<img src="cid:iphone-shot" width="240" alt="Screenshot from our iPhone" style="display:block;max-width:240px;width:100%;height:auto;border-radius:14px;margin:4px 0 18px;border:0">`;

/** "Here's how your game played on our iPhone": sent as soon as the phone study ends. */
export function composeStudyRecap(args: {
  first: string; game: string; study: PackStudy | null; liveFailed: string | null; curve: PackCurve; levels: number; genre: string; eta: number;
  test: boolean; screenshot: boolean; companyName: string; postalAddress: string; replyTo: string;
}): { subject: string; body: string; html: string } {
  const st = args.study;
  const facts: Array<[string, string]> = [];
  if (st?.ok) {
    facts.push(["Levels reached", st.levelReached !== null ? `level ${st.levelReached}` : "not reported"]);
    facts.push(["Result", st.won === true ? "won" : st.won === false ? "lost" : "still playing"]);
    const moves = st.summary.match(/in (\d+) moves/)?.[1];
    if (moves) facts.push(["Moves played", moves]);
    facts.push(["Got harder after", st.movesBeforeRamp !== null ? `about ${st.movesBeforeRamp} moves` : "not seen in this session"]);
    facts.push(["Where a player gets stuck", st.stuckAt ?? "not seen in this session"]);
  }
  const intro = st?.ok
    ? st.from
      ? `Our iPhone's session of ${args.game} just now didn't finish (${args.liveFailed ?? "no result"}), so we used its earlier session (${st.from.replace(/^our iPhone's earlier session, /, "")}). Here's what it saw.`
      : `Here's how ${args.game} played on our iPhone, before we build your levels.`
    : `Our iPhone couldn't finish a session of ${args.game} this time (${args.liveFailed ?? "no result"}), so we have no measurements from it.`;
  const next = `Next: we're building ${args.levels} ${args.genre} levels calibrated to this curve; you'll get them in about ${args.eta} minute${args.eta === 1 ? "" : "s"}.`;
  const testNote = args.test ? "This is a test order, so no money was charged." : null;
  const footerReason = "You're getting it because you ordered a level pack.";
  const body = [
    `Hi ${args.first},`, "", intro, "",
    ...facts.map(([k, v]) => `- ${k}: ${v}`),
    ...(st?.ok && st.designNote ? [`- Design note: ${st.designNote}`] : []),
    ...(facts.length ? [""] : []),
    `What that means for your pack: ${args.curve.basis}`, "",
    ...(args.screenshot ? ["A screenshot from the phone is attached.", ""] : []),
    next, "",
    ...(testNote ? [testNote, ""] : []),
    args.companyName, "", "—",
    `${args.companyName} is a small studio where AI agents design and test levels, and this email was written by one of them. ${footerReason}`,
    args.postalAddress,
  ].join("\n");
  const html = E.layout({
    preheader: st?.ok ? `${args.game} on our iPhone, and the curve it sets for your pack.` : `We used our default curve for your pack.`,
    companyName: args.companyName, postalAddress: args.postalAddress, footerReason,
    body: [
      E.eyebrow(args.test ? "Phone study · test order" : "Phone study", E.C.blue),
      E.heading(`How ${args.game} played on our iPhone`),
      E.text(intro, { color: E.C.muted }),
      ...(args.screenshot ? [shotHtml] : []),
      ...(facts.length ? [E.panel(E.rows(facts.map(([k, v]) => E.checkRow(k, v, "info")).join("")))] : []),
      ...(st?.ok && st.designNote ? [E.quote(st.designNote)] : []),
      E.text(`What that means for your pack: ${args.curve.basis}`),
      E.text(next, { weight: 800 }),
      ...(testNote ? [E.text(testNote, { color: E.C.muted })] : []),
    ].join(""),
  });
  const subject = `How ${args.game} played on our iPhone`;
  return { subject: args.test ? `[Test order] ${subject}` : subject, body, html };
}

/** "We played level 1 of your pack": sent after the closing phone run. */
export function composeLevelOneRecap(args: {
  first: string; genre: string; result: LoopResult | null; summary: string; target: number | null; playUrl: string; test: boolean; screenshot: boolean;
  companyName: string; postalAddress: string; replyTo: string;
}): { subject: string; body: string; html: string } {
  const r = args.result;
  const outcome = r ? args.summary : `the phone couldn't finish the run (${args.summary})`;
  const target = args.target !== null ? ` Our bots set it to about ${pct(args.target)} win rate, so most first-time players should beat it.` : "";
  const testNote = args.test ? "This is a test order, so no money was charged." : null;
  const footerReason = "You're getting it because you ordered a level pack.";
  const body = [
    `Hi ${args.first},`, "",
    `We played level 1 of your ${args.genre} pack on our iPhone, as a first-time player: ${outcome}.${target}`, "",
    ...(r?.designNote ? [`What the phone noticed: ${r.designNote}`, ""] : []),
    ...(r?.visualIssues.length ? [`Anything that looked off: ${r.visualIssues.join("; ")}`, ""] : []),
    ...(args.screenshot ? ["A screenshot from the phone is attached.", ""] : []),
    `Play it yourself: ${args.playUrl}`, "",
    ...(testNote ? [testNote, ""] : []),
    args.companyName, "", "—",
    `${args.companyName} is a small studio where AI agents design and test levels, and this email was written by one of them. ${footerReason}`,
    args.postalAddress,
  ].join("\n");
  const html = E.layout({
    preheader: `Level 1 of your pack on our iPhone: ${outcome}.`, companyName: args.companyName, postalAddress: args.postalAddress, footerReason,
    body: [
      E.eyebrow(args.test ? "Phone playtest · test order" : "Phone playtest", E.C.purple),
      E.heading(`We played level 1 of your pack`),
      E.text(`On our iPhone, as a first-time player: ${outcome}.${target}`),
      ...(args.screenshot ? [shotHtml] : []),
      ...(r?.designNote ? [E.quote(r.designNote)] : []),
      ...(r?.visualIssues.length ? [E.text(`Anything that looked off: ${r.visualIssues.join("; ")}`, { color: E.C.muted })] : []),
      E.button("Play level 1", args.playUrl),
      ...(testNote ? [E.text(testNote, { color: E.C.muted })] : []),
    ].join(""),
  });
  const subject = "We played level 1 of your pack on our iPhone";
  return { subject: args.test ? `[Test order] ${subject}` : subject, body, html };
}

/**
 * Before starting a phone study: if the phone is already running a task (for example a study a
 * restarted server left behind), wait for it instead of piling a second one on. When that task is a
 * study of this same game, its result is used. Waits at most 8 minutes.
 */
export async function waitForPhone(client: NonNullable<ToolContext["mobilerun"]>, deviceId: string, game: string, pollMs = 10_000): Promise<{ result: LoopResult; taskId: string } | null> {
  const until = Date.now() + 8 * 60_000;
  let adoptId: string | null = null;
  while (Date.now() < until) {
    const active = await activePhoneTask(client, deviceId).catch(() => null);
    if (!active) break;
    if (!adoptId) {
      const prompt = await client.tasks.retrieve(active).then((t) => t.task.task).catch(() => "");
      if (prompt.includes(`"${game}"`) && /for game-design research/.test(prompt)) adoptId = active;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  if (!adoptId) return null;
  const st = await client.tasks.getStatus(adoptId).catch(() => null);
  const parsed = LoopResultSchema.safeParse(st?.output);
  return parsed.success && parsed.data.loaded ? { result: parsed.data, taskId: adoptId } : null;
}

async function studyGame(ctx: ToolContext, d: PackDelivery, who: Recipient, pollMs?: number): Promise<PackStudy | null> {
  const company = who.company;
  const log = (action: string, why: string | null, result: string | null) => ctx.store.logActivity({ at: new Date().toISOString(), agent: AGENT, action, why, result, costUsd: null, human: false });
  const work = studyWork(d);
  const name = d.studiedGame ?? "their game";
  const client = ctx.mobilerun;
  const deviceId = ctx.config.MOBILERUN_DEVICE_ID;
  if (!work || !client || !deviceId) {
    await log(`couldn't study ${name} on the iPhone; using the default ${d.difficulty} curve`, `level pack for ${company}`, !work ? "no playable link or App Store bundle id on the order" : "the phone isn't set up on this server");
    return null;
  }
  await log(`studying ${work.name} on the iPhone to set the difficulty curve`, `level pack for ${company}`, null);
  // The shared phone queue: paid playtests, the playtest loop, and this never collide. A short session
  // (10 moves, 20 steps) so it finishes inside the time limit; the screenshot is taken while the game
  // is still on screen.
  const t0 = Date.now();
  let shotPng: Uint8Array | null = null;
  const out = await enqueue(async () => {
    const left = await waitForPhone(client, deviceId, work.name, pollMs);
    if (left) {
      await log(`picked up the iPhone session of ${work.name} a restart left running`, `level pack for ${company}`, `task ${left.taskId}`);
      shotPng = await captureScreen(client, deviceId);
      return { result: left.result, taskId: left.taskId, summary: summarizeLoop(left.result), error: null };
    }
    const o = await runWork(ctx, client, deviceId, work, { maxSeconds: 6 * 60, moves: 10, maxSteps: 20, ...(pollMs ? { pollMs } : {}) });
    if (o?.result) shotPng = await captureScreen(client, deviceId);
    return o;
  }).catch((err: unknown) => ({ error: errText(err), result: null as LoopResult | null, taskId: null as string | null, summary: "" }));
  const secs = Math.round((Date.now() - t0) / 1000);
  const r = out && "result" in out ? out.result : null;
  let study: PackStudy;
  let liveFailed: string | null = null;
  if (!r) {
    liveFailed = (out && "error" in out && out.error) || "the phone didn't return a result";
    const past = await earlierStudy(ctx, work.name).catch(() => null);
    if (past) {
      const ramp = past.movesBeforeRamp !== null ? `gets harder after ~${past.movesBeforeRamp} moves` : "didn't get noticeably harder";
      await log(`${work.name}: ${ramp}${past.stuckAt ? `; players get stuck at ${past.stuckAt}` : ""} (from ${past.from})`.slice(0, 300), `this ${secs} s session failed (${liveFailed}), so the curve uses the newest earlier one`, past.designNote ? `Design note: ${past.designNote.slice(0, 300)}` : null);
      study = past;
    } else {
      await log(`couldn't study ${work.name} on the iPhone; using the default ${d.difficulty} curve`, `level pack for ${company}; ${secs} s`, liveFailed);
      study = { ok: false, game: work.name, movesBeforeRamp: null, levelReached: null, stuckAt: null, designNote: null, won: null, summary: "no result", taskId: out?.taskId ?? null };
    }
  } else {
    study = {
      ok: true, game: work.name, movesBeforeRamp: r.movesBeforeRamp, levelReached: r.levelReached, stuckAt: r.stuckAt, designNote: r.designNote || null,
      won: r.won, summary: out?.summary ?? "", taskId: out?.taskId ?? null,
    };
    const ramp = r.movesBeforeRamp !== null ? `gets harder after ~${r.movesBeforeRamp} moves${r.levelReached !== null ? ` (reached level ${r.levelReached})` : ""}` : `didn't get noticeably harder in our session${r.levelReached !== null ? ` (reached level ${r.levelReached})` : ""}`;
    await log(`${work.name}: ${ramp}${r.stuckAt ? `; players get stuck at ${r.stuckAt}` : ""}`.slice(0, 300), `phone study for ${company}'s level pack, ${secs} s`, r.designNote ? `Design note: ${r.designNote.slice(0, 300)}` : null);
  }

  // The recap goes out right away, before the build.
  const curve = curveFor(d.difficulty, d.levelsOwed, study);
  const shot = shotPng ? await smallScreenshot(shotPng) : null;
  await sendRecap(ctx, who, `${d.id}:study`, composeStudyRecap({
    first: who.first, game: work.name, study, liveFailed, curve, levels: d.levelsOwed, genre: GENRES[d.gameId].label, eta: etaMinutes(d.gameId, d.levelsOwed),
    test: d.test, screenshot: Boolean(shot), companyName: ctx.config.COMPANY_NAME, postalAddress: ctx.config.COMPANY_POSTAL_ADDRESS ?? "",
    replyTo: ctx.config.AGENTMAIL_INBOX_ID ?? "levelai@agentmail.to",
  }), shot, "phone study recap");
  return study;
}

/** The closing shot: the main phone opens level 1 of the pack in our player, plays it, and the customer gets a recap. */
async function playtestPack(ctx: ToolContext, d: PackDelivery, who: Recipient, packId: string, firstLevelId: string, pollMs?: number): Promise<void> {
  const client = ctx.mobilerun;
  const deviceId = ctx.config.MOBILERUN_DEVICE_ID;
  if (!client || !deviceId) return;
  const genre = GENRES[d.gameId];
  const site = ctx.config.SITE_URL.replace(/\/+$/, "");
  const url = playUrl(site, d.gameId, packId, firstLevelId);
  let shotPng: Uint8Array | null = null;
  const out = await enqueue(async () => {
    const o = await runWork(ctx, client, deviceId, {
      kind: "own", name: `level 1 of ${who.company}'s ${genre.label} pack`, url, levelId: firstLevelId,
      targetWinRate: d.curve?.targets[0] ?? null, genre: genre.label, howToPlay: genre.howToPlay,
    }, { maxSeconds: 6 * 60, moves: 10, maxSteps: 20, ...(pollMs ? { pollMs } : {}) }); // 4 min timed out on /play (Nov 7, 9:56 PM)
    if (o?.result) shotPng = await captureScreen(client, deviceId);
    return o;
  });
  const shot = shotPng ? await smallScreenshot(shotPng) : null;
  await sendRecap(ctx, who, `${d.id}:level1`, composeLevelOneRecap({
    first: who.first, genre: genre.label, result: out?.result ?? null, summary: out?.summary ?? "the page didn't load on the phone", target: d.curve?.targets[0] ?? null,
    playUrl: url, test: d.test, screenshot: Boolean(shot), companyName: ctx.config.COMPANY_NAME, postalAddress: ctx.config.COMPANY_POSTAL_ADDRESS ?? "",
    replyTo: ctx.config.AGENTMAIL_INBOX_ID ?? "levelai@agentmail.to",
  }), shot, "level 1 playtest recap");
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
  const measuredCell = (l: { measured: number | null; notes: string | null }) => (l.measured === null ? (l.notes?.replace(/^.*: search bot /, "") ?? "exact puzzle") : pct(l.measured));
  const lines = args.levels.map((l, i) => `Level ${String(i + 1).padStart(2)}   target ${pct(l.target).padStart(4)}   measured ${measuredCell(l).padStart(4)}   ${l.url}`);
  const calibration = args.studied && args.studiedGame
    ? `How we set the curve: before building, our iPhone played ${args.studiedGame}. ${args.curve.basis}`
    : `How we set the curve: ${args.curve.basis}`;
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
    `The curve, level by level: target vs. measured (${args.runs} plays each by the ${botName}):`,
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
      E.text(`The curve, level by level (${args.runs} plays each by the ${botName}):`, { weight: 800 }),
      E.table(["Level", "Target", "Measured", ""], args.levels.map((l, i) => ({ cells: [String(i + 1), pct(l.target), measuredCell(l), "Play"], link: l.url }))),
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
  const who: Recipient = { to: lead?.email ?? null, first: lead?.contactName ? lead.contactName.split(" ")[0]! : company, company, test: d.test, leadId: lead?.id ?? null };
  const stepIn = async (why: string, state: "partial" | "failed", detail: string) => {
    await log(`step-in needed: level pack for ${company}`, why, `left for a person${mode}`);
    await patch(q, d.id, { state, detail, finished_at: new Date() });
    return state;
  };

  try {
    // ---- BYOG hook (bring your own generator, generators/hook.ts) ----
    // A studio that registered its own level generator for this genre gets its pack built by it:
    // their generator makes each level, their bot measures it, our loop tunes it (generators/pack.ts).
    // A failed lookup (e.g. its table isn't in this database yet) must not stop the normal path.
    const external = await externalPackRunner(ctx, d).catch(async (err: unknown) => {
      // The generator table not being in this database yet just means nobody registered one.
      if (!/does not exist/i.test(errText(err))) await log(`own-generator check skipped for ${company}'s pack`, errText(err), "using our engine");
      return null;
    });
    if (external) return await external(opts);
    // ---- end BYOG hook ----
    let packId = d.packId;
    let study = d.study;
    let curve = d.curve;
    let made: MakeResult | null = null;
    if (!packId || !(await packLevelIds(q, packId))) {
      if (!study) study = await studyGame(ctx, d, who, opts.phonePollMs);
      curve = curveFor(d.difficulty, d.levelsOwed, study);
      packId = packId ?? randomUUID();
      await patch(q, d.id, { study, curve, pack_id: packId });
      await log(`difficulty curve for ${company}'s pack: ${curve.basis}`.slice(0, 400), curve.fromStudy ? "set from the phone study" : "documented default curve (no measured ramp)", `targets ${curve.targets.map(pct).join(", ")}`);
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
    if (!to) {
      await log(`level pack not emailed: ${company}`, "no email address on the order", `left for a person${mode}`);
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
      // Through the customer outbox (sends once per delivery; a refused send is retried, not lost).
      const r = await sendCustomerEmail(ctx, {
        kind: "level-pack", leadId: lead?.id ?? null, company, to, subject: mail.subject, text: mail.body, html: mail.html,
        idempotencyKey: idempotencyKey("level-pack", d.id), test: d.test,
      });
      if (r.sent) {
        messageId = r.messageId;
        if (lead) await ctx.store.addOutreach({ leadId: lead.id, to, subject: mail.subject, body: mail.body, status: "sent", blockedReason: null, providerMessageId: messageId });
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
      await playtestPack(ctx, { ...d, curve }, who, packId, saved[0].level_id, opts.phonePollMs).catch((err: unknown) =>
        log(`playtest failed for level 1 of ${company}'s ${genre.label} pack`, errText(err), null));
    }
    return state;
  } catch (err) {
    return stepIn(errText(err), "failed", errText(err)).catch(() => "failed" as const);
  }
}

// ---------- the queue ----------

let draining: Promise<number> | null = null;
let rerun = false;
const PROCESS_START = new Date();

/**
 * Runs every due delivery, one at a time (the levels are CPU work and the study needs the phone).
 * A call while it's already running returns the same run.
 */
export function runDueDeliveries(ctx: ToolContext, opts: RunOptions = {}): Promise<number> {
  if (!ctx.db) return Promise.resolve(0);
  // A call during a run asks for one more pass, so a row added after the run's last check isn't missed.
  if (draining) { rerun = true; return draining; }
  draining = (async () => {
    let n = 0;
    try {
      do {
        rerun = false;
        for (let d = await claimNext(ctx.db!); d; d = await claimNext(ctx.db!)) {
          await runPackDelivery(ctx, d, opts);
          n++;
        }
      } while (rerun);
    } finally {
      draining = null;
    }
    return n;
  })();
  return draining;
}

/** On boot: deliveries a restart cut off go back in the queue, then the queue runs. */
/** A delivery a restart cut off goes back in the queue at most this many times; then a person is asked. */
export const MAX_RESUMES = 2;

export async function resumePackDeliveries(ctx: ToolContext, opts: RunOptions = {}): Promise<number> {
  if (!ctx.db) return 0;
  // Only rows claimed before this process started: a delivery this process already picked up keeps going.
  const cut = await ctx.db(`select id, resumes from biz_pack_deliveries where state = 'working' and started_at < $1`, [PROCESS_START.toISOString()]);
  let n = 0;
  for (const row of cut) {
    const id = String(row.id);
    const resumes = Number(row.resumes ?? 0);
    if (resumes >= MAX_RESUMES) {
      await ctx.db(`update biz_pack_deliveries set state = 'failed', detail = $2, finished_at = now() where id = $1 and state = 'working'`, [id, `cut off by ${resumes + 1} restarts`]);
      await ctx.store.logActivity({ at: new Date().toISOString(), agent: AGENT, action: "step-in needed: a level pack was cut off by restarts", why: `${resumes + 1} server restarts before it finished; not resumed again`, result: `delivery ${id}; left for a person`, costUsd: null, human: false });
      continue;
    }
    await ctx.db(`update biz_pack_deliveries set state = 'queued', resumes = resumes + 1 where id = $1 and state = 'working'`, [id]);
    await ctx.store.logActivity({ at: new Date().toISOString(), agent: AGENT, action: "resumed a level pack after a restart", why: `the server restarted before this pack was delivered (resume ${resumes + 1} of ${MAX_RESUMES})`, result: `delivery ${id}`, costUsd: null, human: false });
    n++;
  }
  void runDueDeliveries(ctx, opts).catch(() => undefined);
  return n;
}

/** Checks for due deliveries (the second half of a subscription month) every `minutes`. */
export function startPackDeliveryLoop(ctx: ToolContext, minutes = 10): () => void {
  const t = setInterval(() => void runDueDeliveries(ctx).catch(() => undefined), minutes * 60_000);
  return () => clearInterval(t);
}
