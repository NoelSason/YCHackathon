import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);

/**
 * Thin wrapper over the Monid CLI (`monid run ... -w -o file -j`). The CLI holds the API key
 * itself (`monid keys add`), so this never touches it. Endpoints were checked with
 * `monid inspect` on Nov 7, 2026:
 *   - litescrape /google-play/games       query: games_category, chart, gl, hl     $0.00015/call
 *   - dataforseo /google-play/app-reviews body: app_id, location_code, language_code, depth, sort_by
 *                                         $0.0015 per page of 150 reviews
 */
export interface MonidRunArgs {
  provider: string;
  endpoint: string;
  body?: unknown;
  query?: unknown;
  waitSeconds?: number;
  /** Hard limit for the whole call. The CLI process is killed when it passes. */
  timeoutMs?: number;
}

export interface MonidRunner {
  run(args: MonidRunArgs): Promise<unknown>;
}

/** Total Monid spend this process has made, in micro-dollars, from each run's reported cost. */
let spentMicro = 0;
export const monidSpentUsd = (): number => spentMicro / 1e6;

/**
 * Each run's cost. The CLI reports it as top-level `cost: { value, currency: "USD" }` (checked Nov 7,
 * 10:46 PM on app-reviews and games runs); `billing.reportedCost` is an older shape kept as a fallback.
 */
export function reportedCostMicro(stdout: string): number {
  try {
    const parsed = JSON.parse(stdout) as {
      cost?: { value?: number; currency?: string };
      billing?: { reportedCost?: { value?: number; unit?: string } };
    };
    if (typeof parsed.cost?.value === "number" && (parsed.cost.currency ?? "USD") === "USD") return Math.round(parsed.cost.value * 1e6);
    const cost = parsed.billing?.reportedCost;
    if (!cost || typeof cost.value !== "number") return 0;
    return cost.unit === "MICRO_DOLLAR" ? cost.value : cost.value * 1e6;
  } catch {
    return 0;
  }
}

/** Today's Monid spend (Pacific day), kept in a temp file so a restart doesn't reset the daily cap. */
const SPEND_FILE = join(tmpdir(), "levelai-monid-spend.json");
export const pacificDay = (d = new Date()): string => d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
let daily: { day: string; micro: number } = (() => {
  try {
    const v = JSON.parse(readFileSync(SPEND_FILE, "utf8")) as { day?: unknown; micro?: unknown };
    return typeof v.day === "string" && typeof v.micro === "number" ? { day: v.day, micro: v.micro } : { day: pacificDay(), micro: 0 };
  } catch {
    return { day: pacificDay(), micro: 0 };
  }
})();
/** Adds a run's cost to the day's total, starting over on a new Pacific day. Pure, for tests. */
export function addDaily(state: { day: string; micro: number }, micro: number, day: string): { day: string; micro: number } {
  return state.day === day ? { day, micro: state.micro + micro } : { day, micro };
}
function recordSpend(micro: number) {
  spentMicro += micro;
  daily = addDaily(daily, micro, pacificDay());
  try {
    writeFileSync(SPEND_FILE, JSON.stringify(daily));
  } catch {
    // Best effort; worst case a restart under-counts today's spend.
  }
}
export function monidSpentTodayUsd(): number {
  return daily.day === pacificDay() ? daily.micro / 1e6 : 0;
}

export class MonidCli implements MonidRunner {
  constructor(private readonly bin = "monid") {}

