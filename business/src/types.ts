/** Shared business-ops types. These are the "business events" contract in docs/master-plan.md. */

export type SignalKind = "too_easy" | "too_hard" | "wants_more_levels" | "repetitive";

export interface ReviewSignal {
  kind: SignalKind;
  /** Short excerpt of the public review text, never the reviewer's name. */
  quote: string;
  rating: number | null;
  timestamp: string | null;
}

/** A game company worth pitching, with evidence a person could check. */
export interface Target {
  appId: string;
  appTitle: string;
  developer: string;
  storeUrl: string;
  downloads: string | null;
  reviewsAnalyzed: number;
  signalCounts: Record<SignalKind, number>;
  /** The strongest signal, used to choose the pitch angle. */
  primarySignal: SignalKind | null;
  examples: ReviewSignal[];
  /** One sentence a person can verify, e.g. "7 of the 86 newest reviews say the early levels are too easy." */
  reason: string;
  score: number;
}

/** Our stages. They map onto Naïve CRM stages (lead, talking, proposal, won, lost). */
export type PipelineStage =
  | "found"
  | "sample_made"
  | "emailed"
  | "replied"
  | "pilot_offered"
  | "pilot_paid"
  | "delivered"
  | "lost"
  | "opted_out";

export interface Lead {
  id: string;
  company: string;
  appId: string | null;
  contactName: string | null;
  email: string | null;
  source: "research" | "inbound_form" | "manual";
  stage: PipelineStage;
  reason: string | null;
  sampleUrl: string | null;
  crmContactId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OutreachRecord {
  id: string;
  leadId: string;
  to: string;
  subject: string;
  body: string;
  status: "drafted" | "sent" | "blocked";
  blockedReason: string | null;
  providerMessageId: string | null;
  createdAt: string;
}

export interface PaymentRecord {
  id: string;
  leadId: string | null;
  provider: "stripe";
  providerEventId: string;
  amountMinor: number;
  currency: string;
  livemode: boolean;
  product: "pilot_pack" | "hint_pack" | "playtest" | "other";
  createdAt: string;
}

export interface DeliveryRecord {
  id: string;
  paymentId: string;
  leadId: string | null;
  status: "pending" | "delivered" | "failed";
  detail: string | null;
  createdAt: string;
}

/** One line of the shared activity log. Abhinav owns the shared table; this is our write shape. */
export interface ActivityEntry {
  at: string;
  agent: string;
  action: string;
  why: string | null;
  result: string | null;
  costUsd: number | null;
  human: boolean;
}

/** What the customer's live watch page shows about one playtest order. */
export type WatchState = "queued" | "testing" | "finished" | "failed";

/** The finished playtest's findings, shown on the watch page (the same facts as the report email). */
export interface WatchSummary {
  loaded: boolean;
  touchOk: boolean;
  visualIssues: string[];
  stuckReason: string | null;
  notes: string | null;
}

/**
 * One playtest order, with the unguessable token that its live watch link carries
 * (`/watch?o=<token>`). The token is the only key the public watch endpoints accept.
 */
export interface WatchOrder {
  id: string;
  token: string;
  leadId: string;
  appUrl: string;
  gameName: string;
  state: WatchState;
  /** True when a test payment (no money moved) started it. */
  test: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  summary: WatchSummary | null;
  /** The payment that started it, once paid; unpaid orders have none. Used to resume after a restart. */
  paymentId?: string | null;
  /** What the customer asked us to focus on. */
  focus?: string | null;
}
