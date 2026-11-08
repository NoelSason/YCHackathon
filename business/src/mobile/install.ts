import type Mobilerun from "@mobilerun/sdk";

/**
 * Installs a free App Store app on the cloud iPhone by its numeric App Store id, so a playtest can
 * play a studio's real app (Mobilerun: POST /devices/{id}/apps with bundleId = bundle id or numeric
 * App Store id; checked Nov 7). Returns the installed app's package name and label, found by
 * comparing the app list before and after. Never uninstalls anything.
 */
export interface InstalledApp { packageName: string; label: string; alreadyInstalled: boolean }

async function listApps(client: Mobilerun, deviceId: string): Promise<Array<{ packageName: string; label: string }>> {
  const r = await client.devices.apps.list(deviceId);
  return (r ?? []).map((a) => ({ packageName: a.packageName, label: a.label }));
}

export async function installFromAppStore(args: {
  client: Mobilerun;
  deviceId: string;
  appStoreId: string;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<InstalledApp> {
  const before = await listApps(args.client, args.deviceId);
  const known = new Set(before.map((a) => a.packageName));
  await args.client.devices.apps.install(args.deviceId, { bundleId: args.appStoreId, background: true });
  const deadline = Date.now() + (args.timeoutMs ?? 5 * 60_000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, args.pollMs ?? 5000));
    const now = await listApps(args.client, args.deviceId);
    const added = now.find((a) => !known.has(a.packageName));
    if (added) return { ...added, alreadyInstalled: false };
    // Fail fast when the device reports the install failed (seen Nov 7: status "failed" right away).
    const log = (await (args.client.devices.apps as unknown as { listInstalls(id: string): Promise<{ installs?: Array<{ appId: string; status: string; errorClass?: string }> }> })
      .listInstalls(args.deviceId).catch(() => ({ installs: [] })));
    const mine = (log.installs ?? []).filter((i) => i.appId === args.appStoreId).pop();
    if (mine?.status === "failed") throw new Error(`The App Store install failed on our test iPhone (${mine.errorClass ?? "no reason given"}).`);
  }
  // Nothing new appeared: it may already have been installed. Ask the install log as a last check.
  throw new Error("The app didn't finish installing in time (it may be paid, region-locked, or large).");
}
