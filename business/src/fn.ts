// The business server as a Neon Function: the same fetch handler `src/server.ts` serves on Node.
// Declared in `neon.ts`; deploy with `neon deploy --env ../.env` from `business/`.
// DATABASE_URL is injected by Neon. Everything else comes from the env block in neon.ts.
import { loadConfig } from "./config.js";
import { createHandler } from "./app.js";

const handle = createHandler(loadConfig());

export default {
  fetch: (request: Request): Promise<Response> => handle(request),
};
