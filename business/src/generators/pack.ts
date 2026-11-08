import { randomUUID } from "node:crypto";
import { onTarget } from "../../../solver/src/autotune.js";
import { wilson95 } from "../../../solver/src/stats.js";
import type { ToolContext } from "../mcp/tools.js";
import type { Query } from "../store.js";
import type { Lead } from "../types.js";
import { idempotencyKey } from "../outreach/send.js";
import * as E from "../email/html.js";
import { AGENT, curveFor, GENRES, jsonUrl, levelUrl, playUrl, type PackCurve, type PackDelivery, type RunOptions } from "../levels/deliver-pack.js";
import { CUSTOMER_PACK_MAKER } from "../levels/public.js";
import { decryptSecret } from "./protocol.js";
import { generatorClient, GeneratorCallError, type GeneratorClient } from "./client.js";
import type { Generator } from "./store.js";

/**
 * A level pack built by the studio's OWN generator. For each level of the pack's curve:
 *
 *   1. ask their generator for a level at a difficulty setting (0–1): "asked <studio>'s generator for level 7 at difficulty 0.42";
 *   2. have their evaluate endpoint play it with THEIR bot (only they can run their game);
 *   3. accept it by the solver's own rule (`onTarget`, solver/src/autotune.ts): "level 7 measured 51% vs 50% target: accepted";
 *      otherwise move the difficulty toward the target (bracket and interpolate, else step) and ask again with a new seed.
 *
 * Their endpoint is called with timeouts, retries, and a circuit breaker (client.ts). If it stops
 * answering, the pack pauses: levels that passed are saved and sent (marked short), and a step-in is
 * logged for a person. Nothing is swapped in from our engine, since our levels wouldn't be in their format.
 */

/** Plays per measurement on their evaluate endpoint. */
export const EVAL_RUNS = 100;
/** Levels asked for per pack slot before the pack stops short. */
export const TRIES_PER_LEVEL = 6;
const MAX_MINUTES = Number(process.env.PACK_MAX_MINUTES ?? 40);

export interface ExternalLevel {
  slot: number;
  target: number;
  level: Record<string, unknown>;
  meta: Record<string, unknown> | null;
  difficulty: number;
  seed: number;
  wins: number;
  runs: number;
  measured: number;
  ci95: [number, number];
  solvable: boolean | null;
  min_moves: number | null;
  bot: string;
  tries: number;
}

export interface BuildResult {
  levels: ExternalLevel[];
  stoppedBy: "done" | "time" | "attempts" | "generator_down";
  error: string | null;
  calls: number;
  elapsedMs: number;
}

type Log = (action: string, why: string | null, result: string | null) => Promise<void>;
const pct = (x: number): string => `${Math.round(x * 100)}%`;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const r3 = (x: number): number => Math.round(x * 1000) / 1000;

/**
 * The next difficulty to ask for. With one try on each side of the target, interpolate between the
 * closest two; otherwise step by how far off it was (at most 0.3, at least 0.03).
 */
export function nextDifficulty(seen: Array<{ d: number; rate: number }>, d: number, rate: number, target: number): number {
  const easy = seen.filter((s) => s.rate > target);
  const hard = seen.filter((s) => s.rate < target);
  if (easy.length && hard.length) {
    const a = easy.reduce((x, y) => (y.d > x.d ? y : x));
    const b = hard.reduce((x, y) => (y.d < x.d ? y : x));
    if (a.d < b.d && a.rate !== b.rate) return r3(clamp01(a.d + ((a.rate - target) / (a.rate - b.rate)) * (b.d - a.d)));
  }
  let step = Math.max(-0.3, Math.min(0.3, rate - target));
  if (Math.abs(step) < 0.03) step = Math.sign(step || 1) * 0.03;
  return r3(clamp01(d + step));
}

