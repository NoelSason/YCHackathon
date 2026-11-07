import type { ReviewSignal, SignalKind } from "../types.js";

/**
 * Finds reviews that show a level-design problem we can fix. Patterns come from real Google Play
 * puzzle-game reviews (see test/fixtures/reviews-sample.json). Ads and pricing complaints are
 * common but aren't our problem to solve, so they're ignored.
 *
 * Deterministic on purpose: every count in an outreach email must be reproducible.
 */
const PATTERNS: Record<SignalKind, RegExp[]> = {
  too_easy: [
    /\b(way |far |too |so )?too easy\b/,
    /\bimpossible to fail\b/,
    /\b(can'?t|cannot|couldn'?t|not possible to|don'?t think it'?s possible to) (ever )?fail\b/,
    /\bno (real )?challenge\b/,
    /\btakes? (too|so|way too) long (for the levels )?to (get|become|be|actually prove)\b/,
    /\b(first|early) (few )?(\d+|dozen|levels?).{0,40}(easy|boring|half asleep|impossible to fail)\b/,
    /\bstupid easy\b/,
  ],
  too_hard: [
    /\b(way |far |so )?too hard\b/,
    /\bimpossible (level|to (beat|pass|win|complete))\b/,
    /\bstuck on (level )?\d+/,
    /\b(level|lvl) \d+.{0,40}(impossible|too hard|can'?t (beat|pass))\b/,
    /\bdifficulty spike\b/,
    /\b(pay|buy|spend).{0,30}to (win|pass|beat|continue)\b/,
  ],
  wants_more_levels: [
    /\b(need|want|wish|add|give us|please|more) (more |new )+levels?\b/,
    /\bmore levels\b/,
    /\b(ran|run|running) out of levels\b/,
    /\b(finished|completed|beat) (all|every) (the )?levels\b/,
    /\bwaiting for (new|more) levels\b/,
  ],
  repetitive: [
    /\b(repetitive|repetitious)\b/,
    /\b(every|all the) levels? (is|are|feel|feels|look|looks) the same\b/,
    /\bsame (level|levels|thing) over and over\b/,
  ],
};

const SIGNAL_ORDER: SignalKind[] = ["too_easy", "too_hard", "wants_more_levels", "repetitive"];

export interface RawReview {
  review_text?: string | null;
  rating?: number | { value?: number | null } | null;
  timestamp?: string | null;
}

function ratingOf(r: RawReview): number | null {
  if (typeof r.rating === "number") return r.rating;
  if (r.rating && typeof r.rating === "object" && typeof r.rating.value === "number") return r.rating.value;
  return null;
}

/** Trims a review to at most `max` characters for quoting, cutting at a word boundary. */
export function excerpt(text: string, max = 140): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).trimEnd()}…`;
}

/** Praise like "not too hard" or "not too easy either" isn't a complaint, so it's removed first. */
const NEGATED = [
  /\b(not|isn'?t|wasn'?t|never|neither) (too|that|so|very|overly|super) (easy|hard|difficult)\b/g,
  /\bnor too (easy|hard|difficult)\b/g,
  /\b(easy|hard) but not too (easy|hard)\b/g,
];

export function classifyReview(text: string): SignalKind[] {
  let t = text.toLowerCase();
  for (const re of NEGATED) t = t.replace(re, " ");
  return SIGNAL_ORDER.filter((kind) => PATTERNS[kind].some((re) => re.test(t)));
}

export function extractSignals(reviews: RawReview[]): ReviewSignal[] {
  const signals: ReviewSignal[] = [];
  for (const r of reviews) {
    const text = r.review_text?.trim();
    if (!text) continue;
    for (const kind of classifyReview(text)) {
      signals.push({ kind, quote: excerpt(text), rating: ratingOf(r), timestamp: r.timestamp ?? null });
    }
  }
  return signals;
}

export function countSignals(signals: ReviewSignal[]): Record<SignalKind, number> {
  const counts: Record<SignalKind, number> = { too_easy: 0, too_hard: 0, wants_more_levels: 0, repetitive: 0 };
  for (const s of signals) counts[s.kind] += 1;
  return counts;
}

/** "7 of the 86 reviews say …" / "1 of the 86 reviews says …". */
export function signalPhrase(kind: SignalKind, count: number): string {
  const one = count === 1;
  switch (kind) {
    case "too_easy":
      return `${one ? "says" : "say"} the levels are too easy or take too long to get challenging`;
    case "too_hard":
      return `${one ? "says" : "say"} a level is too hard or impossible`;
    case "wants_more_levels":
      return `${one ? "asks" : "ask"} for more levels`;
    case "repetitive":
      return `${one ? "says" : "say"} the levels feel repetitive`;
  }
}
