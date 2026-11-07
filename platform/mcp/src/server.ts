// Platform MCP server + the small HTTP API the browser games post events to.
// Streamable HTTP, stateless (one transport per request), bearer auth on /mcp.
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./tools.js";
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

// MCP endpoint. Naïve injects the bearer from its vault; local clients send it directly.
app.all("/mcp", async (req, res) => {
  const auth = req.header("authorization") ?? "";
  if (auth !== `Bearer ${TOKEN}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const server = new McpServer({ name: "level-studio-platform", version: "0.1.0" });
  registerTools(server);
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
