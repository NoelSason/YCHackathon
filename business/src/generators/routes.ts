import { randomInt } from "node:crypto";
import { z } from "zod";
import type { ToolContext } from "../mcp/tools.js";
import type { Lead } from "../types.js";
import { GENRES, packGameFor } from "../levels/deliver-pack.js";
import { PACK_GAME_IDS } from "../levels/pack-types.js";
import { checkBaseUrl, decryptSecret, SIGNATURE_HEADER } from "./protocol.js";
import { generatorClient, GeneratorCallError, type ClientOptions } from "./client.js";
import { getGenerator, listGenerators, publicGenerator, recordTest, registerGenerator } from "./store.js";

/**
 * Registering and testing a studio's own level generator, for the REST API (/studio/generators,
 * reached at /api/studio/generators) and the studio MCP (register_generator, test_generator). Every
 * call is scoped to the studio whose developer key made it.
 */
export const RegisterSchema = z.object({
  name: z.string().trim().min(1).max(80),
  genre: z.string().trim().min(1).max(40),
  base_url: z.string().trim().min(1).max(300),
  format: z.enum(["custom", "levelai"]).optional(),
});

export interface Answer { status: number; body: Record<string, unknown> }
const fail = (status: number, error: string): Answer => ({ status, body: { ok: false, error } });
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err)).slice(0, 200);

function log(ctx: ToolContext, studio: Lead, action: string, why: string | null, result: string | null) {
  return ctx.store.logActivity({ at: new Date().toISOString(), agent: "studio-api", action: `${studio.company}: ${action}`, why, result, costUsd: null, human: false });
}

export async function registerForStudio(ctx: ToolContext, studio: Lead, input: unknown): Promise<Answer> {
  if (!ctx.db) return fail(503, "Generators aren't available on this server right now.");
  const key = ctx.config.GENERATOR_SECRET_KEY;
  if (!key) return fail(503, "Generator registration isn't set up on this server yet.");
  const p = RegisterSchema.safeParse(input);
  if (!p.success) return fail(400, "Send name, genre, and base_url (and optionally format: \"custom\" or \"levelai\").");
  const genre = packGameFor(p.data.genre);
  if (!genre) return fail(400, `genre must be one of: ${PACK_GAME_IDS.map((g) => `${g} (${GENRES[g].label})`).join(", ")}`);
  const url = checkBaseUrl(p.data.base_url);
  if (!url.ok) return fail(400, url.error);
  const { generator, secret } = await registerGenerator(ctx.db, key, { studioId: studio.id, name: p.data.name, genre, format: p.data.format ?? "custom", baseUrl: url.url });
  await log(ctx, studio, `registered a level generator "${generator.name}"`, `${GENRES[genre].label} levels from ${generator.baseUrl}`, `generator ${generator.id}`);
  return {
    status: 201,
    body: {
      ok: true, generator: publicGenerator(generator), signing_secret: secret,
      note: `Save signing_secret now; it isn't shown again. We sign every request to your generator with it in the ${SIGNATURE_HEADER} header. Registering again for the same genre replaces this generator and its secret.`,
      next: `POST /api/studio/generators/${generator.id}/test`,
    },
  };
}

export async function listForStudio(ctx: ToolContext, studio: Lead): Promise<Answer> {
  if (!ctx.db) return fail(503, "Generators aren't available on this server right now.");
  return { status: 200, body: { ok: true, generators: (await listGenerators(ctx.db, studio.id)).map(publicGenerator) } };
}