  async run(args: MonidRunArgs): Promise<unknown> {
    const dir = await mkdtemp(join(tmpdir(), "monid-"));
    const out = join(dir, "out.json");
    const wait = args.timeoutMs ? Math.max(1, Math.ceil(args.timeoutMs / 1000)) : (args.waitSeconds ?? 120);
    const argv = ["run", "-p", args.provider, "-e", args.endpoint, "-w", String(wait), "-o", out, "-j"];
    if (args.body !== undefined) argv.push("-i", JSON.stringify(args.body));
    if (args.query !== undefined) argv.push("--query", JSON.stringify(args.query));
    try {
      const { stdout } = await run(this.bin, argv, {
        env: { ...process.env, NO_COLOR: "1" }, maxBuffer: 32 * 1024 * 1024,
        ...(args.timeoutMs ? { timeout: args.timeoutMs, killSignal: "SIGKILL" as const } : {}),
      });
      recordSpend(reportedCostMicro(stdout));
      return await resolveDownload(JSON.parse(await readFile(out, "utf8")));
    } catch (err) {
      const stdout = (err as { stdout?: string }).stdout ?? "";
      throw new Error(`monid run ${args.provider}${args.endpoint} failed: ${stdout.slice(0, 500) || String(err)}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

/**
 * Large results come back as `{ data: { download_link, content_type } }` instead of inline (seen
 * Nov 7 on the GAME_BOARD chart), so fetch the file. The link is signed, so it's never logged.
 */
export async function resolveDownload(raw: unknown, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const link = (raw as { data?: { download_link?: unknown } })?.data?.download_link;
  if (typeof link !== "string" || !link.startsWith("https://")) return raw;
  const r = await fetchImpl(link, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`couldn't download the large result (HTTP ${r.status})`);
  return r.json();
}

export interface StoreGame {
  appId: string;
  title: string;
  developer: string;
  rating: number | null;
  downloads: string | null;
}

export function parseGames(raw: unknown): StoreGame[] {
  const results = (raw as { organic_results?: Array<{ items?: unknown[] }> })?.organic_results ?? [];
  const items = results.flatMap((r) => r.items ?? []) as Array<Record<string, unknown>>;
  return items
    .filter((it) => typeof it.product_id === "string")
    .map((it) => ({
      appId: String(it.product_id),
      title: String(it.title ?? it.product_id),
      developer: String(it.author ?? "Unknown developer"),
      rating: typeof it.rating === "number" ? it.rating : null,
      downloads: typeof it.downloads === "string" ? it.downloads : null,
    }));
}

/**
 * One Google Play chart. Seen Nov 7, 4:54 PM: litescrape sometimes completes with `output: null`,
 * which the CLI reports as a failure, so one retry after a short pause.
 */
export async function fetchTopPuzzleGames(monid: MonidRunner, chart = "topselling_free", category = "GAME_PUZZLE", country = "us"): Promise<StoreGame[]> {
  const call = () => monid.run({
    provider: "litescrape",
    endpoint: "/google-play/games",
    query: { games_category: category, chart, gl: country, hl: "en" },
  });
  const raw = await call().catch(async () => {
    await new Promise((r) => setTimeout(r, 5000));
    return call();
  });
  return parseGames(raw);
}

export interface RawReviewItem {
  review_text?: string | null;
  rating?: { value?: number | null } | null;
  timestamp?: string | null;
}

export function parseReviews(raw: unknown): RawReviewItem[] {
  const first = Array.isArray(raw) ? raw[0] : raw;
  return ((first as { items?: RawReviewItem[] })?.items ?? []).filter(Boolean);
}

/** "Google Play" or "App Store", from our app id format ("ios:<id>" is the App Store). */
export function storeName(appId: string): "Google Play" | "App Store" {
  return appId.startsWith("ios:") ? "App Store" : "Google Play";
}

export function storeUrl(appId: string): string {
  return appId.startsWith("ios:")
    ? `https://apps.apple.com/app/id${appId.slice(4)}`
    : `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}`;
}

/**
 * Newest reviews from either store. App Store (dataforseo /app-store/app-reviews, 25 per page,
 * checked Nov 7): the review's title is folded into its text, since iOS reviews often put the point
 * in the title.
 */
export async function fetchRecentReviews(monid: MonidRunner, appId: string, depth = 150, timeoutMs?: number): Promise<RawReviewItem[]> {
  // The same game's newest reviews, read in the last few hours, are reused instead of paid for again
  // (an audit and the outreach loop often read the same chart game).
  const cache = reviewCache(monid);
  const key = `${appId}|${depth}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < REVIEW_CACHE_MS) return hit.items;
  const items = await fetchReviewsUncached(monid, appId, depth, timeoutMs);
  if (items.length) cache.set(key, { at: Date.now(), items });
  return items;
}

/** How long a game's fetched reviews are reused. Matches the outreach loop's six-hour skip window. */
export const REVIEW_CACHE_MS = 6 * 3600_000;
const reviewCaches = new WeakMap<MonidRunner, Map<string, { at: number; items: RawReviewItem[] }>>();
function reviewCache(monid: MonidRunner) {
  let c = reviewCaches.get(monid);
  if (!c) reviewCaches.set(monid, (c = new Map()));
  return c;
}
/** App ids whose reviews this runner fetched within the cache window. */
export function recentlyFetchedAppIds(monid: MonidRunner, now = Date.now()): Set<string> {
  const ids = new Set<string>();
  for (const [key, v] of reviewCache(monid)) if (now - v.at < REVIEW_CACHE_MS) ids.add(key.slice(0, key.lastIndexOf("|")));
  return ids;
}

async function fetchReviewsUncached(monid: MonidRunner, appId: string, depth: number, timeoutMs?: number): Promise<RawReviewItem[]> {
  const limit = timeoutMs ? { timeoutMs } : {};
  if (appId.startsWith("ios:")) {
    const raw = await monid.run({
      provider: "dataforseo",
      endpoint: "/app-store/app-reviews",
      body: { app_id: appId.slice(4), location_code: 2840, language_code: "en", depth: Math.min(depth, 100), sort_by: "most_recent" },
      ...limit,
    });
    return parseReviews(raw).map((r) => {
      const title = (r as { title?: string | null }).title?.trim();
      const text = r.review_text?.trim() ?? "";
      return { ...r, review_text: title && !text.toLowerCase().startsWith(title.toLowerCase()) ? `${title}. ${text}` : text };
    });
  }
  const raw = await monid.run({
    provider: "dataforseo",
    endpoint: "/google-play/app-reviews",
    body: { app_id: appId, location_code: 2840, language_code: "en", depth, sort_by: "newest" },
    ...limit,
  });
  return parseReviews(raw);
}

/** Lowercase words, with punctuation and accents dropped: "Block Blast!" → ["block", "blast"]. */
function words(s: string): string[] {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

const FILLER = new Set(["the", "a", "an", "game", "games", "app", "my", "our", "android", "ios", "iphone"]);

/**
 * Whether a store title is the game someone typed. Every word they typed (minus filler like "game")
 * must be in the title, or the title must contain what they typed with the spaces removed
 * ("candycrush" → "Candy Crush Saga"). Deliberately strict: quoting another game's players as theirs
 * would be worse than quoting none.
 */
export function titleMatches(query: string, title: string): boolean {
  const q = words(query).filter((w) => !FILLER.has(w));
  const t = words(title);
  if (!q.length || !t.length) return false;
  if (q.every((w) => t.includes(w))) return true;
  const joined = q.join("");
  return joined.length >= 4 && t.join("").includes(joined);
}

/**
 * The store's top result for a typed game name, when its title matches (`titleMatches`). Reads the
 * highlighted app first (Google shows one for a clear name), then the listed results in order.
 */
export function parseAppSearch(raw: unknown, query: string): StoreGame | null {
  const r = raw as { app_highlight?: Record<string, unknown>; organic_results?: Array<{ items?: unknown[] }> } | null;
  const candidates = [r?.app_highlight, ...(r?.organic_results ?? []).flatMap((x) => x.items ?? [])] as Array<Record<string, unknown> | undefined>;
  for (const it of candidates) {
    if (!it || typeof it.product_id !== "string" || typeof it.title !== "string") continue;
    if (!titleMatches(query, it.title)) continue;
    return {
      appId: it.product_id,
      title: it.title,
      developer: String(it.author ?? "Unknown developer"),
      rating: typeof it.rating === "number" ? it.rating : null,
      downloads: typeof it.downloads === "string" ? it.downloads : null,
    };
  }
  return null;
}

/** Finds a game on Google Play by the name someone typed (litescrape /google-play/apps, $0.00015 a call, about 5 s). */
export async function searchGooglePlay(monid: MonidRunner, query: string, timeoutMs?: number): Promise<StoreGame | null> {
  const raw = await monid.run({
    provider: "litescrape",
    endpoint: "/google-play/apps",
    query: { q: query.slice(0, 200), gl: "us", hl: "en" },
    ...(timeoutMs ? { timeoutMs } : {}),
  });
  return parseAppSearch(raw, query);
}
