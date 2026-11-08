import { Worker } from "node:worker_threads";
import type { AcceptedLevel } from "./calibrate.js";
import type { ProductionGame } from "./catalog.js";

export type JobResult = { ok: true; result: AcceptedLevel } | { ok: false; errors: string[] };

export function generateOne(game: ProductionGame, position: number, series: number, maxMs = 55_000, fingerprints: string[] = [], signal?: AbortSignal, attemptOffset = 0): Promise<JobResult> {
  if (signal?.aborted) return Promise.resolve({ ok: false, errors: ["stopped"] });
  return new Promise(resolve => {
    const started = Date.now();
    const w = new Worker(new URL(`./job${import.meta.url.endsWith(".ts") ? ".ts" : ".js"}`, import.meta.url), {
      execArgv: import.meta.url.endsWith(".ts") ? ["--import", "tsx"] : [],
      workerData: { game, position, series, maxMs, fingerprints, attemptOffset },
    });
    let settled = false;
    const finish = (out: JobResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      void w.terminate();
      if (out.ok) out.result.elapsed_ms = Date.now() - started;
      resolve(out);
    };
    const stop = () => finish({ ok: false, errors: ["stopped"] });
    const timer = setTimeout(() => finish({ ok: false, errors: [`${maxMs}ms deadline reached; no level accepted`] }), maxMs);
    signal?.addEventListener("abort", stop, { once: true });
    w.once("message", (out: JobResult) => finish(out));
    w.once("error", error => finish({ ok: false, errors: [error.message] }));
    w.once("exit", code => { if (!settled) finish({ ok: false, errors: [`job exited without evidence (code ${code})`] }); });
  });
}
