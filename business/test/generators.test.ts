import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { loadConfig } from "../src/config.js";
import { PlatformStore, type Query } from "../src/store.js";
import { createHandler } from "../src/app.js";
import { hashKey, newKey } from "../src/studio/keys.js";
import { getPackDelivery, runDueDeliveries, type RunOptions } from "../src/levels/deliver-pack.js";
import type { ToolContext } from "../src/mcp/tools.js";
import { checkBaseUrl, decryptSecret, encryptSecret, SIGNATURE_HEADER, signatureFor, verifySignature } from "../src/generators/protocol.js";
import { breakerState, BREAKER_FAILURES, generatorClient, GeneratorCallError, resetBreakers } from "../src/generators/client.js";
import { buildWithGenerator, nextDifficulty } from "../src/generators/pack.js";
import { onTarget } from "../../solver/src/autotune.js";

// Bring your own generator, with no network: the platform schema in PGlite, mail faked, and the
// studio's generator played by a fake fetch that checks our signature like a real endpoint would.
const platformSchema = await readFile(new URL("../../platform/db/schema.sql", import.meta.url), "utf8");
const businessSchema = await readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8");
const KEY = "a".repeat(64);
const TEAM = "team@levelai.example";

interface Mail { to: string; subject: string; text: string; idempotencyKey: string }

async function setup() {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(platformSchema);
  await db.exec(businessSchema);
  const q: Query = async (text, params = []) => (await db.query<Record<string, unknown>>(text, params)).rows;
  const sent: Mail[] = [];
  const ctx: ToolContext = {
    config: loadConfig({
      COMPANY_POSTAL_ADDRESS: "1752 Shattuck Avenue, Berkeley, CA 94704", AGENTMAIL_INBOX_ID: "levelai@agentmail.to", TEAM_EMAILS: TEAM,
      BUSINESS_MCP_TOKEN: "tok_demo", SITE_URL: "https://levels.example", GENERATOR_SECRET_KEY: KEY,
    }),
    store: new PlatformStore(q, new Set([TEAM])), monid: null, naive: null, stripe: null, mobilerun: null,
    mail: { async send(a) { sent.push(a); return { messageId: `m_${sent.length}` }; }, async reply() { return { messageId: "r" }; } },
    db: q,
  };
  const studio = await ctx.store.upsertLead({ company: "Test Agency", appId: null, contactName: "Ada Tester", email: TEAM, source: "inbound_form", stage: "found", reason: null, sampleUrl: null, crmContactId: null });
  const key = newKey();
  await ctx.store.addApiKey(studio.id, hashKey(key));
  return { ctx, q, sent, studio, key, handle: createHandler(ctx.config, ctx, q) };
}

