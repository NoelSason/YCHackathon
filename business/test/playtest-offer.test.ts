import { describe, expect, it } from "vitest";
import type Mobilerun from "@mobilerun/sdk";
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store.js";
import { composeReport, createPlaytestOrder, enqueue, runPlaytestOrder } from "../src/leads/playtest-offer.js";
import { playtestPage } from "../src/leads/playtest-page.js";
import type { ToolContext } from "../src/mcp/tools.js";

function fakePhone(result: unknown): Mobilerun {
  return {
    tasks: {
      run: async () => ({ id: "task_1", status: "created" }),
      getStatus: async () => ({ status: "completed", succeeded: true, message: "done", output: result, steps: 9 }),
    },
  } as unknown as Mobilerun;
}

function ctx(phone: Mobilerun | null, env: Record<string, string> = {}) {
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const c: ToolContext = {
    config: loadConfig({ COMPANY_NAME: "Level AI", COMPANY_POSTAL_ADDRESS: "1752 Shattuck Avenue, Berkeley, CA 94704", MOBILERUN_DEVICE_ID: "dev_1", ...env }),
    store: new MemoryStore(), monid: null, stripe: null, naive: null, mobilerun: phone,
    mail: { async send(a) { sent.push(a); return { messageId: "m1" }; }, async reply() { return { messageId: "r" }; } },
  };
  return { c, sent };
}

const order = { name: "Ada Lovelace", email: "ada@team.example", team: "Team Ada", appUrl: "https://ada.example.app", focus: "the signup flow", consent: true };

describe("phone playtest offer", () => {
  it("runs a free playtest on the phone and emails the report", async () => {
    const report = { results: [{ level: "app", loaded: true, touchOk: true, won: null, movesUsed: null, visualIssues: ["Sign-up button is cut off on small screens"], stuckReason: null, notes: "Home and settings load quickly." }] };
    const { c, sent } = ctx(fakePhone(report));
    const r = await createPlaytestOrder(c, order);
    expect(r).toMatchObject({ ok: true, payUrl: null });
    await enqueue(async () => undefined); // wait for the queued playtest to finish
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe("Your iPhone playtest report: Team Ada");
    expect(sent[0]!.text).toContain("Sign-up button is cut off on small screens");
    expect(sent[0]!.text).toContain("Reply \"stop\"");
    if (r.ok) expect((await c.store.getLead(r.lead.id))!.stage).toBe("delivered");
  });

  it("rejects a non-web link and a missing consent", async () => {
    const { c } = ctx(null);
    expect((await createPlaytestOrder(c, { ...order, appUrl: "ftp://x" })).ok).toBe(false);
    expect((await createPlaytestOrder(c, { ...order, consent: false })).ok).toBe(false);
  });

  it("still emails an honest note when the phone can't finish", async () => {
    const { c, sent } = ctx(null);
    const lead = await c.store.upsertLead({ company: "Team B", appId: null, contactName: null, email: "b@x.example", source: "inbound_form", stage: "found", reason: null, sampleUrl: null, crmContactId: null });
    await runPlaytestOrder(c, lead, "https://b.example", null);
    expect(sent[0]!.text).toContain("couldn't finish the playtest");
  });

  it("shows the price only when payments are on", () => {
    expect(playtestPage("Level AI", 5, false)).toContain("$5 per playtest");
    expect(playtestPage("Level AI", undefined, false)).toContain("Free during the hackathon");
    expect(playtestPage("Level AI", undefined, false)).not.toMatch(/mobilerun|stripe|agentmail/i);
    expect(composeReport({ name: null, team: "T", appUrl: "https://t", outcome: null, error: null, companyName: "Level AI", postalAddress: "A" }).subject).toContain("T");
  });
});
