import type Mobilerun from "@mobilerun/sdk";
import { z } from "zod";

/**
 * Installs a free App Store app on a cloud iPhone, so a playtest can play a studio's real app.
 *
 * 1. The Mobilerun API (POST /devices/{id}/apps) on the main phone. It installs only apps in
 *    Mobilerun's hosted catalog, with no Apple Account on the phone. Checked Nov 7: Duolingo and
 *    Spotify install; Royal Match, Block Blast, Parking Loop, and other studio games return 404
 *    APP_NOT_FOUND. Numeric App Store ids 404 too, so we resolve them to bundle ids first.
 * 2. When that 404s and MOBILERUN_APPSTORE_DEVICE_ID is set: a Mobilerun Agent task on that second
 *    phone (signed in to the App Store by a person) opens the App Store, searches the app's exact
 *    name, checks the developer, and taps Get. Free apps only: it never buys, never confirms with a
 *    password or Face ID, and never changes account settings. apps.list on that phone confirms it.
 *
 * The result says which phone has the app, so the playtest runs there. Never uninstalls.
 */
export interface InstalledApp {
  packageName: string;
  label: string;
  alreadyInstalled: boolean;
  /** The phone the app is on. Run the playtest here. */
  deviceId: string;
  /** "api": Mobilerun's catalog. "app_store": downloaded in the App Store app on the App Store phone. */
  via: "api" | "app_store";
}

/** What Apple's public lookup says about an app. */
export interface AppInfo { bundleId: string; name: string; developer: string | null; price: number | null }

async function listApps(client: Mobilerun, deviceId: string): Promise<Array<{ packageName: string; label: string }>> {
  const r = await client.devices.apps.list(deviceId);
  return (r ?? []).map((a) => ({ packageName: a.packageName, label: a.label }));
}

/** Numeric App Store id or bundle id → name, developer, and price, via Apple's public lookup. Null if not found. */
export async function lookupApp(id: string, fetchImpl: typeof fetch = fetch): Promise<AppInfo | null> {
  const q = /^\d+$/.test(id) ? `id=${id}` : `bundleId=${encodeURIComponent(id)}`;
  const r = await fetchImpl(`https://itunes.apple.com/lookup?${q}&country=us`, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) return null;
  const j = (await r.json()) as { results?: Array<{ bundleId?: string; trackName?: string; sellerName?: string; artistName?: string; price?: number }> };
  const hit = j.results?.find((x) => x.bundleId);
  if (!hit?.bundleId) return null;
  return { bundleId: hit.bundleId, name: hit.trackName ?? hit.bundleId, developer: hit.artistName ?? hit.sellerName ?? null, price: typeof hit.price === "number" ? hit.price : null };
}

/** Numeric App Store id → bundle id and name. A bundle id passes through without a lookup. */
export async function lookupBundleId(appStoreId: string, fetchImpl: typeof fetch = fetch): Promise<{ bundleId: string; name: string } | null> {
  if (!/^\d+$/.test(appStoreId)) return { bundleId: appStoreId, name: appStoreId };
  const app = await lookupApp(appStoreId, fetchImpl);
  return app ? { bundleId: app.bundleId, name: app.name } : null;
}