/** The tuning loop over their generator. Pure apart from the client and the log, so tests run it with a fake endpoint. */
export async function buildWithGenerator(client: GeneratorClient, args: {
  targets: number[]; seed: number; studio: string; log: Log; runs?: number; maxSeconds?: number; triesPerLevel?: number; params?: Record<string, unknown>;
}): Promise<BuildResult> {
  const t0 = Date.now();
  const deadline = t0 + (args.maxSeconds ?? MAX_MINUTES * 60) * 1000;
  const runs = args.runs ?? EVAL_RUNS;
  const tries = args.triesPerLevel ?? TRIES_PER_LEVEL;
  const levels: ExternalLevel[] = [];
  let calls = 0;
  let validateOffered = true;
  let prev: { d: number; t: number } | null = null;
  const done = (stoppedBy: BuildResult["stoppedBy"], error: string | null = null): BuildResult => ({ levels, stoppedBy, error, calls, elapsedMs: Date.now() - t0 });

  for (let slot = 1; slot <= args.targets.length; slot++) {
    const t = args.targets[slot - 1]!;
    // First guess: the last level's setting, moved by the change in target; the very first starts at 1 − target.
    let d = r3(clamp01(prev ? prev.d + (prev.t - t) : 1 - t));
    const seen: Array<{ d: number; rate: number }> = [];
    let made: ExternalLevel | null = null;
    for (let k = 1; k <= tries && !made; k++) {
      if (Date.now() >= deadline) return done("time");
      const seed = ((args.seed + slot * 7919 + k * 104_729) % 2_147_483_647) + 1;
      await args.log(`asked ${args.studio}'s generator for level ${slot} at difficulty ${d.toFixed(2)}`, `target ${pct(t)} win rate${k > 1 ? `; try ${k}` : ""}`, null);
      try {
        calls++;
        const g = await client.generate({ seed, difficulty: d, ...(args.params ? { params: args.params } : {}), context: { pack_level: slot, pack_size: args.targets.length, target_win_rate: t } });
        if (validateOffered) {
          calls++;
          const v = await client.validate(g.level);
          if (!v) validateOffered = false;
          else if (!v.ok) {
            await args.log(`${args.studio}'s validate rejected their level ${slot}; asking for another`, (v.errors ?? []).join("; ").slice(0, 200) || "no reason given", null);
            continue;
          }
        }
        calls++;
        const e = await client.evaluate({ level: g.level, runs, seed });
        const bot = e.bot ?? "their bot";
        if (e.solvable === false) {
          await args.log(`${args.studio}'s level ${slot} isn't solvable by their own check; asking for another`, `${bot} on their evaluate endpoint`, null);
          continue;
        }
        const rate = e.wins / e.runs;
        const ci = wilson95(e.wins, e.runs);
        const why = `${bot} won ${e.wins}/${e.runs} on their evaluate endpoint (95% interval ${pct(ci.low)}–${pct(ci.high)})`;
        if (onTarget({ win_rate: rate, ci95_low: ci.low, ci95_high: ci.high }, t)) {
          made = {
            slot, target: t, level: g.level, meta: g.meta ?? null, difficulty: d, seed, wins: e.wins, runs: e.runs, measured: r3(rate), ci95: [r3(ci.low), r3(ci.high)],
            solvable: e.solvable ?? null, min_moves: e.min_moves ?? null, bot, tries: k,
          };
          await args.log(`${args.studio}'s level ${slot} measured ${pct(rate)} vs ${pct(t)} target: accepted`, why, `difficulty ${d.toFixed(2)}, try ${k}`);
        } else {
          seen.push({ d, rate });
          const nd = nextDifficulty(seen, d, rate, t);
          const move = nd === d ? `already at difficulty ${d.toFixed(2)}, asking for another level` : `difficulty ${d.toFixed(2)} → ${nd.toFixed(2)}`;
          await args.log(`${args.studio}'s level ${slot} measured ${pct(rate)} vs ${pct(t)} target: too ${rate > t ? "easy" : "hard"}; ${move}`, why, null);
          d = nd;
        }
      } catch (err) {
        const msg = (err instanceof Error ? err.message : String(err)).slice(0, 200);
        if (err instanceof GeneratorCallError && err.kind === "circuit_open") return done("generator_down", msg);
        await args.log(`${args.studio}'s generator failed on level ${slot}`, msg, k < tries ? "trying again" : null);
      }
    }
    if (!made) return done("attempts", `level ${slot} didn't land within ${pct(0.05)} of its ${pct(t)} target in ${tries} tries`);
    levels.push(made);
    prev = { d: made.difficulty, t };
  }
  return done("done");
}

