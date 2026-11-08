import Stripe from "stripe";
import type { Store } from "../store.js";
import type { PaymentRecord } from "../types.js";

/**
 * Billing: payment links for pilot packs and hint packs, and the webhook that turns a payment into
 * a delivery. Kept small on purpose: the organizers said Stripe credits for agentic payments are
 * coming later, so this is the minimum that works end to end in test mode.
 *
 * Safety: refuses a live key unless BILLING_ALLOW_LIVE=1. Never refunds. Refunds go to a person.
 */
export type Product = PaymentRecord["product"];

export function assertKeyMode(secretKey: string, allowLive: boolean): void {
  const live = secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_");
  if (live && !allowLive) throw new Error("Live Stripe key refused. Set BILLING_ALLOW_LIVE=1 only after the team agrees.");
}

export function stripeClient(secretKey: string, allowLive: boolean): Stripe {
  assertKeyMode(secretKey, allowLive);
  return new Stripe(secretKey);
}

export interface PaymentLinkInput {
  product: Product;
  /** Extra details that travel to the webhook, such as the app to playtest. */
  extraMetadata?: Record<string, string>;
  name: string;
  amountMinor: number;
  currency?: string;
  leadId: string | null;
  /** Where the customer lands after paying. */
  successUrl: string;
}

/** Creates a one-off price and a payment link. The lead id travels in metadata to the webhook. */
export async function createPaymentLink(stripe: Stripe, input: PaymentLinkInput): Promise<{ url: string; id: string }> {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error("amountMinor must be a positive integer.");
  const metadata = { ...(input.extraMetadata ?? {}), product: input.product, lead_id: input.leadId ?? "" };
  const price = await stripe.prices.create({
    currency: input.currency ?? "usd",
    unit_amount: input.amountMinor,
    product_data: { name: input.name, metadata },
  });
  const link = await stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    metadata,
    after_completion: { type: "redirect", redirect: { url: input.successUrl } },
  });
  return { url: link.url, id: link.id };
}

export type WebhookOutcome =
  | { kind: "ignored"; type: string }
  | { kind: "duplicate"; eventId: string }
  | { kind: "paid"; payment: PaymentRecord; metadata: Record<string, string> };

/**
 * Verifies and handles one Stripe webhook. On `checkout.session.completed` with a paid session, it
 * records the payment once (Stripe retries), moves the lead to pilot_paid, and adds a pending
 * delivery for the `deliver` step.
 */
export async function handleStripeWebhook(args: {
  stripe: Stripe;
  webhookSecret: string;
  rawBody: string | Buffer;
  signature: string | undefined;
  store: Store;
}): Promise<WebhookOutcome> {
  if (!args.signature) throw new Error("Missing stripe-signature header.");
  const event = args.stripe.webhooks.constructEvent(args.rawBody, args.signature, args.webhookSecret);
  if (event.type !== "checkout.session.completed") return { kind: "ignored", type: event.type };

  const session = event.data.object;
  if (session.payment_status !== "paid") return { kind: "ignored", type: `${event.type}:${session.payment_status}` };

  const leadId = session.metadata?.lead_id || null;
  const product = (session.metadata?.product as Product | undefined) ?? "other";
  const payment = await args.store.recordPayment({
    leadId,
    provider: "stripe",
    providerEventId: event.id,
    amountMinor: session.amount_total ?? 0,
    currency: session.currency ?? "usd",
    livemode: event.livemode,
    product,
  });
  if (!payment) return { kind: "duplicate", eventId: event.id };

  if (leadId) await args.store.setStage(leadId, "pilot_paid");
  await args.store.addDelivery({ paymentId: payment.id, leadId, status: "pending", detail: null });
  await args.store.logActivity({
    at: new Date().toISOString(),
    agent: "billing",
    action: `payment received: ${product}`,
    why: leadId ? `lead ${leadId}` : "no lead attached",
    result: `${(payment.amountMinor / 100).toFixed(2)} ${payment.currency.toUpperCase()}${payment.livemode ? "" : " (test mode)"}`,
    costUsd: null,
    human: false,
  });
  return { kind: "paid", payment, metadata: { ...(session.metadata ?? {}) } };
}