export async function installFromAppStore(args: {
  client: Mobilerun;
  deviceId: string;
  appStoreId: string;
  /** The phone signed in to the App Store, used when the API can't install the app. */
  appStoreDeviceId?: string | null;
  /** Mobilerun Agent model for the App Store task. */
  model?: string;
  /** Called when the install moves to the App Store phone, so a live view can follow it. */
  onAppStorePhone?: (deviceId: string) => void;
  timeoutMs?: number;
  pollMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<InstalledApp> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const app = await lookupBundleId(args.appStoreId, fetchImpl);
  if (!app) throw new Error("We couldn't find that app on the US App Store.");
  const before = await listApps(args.client, args.deviceId);
  const already = before.find((a) => a.packageName === app.bundleId);
  if (already) return { ...already, alreadyInstalled: true, deviceId: args.deviceId, via: "api" };
  const storePhone = args.appStoreDeviceId && args.appStoreDeviceId !== args.deviceId ? args.appStoreDeviceId : null;
  if (storePhone) {
    const there = (await listApps(args.client, storePhone).catch(() => [])).find((a) => a.packageName === app.bundleId);
    if (there) return { ...there, alreadyInstalled: true, deviceId: storePhone, via: "app_store" };
  }
  const known = new Set(before.map((a) => a.packageName));
  try {
    await args.client.devices.apps.install(args.deviceId, { bundleId: app.bundleId, background: false }, { timeout: args.timeoutMs ?? 5 * 60_000 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const notFound = /APP_NOT_FOUND|404/.test(msg);
    if (notFound && storePhone) {
      return installWithAppStoreApp({ ...args, fetchImpl, deviceId: storePhone, bundleId: app.bundleId });
    }
    if (notFound) throw new Error("We can't install that app on our test iPhone yet (it isn't in the set of apps the phone can download).");
    throw new Error(`The App Store install failed on our test iPhone (${/TIMEOUT|504/.test(msg) ? "timed out" : "download failed"}).`);
  }
  const installed = (await listApps(args.client, args.deviceId)).find((a) => a.packageName === app.bundleId);
  if (installed) return { ...installed, alreadyInstalled: false, deviceId: args.deviceId, via: "api" };
  const deadline = Date.now() + (args.timeoutMs ?? 5 * 60_000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, args.pollMs ?? 5000));
    const now = await listApps(args.client, args.deviceId);
    const added = now.find((a) => !known.has(a.packageName));
    if (added) return { ...added, alreadyInstalled: false, deviceId: args.deviceId, via: "api" };
    // Fail fast when the device reports the install failed (seen Nov 7: status "failed" right away).
    const log = (await (args.client.devices.apps as unknown as { listInstalls(id: string): Promise<{ installs?: Array<{ appId: string; status: string; errorClass?: string }> }> })
      .listInstalls(args.deviceId).catch(() => ({ installs: [] })));
    const mine = (log.installs ?? []).filter((i) => i.appId === app.bundleId || i.appId === args.appStoreId).pop();
    if (mine?.status === "failed") throw new Error(`The App Store install failed on our test iPhone (${mine.errorClass ?? "no reason given"}).`);
  }
  throw new Error("The app didn't finish installing in time (it may be paid, region-locked, or large).");
}

/** What the phone agent reports after trying the App Store. Nullable strings become type: [string, null], never anyOf. */
export const StoreInstallResultSchema = z.object({
  installed: z.boolean(),
  appName: z.string().nullable(),
  developer: z.string().nullable(),
  blockedBy: z.string().nullable(),
});
export type StoreInstallResult = z.infer<typeof StoreInstallResultSchema>;

export const STORE_MAX_STEPS = 40;
export const STORE_MAX_SECONDS = 7 * 60;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

/** The plain-language goal for the App Store task. */
export function storeInstallTask(app: { name: string; developer: string }): string {
  return [
    `Goal: download the free app "${app.name}" by ${app.developer} from the App Store on this iPhone.`,
    "1. Go to the home screen and open the App Store app.",
    `2. Tap Search in the bottom bar, tap the search field, type exactly: ${app.name}  and tap Search on the keyboard.`,
    `3. Skip any result marked "Ad". Find the result named "${app.name}" from the developer "${app.developer}" and open its page. Check that the developer name on the page is "${app.developer}". If no result matches, stop and report installed = false, blockedBy = "not found".`,
    "4. If the page's button says \"Open\", the app is already installed: report installed = true.",
    "5. If the button says \"Get\" or shows a cloud icon with a down arrow, tap it. If a sheet then shows a free \"Get\" or \"Install\" button that needs no password, tap it.",
    "6. Wait for the download: check every 10 seconds, for up to 4 minutes, until the button says \"Open\". Then report installed = true. Don't open the app.",
    "Rules:",
    "- Free apps only. If the button shows a price (for example $0.99) instead of Get, stop: installed = false, blockedBy = \"paid app\".",
    "- Never type a password. Never confirm with Face ID, Touch ID, or a side-button double-click. Never sign in, sign out, or change the Apple Account, payment, or any setting. If the phone asks for any of these, tap Cancel and stop: installed = false, and blockedBy says what it asked for.",
    "- Never tap ads, In-App Purchases, subscriptions, or other apps.",
    "Report: installed, appName (the name on the app's page, or null), developer (the developer on the app's page, or null), blockedBy (null if nothing stopped you).",
  ].join("\n");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Downloads a free app in the App Store app on the App Store phone, then confirms it with apps.list. */
export async function installWithAppStoreApp(args: {
  client: Mobilerun;
  /** The App Store phone. */
  deviceId: string;
  bundleId: string;
  model?: string;
  onAppStorePhone?: (deviceId: string) => void;
  pollMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<InstalledApp> {
  const info = await lookupApp(args.bundleId, args.fetchImpl ?? fetch);
  if (!info) throw new Error("We couldn't find that app on the US App Store.");
  if (info.price !== 0) {
    throw new Error(info.price == null
      ? "We couldn't confirm that app is free, and we only download free apps. Send a link to a free app or a web build instead."
      : "That app costs money on the App Store, and we only download free apps. Send a link to a free app or a web build instead.");
  }
  if (!info.developer) throw new Error("We couldn't confirm who makes that app, so we didn't download it.");
  const app = { name: info.name, developer: info.developer };
  args.onAppStorePhone?.(args.deviceId);
  const pollMs = args.pollMs ?? 5000;

  const task = await args.client.tasks.run({
    deviceId: args.deviceId,
    task: storeInstallTask(app),
    llmModel: args.model ?? "mobilerun/mobile-agent-fast",
    maxSteps: STORE_MAX_STEPS,
    executionTimeout: STORE_MAX_SECONDS,
    vision: true,
    outputSchema: z.toJSONSchema(StoreInstallResultSchema) as Record<string, unknown>,
    recordingEnabled: false,
  });
  const deadline = Date.now() + (STORE_MAX_SECONDS + 30) * 1000;
  let s = await args.client.tasks.getStatus(task.id);
  while (!TERMINAL.has(s.status) && Date.now() < deadline) {
    await sleep(pollMs);
    s = await args.client.tasks.getStatus(task.id);
  }
  if (!TERMINAL.has(s.status)) await args.client.tasks.stop(task.id).catch(() => undefined);
  const parsed = StoreInstallResultSchema.safeParse(s.output);
  const report = parsed.success ? parsed.data : null;

  // The phone's own app list is the proof, not the agent's word. A download can land a little after the agent reports.
  for (let i = 0; i < 6; i++) {
    const hit = (await listApps(args.client, args.deviceId).catch(() => [])).find((a) => a.packageName === info.bundleId);
    if (hit) return { ...hit, alreadyInstalled: false, deviceId: args.deviceId, via: "app_store" };
    if (!report?.installed) break;
    await sleep(pollMs);
  }
  const why = report?.blockedBy ?? (report?.installed ? "it said it finished, but the app isn't on the phone" : !TERMINAL.has(s.status) ? "it ran out of time" : "it didn't finish");
  throw new Error(`We couldn't download that app from the App Store on our test iPhone (${why.slice(0, 120)}).`);
}