/** One generate (and validate, if offered) and one evaluate, reported step by step: what we sent and what came back. */
export async function testForStudio(ctx: ToolContext, studio: Lead, id: string, opts: ClientOptions = {}): Promise<Answer> {
  if (!ctx.db) return fail(503, "Generators aren't available on this server right now.");
  const key = ctx.config.GENERATOR_SECRET_KEY;
  if (!key) return fail(503, "Generator registration isn't set up on this server yet.");
  const gen = await getGenerator(ctx.db, id);
  if (!gen || gen.studioId !== studio.id || gen.status !== "active") return fail(404, "No active generator with that id on your studio.");
  const client = generatorClient(gen, decryptSecret(gen.secretEnc, key), { retries: 0, ...opts });
  const seed = randomInt(1, 2 ** 31 - 1);
  const steps: Array<Record<string, unknown>> = [];
  const finish = async (ok: boolean, error: string | null, extra: Record<string, unknown> = {}): Promise<Answer> => {
    await recordTest(ctx.db!, gen.id, ok, error);
    await log(ctx, studio, `tested their level generator "${gen.name}"`, steps.map((s) => `${s.op} ${s.ok ? `${s.ms} ms` : "failed"}`).join(", "), ok ? `passed${extra.measured ? `: ${(extra.measured as { summary: string }).summary}` : ""}` : `failed: ${error}`);
    return { status: 200, body: { ok, generator: publicGenerator({ ...gen, lastTestOk: ok, lastError: error }), steps, ...extra, ...(error ? { error } : {}) } };
  };
  try {
    const sent = { seed, difficulty: 0.5 };
    const g = await client.generate(sent);
    steps.push({ op: "generate", ok: true, ms: g.info.ms, sent, received: { level: g.level, ...(g.meta ? { meta: g.meta } : {}) } });
    const v = await client.validate(g.level);
    steps.push(v ? { op: "validate", ok: true, ms: v.info.ms, received: { ok: v.ok, errors: v.errors ?? [] } } : { op: "validate", ok: true, ms: null, received: "not offered (404); that's fine, it's optional" });
    if (v && !v.ok) return finish(false, `your validate rejected the level your generate made: ${(v.errors ?? []).join("; ").slice(0, 160) || "no reason given"}`);
    const e = await client.evaluate({ level: g.level, runs: 50, seed });
    steps.push({ op: "evaluate", ok: true, ms: e.info.ms, sent: { runs: 50, seed }, received: { wins: e.wins, runs: e.runs, ...(e.solvable !== undefined ? { solvable: e.solvable } : {}), ...(e.min_moves !== undefined ? { min_moves: e.min_moves } : {}), ...(e.bot ? { bot: e.bot } : {}) } });
    const rate = e.wins / e.runs;
    const summary = `${e.bot ?? "your bot"} won ${e.wins}/${e.runs} (${Math.round(rate * 100)}%) at difficulty 0.5`;
    return finish(true, null, {
      measured: { win_rate: Math.round(rate * 1000) / 1000, summary },
      next: "Your generator is ready. Level pack orders from your studio for this genre are now built with it.",
    });
  } catch (err) {
    const op = err instanceof GeneratorCallError ? err.op : "generate";
    steps.push({ op, ok: false, error: errText(err) });
    return finish(false, errText(err));
  }
}

/**
 * The REST routes: GET/POST /studio/generators and POST /studio/generators/:id/test. Null when the
 * path isn't one of them. `studio` is null for a missing or unknown developer key.
 */
export async function generatorRoute(ctx: ToolContext, request: Request, url: URL, studio: () => Promise<Lead | null>, readJson: () => Promise<unknown>): Promise<Response | null> {
  const m = url.pathname.match(/^\/studio\/generators(?:\/([0-9a-f-]{36})\/test)?\/?$/i);
  if (!m) return null;
  const respond = (a: Answer) => new Response(JSON.stringify(a.body), { status: a.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  const s = await studio();
  if (!s) return respond(fail(401, "unauthorized: get a key at /developers"));
  if (m[1]) return request.method === "POST" ? respond(await testForStudio(ctx, s, m[1])) : respond(fail(405, "use POST"));
  if (request.method === "GET") return respond(await listForStudio(ctx, s));
  if (request.method === "POST") return respond(await registerForStudio(ctx, s, await readJson()));
  return respond(fail(405, "use GET or POST"));
}
