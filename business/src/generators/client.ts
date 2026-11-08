import { randomUUID } from "node:crypto";
import type { z } from "zod";
import {
  EvaluateResponse, GENERATOR_ID_HEADER, GenerateResponse, REQUEST_ID_HEADER, SIGNATURE_HEADER, ValidateResponse, signatureFor,
  type EvaluateRequest, type EvaluateResult, type GenerateRequest, type GenerateResult, type Op, type ValidateResult,
} from "./protocol.js";

/**
 * Calls a studio's generator: signed requests, a timeout per operation, retries for errors worth
 * retrying (network, timeout, 429, 5xx), and a circuit breaker per generator so a dead endpoint fails
 * fast instead of holding a pack for minutes. The secret is used only to sign; it's never logged.
 */
export const TIMEOUT_MS: Record<Op, number> = { generate: 20_000, evaluate: 90_000, validate: 10_000 };
export const RETRIES = 2;
/** Consecutive failed calls (after retries) that open the breaker, and how long it stays open. */
export const BREAKER_FAILURES = 3;
export const BREAKER_OPEN_MS = 120_000;
const MAX_RESPONSE_BYTES = 512_000;

export type FailureKind = "timeout" | "network" | "http" | "bad_response" | "circuit_open";
export class GeneratorCallError extends Error {
  constructor(readonly op: Op, readonly kind: FailureKind, message: string, readonly status: number | null = null) {
    super(message);
    this.name = "GeneratorCallError";
  }
  get retryable(): boolean {
    return this.kind === "timeout" || this.kind === "network" || (this.kind === "http" && (this.status === 429 || (this.status ?? 0) >= 500));
  }
}

interface Breaker { failures: number; openUntil: number }
const breakers = new Map<string, Breaker>();
export function breakerState(id: string): { open: boolean; failures: number; openUntil: number } {
  const b = breakers.get(id) ?? { failures: 0, openUntil: 0 };
  return { open: b.openUntil > Date.now(), failures: b.failures, openUntil: b.openUntil };
}
export function resetBreakers(): void { breakers.clear(); }

export interface ClientOptions {
  fetch?: typeof fetch;
  timeoutMs?: Partial<Record<Op, number>>;
  retries?: number;
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Called before each retry, for the activity log. */
  onRetry?: (op: Op, attempt: number, err: GeneratorCallError) => void | Promise<void>;
}

export interface CallInfo { op: Op; ms: number; attempts: number; status: number }

export interface GeneratorClient {
  generate(req: GenerateRequest): Promise<GenerateResult & { info: CallInfo }>;
  evaluate(req: EvaluateRequest): Promise<EvaluateResult & { info: CallInfo }>;
  /** Null when the generator doesn't offer validate (404 or 405). */
  validate(level: Record<string, unknown>): Promise<(ValidateResult & { info: CallInfo }) | null>;
}

export function generatorClient(gen: { id: string; baseUrl: string }, secret: string, opts: ClientOptions = {}): GeneratorClient {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const retries = opts.retries ?? RETRIES;

  async function once<T>(op: Op, body: string, schema: z.ZodType<T>): Promise<{ value: T; status: number } | { missing: true }> {
    const ctrl = new AbortController();
    const timeout = opts.timeoutMs?.[op] ?? TIMEOUT_MS[op];
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res: Response;
    try {
      res = await doFetch(`${gen.baseUrl}/${op}`, {
        method: "POST", body, signal: ctrl.signal, redirect: "error",
        headers: { "content-type": "application/json", [SIGNATURE_HEADER]: signatureFor(secret, body), [GENERATOR_ID_HEADER]: gen.id, [REQUEST_ID_HEADER]: randomUUID() },
      });
    } catch (err) {
      clearTimeout(timer);
      if (ctrl.signal.aborted) throw new GeneratorCallError(op, "timeout", `${op} timed out after ${Math.round(timeout / 1000)} s`);
      throw new GeneratorCallError(op, "network", `${op} couldn't connect (${err instanceof Error ? err.message.slice(0, 80) : "network error"})`);
    }
    try {
      if (op === "validate" && (res.status === 404 || res.status === 405)) return { missing: true };
      const text = await res.text();
      if (!res.ok) throw new GeneratorCallError(op, "http", `${op} answered HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ""}`, res.status);
      if (text.length > MAX_RESPONSE_BYTES) throw new GeneratorCallError(op, "bad_response", `${op} answer is over ${MAX_RESPONSE_BYTES / 1000} KB`, res.status);
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { throw new GeneratorCallError(op, "bad_response", `${op} didn't answer with JSON`, res.status); }
      const v = schema.safeParse(parsed);
      if (!v.success) throw new GeneratorCallError(op, "bad_response", `${op} answer doesn't match the protocol: ${v.error.issues.map((i) => `${i.path.join(".") || "body"} ${i.message}`).join("; ").slice(0, 200)}`, res.status);
      return { value: v.data, status: res.status };
    } catch (err) {
      if (err instanceof GeneratorCallError) throw err;
      if (ctrl.signal.aborted) throw new GeneratorCallError(op, "timeout", `${op} timed out after ${Math.round(timeout / 1000)} s`);
      throw new GeneratorCallError(op, "network", `${op} answer was cut off`);
    } finally {
      clearTimeout(timer);
    }
  }

  async function call<T>(op: Op, payload: unknown, schema: z.ZodType<T>): Promise<({ value: T } | { missing: true }) & { info: CallInfo }> {
    const b = breakers.get(gen.id) ?? { failures: 0, openUntil: 0 };
    breakers.set(gen.id, b);
    if (b.openUntil > Date.now()) {
      throw new GeneratorCallError(op, "circuit_open", `paused calls to this generator for ${Math.ceil((b.openUntil - Date.now()) / 1000)} s after ${b.failures} failed calls in a row`);
    }
    const body = JSON.stringify(payload);
    const t0 = Date.now();
    for (let attempt = 1; ; attempt++) {
      try {
        const out = await once(op, body, schema);
        b.failures = 0;
        b.openUntil = 0;
        return { ...out, info: { op, ms: Date.now() - t0, attempts: attempt, status: "status" in out ? out.status : 404 } };
      } catch (err) {
        const e = err instanceof GeneratorCallError ? err : new GeneratorCallError(op, "network", String(err));
        if (e.retryable && attempt <= retries) {
          await opts.onRetry?.(op, attempt, e);
          await sleep((opts.backoffMs ?? 500) * 2 ** (attempt - 1));
          continue;
        }
        b.failures++;
        // Open after enough failures in a row; a failed call while half-open (just after the pause) reopens at once.
        if (b.failures >= BREAKER_FAILURES) b.openUntil = Date.now() + BREAKER_OPEN_MS;
        throw e;
      }
    }
  }

  return {
    async generate(req) {
      const r = await call("generate", req, GenerateResponse);
      if ("missing" in r) throw new GeneratorCallError("generate", "http", "generate answered 404", 404);
      return { ...r.value, info: r.info };
    },
    async evaluate(req) {
      const r = await call("evaluate", req, EvaluateResponse);
      if ("missing" in r) throw new GeneratorCallError("evaluate", "http", "evaluate answered 404", 404);
      return { ...r.value, info: r.info };
    },
    async validate(level) {
      const r = await call("validate", { level }, ValidateResponse);
      return "missing" in r ? null : { ...r.value, info: r.info };
    },
  };
}
