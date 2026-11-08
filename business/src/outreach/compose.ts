import type { Lead, SignalKind, Target } from "../types.js";
import { storeName } from "../research/monid.js";

/**
 * Writes the first outreach email to a studio. The copy is for the person reading it: what we
 * noticed, what we made for them, and what it costs. No internal mechanics.
 *
 * Every number in the body comes from `facts`, so the guard can check that the email states
 * nothing a tool didn't measure.
 */
export interface OutreachDraft {
  subject: string;
  body: string;
  /** Numbers the body is allowed to contain, and where each came from. */
  facts: Array<{ value: string; source: string }>;
  /** Optional HTML version; the plain-text body always goes too. */
  html?: string;
}

export interface ComposeInput {
  lead: Pick<Lead, "contactName" | "company">;
  target: Pick<Target, "appId" | "appTitle" | "reviewsAnalyzed" | "signalCounts" | "primarySignal" | "examples">;
  /** A playable sample made for them. Without one, the email offers to make one. */
  sampleUrl: string | null;
  pilot: { levels: number; priceLabel: string; paymentUrl: string | null };
  sender: { name: string; company: string; postalAddress: string };
}

const OPENERS: Record<SignalKind, (n: number, total: number, game: string, store: string) => string> = {
  too_easy: (n, total, game, store) =>
    `I read the ${total} newest ${store} reviews of ${game}, and ${n} of them ${n === 1 ? "says" : "say"} the levels are too easy or take too long to get challenging.`,
  too_hard: (n, total, game, store) =>
    `I read the ${total} newest ${store} reviews of ${game}, and ${n} of them ${n === 1 ? "says" : "say"} a level is too hard to get past.`,
  wants_more_levels: (n, total, game, store) =>
    `I read the ${total} newest ${store} reviews of ${game}, and ${n} of them ${n === 1 ? "asks" : "ask"} for more levels.`,
  repetitive: (n, total, game, store) =>
    `I read the ${total} newest ${store} reviews of ${game}, and ${n} of them ${n === 1 ? "says" : "say"} the levels start to feel the same.`,
};

const SUBJECTS: Record<SignalKind, (game: string) => string> = {
  too_easy: (game) => `A harder early curve for ${game}`,
  too_hard: (game) => `Smoothing a tough spot in ${game}`,
  wants_more_levels: (game) => `New levels for ${game}`,
  repetitive: (game) => `Fresh levels for ${game}`,
};

export function composeOutreach(input: ComposeInput): OutreachDraft {
  const { target, lead, sampleUrl, pilot, sender } = input;
  const kind = target.primarySignal;
  if (!kind) throw new Error(`No signal to pitch on for ${target.appTitle}.`);
  const n = target.signalCounts[kind];
  const total = target.reviewsAnalyzed;
  const quote = target.examples[0]?.quote;
  const greeting = lead.contactName ? `Hi ${lead.contactName.split(" ")[0]},` : `Hi ${lead.company} team,`;

  const lines = [
    greeting,
    "",
    OPENERS[kind](n, total, target.appTitle, storeName(target.appId)),
    ...(quote ? ["", `One player put it this way: "${quote}"`] : []),
    "",
    ...(sampleUrl
      ? [
          `We make and tune puzzle levels. Before a level ships, our test players play it hundreds of times, so its difficulty is measured, not guessed. I made a short sample set in the style of ${target.appTitle} for you to try:`,
          sampleUrl,
        ]
      : [
          "We make and tune puzzle levels. Before a level ships, our test players play it hundreds of times, so its difficulty is measured, not guessed.",
          "",
          `If it would help, reply and we'll make you a free sample set in the style of ${target.appTitle}, tuned to the difficulty you want. We also do pilot packs of ${pilot.levels} levels, tuned to the curve you choose.`,
        ]),
    ...(sampleUrl
      ? [
          "",
          pilot.paymentUrl
            ? `If it's useful, a pilot pack of ${pilot.levels} levels, tuned to the difficulty curve you choose, is ${pilot.priceLabel}. You can start it here: ${pilot.paymentUrl}`
            : `If it's useful, we also do pilot packs of ${pilot.levels} levels, tuned to the difficulty curve you choose. Just reply and I'll send the details.`,
        ]
      : []),
    "",
    sender.name,
    sender.company,
    "",
    "—",
    `${sender.company} is a small studio where AI agents design and test levels, and this email was written by one of them.`,
    sender.postalAddress,
    `Reply "stop" and we won't email you again.`,
  ];

  return {
    subject: SUBJECTS[kind](target.appTitle),
    body: lines.join("\n"),
    facts: [
      // Numbers inside the player's own words come from the review itself.
      ...numbersIn(quote ?? "").map((value) => ({ value, source: "the quoted review" })),
      { value: String(total), source: "reviews analyzed (Monid: dataforseo /google-play/app-reviews)" },
      { value: String(n), source: `reviews matching ${kind}` },
      { value: String(pilot.levels), source: "pilot pack size (team setting)" },
    ],
  };
}

/** Every number written in `text` (digits, with optional , or .), e.g. "1,000" or "4.5". */
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,.]*\d|\d/g) ?? []).map((n) => n.replace(/,/g, ""));
}
