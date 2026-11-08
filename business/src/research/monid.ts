import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
export interface MonidRunner {
  run(args: { provider: string; endpoint: string; body?: unknown; query?: unknown; waitSeconds?: number }): Promise<unknown>;
}

export class MonidCli implements MonidRunner {
  constructor(private readonly bin = "monid") {}

  async run(args: { provider: string; endpoint: string; body?: unknown; query?: unknown; waitSeconds?: number }): Promise<unknown> {
    const dir = await mkdtemp(join(tmpdir(), "monid-"));
    const out = join(dir, "out.json");
    const argv = ["run", "-p", args.provider, "-e", args.endpoint, "-w", String(args.waitSeconds ?? 120), "-o", out, "-j"];
    if (args.body !== undefined) argv.push("-i", JSON.stringify(args.body));
    if (args.query !== undefined) argv.push("--query", JSON.stringify(args.query));
    try {
      await run(this.bin, argv, { env: { ...process.env, NO_COLOR: "1" }, maxBuffer: 32 * 1024 * 1024 });
      return JSON.parse(await readFile(out, "utf8"));
    } catch (err) {
      const stdout = (err as { stdout?: string }).stdout ?? "";
      throw new Error(`monid run ${args.provider}${args.endpoint} failed: ${stdout.slice(0, 500) || String(err)}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
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
export async function fetchTopPuzzleGames(monid: MonidRunner, chart = "topselling_free", category = "GAME_PUZZLE"): Promise<StoreGame[]> {
  const call = () => monid.run({
    provider: "litescrape",
    endpoint: "/google-play/games",
    query: { games_category: category, chart, gl: "us", hl: "en" },
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
export async function fetchRecentReviews(monid: MonidRunner, appId: string, depth = 150): Promise<RawReviewItem[]> {
  if (appId.startsWith("ios:")) {
    const raw = await monid.run({
      provider: "dataforseo",
      endpoint: "/app-store/app-reviews",
      body: { app_id: appId.slice(4), location_code: 2840, language_code: "en", depth: Math.min(depth, 100), sort_by: "most_recent" },
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
  });
  return parseReviews(raw);
}
