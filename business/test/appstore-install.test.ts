import { afterEach, describe, expect, it, vi } from "vitest";
import type Mobilerun from "@mobilerun/sdk";
import { z } from "zod";
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store.js";
import { runPlaytestOrder } from "../src/leads/playtest-offer.js";
import { installWithAppStoreApp, StoreInstallResultSchema, storeInstallTask } from "../src/mobile/install.js";
import type { ToolContext } from "../src/mcp/tools.js";

const PARKING = { bundleId: "com.loop.packedloop", trackName: "Parking Loop", artistName: "Loop Games", price: 0 };
const REPORT = { results: [{ level: "app", loaded: true, touchOk: true, won: null, movesUsed: null, visualIssues: [], stuckReason: null, notes: "Level 1 loads and plays." }] };

/** Apple's lookup, answering for one app by numeric id or bundle id. */
function fakeLookup(app: typeof PARKING): typeof fetch {
  return (async (url: string | URL) => {
    const u = String(url);
    const hit = u.includes("id=1234567") || u.includes(`bundleId=${app.bundleId}`);
    return new Response(JSON.stringify({ results: hit ? [app] : [] }), { status: 200 });
  }) as typeof fetch;
}

interface Run { deviceId: string; task: string }

/** Two phones. The API install always 404s (the app isn't in Mobilerun's catalog). */
function fakePhones(opts: { storeReport?: unknown; storeInstalls?: boolean } = {}) {
  const runs: Run[] = [];
  const apps: Record<string, Array<{ packageName: string; label: string }>> = { dev_1: [], dev_store: [] };
  const outputs = new Map<string, unknown>();
  const client = {
    devices: {
      apps: {
        list: async (id: string) => apps[id] ?? [],
        install: async (_id: string, p: { bundleId: string }) => { throw new Error(`404 App ${p.bundleId} not found`); },
      },
      screenshots: { capture: () => { throw new Error("no screen in tests"); } },
    },
    tasks: {
      run: async (p: { deviceId: string; task: string }) => {
        runs.push({ deviceId: p.deviceId, task: p.task });
        const id = `task_${runs.length}`;
        if (p.task.includes("from the App Store on this iPhone")) {
          if (opts.storeInstalls !== false) apps[p.deviceId]!.push({ packageName: PARKING.bundleId, label: PARKING.trackName });
          outputs.set(id, opts.storeReport ?? { installed: true, appName: "Parking Loop", developer: "Loop Games", blockedBy: null });
        } else {
          outputs.set(id, REPORT);
        }
        return { id, status: "created" };
      },
      getStatus: async (id: string) => ({ status: "completed", succeeded: true, message: "done", output: outputs.get(id), steps: 5 }),
      stop: async () => undefined,
    },
  } as unknown as Mobilerun;
  return { client, runs, apps };
}

function ctx(phone: Mobilerun, env: Record<string, string> = {}) {
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const c: ToolContext = {
    config: loadConfig({ COMPANY_NAME: "Level AI", COMPANY_POSTAL_ADDRESS: "1752 Shattuck Avenue, Berkeley, CA 94704", MOBILERUN_DEVICE_ID: "dev_1", ...env }),
    store: new MemoryStore(), monid: null, stripe: null, naive: null, mobilerun: phone,
    mail: { async send(a) { sent.push(a); return { messageId: "m1" }; }, async reply() { return { messageId: "r" }; } },
  };
  return { c, sent };
}

async function lead(c: ToolContext) {
  return c.store.upsertLead({ company: "Loop Games", appId: null, contactName: "Sam", email: "sam@loop.example", source: "inbound_form", stage: "found", reason: null, sampleUrl: null, crmContactId: null });
}

const STORE_URL = "https://apps.apple.com/us/app/parking-loop/id1234567";

afterEach(() => vi.unstubAllGlobals());

