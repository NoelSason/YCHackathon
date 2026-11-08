import type Mobilerun from "@mobilerun/sdk";

/**
 * Installs a free App Store app on the cloud iPhone, so a playtest can play a studio's real app.
 * Mobilerun installs from the App Store itself (no Apple Account sign-in on the phone). Checked
 * Nov 7, 5:30 PM: POST /devices/{id}/apps with a bundle id string ("com.duolingo.DuolingoMobile")
 * installed in 19 s, but numeric App Store ids returned 404 APP_NOT_FOUND, even though the docs say
 * both work. So we resolve the numeric id to its bundle id with Apple's public lookup first, and
 * install inline (background: false) so a failure comes back with its reason. Never uninstalls.
 */
export interface InstalledApp { packageName: string; label: string; alreadyInstalled: boolean }

async function listApps(client: Mobilerun, deviceId: string): Promise<Array<{ packageName: string; label: string }>> {
  const r = await client.devices.apps.list(deviceId);
  return (r ?? []).map((a) => ({ packageName: a.packageName, label: a.label }));
}

/** Numeric App Store id → bundle id and name, via Apple's public lookup. Null if not found. */
export async function lookupBundleId(appStoreId: string, fetchImpl: typeof fetch = fetch): Promise<{ bundleId: string; name: string } | null> {
  if (!/^\d+$/.test(appStoreId)) return { bundleId: appStoreId, name: appStoreId };
  const r = await fetchImpl(`https://itunes.apple.com/lookup?id=${appStoreId}&country=us`, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) return null;
  const j = (await r.json()) as { results?: Array<{ bundleId?: string; trackName?: string }> };
  const hit = j.results?.find((x) => x.bundleId);
  return hit?.bundleId ? { bundleId: hit.bundleId, name: hit.trackName ?? hit.bundleId } : null;
}

export async function installFromAppStore(args: {
  client: Mobilerun;
  deviceId: string;
  appStoreId: string;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<InstalledApp> {
  const app = await lookupBundleId(args.appStoreId);
  if (!app) throw new Error("We couldn't find that app on the US App Store.");
  const before = await listApps(args.client, args.deviceId);
  const already = before.find((a) => a.packageName === app.bundleId);
  if (already) return { ...already, alreadyInstalled: true };
  const known = new Set(before.map((a) => a.packageName));
  try {
    await args.client.devices.apps.install(args.deviceId, { bundleId: app.bundleId, background: false }, { timeout: args.timeoutMs ?? 5 * 60_000 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`The App Store install failed on our test iPhone (${/APP_NOT_FOUND|404/.test(msg) ? "not available to install" : /TIMEOUT|504/.test(msg) ? "timed out" : "download failed"}).`);
  }
  const installed = (await listApps(args.client, args.deviceId)).find((a) => a.packageName === app.bundleId);
  if (installed) return { ...installed, alreadyInstalled: false };
  const deadline = Date.now() + (args.timeoutMs ?? 5 * 60_000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, args.pollMs ?? 5000));
    const now = await listApps(args.client, args.deviceId);
    const added = now.find((a) => !known.has(a.packageName));
    if (added) return { ...added, alreadyInstalled: false };
    // Fail fast when the device reports the install failed (seen Nov 7: status "failed" right away).
    const log = (await (args.client.devices.apps as unknown as { listInstalls(id: string): Promise<{ installs?: Array<{ appId: string; status: string; errorClass?: string }> }> })
      .listInstalls(args.deviceId).catch(() => ({ installs: [] })));
    const mine = (log.installs ?? []).filter((i) => i.appId === app.bundleId || i.appId === args.appStoreId).pop();
    if (mine?.status === "failed") throw new Error(`The App Store install failed on our test iPhone (${mine.errorClass ?? "no reason given"}).`);
  }
  // Nothing new appeared: it may already have been installed. Ask the install log as a last check.
  throw new Error("The app didn't finish installing in time (it may be paid, region-locked, or large).");
}