const post = (path: string, body: unknown, key?: string) =>
  new Request(`http://x${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) } });
const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Fail = "500" | "hang" | "garbage" | null;
/**
 * A studio's generator: difficulty d gives a level its bot wins about 95% − 90%·d of the time (±3
 * points by seed). It rejects any request whose signature doesn't verify with its secret.
 */
function fakeGenerator(secret: () => string, fail: (op: string, n: number) => Fail = () => null) {
  const calls: Array<{ op: string; body: Record<string, unknown>; signed: boolean }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const op = String(input).split("/").pop()!;
    const raw = String(init?.body ?? "");
    const signed = verifySignature(secret(), raw, (init?.headers as Record<string, string>)[SIGNATURE_HEADER]);
    const body = JSON.parse(raw) as Record<string, unknown>;
    calls.push({ op, body, signed });
    if (!signed) return answer({ error: "bad signature" }, 401);
    const mode = fail(op, calls.length);
    if (mode === "500") return answer({ error: "boom" }, 500);
    if (mode === "garbage") return new Response("<html>oops</html>", { status: 200 });
    if (mode === "hang") return new Promise<Response>((_, rej) => init!.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
    if (op === "generate") return answer({ level: { grid: [[1, 0], [0, 1]], d: body.difficulty, seed: body.seed }, meta: { notch: 3 } });
    if (op === "validate") return answer({ ok: true, errors: [] });
    const level = body.level as { d: number; seed: number };
    const noise = ((level.seed % 7) - 3) / 100;
    const rate = Math.min(1, Math.max(0, 0.95 - 0.9 * level.d + noise));
    const runs = Number(body.runs);
    return answer({ wins: Math.round(rate * runs), runs, solvable: true, min_moves: 12, bot: "fake-bot" });
  }) as typeof globalThis.fetch;
  return { fetch: fetchImpl, calls };
}

async function register(s: Awaited<ReturnType<typeof setup>>, extra: Record<string, unknown> = {}) {
  const res = await s.handle(post("/studio/generators", { name: "Agency levels", genre: "parking-puzzle", base_url: "https://gen.agency.example/levelai/", ...extra }, s.key));
  const body = (await res.json()) as { ok: boolean; generator: { id: string; base_url: string; genre: string }; signing_secret: string; error?: string };
  return { res, body };
}

beforeEach(() => resetBreakers());
afterEach(() => vi.unstubAllGlobals());

describe("the protocol's signature", () => {
  const body = JSON.stringify({ seed: 1, difficulty: 0.5 });
  it("verifies with the right secret, and fails on another secret, a changed body, or an old timestamp", () => {
    const h = signatureFor("lvlgen_secret", body);
    expect(h).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verifySignature("lvlgen_secret", body, h)).toBe(true);
    expect(verifySignature("lvlgen_other", body, h)).toBe(false);
    expect(verifySignature("lvlgen_secret", body.replace("0.5", "0.6"), h)).toBe(false);
    const old = signatureFor("lvlgen_secret", body, Math.floor(Date.now() / 1000) - 301);
    expect(verifySignature("lvlgen_secret", body, old)).toBe(false);
    expect(verifySignature("lvlgen_secret", body, null)).toBe(false);
    expect(verifySignature("lvlgen_secret", body, "t=1,v1=zz")).toBe(false);
  });

  it("encrypts the secret at rest and reads it back only with the key", () => {
    const stored = encryptSecret("lvlgen_abc", KEY);
    expect(stored).not.toContain("lvlgen_abc");
    expect(decryptSecret(stored, KEY)).toBe("lvlgen_abc");
    expect(() => decryptSecret(stored, "b".repeat(64))).toThrow();
  });

  it("only calls public https hosts", () => {
    expect(checkBaseUrl("https://gen.studio.com/levelai/")).toEqual({ ok: true, url: "https://gen.studio.com/levelai" });
    for (const bad of ["http://gen.studio.com", "https://localhost:3000", "https://127.0.0.1", "https://10.0.0.5/x", "https://user:pw@gen.studio.com", "https://intranet", "not a url"]) {
      expect(checkBaseUrl(bad).ok).toBe(false);
    }
  });
});

describe("registering a generator", () => {
  it("needs a developer key and a known genre and a public https URL", async () => {
    const s = await setup();
    expect((await s.handle(post("/studio/generators", { name: "x", genre: "match3", base_url: "https://g.example" }))).status).toBe(401);
    expect((await register(s, { genre: "chess" })).res.status).toBe(400);
    expect((await register(s, { base_url: "http://gen.agency.example" })).body.error).toMatch(/https/);
  });

  it("returns the secret once, stores only its encryption, and lists without it", async () => {
    const s = await setup();
    const { res, body } = await register(s);
    expect(res.status).toBe(201);
    expect(body.signing_secret).toMatch(/^lvlgen_[0-9a-f]{48}$/);
    expect(body.generator).toMatchObject({ genre: "lotescape", base_url: "https://gen.agency.example/levelai" });
    const row = (await s.q(`select * from biz_generators`))[0]!;
    expect(JSON.stringify(row)).not.toContain(body.signing_secret);
    expect(decryptSecret(String(row.secret_enc), KEY)).toBe(body.signing_secret);
    const list = await (await s.handle(new Request("http://x/studio/generators", { headers: { authorization: `Bearer ${s.key}` } }))).json();
    expect(JSON.stringify(list)).not.toContain(body.signing_secret);
    expect((list as { generators: unknown[] }).generators).toHaveLength(1);
    // The activity log never holds the secret either.
    expect(JSON.stringify(await s.ctx.store.listActivity(50))).not.toContain(body.signing_secret);
  });

  it("replaces the studio's generator for the same genre, with a new secret", async () => {
    const s = await setup();
    const a = (await register(s)).body;
    const b = (await register(s, { name: "Agency levels v2" })).body;
    expect(b.signing_secret).not.toBe(a.signing_secret);
    const rows = await s.q(`select id::text as id, status from biz_generators order by created_at`);
    expect(rows.map((r) => r.status)).toEqual(["replaced", "active"]);
    expect((await s.handle(post(`/studio/generators/${a.generator.id}/test`, {}, s.key))).status).toBe(404);
  });
});

describe("testing a generator", () => {
  it("calls generate, validate, and evaluate once, signed, and reports what it saw", async () => {
    const s = await setup();
    const { body } = await register(s);
    const gen = fakeGenerator(() => body.signing_secret);
    vi.stubGlobal("fetch", gen.fetch);
    const res = await s.handle(post(`/studio/generators/${body.generator.id}/test`, {}, s.key));
    const r = (await res.json()) as { ok: boolean; steps: Array<{ op: string; ok: boolean }>; measured: { win_rate: number; summary: string } };
    expect(r.ok).toBe(true);
    expect(r.steps.map((x) => x.op)).toEqual(["generate", "validate", "evaluate"]);
    expect(gen.calls.every((c) => c.signed)).toBe(true);
    expect(gen.calls[0]!.body).toMatchObject({ difficulty: 0.5 });
    expect(r.measured.summary).toMatch(/^fake-bot won \d+\/50/);
    expect((await s.q(`select last_test_ok from biz_generators`))[0]!.last_test_ok).toBe(true);
  });

  it("says what failed when the endpoint answers badly", async () => {
    const s = await setup();
    const { body } = await register(s);
    vi.stubGlobal("fetch", fakeGenerator(() => body.signing_secret, (op) => (op === "evaluate" ? "garbage" : null)).fetch);
    const r = (await (await s.handle(post(`/studio/generators/${body.generator.id}/test`, {}, s.key))).json()) as { ok: boolean; error: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/evaluate didn't answer with JSON/);
  });

  it("a wrong secret on their side shows up as a 401 from their endpoint", async () => {
    const s = await setup();
    const { body } = await register(s);
    vi.stubGlobal("fetch", fakeGenerator(() => "lvlgen_not_the_one").fetch);
    const r = (await (await s.handle(post(`/studio/generators/${body.generator.id}/test`, {}, s.key))).json()) as { ok: boolean; error: string };
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toMatch(/HTTP 401/);
  });
});

describe("the tuning loop over their generator", () => {
  it("steps toward the target, then interpolates between a try on each side", () => {
    expect(nextDifficulty([{ d: 0.2, rate: 0.9 }], 0.2, 0.9, 0.5)).toBe(0.5);
    expect(nextDifficulty([{ d: 0.2, rate: 0.9 }, { d: 0.6, rate: 0.3 }], 0.6, 0.3, 0.5)).toBe(0.467);
    expect(nextDifficulty([{ d: 1, rate: 0.9 }], 1, 0.9, 0.5)).toBe(1);
  });

  it("converges every level of a curve onto its target with the solver's acceptance rule", async () => {
    const gen = fakeGenerator(() => "s");
    const client = generatorClient({ id: "g1", baseUrl: "https://g.example" }, "s", { fetch: gen.fetch });
    const lines: string[] = [];
    const targets = [0.85, 0.85, 0.7, 0.55, 0.4];
    const r = await buildWithGenerator(client, { targets, seed: 42, studio: "Test Agency", log: async (a) => { lines.push(a); } });
    expect(r.stoppedBy).toBe("done");
    expect(r.levels).toHaveLength(5);
    for (const l of r.levels) expect(onTarget({ win_rate: l.measured, ci95_low: l.ci95[0], ci95_high: l.ci95[1] }, l.target)).toBe(true);
    expect(lines[0]).toBe("asked Test Agency's generator for level 1 at difficulty 0.15");
    expect(lines.some((l) => /^Test Agency's level \d measured \d+% vs \d+% target: accepted$/.test(l))).toBe(true);
    // Their context fields arrive with each generate call.
    expect(gen.calls.find((c) => c.op === "generate")!.body.context).toEqual({ pack_level: 1, pack_size: 5, target_win_rate: 0.85 });
  });
});

describe("failures: timeouts, retries, and the circuit breaker", () => {
  it("times out a call that hangs", async () => {
    const gen = fakeGenerator(() => "s", () => "hang");
    const client = generatorClient({ id: "g-hang", baseUrl: "https://g.example" }, "s", { fetch: gen.fetch, retries: 0, timeoutMs: { generate: 30 } });
    const err = await client.generate({ seed: 1, difficulty: 0.5 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GeneratorCallError);
    expect((err as GeneratorCallError).kind).toBe("timeout");
  });

  it("retries a 500, then succeeds", async () => {
    const retries: number[] = [];
    const gen = fakeGenerator(() => "s", (_op, n) => (n === 1 ? "500" : null));
    const client = generatorClient({ id: "g-retry", baseUrl: "https://g.example" }, "s", { fetch: gen.fetch, backoffMs: 1, onRetry: (_op, a) => { retries.push(a); } });
    const g = await client.generate({ seed: 1, difficulty: 0.5 });
    expect(g.info.attempts).toBe(2);
    expect(retries).toEqual([1]);
  });

  it("opens after repeated failures and stops calling the endpoint", async () => {
    const gen = fakeGenerator(() => "s", () => "500");
    const client = generatorClient({ id: "g-dead", baseUrl: "https://g.example" }, "s", { fetch: gen.fetch, backoffMs: 1, retries: 1 });
    for (let i = 0; i < BREAKER_FAILURES; i++) await expect(client.generate({ seed: i, difficulty: 0.5 })).rejects.toThrow(/HTTP 500/);
    const before = gen.calls.length;
    const err = (await client.generate({ seed: 9, difficulty: 0.5 }).catch((e: unknown) => e)) as GeneratorCallError;
    expect(err.kind).toBe("circuit_open");
    expect(gen.calls.length).toBe(before);
    expect(breakerState("g-dead").open).toBe(true);
  });
});

describe("a level pack built by the studio's generator", () => {
  it("demo run → their generator makes each level, their bot measures it, our loop tunes it → saved and emailed", async () => {
    const s = await setup();
    const { body } = await register(s, { format: "levelai" });
    const gen = fakeGenerator(() => body.signing_secret);
    vi.stubGlobal("fetch", gen.fetch);
    const res = await s.handle(new Request("http://x/orders/demo-run", {
      method: "POST", headers: { authorization: "Bearer tok_demo" }, body: JSON.stringify({ email: TEAM, generator_id: body.generator.id, levels: 5 }),
    }));
    const queued = (await res.json()) as { ok: boolean; deliveryId: string; levels: number };
    expect(res.status).toBe(202);
    expect(queued).toMatchObject({ ok: true, levels: 5 });
    await runDueDeliveries(s.ctx);

    const d = await getPackDelivery(s.q, queued.deliveryId);
    expect(d).toMatchObject({ state: "delivered", levelsDelivered: 5, gameId: "lotescape", test: true });
    const levels = await s.q(`select level, created_by, measured_win_rate, target_win_rate, notes from levels`);
    expect(levels).toHaveLength(5);
    expect(levels.every((l) => l.created_by === "pack-delivery" && /from Test Agency's generator "Agency levels"/.test(String(l.notes)))).toBe(true);
    expect((await s.q(`select claimed_by from solver_runs`)).every((r) => r.claimed_by === "external-generator")).toBe(true);

    expect(s.sent).toHaveLength(1);
    const mail = s.sent[0]!;
    expect(mail.to).toBe(TEAM);
    expect(mail.subject).toBe("[Test order] Your level pack is ready: 5 parking-puzzle levels from your generator");
    expect(mail.text).toContain('made by your own generator ("Agency levels"), measured by your own bot (fake-bot), and tuned by our agents');
    expect(mail.text).toContain("Play them: https://levels.example/games/lotescape/?level=");
    expect(mail.text).toMatch(/Level  1 {3}target  85% {3}measured \d+% \(\d+\/100\) {3}difficulty 0\.\d\d/);

    const acts = (await s.ctx.store.listActivity(500)).map((a) => a.action);
    expect(acts).toContain('building Test Agency\'s level pack with their own generator "Agency levels"');
    expect(acts).toContain("asked Test Agency's generator for level 1 at difficulty 0.15");
    expect(acts.some((a) => /^Test Agency's level 5 measured \d+% vs 40% target: accepted$/.test(a))).toBe(true);
    expect(acts.some((a) => a.startsWith("step-in needed"))).toBe(false);
  });

  it("an order with no generator registered still goes through our own engine", async () => {
    const s = await setup();
    const { externalPackRunner } = await import("../src/generators/hook.js");
    const d = { leadId: s.studio.id, gameId: "lotescape" } as Parameters<typeof externalPackRunner>[1];
    expect(await externalPackRunner(s.ctx, d)).toBeNull();
    await register(s);
    expect(await externalPackRunner(s.ctx, { ...d, gameId: "match3" })).toBeNull();
    expect(await externalPackRunner(s.ctx, d)).not.toBeNull();
  });

  it("pauses when their endpoint dies: sends the levels that passed, marked short, and asks for a person", async () => {
    const s = await setup();
    const { body } = await register(s);
    // Healthy for two measurements, then every call fails.
    let evaluated = 0;
    const gen = fakeGenerator(() => body.signing_secret, (op) => {
      if (evaluated >= 2) return "500";
      if (op === "evaluate") evaluated++;
      return null;
    });
    vi.stubGlobal("fetch", gen.fetch);
    const res = await s.handle(new Request("http://x/orders/demo-run", {
      method: "POST", headers: { authorization: "Bearer tok_demo" }, body: JSON.stringify({ email: TEAM, generator_id: body.generator.id, levels: 4 }),
    }));
    const { deliveryId } = (await res.json()) as { deliveryId: string };
    await runDueDeliveries(s.ctx, { backoffMs: 1 } as RunOptions);
    const d = await getPackDelivery(s.q, deliveryId);
    expect(d?.state).toBe("partial");
    expect(d!.levelsDelivered).toBeGreaterThanOrEqual(1);
    expect(d!.levelsDelivered).toBeLessThan(4);
    expect(s.sent[0]!.subject).toMatch(/^\[Test order\] Your level pack: \d of 4 levels from your generator$/);
    expect(s.sent[0]!.text).toContain("before your generator stopped answering");
    const acts = await s.ctx.store.listActivity(500);
    expect(acts.some((a) => a.action === "step-in needed: level pack for Test Agency")).toBe(true);
    expect(acts.some((a) => /didn't answer generate; retrying|didn't answer evaluate; retrying/.test(a.action))).toBe(true);
  }, 30_000);

  it("fails and asks for a person, with no email, when no level ever comes back", async () => {
    const s = await setup();
    const { body } = await register(s);
    vi.stubGlobal("fetch", fakeGenerator(() => body.signing_secret, () => "500").fetch);
    const res = await s.handle(new Request("http://x/orders/demo-run", {
      method: "POST", headers: { authorization: "Bearer tok_demo" }, body: JSON.stringify({ email: TEAM, generator_id: body.generator.id, levels: 3 }),
    }));
    const { deliveryId } = (await res.json()) as { deliveryId: string };
    await runDueDeliveries(s.ctx, { backoffMs: 1 } as RunOptions);
    expect((await getPackDelivery(s.q, deliveryId))?.state).toBe("failed");
    expect(s.sent).toHaveLength(0);
    const step = (await s.ctx.store.listActivity(500)).find((a) => a.action === "step-in needed: level pack for Test Agency");
    expect(step?.why).toMatch(/their generator stopped answering/);
  }, 30_000);

  it("demo runs refuse a generator that isn't on a team studio", async () => {
    const s = await setup();
    const other = await s.ctx.store.upsertLead({ company: "Real Studio", appId: null, contactName: null, email: "dev@real.example", source: "inbound_form", stage: "found", reason: null, sampleUrl: null, crmContactId: null });
    const k = newKey();
    await s.ctx.store.addApiKey(other.id, hashKey(k));
    const reg = (await (await s.handle(post("/studio/generators", { name: "Real", genre: "match3", base_url: "https://gen.real.example" }, k))).json()) as { generator: { id: string } };
    const res = await s.handle(new Request("http://x/orders/demo-run", {
      method: "POST", headers: { authorization: "Bearer tok_demo" }, body: JSON.stringify({ email: TEAM, generator_id: reg.generator.id }),
    }));
    expect(res.status).toBe(400);
  });
});
