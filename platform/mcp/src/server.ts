// Platform MCP server + the small HTTP API the browser games post events to.
// Streamable HTTP, stateless (one transport per request), bearer auth on /mcp.
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools, type Catalog } from "./tools.js";
import { q, pool } from "./db.js";
import { getAdapter } from "./adapters.js";

const PORT = Number(process.env.PORT ?? 8787);
const TOKEN = process.env.MCP_BEARER_TOKEN;
if (!TOKEN) {
  console.error("MCP_BEARER_TOKEN is not set");
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", async (_req, res) => {
  try {
    await pool.query("select 1");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Player events from the browser games (CONTRACTS.md §1). No auth: the games are public.
app.post("/events", async (req, res) => {
  const b = req.body ?? {};
  const types = ["attempt", "win", "loss", "quit"];
  if (typeof b.game_id !== "string" || !types.includes(b.type)) {
    res.status(400).json({ error: "game_id and type (attempt|win|loss|quit) are required" });
    return;
  }
  await q(
    `insert into player_events(game_id, level_id, session_id, type, moves_used, time_seconds) values ($1,$2,$3,$4,$5,$6)`,
    [b.game_id, b.level_id ?? null, b.session_id ?? null, b.type, b.moves_used ?? null, b.time_seconds ?? null],
  );
  res.json({ ok: true });
});

app.get("/games/:game_id/schema", (req, res) => {
  const a = getAdapter(req.params.game_id);
  if (!a) { res.status(404).json({ error: "unknown game" }); return; }
  res.json(a.schema);
});

// Public read path used by level URLs. Level ids are random UUIDs and the content is designed
// for public play; writes remain behind the authenticated MCP endpoint.
app.get("/levels/:level_id", async (req, res) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.level_id)) {
    res.status(400).json({ error: "invalid level id" });
    return;
  }
  const row = await q<{ level_id: string; game_id: string; level: object; status: string }>(
    "select level_id, game_id, level, status from levels where level_id = $1",
    [req.params.level_id],
  );
  if (!row.length) { res.status(404).json({ error: "level not found" }); return; }
  res.json(row[0]);
});

// MCP endpoint. Naïve injects the bearer from its vault; local clients send it directly.
app.all(["/mcp", "/mcp/crm"], async (req, res) => {
  const auth = req.header("authorization") ?? "";
  if (auth !== `Bearer ${TOKEN}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const catalog: Catalog = req.path === "/mcp/crm" ? "crm" : "core";
  const server = new McpServer({ name: catalog === "crm" ? "level-studio-crm" : "level-studio-platform", version: "0.2.0" });
  registerTools(server, catalog);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { void transport.close(); void server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("mcp error", e);
    if (!res.headersSent) res.status(500).json({ error: "internal" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`platform mcp listening on :${PORT} (/mcp, /events, /health)`);
});
