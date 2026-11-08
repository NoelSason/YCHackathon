import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createHandler } from "../src/app.js";

// The fetch handler that both `node dist/server.js` and the Neon Function run.
const handle = createHandler(loadConfig({ BUSINESS_MCP_TOKEN: "test-token" }));
const mcpHeaders = { "content-type": "application/json", accept: "application/json, text/event-stream" };

describe("server routes (fetch handler)", () => {
  it("reports health with booleans only", async () => {
    const res = await handle(new Request("http://x/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, integrations: { database: false } });
  });

  it("refuses /mcp without the bearer, and lists tools with it", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const denied = await handle(new Request("http://x/mcp", { method: "POST", headers: mcpHeaders, body }));
    expect(denied.status).toBe(401);
    const ok = await handle(new Request("http://x/mcp", { method: "POST", headers: { ...mcpHeaders, authorization: "Bearer test-token" }, body }));
    expect(ok.status).toBe(200);
    const { result } = (await ok.json()) as { result: { tools: Array<{ name: string }> } };
    expect(result.tools.map((t) => t.name)).toContain("find_targets");
  });

  it("rejects an incomplete lead, 503s unconfigured webhooks, and 404s unknown paths", async () => {
    expect((await handle(new Request("http://x/leads", { method: "POST", body: "{}" }))).status).toBe(400);
    expect((await handle(new Request("http://x/webhooks/agentmail", { method: "POST", body: "{}" }))).status).toBe(503);
    expect((await handle(new Request("http://x/webhooks/stripe", { method: "POST", body: "{}" }))).status).toBe(503);
    expect((await handle(new Request("http://x/nope"))).status).toBe(404);
  });

  it("treats blank env values as unset", () => {
    const config = loadConfig({ PILOT_PRICE_USD: "", OUTREACH_SEND: "", PORT: "" });
    expect(config.PILOT_PRICE_USD).toBeUndefined();
    expect(config.OUTREACH_SEND).toBe("0");
    expect(config.PORT).toBe(8787);
  });
});
