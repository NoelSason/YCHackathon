import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { integrationStatus, loadConfig } from "./config.js";
import { createHandler, MAX_BODY_BYTES } from "./app.js";

/**
 * The business server on Node: `npm run webhooks` (dev) or `npm start` (built, `node dist/server.js`).
 * It adapts Node's request and response to the fetch handler in `src/app.ts`, which is also what the
 * Neon Function (`src/fn.ts`) runs. Routes are listed in `src/app.ts`.
 */
const config = loadConfig();
const handle = createHandler(config);

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("Body too large.");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function toRequest(req: IncomingMessage): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(new URL(req.url ?? "/", "http://localhost"), {
    method: req.method ?? "GET",
    headers,
    body: hasBody ? await readBody(req) : undefined,
  });
}

async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

const server = createServer(async (req, res) => {
  try {
    await writeResponse(res, await handle(await toRequest(req)));
  } catch (err) {
    console.error(err instanceof Error ? err.message : "request failed");
    if (!res.headersSent) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "request failed" }));
    }
  }
});

server.listen(config.PORT, () => {
  console.log(`business ops listening on :${config.PORT}`, integrationStatus(config));
});
