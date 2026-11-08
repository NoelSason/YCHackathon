// Example generator (Level AI sample): a stand-in for a game studio's own endpoint, implementing the
// Level AI Generator Protocol (docs/developers.md, "Bring your own generator") for Lot Escape.
//   POST /generate  {seed, difficulty, params?, context?} → {level, meta}
//   POST /evaluate  {level, runs, seed}                   → {wins, runs, solvable, min_moves, bot}
//   POST /validate  {level}                               → {ok, errors}
// Every request must carry a valid X-LevelAI-Signature made with LEVELAI_SIGNING_SECRET, the secret
// Level AI returned when this endpoint was registered.
import { createHmac, timingSafeEqual } from "node:crypto";
import { evaluate, generate, validate } from "./lot.js";

/** The same check the developer docs show. */
function verifyLevelAiSignature(secret: string, rawBody: string, header: string | null): boolean {
  const parts = Object.fromEntries((header ?? "").split(",").map((p) => p.trim().split("=", 2)));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1 || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"));
  const given = Buffer.from(String(parts.v1));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);

export async function handle(request: Request, op: string): Promise<Response> {
  const secret = process.env.LEVELAI_SIGNING_SECRET;
  if (!secret) return reply(503, { error: "not configured: set LEVELAI_SIGNING_SECRET" });
  if (request.method !== "POST") return reply(405, { error: "use POST" });
  const raw = await request.text();
  if (raw.length > 200_000) return reply(413, { error: "body too large" });
  if (!verifyLevelAiSignature(secret, raw, request.headers.get("x-levelai-signature"))) return reply(401, { error: "bad signature" });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw) as Record<string, unknown>; } catch { return reply(400, { error: "body must be JSON" }); }
  const t0 = Date.now();
  try {
    if (op === "generate") {
      const out = generate(Math.floor(num(body.seed, 0, 2 ** 31, 1)), num(body.difficulty, 0, 1, 0.5));
      console.log(`generate d=${body.difficulty} notch=${out.meta.notch} min=${out.meta.min_moves} ${Date.now() - t0}ms`);
      return reply(200, out);
    }
    if (op === "validate") return reply(200, validate(body.level));
    if (op === "evaluate") {
      const check = validate(body.level);
      if (!check.ok) return reply(422, { error: `not a valid Lot Escape level: ${check.errors.join("; ")}` });
      const runs = Math.floor(num(body.runs, 1, 300, 100));
      const out = evaluate(body.level as never, runs, Math.floor(num(body.seed, 0, 2 ** 31, 1)));
      console.log(`evaluate runs=${runs} wins=${out.wins} ${Date.now() - t0}ms`);
      return reply(200, out);
    }
    return reply(404, { error: "unknown operation" });
  } catch (err) {
    return reply(500, { error: err instanceof Error ? err.message.slice(0, 200) : "failed" });
  }
}
