import { describe, expect, it, beforeEach } from "vitest";
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store.js";
import { appIdFromStoreUrl } from "../src/leads/intake.js";
import { storeName, storeUrl } from "../src/research/monid.js";
import { pickGenericEmail } from "../src/research/contacts.js";
import { finish, resetProgress, status, step } from "../src/leads/progress.js";
import { createHandler } from "../src/app.js";
import type { ToolContext } from "../src/mcp/tools.js";

function ctx(): { c: ToolContext; sent: Array<{ to: string; subject: string; text: string }> } {
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const config = loadConfig({ COMPANY_NAME: "Level AI", COMPANY_POSTAL_ADDRESS: "1752 Shattuck Avenue, Berkeley, CA 94704", BUSINESS_MCP_TOKEN: "t" });
  return {
    c: { config, store: new MemoryStore(), monid: null, stripe: null, naive: null, mobilerun: null,
      mail: { async send(a) { sent.push(a); return { messageId: "m1" }; }, async reply() { return { messageId: "r" }; } } },
    sent,
  };
}

describe("App Store and Google Play links", () => {
  it("reads both stores' links", () => {
    expect(appIdFromStoreUrl("https://apps.apple.com/us/app/royal-match/id1482155847")).toBe("ios:1482155847");
    expect(appIdFromStoreUrl("https://play.google.com/store/apps/details?id=com.loop.packedloop")).toBe("com.loop.packedloop");
    expect(appIdFromStoreUrl("https://apps.apple.com/us/app/no-id")).toBeNull();
    expect(storeName("ios:1")).toBe("App Store");
    expect(storeUrl("ios:1482155847")).toBe("https://apps.apple.com/app/id1482155847");
  });
});

describe("public contact lookup", () => {
  it("picks a business-style role address and ignores personal ones", () => {
    const raw = { data: { emails: [
      { value: "jane.doe@studio.com", type: "personal" },
      { value: "support@studio.com", type: "generic" },
      { value: "business@studio.com", type: "generic" },
    ] } };
    expect(pickGenericEmail(raw)).toBe("business@studio.com");
    expect(pickGenericEmail({ data: { emails: [{ value: "a.b@x.com", type: "personal" }] } })).toBeNull();
  });
});

describe("live progress", () => {
  beforeEach(() => resetProgress());
  it("moves steps from active to done and marks the end", () => {
    step("id1", "Reading reviews");
    step("id1", "Writing your email");
    finish("id1", "Email sent");
    const s = status("id1");
    expect(s.done).toBe(true);
    expect(s.steps.map((x) => x.state)).toEqual(["done", "done", "done"]);
    expect(status("unknown")).toEqual({ steps: [], done: false });
  });
});

describe("developer keys and the studio MCP", () => {
  it("emails a key once, never stores it, and lets that key list the studio tools", async () => {
    const { c, sent } = ctx();
    const handle = createHandler(c.config, c);
    const res = await handle(new Request("http://x/developer-keys", { method: "POST", body: JSON.stringify({ name: "Ada", email: "ada@studio.example", studio: "Ada Games", consent: true }) }));
    expect(res.status).toBe(201);
    const key = sent[0]!.text.match(/lvl_[0-9a-f]{48}/)![0];
    expect(JSON.stringify(await c.store.listActivity())).not.toContain(key);

    const denied = await handle(new Request("http://x/studio-mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }));
    expect(denied.status).toBe(401);

    const ok = await handle(new Request("http://x/studio-mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }));
    const text = await ok.text();
    for (const t of ["request_playtest", "audit_reviews", "request_free_levels", "get_status"]) expect(text).toContain(`"name":"${t}"`);
  });

  it("answers /offer and /signup-status for the new pages", async () => {
    const { c } = ctx();
    const handle = createHandler(c.config, c);
    expect(await (await handle(new Request("http://x/offer"))).json()).toEqual({ playtestPriceUsd: null });
    expect((await handle(new Request("http://x/signup-status?id=nope"))).status).toBe(400);
  });
});
