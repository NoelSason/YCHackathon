// Smoke test against a running server: list tools, save a stub level, queue a solve, log a decision.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MCP_URL ?? "http://localhost:8787/mcp";
const token = process.env.MCP_BEARER_TOKEN ?? "";
const transport = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: { headers: { authorization: `Bearer ${token}` } },
});
const client = new Client({ name: "smoke", version: "0.0.1" });
await client.connect(transport);

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as { type: string; text?: string }[]).find((c) => c.type === "text")?.text ?? "{}";
  const data = JSON.parse(text);
  console.log(name, "→", JSON.stringify(data).slice(0, 200));
  return data;
}

await call("list_games");
const saved = await call("save_level", { game_id: "stub", level: { width: 6, height: 6, moves: 20 }, target_win_rate: 0.4, notes: "smoke" });
await call("validate_level", { game_id: "stub", level: { width: "x" } });
const run = await call("solve_level", { level_id: saved.level_id, runs: 50 });
await call("get_solver_run", { run_id: run.run_id });
const d = await call("log_decision", { saw: "smoke", options: ["a", "b"], chose: "a", why: "smoke", expected: "nothing" });
await call("resolve_decision", { decision_id: d.id, result: "nothing happened", matched_expectation: true });
await call("get_company_metrics");
await client.close();
console.log("smoke ok");
