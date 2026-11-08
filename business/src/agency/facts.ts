import type { Config } from "../config.js";
import { activeStripeKey } from "../config.js";
import { isLiveKey } from "../billing/stripe.js";
import { numbersIn } from "../outreach/compose.js";
import { GENRES, packGameOpen } from "../levels/deliver-pack.js";
import { PACK_GAME_IDS, type PackGameId } from "../levels/pack-types.js";

/**
 * The facts sheet: everything the sales agent may say, and nothing else. Every number in a reply
 * must appear here (or in a link we generated), and the guard checks it. Edit this, not the prompt,
 * when an offer changes.
 */
export const SAMPLE_LEVELS = 5;
export const MAX_EXCHANGES = 6;

export interface Facts {
  /** The sheet as plain text, for the model. */
  text: string;
  /** Numbers a reply may contain. */
  allowedNumbers: string[];
  links: { site: string; pricing: string; playtest: string; play: string; games: string; developers: string; inbox: string };
  openGenres: PackGameId[];
  checkoutLive: boolean;
}

const usd = (n: number): string => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

export function buildFacts(config: Config, opts: { stripe: boolean }): Facts {
  const site = config.SITE_URL.replace(/\/+$/, "");
  const inbox = config.AGENTMAIL_INBOX_ID ?? "levelai@agentmail.to";
  const links = {
    site, pricing: `${site}/pricing`, playtest: `${site}/playtest`, play: `${site}/play`, games: `${site}/games`, developers: `${site}/developers`, inbox,
  };
  const openGenres = PACK_GAME_IDS.filter(packGameOpen);
  const genreList = openGenres.map((g) => `${GENRES[g].label} (our game ${GENRES[g].game})`).join(", ");
  const checkoutLive = opts.stripe && isLiveKey(activeStripeKey(config));
  const playtestPrice = config.PLAYTEST_PRICE_USD && opts.stripe ? usd(config.PLAYTEST_PRICE_USD) : null;
  const text = [
    "COMPANY",
    `- ${config.COMPANY_NAME} is a small puzzle-level studio run by AI agents, with a small human team behind them. Email: ${inbox}. Postal address: ${config.COMPANY_POSTAL_ADDRESS ?? "not set"}.`,
    "- The agents design puzzle levels, play each one many times with bot players until it lands on a target win rate, and playtest builds on a real iPhone in the cloud.",
    "",
    "OFFERS",
    `- Free sample: ${SAMPLE_LEVELS} levels in one of our genres, at the difficulty they pick (easy, medium, or hard). Each level is played by our bots until it lands on its target win rate. It arrives by email with a play link and a JSON link, usually within an hour of starting. One free sample per company.`,
    "- Free trial iPhone playtest: one per company we've emailed. Our agent plays their build on a real cloud iPhone and emails a short report (does it load, does touch work, visual issues, where it got stuck). It needs an App Store link or a web link that opens in Safari. Usually about 10 minutes once it starts; the phone runs one order at a time.",
    `- iPhone playtest: ${playtestPrice ?? "priced on the playtest page"} each, ordered at ${links.playtest}.`,
    `- Level pack: ${usd(config.PILOT_PRICE_USD)} one-time for ${config.PILOT_LEVELS} levels for one game, in one of our genres, delivered as playable previews plus JSON. Usually within the hour, and always within 48 hours.`,
    `- Level subscription: ${usd(config.SUBSCRIPTION_PRICE_USD)} a month for ${config.SUBSCRIPTION_LEVELS} new levels a month (half now, half two weeks later), ${config.SUBSCRIPTION_PLAYTESTS} iPhone playtests a month, and a developer API key. Cancel anytime by replying.`,
    `- Checkout is ${checkoutLive ? "live (real payments by card through Stripe)" : opts.stripe ? "in test mode (no real money)" : "closed right now; a person sets up orders by email"}.`,
    "",
    "WHAT'S REAL TODAY",
    `- Genres we build in: ${genreList}. Levels are made in our own engine for that genre.`,
    `- Level JSON format, a REST API, and an MCP connector for coding agents are documented at ${links.developers}.`,
    `- Levels anyone can play now: ${links.games} and ${links.play}. Pricing: ${links.pricing}. Playtest orders: ${links.playtest}.`,
    "- After a paid playtest starts, the buyer gets a private link to watch the iPhone live.",
    "",
    "WHAT ISN'T (never promise these)",
    "- We don't put levels inside a customer's game or engine. They get previews and JSON to adapt.",
    "- No genres beyond the ones listed. No Android or Google Play playtests (our phone is an iPhone).",
    "- No human QA testers, no art, no full game development, no ports.",
    "- No custom prices, discounts, contracts, NDAs, invoices, or refunds by email from the agent: a person handles those.",
    "- No promises about retention, revenue, ratings, or downloads. No customer names, case studies, or other customers' details.",
    "- No meetings or calls booked by the agent; offer to have a person follow up instead.",
  ].join("\n");
  const allowedNumbers = [String(SAMPLE_LEVELS), ...numbersIn(text)];
  return { text, allowedNumbers: [...new Set(allowedNumbers)], links, openGenres, checkoutLive };
}
