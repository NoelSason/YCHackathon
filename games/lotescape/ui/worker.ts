// Web Worker entry: builds endless-mode lots and checks saved ones off the main thread.
import { runJob, type Job } from "./jobs.js";

const scope = globalThis as unknown as { onmessage: ((event: MessageEvent<Job>) => void) | null; postMessage(message: unknown): void };
scope.onmessage = (event) => scope.postMessage(runJob(event.data));
