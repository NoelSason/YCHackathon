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
    /\b(way |far |too |so )?too easy\b(?! to (lose|fail|die))/,
    /\bimpossible to fail\b/,
    /\b(can'?t|cannot|couldn'?t|not possible to|don'?t think it'?s possible to) (ever )?fail\b/,
    /\bno (real )?challenge\b/,
    /\btakes? (too|so|way too) long (for the levels )?to (get|become|be|actually prove) (hard|harder|challenging|difficult|interesting|a challenge)\b/,
    /\b(first|early) (few )?(\d+|dozen|levels?).{0,40}(easy|boring|half asleep|impossible to fail)\b/,
    /\bstupid easy\b/,
  ],
  too_hard: [
    /\b(way |far |so )?too hard\b/,
    /\btoo easy to (lose|fail|die)\b/,
    /\bimpossible (level|to (beat|pass|win|complete))\b/,
    /\b(level|lvl) \d+ (is|was) (literally |actually |quite literally |physically )*impossible\b/,
    /\b(level|lvl) \d+.{0,40}(impossible|too hard)\b/,
    /\bdifficulty spike\b/,
    /\bimpossible (to beat |to pass )?without (paying|power[- ]?ups?|boosters?|spending)\b/,
    /\b(have to|need to|must|forced to|make you) (pay|buy|spend).{0,30}to (win|pass|beat) (the |a |this )?level\b/,
  ],
  wants_more_levels: [
    /\b(need|want|wish (there were|for)|add|give us|please add) (more |new )+levels?\b/,
    /\bmore levels,? please\b/,
    /\b(ran|run|running) out of levels\b/,
    /\b(finished|completed|beat) (all|every) (the )?levels\b/,
    /\bwaiting for (new|more) levels\b/,
  ],
  repetitive: [
    /\b(levels?|puzzles?|gameplay) (are|is|get|gets|feel|feels|become|becomes) (so |very |too |really )?(repetitive|repetitious)\b/,
    /\b(repetitive|repetitious) (levels?|puzzles?|gameplay)\b/,
    /\b(every|all the) levels? (is|are|feel|feels|look|looks) the same\b/,
    /\bsame (level|levels) over and over\b/,
  ],
};

/** Praise or negation ("not too hard", "aren't too hard", "not impossible") isn't a complaint. */
const NEGATED = [
  /\b(not|isn'?t|aren'?t|wasn'?t|weren'?t|neither|is not|are not) (being )?(too |that |so |overly )?(easy|hard|difficult),? (or|nor) (too |that |so |overly )?(easy|hard|difficult)\b/g,
  /\b(not|isn'?t|aren'?t|wasn'?t|weren'?t|never|neither|is not|are not) (being )?(too|that|so|very|overly|super|really) (easy|hard|difficult)\b/g,
  /\b(not|isn'?t|aren'?t|wasn'?t|never) (being )?impossible\b/g,
  /\bnor too (easy|hard|difficult)\b/g,
  /\b(easy|hard) but not too (easy|hard)\b/g,
];

/** Weaker "I'm stuck" signals. These count only when the review doesn't blame ads, crashes, or the screen. */
const STUCK = [/\bstuck on (level |lvl )?\d+/, /\b(level|lvl) ?\d+.{0,40}can'?t (beat|pass)\b/];

/** Sentences about other games ("some games are way too easy") don't describe this game. */
const OTHER_GAMES = /\b(other|some|most|many|these|those|similar) games\b/;
/** Ads, crashes, and connection trouble can block a level, but that's not level design. */
const TECHNICAL = /\b(ads?|adds|ad not ready|resolution|crash(es|ing)?|glitch(es|y)?|bugs?|freez(e|es|ing)|won'?t load|internet|offline|connection|lag(gy)?)\b/;

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

/** Each signal found in a review, with the sentence that shows it (so quotes are never out of context). */
export function classifyWithEvidence(text: string): Map<SignalKind, string> {
  const found = new Map<SignalKind, string>();
  const reviewIsTechnical = TECHNICAL.test(text.toLowerCase());
  for (const original of text.split(/(?<=[.!?\n])\s+/)) {
    const raw = original.toLowerCase();
    if (OTHER_GAMES.test(raw)) continue;
    let t = raw;
    for (const re of NEGATED) t = t.replace(re, " ");
    const technical = TECHNICAL.test(t);
    for (const kind of SIGNAL_ORDER) {
      // A level that's "impossible" because an ad won't load is a technical problem, not difficulty.
      if (technical && (kind === "too_hard" || kind === "repetitive")) continue;
      if (!found.has(kind) && PATTERNS[kind].some((re) => re.test(t))) found.set(kind, original.trim());
    }
    if (!found.has("too_hard") && !technical && !reviewIsTechnical && STUCK.some((re) => re.test(t))) found.set("too_hard", original.trim());
  }
  return found;
}

export function classifyReview(text: string): SignalKind[] {
  const found = classifyWithEvidence(text);
  return SIGNAL_ORDER.filter((k) => found.has(k));
}

export function extractSignals(reviews: RawReview[]): ReviewSignal[] {
  const signals: ReviewSignal[] = [];
  for (const r of reviews) {
    const text = r.review_text?.trim();
    if (!text) continue;
    for (const [kind, sentence] of classifyWithEvidence(text)) {
      signals.push({ kind, quote: excerpt(sentence), rating: ratingOf(r), timestamp: r.timestamp ?? null });
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
