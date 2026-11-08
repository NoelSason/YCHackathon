import type { StageEvent } from "./events.ts";

/**
 * "Moments": log rows worth celebrating on the stage for a few seconds. Each one is matched from a
 * real row's action text, exactly as the business server writes it (business/src/outreach/send.ts,
 * leads/intake.ts, leads/playtest-offer.ts, billing/stripe.ts, outreach/inbound.ts, mcp/tools.ts,
 * outreach/autopilot.ts, leads/live.ts). Nothing here makes up an event: no row, no moment.
 */
export type MomentKind =
  | "email_sent"
  | "reply"
  | "reply_read"
  | "signup"
  | "playtest_ordered"
  | "playtest_started"
  | "playtest_done"
  | "report_sent"
  | "payment"
  | "audit"
  | "contact"
  | "decision";

export interface Moment {
  kind: MomentKind;
  /** "big" gets a banner and a tile burst; "small" gets a short toast. */
  tier: "big" | "small";
  /** Short kicker on the banner, e.g. "Email sent". */
  label: string;
  title: string;
  detail: string | null;
  /** The studio, team, game, or product the row is about. */
  subject: string | null;
  /** The app being playtested (playtest moments only). */
  app: string | null;
  /** Payments only: true when the row says it was a test-mode payment. */
  test: boolean | null;
  /** Playtests only: true for a market study of someone else's web game (no customer). */
  market?: boolean;
}

/** Results that are plumbing (message ids, lead ids), not something to show the room. */
export function cleanResult(result: string | null): string | null {
  if (!result) return null;
  if (/^message\s*<[^>]*>?/i.test(result) || /^message\s+\S+$/i.test(result)) return null;
  if (/^lead\s+[0-9a-f-]{8,}$/i.test(result)) return null;
  return result;
}

const m = (kind: MomentKind, tier: Moment["tier"], label: string, title: string, rest: Partial<Moment> = {}): Moment => ({
  kind, tier, label, title, detail: null, subject: null, app: null, test: null, ...rest,
});

export function momentFor(e: StageEvent): Moment | null {
  if (e.human) return null;
  if (e.kind === "decision") {
    return m("decision", "big", "Decision", e.action, { detail: e.why ?? e.saw, subject: e.agent });
  }
  const a = e.action.trim();
  let x: RegExpMatchArray | null;

  if ((x = a.match(/^outreach sent to (.+)$/i))) {
    return m("email_sent", "big", "Email sent", `Email sent to ${x[1]}`, { subject: x[1]!, detail: e.why });
  }
  if (/^reply from an unknown sender$/i.test(a)) {
    return m("reply", "small", "Reply", "A reply arrived from an unknown sender", { detail: cleanResult(e.result) });
  }
  if ((x = a.match(/^reply from (.+)$/i))) {
    return m("reply", "big", "Reply", `${x[1]} replied`, { subject: x[1]! });
  }
  if ((x = a.match(/^read reply from (.+)$/i))) {
    return m("reply_read", "small", "Reply", `Read the reply from ${x[1]}`, { subject: x[1]!, detail: e.why });
  }
  if ((x = a.match(/^new inbound lead: (.+)$/i))) {
    return m("signup", "big", "New signup", `Someone just signed up: ${x[1]}`, { subject: x[1]!, detail: e.why });
  }
  if ((x = a.match(/^playtest ordered by (.+)$/i))) {
    return m("playtest_ordered", "small", "Playtest", `New playtest order from ${x[1]}`, { subject: x[1]!, app: e.why });
  }
  // Market studies from the phone loop: "playtesting 2048 (web game, market study) on the iPhone".
  if ((x = a.match(/^playtesting (.+?) \(web game[^)]*\)(?: on the iPhone)?$/i))) {
    return m("playtest_started", "big", "Market study", `Now playtesting ${x[1]}, a web puzzle game`, { subject: "", app: x[1]!, market: true });
  }
  if ((x = a.match(/^playtested (.+?) \(web game[^)]*\)(?::.*)?$/i))) {
    return m("playtest_done", "small", "Market study", `Finished studying ${x[1]}`, { subject: "", app: x[1]!, market: true, detail: cleanResult(e.result) || a.replace(/^[^:]*:\s*/, "") });
  }
  if ((x = a.match(/^playtesting (.+?)(?:'s app)?(?: on the iPhone)?$/i))) {
    return m("playtest_started", "big", "Playtest", `Now testing ${x[1]}'s app`, { subject: x[1]!, app: e.why });
  }
  if ((x = a.match(/^playtested (.+?)(?:'s app)?$/i))) {
    return m("playtest_done", "small", "Playtest", `Playtest finished for ${x[1]}`, { subject: x[1]!, app: e.why, detail: cleanResult(e.result) });
  }
  if ((x = a.match(/^emailed the playtest report to (.+)$/i))) {
    return m("report_sent", "big", "Playtest report", `Playtest report sent to ${x[1]}`, { subject: x[1]! });
  }
  if ((x = a.match(/^payment received: (.+)$/i))) {
    const test = /test mode/i.test(e.result ?? "");
    const amount = (e.result ?? "").replace(/\s*\(test mode\)\s*/i, "").trim();
    return m("payment", "big", test ? "Test payment" : "Payment", test ? `Test payment received: ${x[1]}` : `Payment received: ${x[1]}`, {
      subject: x[1]!,
      test,
      detail: amount ? (test ? `${amount}, test mode (no real money)` : amount) : test ? "Test mode (no real money)" : null,
    });
  }
  if ((x = a.match(/^audited (.+)$/i))) {
    return m("audit", "small", "Research", `Read the reviews of ${x[1]}`, { subject: x[1]!, detail: e.why });
  }
  if ((x = a.match(/^found a public contact for (.+)$/i))) {
    return m("contact", "small", "Research", `Found a contact at ${x[1]}`, { subject: x[1]!, detail: e.why });
  }
  return null;
}
