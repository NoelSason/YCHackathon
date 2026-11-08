import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * The Level AI Generator Protocol: how a studio exposes its own level generation to us.
 *
 * The studio runs an HTTPS endpoint with three operations under its base URL:
 *   POST {base}/generate   {seed, difficulty (0–1), params?, context?}  → {level, meta?}
 *   POST {base}/evaluate   {level, runs, seed}                          → {wins, runs, solvable?, min_moves?, bot?}
 *   POST {base}/validate   {level}                                      → {ok, errors?}      (optional; 404 = not offered)
 *
 * Every request carries `X-LevelAI-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`,
 * keyed by the signing secret we gave the studio when it registered. The studio verifies it (and that
 * t is within 5 minutes) before doing any work. Docs: docs/developers.md, "Bring your own generator".
 */
export const SIGNATURE_HEADER = "x-levelai-signature";
export const GENERATOR_ID_HEADER = "x-levelai-generator";
export const REQUEST_ID_HEADER = "x-levelai-request";
export const SIGNATURE_TOLERANCE_SECONDS = 300;
export const OPS = ["generate", "evaluate", "validate"] as const;
export type Op = (typeof OPS)[number];

export const newSecret = (): string => `lvlgen_${randomBytes(24).toString("hex")}`;

export function signatureFor(secret: string, body: string, t: number = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

/** The check a studio's endpoint runs (the docs show the same code). */
export function verifySignature(secret: string, body: string, header: string | null | undefined, nowMs: number = Date.now()): boolean {
  const parts = Object.fromEntries((header ?? "").split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1 || Math.abs(nowMs / 1000 - t) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const want = Buffer.from(createHmac("sha256", secret).update(`${t}.${body}`).digest("hex"));
  const got = Buffer.from(parts.v1);
  return got.length === want.length && timingSafeEqual(got, want);
}

// ---------- the secret at rest ----------

/** AES-256-GCM with GENERATOR_SECRET_KEY: "v1:<iv>:<tag>:<ciphertext>", base64 parts. */
export function encryptSecret(secret: string, keyHex: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
  const ct = Buffer.concat([c.update(secret, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(stored: string, keyHex: string): string {
  const [v, iv, tag, ct] = stored.split(":");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("unknown secret format");
  const d = createDecipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

// ---------- what we accept back ----------

const JsonObject = z.record(z.string(), z.unknown());
export const GenerateResponse = z.object({ level: JsonObject, meta: JsonObject.optional() });
export const EvaluateResponse = z.object({
  wins: z.number().int().min(0),
  runs: z.number().int().min(1),
  solvable: z.boolean().optional(),
  min_moves: z.number().int().min(0).optional(),
  bot: z.string().max(60).optional(),
}).refine((r) => r.wins <= r.runs, { message: "wins must not exceed runs" });
export const ValidateResponse = z.object({ ok: z.boolean(), errors: z.array(z.string().max(300)).max(50).optional() });
export type GenerateResult = z.infer<typeof GenerateResponse>;
export type EvaluateResult = z.infer<typeof EvaluateResponse>;
export type ValidateResult = z.infer<typeof ValidateResponse>;

export interface GenerateRequest {
  seed: number;
  difficulty: number;
  params?: Record<string, unknown>;
  /** Informational: where this level goes. A generator may ignore it. */
  context?: { pack_level: number; pack_size: number; target_win_rate: number };
}
export interface EvaluateRequest { level: Record<string, unknown>; runs: number; seed: number }

/**
 * A base URL we're willing to call: https only, no credentials, no localhost or IP literals (so a
 * registration can't point our server at its own network).
 */
export function checkBaseUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, error: "base_url must be a full URL, like https://levels.yourstudio.com/levelai" }; }
  if (u.protocol !== "https:") return { ok: false, error: "base_url must use https" };
  if (u.username || u.password) return { ok: false, error: "base_url must not contain a username or password" };
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || /^[\d.]+$/.test(h) || h.includes(":") || !h.includes(".")) {
    return { ok: false, error: "base_url must be a public host name (not localhost or an IP address)" };
  }
  if (u.search || u.hash) return { ok: false, error: "base_url must not have a query or fragment" };
  return { ok: true, url: `${u.origin}${u.pathname.replace(/\/+$/, "")}` };
}
