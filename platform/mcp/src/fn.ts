// The platform as a Neon Function: a web-standard fetch handler. Same tools, same routes as
// server.ts (which stays for local Express dev). Deploy with `neon deploy --env .env`.
// DATABASE_URL is injected by Neon; MCP_BEARER_TOKEN and GAMES_BASE_URL come from neon.ts env.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { attachDatabasePool } from "@neon/functions";
import { registerTools } from "./tools.js";
import { pool, q } from "./db.js";
import { getAdapter, listAdapters } from "./adapters.js";

attachDatabasePool(pool);

// Make sure every registered adapter has a `games` row, so list_games and the FK on levels work
// as soon as an adapter is registered. Runs once per isolate; idempotent.
const seeded = (async () => {
  for (const a of listAdapters()) {
    await q(
      `insert into games(game_id, name, bots) values ($1,$2,$3)
       on conflict (game_id) do update set name = excluded.name, bots = excluded.bots`,
      [a.game_id, a.name, JSON.stringify(a.bots)],
    ).catch((e: unknown) => console.error("seed games failed", e));
  }
})();

const TOKEN = process.env.MCP_BEARER_TOKEN ?? "";
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...cors() },
  });

function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers":
      "content-type, authorization, mcp-session-id, mcp-protocol-version",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  };
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      return await handle(request);
    } catch (e) {
      console.error("platform error", e);
      return json({ error: "internal", message: String(e) }, 500);
    }
  },
};

async function handle(request: Request): Promise<Response> {
  await seeded;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors() });

  if (path === "/health") {
    try {
      await pool.query("select 1");
      return json({ ok: true });
    } catch (e) {
      return json({ ok: false, error: String(e) }, 500);
    }
  }

  // Player events from the browser games (CONTRACTS.md §1). Public: the games are public.
  if (path === "/events" && request.method === "POST") {
    let b: Record<string, unknown>;
    try {
      b = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "invalid json" }, 400);
    }
    const types = ["attempt", "win", "loss", "quit"];
    if (
      typeof b.game_id !== "string" ||
      typeof b.type !== "string" ||
      !types.includes(b.type)
    ) {
      return json(
        { error: "game_id and type (attempt|win|loss|quit) are required" },
        400,
      );
    }
    await q(
      `insert into player_events(game_id, level_id, session_id, type, moves_used, time_seconds) values ($1,$2,$3,$4,$5,$6)`,
      [
        b.game_id,
        b.level_id ?? null,
        b.session_id ?? null,
        b.type,
        b.moves_used ?? null,
        b.time_seconds ?? null,
      ],
    );
    return json({ ok: true });
  }

  const schema = path.match(/^\/games\/([a-z0-9_-]+)\/schema$/);
  if (schema) {
    const a = getAdapter(schema[1]!);
    return a ? json(a.schema) : json({ error: "unknown game" }, 404);
  }

  const level = path.match(/^\/levels\/([^/]+)$/);
  if (level) {
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(level[1]!)) {
      return json({ error: "invalid level id" }, 400);
    }
    const rows = await q<{ level_id: string; game_id: string; level: object; status: string }>(
      "select level_id, game_id, level, status from levels where level_id = $1",
      [level[1]],
    );
    return rows.length ? json(rows[0]) : json({ error: "level not found" }, 404);
  }

  if (path === "/mcp") {
    if (!TOKEN || request.headers.get("authorization") !== `Bearer ${TOKEN}`) {
      return json({ error: "unauthorized" }, 401);
    }
    const server = new McpServer({
      name: "level-studio-platform",
      version: "0.1.0",
    });
    registerTools(server);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(request);
    } finally {
      void transport.close();
      void server.close();
    }
  }

  return json(
    {
      error: "not found",
      routes: ["/health", "POST /events", "/games/:id/schema", "GET /levels/:id", "/mcp"],
    },
    404,
  );
}
