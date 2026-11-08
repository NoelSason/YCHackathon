import type { SignalKind, Target } from "../types.js";
import { countSignals, extractSignals, signalPhrase, type RawReview } from "./signals.js";
import { fetchRecentReviews, fetchTopPuzzleGames, storeName, storeUrl, type MonidRunner, type StoreGame } from "./monid.js";

/** Studios that are almost certainly too big to buy a level pilot from us this weekend. */
const BIG_STUDIOS = [/\bking\b/i, /\bdream games\b/i, /\bplayrix\b/i, /^peak$/i, /\bmoon active\b/i, /\bzynga\b/i, /\bsupercell\b/i, /\brovio\b/i];

/** "100,000,000+" → 100000000. Unknown → null. */
export function parseDownloads(downloads: string | null): number | null {
  if (!downloads) return null;
  const n = Number(downloads.replace(/[^0-9]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Builds one target from a game and its reviews. The score favors games with many level-design
 * complaints relative to the number of reviews read, and mid-size studios that might say yes.
 */
export function buildTarget(game: StoreGame, reviews: RawReview[]): Target {
  const signals = extractSignals(reviews);
  const counts = countSignals(signals);
  const analyzed = reviews.filter((r) => r.review_text?.trim()).length;
  const ordered = (Object.entries(counts) as Array<[SignalKind, number]>).sort((a, b) => b[1] - a[1]);
  const top = ordered[0];
  const primary = top && top[1] > 0 ? top[0] : null;
  const total = signals.length;

  const downloads = parseDownloads(game.downloads);
  const sizeFactor = downloads === null ? 1 : downloads >= 100_000_000 ? 0.6 : downloads >= 1_000_000 ? 1 : 0.8;
  const bigStudio = BIG_STUDIOS.some((re) => re.test(game.developer));
  const density = analyzed > 0 ? total / analyzed : 0;
  const score = Number((density * 100 * sizeFactor * (bigStudio ? 0.3 : 1)).toFixed(2));

  const reason =
    primary && top
      ? `${top[1]} of the ${analyzed} newest ${storeName(game.appId)} reviews of ${game.title} ${signalPhrase(primary, top[1])}.`
      : `No level-design complaints in the ${analyzed} newest ${storeName(game.appId)} reviews of ${game.title}.`;

  return {
    appId: game.appId,
    appTitle: game.title,
    developer: game.developer,
    storeUrl: storeUrl(game.appId),
    downloads: game.downloads,
    reviewsAnalyzed: analyzed,
    signalCounts: counts,
    primarySignal: primary,
    examples: signals.filter((s) => s.kind === primary).slice(0, 3),
    reason,
    score,
  };
}

export interface FindTargetsOptions {
  /** How many chart games to read reviews for. Each costs about $0.0015 in Monid credit. */
  maxGames?: number;
  minSignals?: number;
  chart?: string;
}

export async function findTargets(monid: MonidRunner, opts: FindTargetsOptions = {}): Promise<Target[]> {
  const maxGames = opts.maxGames ?? 10;
  const minSignals = opts.minSignals ?? 2;
  const games = (await fetchTopPuzzleGames(monid, opts.chart)).filter(
    (g) => !BIG_STUDIOS.some((re) => re.test(g.developer)),
  );
  const targets: Target[] = [];
  for (const game of games.slice(0, maxGames)) {
    const reviews = await fetchRecentReviews(monid, game.appId);
    const target = buildTarget(game, reviews);
    const total = Object.values(target.signalCounts).reduce((a, b) => a + b, 0);
    if (total >= minSignals) targets.push(target);
  }
  return targets.sort((a, b) => b.score - a.score);
}