// ---------- saving ----------

async function savePack(q: Query, packId: string, d: PackDelivery, gen: Generator, studio: string, made: ExternalLevel[]): Promise<void> {
  // Levels and packs reference games(game_id); make sure the genre's row exists (never changes one).
  await q(`insert into games (game_id, name, bots, default_win_rate) values ($1, $2, $3::jsonb, 0.40) on conflict do nothing`, [d.gameId, GENRES[d.gameId].game, JSON.stringify([made[0]?.bot ?? "external"])]);
  const input = made.map((m, i) => ({
    level_id: randomUUID(), ord: i, level: m.level, target: m.target, measured: m.measured,
    notes: `level pack ${packId}, level ${i + 1}: from ${studio}'s generator "${gen.name}" at difficulty ${m.difficulty.toFixed(2)}; ${m.bot} won ${m.wins}/${m.runs} on their evaluate endpoint`,
    run_id: randomUUID(), bot: m.bot, runs: m.runs,
    results: { [m.bot]: { runs: m.runs, wins: m.wins, win_rate: m.measured, ci95_low: m.ci95[0], ci95_high: m.ci95[1] }, external_generator: { id: gen.id, difficulty: m.difficulty, seed: m.seed, tries: m.tries, meta: m.meta } },
    solvable: m.solvable, min_moves: m.min_moves,
  }));
  await q(
    `with input as (
       select * from jsonb_to_recordset($1::jsonb) as x(level_id uuid, ord int, level jsonb, target numeric, measured numeric, notes text,
                                                        run_id uuid, bot text, runs int, results jsonb, solvable boolean, min_moves int)
     ), l as (
       insert into levels (level_id, game_id, level, target_win_rate, status, measured_win_rate, notes, created_by)
       select level_id, $2, level, target, 'published', measured, notes, $5 from input returning level_id
     ), s as (
       insert into solver_runs (run_id, level_id, bots, runs_per_bot, status, results, solvable, min_moves, claimed_by, started_at, finished_at)
       select run_id, level_id, jsonb_build_array(bot), runs, 'done', results, solvable, min_moves, 'external-generator', now(), now() from input returning run_id
     )
     insert into packs (pack_id, game_id, name, level_ids)
     values ($3, $2, $4, (select jsonb_agg(level_id order by ord) from input))`,
    [JSON.stringify(input), d.gameId, packId, `${studio}: ${GENRES[d.gameId].label} level pack from their generator`.slice(0, 120), CUSTOMER_PACK_MAKER],
  );
}

interface SavedLevel { level_id: string; target: number; measured: number | null; notes: string | null }
async function savedLevels(q: Query, packId: string | null): Promise<SavedLevel[]> {
  if (!packId) return [];
  const p = await q(`select level_ids from packs where pack_id::text = $1`, [packId]);
  if (!p[0]) return [];
  const ids = (typeof p[0].level_ids === "string" ? JSON.parse(p[0].level_ids) : p[0].level_ids) as string[];
  const rows = await q(`select level_id::text as level_id, target_win_rate, measured_win_rate, notes from levels where level_id = any($1::uuid[])`, [ids]);
  const by = new Map(rows.map((r) => [String(r.level_id), r]));
  return ids.flatMap((id) => {
    const r = by.get(id);
    return r ? [{ level_id: id, target: Number(r.target_win_rate), measured: r.measured_win_rate === null ? null : Number(r.measured_win_rate), notes: r.notes === null ? null : String(r.notes) }] : [];
  });
}

async function patchRow(q: Query, id: string, cols: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(cols);
  await q(`update biz_pack_deliveries set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} where id = $1`, [id, ...keys.map((k) => {
    const v = cols[k];
    return v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v;
  })]);
}

// ---------- the email ----------