describe("App Store install fallback", () => {
  it("falls back to the App Store phone on a 404, then plays the app there", async () => {
    vi.stubGlobal("fetch", fakeLookup(PARKING));
    const { client, runs } = fakePhones();
    const { c, sent } = ctx(client, { MOBILERUN_APPSTORE_DEVICE_ID: "dev_store" });
    const l = await lead(c);
    await runPlaytestOrder(c, l, STORE_URL, null);

    expect(runs).toHaveLength(2);
    // 1: the App Store download, on the App Store phone, with the exact name and developer.
    expect(runs[0]!.deviceId).toBe("dev_store");
    expect(runs[0]!.task).toContain('"Parking Loop" by Loop Games');
    expect(runs[0]!.task).toMatch(/Never type a password/);
    // 2: the playtest itself, on the phone that has the app.
    expect(runs[1]!.deviceId).toBe("dev_store");
    expect(sent[0]!.subject).toBe("Your iPhone playtest report: Loop Games");
    const acts = (await c.store.listActivity(50)).map((a) => a.action);
    expect(acts).toContain("installed Parking Loop on the iPhone");
  });

  it("uses the App Store phone without downloading again when the app is already there", async () => {
    vi.stubGlobal("fetch", fakeLookup(PARKING));
    const { client, runs, apps } = fakePhones();
    apps.dev_store!.push({ packageName: PARKING.bundleId, label: "Parking Loop" });
    const { c } = ctx(client, { MOBILERUN_APPSTORE_DEVICE_ID: "dev_store" });
    await runPlaytestOrder(c, await lead(c), STORE_URL, null);
    expect(runs.map((r) => r.deviceId)).toEqual(["dev_store"]);
    expect(runs[0]!.task).not.toContain("from the App Store on this iPhone");
  });

  it("refuses a paid app before touching the phone", async () => {
    vi.stubGlobal("fetch", fakeLookup({ ...PARKING, price: 0.99 }));
    const { client, runs } = fakePhones();
    const { c, sent } = ctx(client, { MOBILERUN_APPSTORE_DEVICE_ID: "dev_store" });
    await runPlaytestOrder(c, await lead(c), STORE_URL, null);
    expect(runs).toHaveLength(0);
    expect(sent[0]!.text).toContain("costs money on the App Store");
    expect(sent[0]!.text).toContain("couldn't finish this playtest");
  });

  it("says honestly that the app can't be installed when there's no App Store phone", async () => {
    vi.stubGlobal("fetch", fakeLookup(PARKING));
    const { client, runs } = fakePhones();
    const { c, sent } = ctx(client);
    await runPlaytestOrder(c, await lead(c), STORE_URL, null);
    expect(runs).toHaveLength(0);
    expect(sent[0]!.text).toContain("We can't install that app on our test iPhone yet");
    expect(sent[0]!.text).not.toMatch(/mobilerun|404|catalog/i);
  });

  it("trusts the phone's app list, not the agent's word", async () => {
    const { client } = fakePhones({ storeInstalls: false, storeReport: { installed: false, appName: "Parking Loop", developer: "Loop Games", blockedBy: "asked for a password" } });
    await expect(installWithAppStoreApp({ client, deviceId: "dev_store", bundleId: PARKING.bundleId, pollMs: 1, fetchImpl: fakeLookup(PARKING) }))
      .rejects.toThrow("asked for a password");
    const { client: liar } = fakePhones({ storeInstalls: false });
    await expect(installWithAppStoreApp({ client: liar, deviceId: "dev_store", bundleId: PARKING.bundleId, pollMs: 1, fetchImpl: fakeLookup(PARKING) }))
      .rejects.toThrow("isn't on the phone");
  });

  it("sends Mobilerun a schema without anyOf and a task with the safety rules", () => {
    expect(JSON.stringify(z.toJSONSchema(StoreInstallResultSchema))).not.toContain("anyOf");
    const t = storeInstallTask({ name: "Parking Loop", developer: "Loop Games" });
    expect(t).toMatch(/Free apps only/);
    expect(t).toMatch(/Face ID/);
    expect(t).toMatch(/Skip any result marked "Ad"/);
  });
});
