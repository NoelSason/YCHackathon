// Worker thread: makes one pack's levels (pack-maker.ts) off the server's main thread, so web
// requests and webhooks keep answering while the bots play. Posts each accepted level and retry as it
// happens, then the result. Started by `workerPackMaker` in deliver-pack.ts.
import { parentPort, workerData } from "node:worker_threads";
import { makePack } from "./pack-maker.js";
import type { MakeRequest } from "./pack-types.js";

const req = workerData as MakeRequest;
makePack(req, (p) => { parentPort!.postMessage({ type: "progress", progress: p }); })
  .then((result) => parentPort!.postMessage({ type: "done", result }))
  .catch((e: unknown) => parentPort!.postMessage({ type: "error", error: e instanceof Error ? e.message : String(e) }));
