import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Check } from "../types.js";
const EXPECTED = ["list_games", "validate_level", "save_level", "solve_level", "get_solver_run", "accept_level", "publish_pack", "get_player_stats", "get_company_metrics", "log_action", "log_decision", "resolve_decision"];
const check: Check = {
  name: "mcp_tools", owner: "Abhinav", path: "all (agents can call the platform)",
  async run({ platformUrl, bearer }) {
    const transport = new StreamableHTTPClientTransport(new URL(`${platformUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${bearer}` } } });
    const client = new Client({ name: "checks", version: "0.0.1" });
    await client.connect(transport);
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      const missing = EXPECTED.filter((n) => !names.includes(n));
      return missing.length ? { ok: false, detail: `missing tools: ${missing.join(", ")}` } : { ok: true, detail: `${names.length} tools listed with the bearer` };
    } finally { await client.close(); }
  },
};
export default check;