export function composeExternalPackEmail(args: {
  first: string; generatorName: string; genre: string; owed: number; curve: PackCurve; bot: string; runs: number;
  levels: Array<{ target: number; measured: number | null; wins?: number; runs?: number; difficulty?: number; tries?: number; url: string }>;
  calls: number | null; minutes: number | null; playUrl: string | null; jsonUrl: string; stoppedNote: string | null; test: boolean;
  companyName: string; postalAddress: string; replyTo: string;
}): { subject: string; body: string; html: string } {
  const n = args.levels.length;
  const short = n < args.owed;
  const what = `${n} ${args.genre} level${n === 1 ? "" : "s"}`;
  const lead = `Your level pack is ready: ${what} made by your own generator ("${args.generatorName}"), measured by your own bot (${args.bot}), and tuned by our agents to the difficulty curve you ordered.`;
  const how = `How it worked: for each level, our agents asked your generator for a level at a difficulty setting, had your evaluate endpoint play it ${args.runs} times, and moved the setting until the win rate landed on that level's target.${args.calls !== null && args.minutes !== null ? ` That took ${args.calls} calls to your generator in ${args.minutes} min.` : ""}`;
  const measuredCell = (l: (typeof args.levels)[number]) => (l.measured === null ? "not measured" : `${pct(l.measured)}${l.wins !== undefined && l.runs !== undefined ? ` (${l.wins}/${l.runs})` : ""}`);
  const lines = args.levels.map((l, i) => `Level ${String(i + 1).padStart(2)}   target ${pct(l.target).padStart(4)}   measured ${measuredCell(l)}${l.difficulty !== undefined ? `   difficulty ${l.difficulty.toFixed(2)}` : ""}${l.tries !== undefined ? `   ${l.tries} ${l.tries === 1 ? "try" : "tries"}` : ""}   ${l.url}`);
  const shortNote = short ? `We promised ${args.owed} levels and ${n} landed on target${args.stoppedNote ? ` before ${args.stoppedNote}` : ""}. A person on our team will follow up about the rest.` : null;
  const testNote = args.test ? "This was a test order, so no money was charged." : null;
  const footerReason = "You're getting it because you ordered a level pack.";
  const body = [
    `Hi ${args.first},`, "", lead, "",
    ...(args.playUrl ? [`Play them: ${args.playUrl}`] : []),
    `JSON for all levels (in your format): ${args.jsonUrl}`, "",
    how, "",
    `The curve: ${pct(args.curve.start)} → ${pct(args.curve.end)}. Level by level, target vs. measured by your bot:`,
    ...lines, "",
    ...(shortNote ? [shortNote, ""] : []),
    `Questions, or a different curve? Reply to this email or write to ${args.replyTo}.`, "",
    ...(testNote ? [testNote, ""] : []),
    args.companyName, "", "—",
    `${args.companyName} is a small studio where AI agents design and test levels, and this email was written by one of them. ${footerReason}`,
    args.postalAddress,
  ].join("\n");
  const html = E.layout({
    preheader: `${what} from your generator, measured by your bot, tuned to your curve.`,
    companyName: args.companyName, postalAddress: args.postalAddress, footerReason,
    body: [
      E.eyebrow(short ? `Level pack · ${n} of ${args.owed} levels` : args.test ? "Level pack ready · test order" : "Level pack ready", short ? E.C.yellow : E.C.green),
      E.heading(`Your levels from your generator, ${args.first}`),
      E.text(lead, { color: E.C.muted }),
      ...(args.playUrl ? [E.button("Play your levels", args.playUrl)] : []),
      E.button("Download the JSON", args.jsonUrl, E.C.green),
      E.panel(E.rows([
        E.checkRow("Made by", `your generator, "${args.generatorName}"`, "info"),
        E.checkRow("Measured by", `your bot (${args.bot}), ${args.runs} plays per try`, "info"),
        E.checkRow("Tuned by", "our agents, to your curve", "info"),
        E.checkRow("Levels", short ? `${n} of ${args.owed}` : String(n), short ? "fail" : "pass"),
        E.checkRow("Difficulty curve", `${pct(args.curve.start)} → ${pct(args.curve.end)}`, "info"),
      ].join(""))),
      E.text(how),
      ...(shortNote ? [E.text(shortNote, { weight: 800 })] : []),
      E.text("Level by level, target vs. measured by your bot:", { weight: 800 }),
      E.table(["Level", "Target", "Measured", ""], args.levels.map((l, i) => ({ cells: [String(i + 1), pct(l.target), measuredCell(l), args.playUrl ? "Play" : "JSON"], link: l.url }))),
      E.text(`Questions, or a different curve? Reply to this email or write to ${args.replyTo}.`, { color: E.C.muted }),
      ...(testNote ? [E.text(testNote, { color: E.C.muted })] : []),
    ].join(""),
  });
  const subject = short ? `Your level pack: ${n} of ${args.owed} levels from your generator` : `Your level pack is ready: ${what} from your generator`;
  return { subject: args.test ? `[Test order] ${subject}` : subject, body, html };
}

