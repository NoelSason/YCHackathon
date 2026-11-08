import { randomBytes, timingSafeEqual } from "node:crypto";
import type Mobilerun from "@mobilerun/sdk";
import { captureScreen } from "../mobile/screen.js";
import type { ActivityEntry, Lead, WatchOrder, WatchState, WatchSummary } from "../types.js";
import type { Store } from "../store.js";
import * as E from "../email/html.js";

/**
 * "Watch your playtest live": a paid order's customer gets a link (`/watch?o=<token>`) when the
 * playtest starts, and the page shows the phone's screen about once a second, a status, and the
 * steps so far. Read-only by design: the browser only ever gets PNG screenshots and status JSON.
 * It never gets a device id, an API key, a stream token, or any way to touch the phone.
 *
 *   GET /watch-status?o=<token>   state, game, times, steps, and (when finished) the summary
 *   GET /watch-frame?o=<token>    the phone's screen as a PNG, only while this order is on the phone;
 *                                 afterwards its last frame, or 204. About 2 requests/s per token.
 * Both answer 404 for an unknown or malformed token.
 */

/** 32 random bytes as base64url: 43 characters. */
export function newWatchToken(): string {
  return randomBytes(32).toString("base64url");
}
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function watchUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/watch?o=${token}`;
}

/** A name for the game from its link: the App Store slug ("block-blast" → "Block Blast") or the host. */
export function gameNameFromUrl(appUrl: string): string {
  try {
    const u = new URL(appUrl);
    const slug = /\/app\/([^/]+)\/id\d+/.exec(u.pathname)?.[1];
    if (/(^|\.)apps\.apple\.com$/.test(u.hostname) && slug) {
      return decodeURIComponent(slug).split("-").filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ").slice(0, 80);
    }
    return u.hostname.replace(/^www\./, "").slice(0, 80);
  } catch {
    return "your app";
  }
}

// ---------------------------------------------------------------------------------------------
// The phone: which order is on it right now, and the last frame of each finished order.

interface Active { orderId: string; token: string; client: Mobilerun; deviceId: string }
let active: Active | null = null;
const finalFrames = new Map<string, Uint8Array>();
const MAX_FINAL_FRAMES = 30;
let shot: { png: Uint8Array; at: number; orderId: string } | null = null;
let inflight: Promise<Uint8Array | null> | null = null;
/** Viewers share one capture per this many ms, so several open tabs don't multiply phone calls. */
const SHARED_MS = 700;

/** Marks this order as the one on the phone. Frames are served for it until `phoneDone`. */
export function phoneStart(order: Pick<WatchOrder, "id" | "token">, client: Mobilerun, deviceId: string): void {
  active = { orderId: order.id, token: order.token, client, deviceId };
  shot = null;
}

/** Ends the live view for this order, keeping its last screen as the final frame. */
export async function phoneDone(orderId: string): Promise<void> {
  if (active?.orderId !== orderId) return;
  const a = active;
  const last = await captureScreen(a.client, a.deviceId).catch(() => null);
  const frame = last ?? (shot?.orderId === orderId ? shot.png : null);
  if (frame) {
    finalFrames.set(orderId, frame);
    while (finalFrames.size > MAX_FINAL_FRAMES) finalFrames.delete(finalFrames.keys().next().value!);
  }
  if (active?.orderId === orderId) active = null;
  shot = null;
}

async function liveFrame(a: Active): Promise<Uint8Array | null> {
  if (shot && shot.orderId === a.orderId && Date.now() - shot.at < SHARED_MS) return shot.png;
  inflight ??= captureScreen(a.client, a.deviceId).then((png) => {
    // Only keep it if the same order is still on the phone.
    if (png && active?.orderId === a.orderId) shot = { png, at: Date.now(), orderId: a.orderId };
    return png;
  }).finally(() => { inflight = null; });
  const png = await inflight;
  return active?.orderId === a.orderId ? png : null;
}

const sameToken = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Test helper. */
export function resetWatch(): void {
  active = null;
  shot = null;
  inflight = null;
  finalFrames.clear();
  hits.clear();
}

// ---------------------------------------------------------------------------------------------
// Steps: the order's own rows from the activity log, reworded for the customer. Rows that match
// no pattern are dropped, so no internal wording, ids, or vendor names reach the page.

export interface WatchStep { at: string; text: string; state: "done" | "active" | "failed" }

const STEP_PATTERNS: Array<{ re: RegExp; text: (e: ActivityEntry) => string; failed?: boolean; company: boolean }> = [
  { re: /^playtest ordered by /, text: () => "Order received", company: true },
  { re: /^playtest queued after payment: /, text: (e) => (/\(test mode\)/.test(e.result ?? "") ? "Test payment received. In line for the iPhone" : "Payment received. In line for the iPhone"), company: true },
  { re: /^emailed the live watch link to /, text: () => "Sent you this live view by email", company: true },
  { re: /^installing .+'s app from the App Store$/, text: () => "Installing your app from the App Store", company: true },
  { re: /^installed .+ on the iPhone$/, text: () => "Installed your app on the iPhone", company: false },
  { re: /^playtesting .+'s app on the iPhone$/, text: () => "Playing your app on a real iPhone", company: true },
  { re: /^playtested .+'s app$/, text: () => "Finished playing. Writing your report", company: true },
  { re: /^playtest skipped for /, text: () => "We couldn't play this link on our iPhone", failed: true, company: true },
  { re: /^playtest failed for /, text: () => "The phone couldn't finish this playtest", failed: true, company: true },
  { re: /^emailed the playtest report to /, text: () => "Report sent to your inbox", company: true },
  { re: /^emailed a playtest status update to /, text: () => "We emailed you an update", company: true },
  { re: /^couldn't email .+ about their playtest$/, text: () => "We couldn't email you yet", failed: true, company: true },
  { re: /^playtest order needs a person: /, text: () => "A person on our team will follow up", failed: true, company: true },
];

export function stepsFor(entries: ActivityEntry[], company: string, state: WatchState): WatchStep[] {
  const steps: WatchStep[] = [];
  for (const e of entries) {
    const p = STEP_PATTERNS.find((x) => x.re.test(e.action));
    if (!p) continue;
    if (p.company && !e.action.includes(company)) continue;
    if (!p.company && e.agent !== "playtest-lead") continue;
    const text = p.text(e);
    if (steps.at(-1)?.text === text) continue;
    steps.push({ at: e.at, text, state: p.failed ? "failed" : "done" });
  }
  // While the order is still going, its newest step is the one in progress.
  const last = steps.at(-1);
  if ((state === "queued" || state === "testing") && last && last.state === "done") last.state = "active";
  return steps;
}

export interface WatchStatus {
  state: WatchState;
  game: string;
  test: boolean;
  orderedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** True while this order's screen is live on the phone. */
  live: boolean;
  steps: WatchStep[];
  summary: WatchSummary | null;
}

export async function watchStatus(store: Store, order: WatchOrder, lead: Lead | null): Promise<WatchStatus> {
  // From a little before the order to a few minutes after it ended (the report email comes last).
  const from = new Date(Date.parse(order.createdAt) - 10_000).toISOString();
  const to = order.finishedAt ? new Date(Date.parse(order.finishedAt) + 5 * 60_000).toISOString() : null;
  const entries = lead ? await store.listActivityBetween(from, to, 300) : [];
  return {
    state: order.state,
    game: order.gameName,
    test: order.test,
    orderedAt: order.createdAt,
    startedAt: order.startedAt,
    finishedAt: order.finishedAt,
    live: active?.orderId === order.id,
    steps: lead ? stepsFor(entries, lead.company, order.state) : [],
    summary: order.state === "finished" ? order.summary : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Routes.

const hits = new Map<string, number[]>();
/** About 2 frames a second per token. */
const FRAME_LIMIT = 2;
function overLimit(token: string): boolean {
  const t = Date.now();
  const recent = (hits.get(token) ?? []).filter((x) => t - x < 1000);
  if (recent.length >= FRAME_LIMIT) {
    hits.set(token, recent);
    return true;
  }
  recent.push(t);
  hits.set(token, recent);
  if (hits.size > 2000) for (const [k, v] of hits) if (!v.some((x) => t - x < 1000)) hits.delete(k);
  return false;
}

const noStore = { "cache-control": "no-store", "x-robots-tag": "noindex" };
const jsonRes = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...noStore } });
const notFound = (): Response => jsonRes(404, { error: "not found" });
const png = (bytes: Uint8Array, kind: "live" | "final"): Response =>
  new Response(Buffer.from(bytes), { status: 200, headers: { "content-type": "image/png", "x-frame-kind": kind, ...noStore } });

export function watchRoutes(store: Store): (request: Request, url: URL) => Promise<Response | null> {
  async function lookup(token: string): Promise<WatchStatus | null> {
    const order = await store.getWatchOrderByToken(token);
    return order ? watchStatus(store, order, await store.getLead(order.leadId)) : null;
  }

  return async (request, url) => {
    if (url.pathname !== "/watch-status" && url.pathname !== "/watch-frame") return null;
    if (request.method !== "GET") return jsonRes(405, { error: "method not allowed" });
    const token = url.searchParams.get("o") ?? "";
    if (!TOKEN_RE.test(token)) return notFound();

    if (url.pathname === "/watch-status") {
      const body = await lookup(token);
      return body ? jsonRes(200, body) : notFound();
    }

    // /watch-frame
    if (overLimit(token)) return new Response(null, { status: 429, headers: { "retry-after": "1", ...noStore } });
    const a = active;
    if (a && sameToken(a.token, token)) {
      const frame = await liveFrame(a);
      if (frame) return png(frame, "live");
      const fallback = finalFrames.get(a.orderId);
      return fallback ? png(fallback, "final") : new Response(null, { status: 204, headers: noStore });
    }
    const order = await store.getWatchOrderByToken(token);
    if (!order) return notFound();
    const last = finalFrames.get(order.id);
    return last && (order.state === "finished" || order.state === "failed")
      ? png(last, "final")
      : new Response(null, { status: 204, headers: noStore });
  };
}

// ---------------------------------------------------------------------------------------------
// The "starting now" email.

export function composeWatchEmail(args: {
  name: string | null;
  team: string;
  gameName: string;
  watchUrl: string;
  test: boolean;
  companyName: string;
  postalAddress: string;
}): { subject: string; body: string; html: string } {
  const first = args.name ? args.name.split(" ")[0]! : args.team;
  const testNote = args.test ? "This is a test order, so no money was charged." : null;
  const intro = `Your playtest of ${args.gameName} is starting now on a real iPhone in the cloud. You can watch the phone's screen live while it plays:`;
  const readOnly = "The page only shows the screen, so nothing you do there touches the phone. A playtest usually takes a few minutes, and the report comes to this inbox when it's done.";
  const keep = "Anyone with this link can watch, so keep it to yourself.";
  const footerReason = "You're getting it because you ordered a playtest.";
  const body = [
    `Hi ${first},`,
    "",
    intro,
    "",
    args.watchUrl,
    "",
    readOnly,
    keep,
    "",
    ...(testNote ? [testNote, ""] : []),
    args.companyName,
    "",
    "—",
    `${args.companyName} is a small studio where AI agents play, design, and test games, and this email was written by one of them. ${footerReason}`,
    args.postalAddress,
    `Reply "stop" and we won't email you again.`,
  ].join("\n");
  const html = E.layout({
    preheader: `Your playtest of ${args.gameName} is starting. Watch the iPhone's screen live.`,
    companyName: args.companyName,
    postalAddress: args.postalAddress,
    footerReason,
    body: [
      E.eyebrow(args.test ? "Live now · test order" : "Live now", E.C.green),
      E.heading(`Your playtest is starting, ${first}`),
      E.text(intro, { color: E.C.muted }),
      E.button("Watch it live", args.watchUrl),
      E.text(readOnly),
      E.text(keep, { color: E.C.muted, size: 14 }),
      ...(testNote ? [E.text(testNote, { color: E.C.muted })] : []),
    ].join(""),
  });
  const subject = "Your playtest is starting: watch it live";
  return { subject: args.test ? `[Test order] ${subject}` : subject, body, html };
}