// ---------- one delivery ----------

export interface ExternalRunOptions extends RunOptions {
  fetch?: typeof fetch;
  runs?: number;
  backoffMs?: number;
  timeoutMs?: Partial<Record<"generate" | "evaluate" | "validate", number>>;
}

/** Builds, saves, and emails one claimed delivery with the studio's generator. Never throws; failures are logged as step-ins. */
export async function runExternalPackDelivery(ctx: ToolContext, d: PackDelivery, gen: Generator, opts: ExternalRunOptions = {}): Promise<PackDelivery["state"]> {
  const q = ctx.db!;
  const log: Log = (action, why, result) => ctx.store.logActivity({ at: new Date().toISOString(), agent: AGENT, action, why, result, costUsd: null, human: false });
  const mode = d.test ? " (test order)" : "";
  const lead: Lead | null = d.leadId ? await ctx.store.getLead(d.leadId) : null;
  const company = lead?.company ?? "a customer";
  const genre = GENRES[d.gameId];
  const site = ctx.config.SITE_URL.replace(/\/+$/, "");
  const stepIn = async (why: string, state: "partial" | "failed", detail: string) => {
    await log(`step-in needed: level pack for ${company}`, why, `left for a person${mode}`);
    await patchRow(q, d.id, { state, detail: detail.slice(0, 300), finished_at: new Date() });
    return state;
  };

  try {
    const key = ctx.config.GENERATOR_SECRET_KEY;
    if (!key) return await stepIn(`can't call ${company}'s generator: GENERATOR_SECRET_KEY isn't set on this server`, "failed", "generator secret key missing");
    const curve = d.curve ?? curveFor(d.difficulty, d.levelsOwed, null);
    let packId = d.packId;
    let built: BuildResult | null = null;
    if (!(await savedLevels(q, packId)).length) {
      packId = packId ?? randomUUID();
      await patchRow(q, d.id, { curve, pack_id: packId });
      await log(
        `building ${company}'s level pack with their own generator "${gen.name}"`,
        `${d.levelsOwed} ${genre.label} levels: their generator makes each one, their bot measures it, our agents tune its difficulty to the curve`,
        `targets ${curve.targets.map(pct).join(", ")}${mode}`,
      );
      const client = generatorClient(gen, decryptSecret(gen.secretEnc, key), {
        ...(opts.fetch ? { fetch: opts.fetch } : {}), ...(opts.backoffMs !== undefined ? { backoffMs: opts.backoffMs } : {}), ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
        onRetry: (op, attempt, err) => log(`${company}'s generator didn't answer ${op}; retrying`, err.message, `attempt ${attempt + 1}`),
      });
      built = await buildWithGenerator(client, {
        targets: curve.targets, seed: Number.parseInt(d.id.replace(/-/g, "").slice(0, 7), 16), studio: company, log,
        ...(opts.runs ? { runs: opts.runs } : {}), maxSeconds: (opts.maxMinutes ?? MAX_MINUTES) * 60,
      });
      const why = built.stoppedBy === "generator_down" ? `their generator stopped answering (${built.error})` : built.stoppedBy === "time" ? "the time cap ran out" : built.error ?? "";
      if (!built.levels.length) return await stepIn(`no level from ${company}'s generator passed: ${why}`, "failed", why || "no levels passed");
      await savePack(q, packId, d, gen, company, built.levels);
      await log(
        `level pack for ${company}: ${built.levels.length} levels from their generator, measured ${pct(Math.min(...built.levels.map((l) => l.measured)))}–${pct(Math.max(...built.levels.map((l) => l.measured)))} vs ${pct(curve.start)} → ${pct(curve.end)} curve`,
        `${built.calls} calls to their generator in ${Math.round(built.elapsedMs / 6000) / 10} min${built.stoppedBy !== "done" ? `; stopped: ${why}` : ""}`,
        `pack ${packId}${mode}`,
      );
    }
    const saved = await savedLevels(q, packId);
    const short = saved.length < d.levelsOwed;
    const previewable = gen.format === "levelai";
    const urlFor = (id: string) => (previewable ? levelUrl(site, d.gameId, id) : `${site}/api/levels/${id}`);
    const byOrder = built?.levels ?? [];
    const bot = byOrder[0]?.bot ?? saved[0]?.notes?.match(/; (.+?) won /)?.[1] ?? "their bot";

    let messageId: string | null = null;
    const to = lead?.email ?? null;
    if (!to || !ctx.mail) {
      await log(`level pack not emailed: ${company}`, !to ? "no email address on the order" : "no mail sender on this server", `left for a person${mode}`);
    } else if (await ctx.store.isSuppressed(to)) {
      await log(`level pack not emailed: ${company}`, "the customer opted out of email", `nothing sent${mode}`);
    } else {
      const mail = composeExternalPackEmail({
        first: lead?.contactName ? lead.contactName.split(" ")[0]! : company, generatorName: gen.name, genre: genre.label, owed: d.levelsOwed, curve, bot,
        runs: byOrder[0]?.runs ?? opts.runs ?? EVAL_RUNS,
        levels: saved.map((s, i) => {
          const b = byOrder[i];
          return { target: s.target, measured: s.measured, url: urlFor(s.level_id), ...(b ? { wins: b.wins, runs: b.runs, difficulty: b.difficulty, tries: b.tries } : {}) };
        }),
        calls: built?.calls ?? null, minutes: built ? Math.round(built.elapsedMs / 6000) / 10 : null,
        playUrl: previewable && saved[0] ? playUrl(site, d.gameId, packId!, saved[0].level_id) : null, jsonUrl: jsonUrl(site, packId!),
        stoppedNote: built?.stoppedBy === "generator_down" ? "your generator stopped answering" : built?.stoppedBy === "time" ? "our time limit for a pack ran out" : null,
        test: d.test, companyName: ctx.config.COMPANY_NAME, postalAddress: ctx.config.COMPANY_POSTAL_ADDRESS ?? "", replyTo: ctx.config.AGENTMAIL_INBOX_ID ?? "levelai@agentmail.to",
      });
      try {
        messageId = (await ctx.mail.send({ to, subject: mail.subject, text: mail.body, html: mail.html, idempotencyKey: idempotencyKey("level-pack", d.id) })).messageId;
        if (lead) await ctx.store.addOutreach({ leadId: lead.id, to, subject: mail.subject, body: mail.body, status: "sent", blockedReason: null, providerMessageId: messageId });
      } catch (err) {
        await log(`couldn't email ${company} their level pack`, (err instanceof Error ? err.message : String(err)).slice(0, 200), `pack ${packId} saved; left for a person${mode}`);
      }
    }

    const state = short ? "partial" : "delivered";
    await patchRow(q, d.id, { state, levels_delivered: saved.length, email_message_id: messageId, finished_at: new Date(), detail: short ? `${saved.length} of ${d.levelsOwed} levels from their generator` : null });
    if (messageId) await log(`delivered level pack to ${company}`, `${saved.length} ${genre.label} levels from their generator: ${jsonUrl(site, packId!)}`, `message ${messageId}${mode}`);
    if (short) await log(`step-in needed: level pack for ${company}`, `delivered ${saved.length} of ${d.levelsOwed} levels from their generator${built?.error ? ` (${built.error})` : ""}`, `left for a person${mode}`);
    if (d.paymentId && !short && messageId) {
      const open = await q(`select count(*)::int as n from biz_pack_deliveries where payment_id = $1 and state not in ('delivered')`, [d.paymentId]);
      if (Number(open[0]?.n ?? 1) === 0) await ctx.store.addDelivery({ paymentId: d.paymentId, leadId: d.leadId, status: "delivered", detail: `level pack ${packId} (their generator)` });
    }
    if (lead && messageId) await ctx.store.setStage(lead.id, "delivered");
    return state;
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    return stepIn(msg, "failed", msg).catch(() => "failed" as const);
  }
}
