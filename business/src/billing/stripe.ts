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

/** True for a live-mode key. Test keys (sk_test_, rk_test_) and anything else count as test. */
export function isLiveKey(secretKey: string | undefined): boolean {
  return Boolean(secretKey && (secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_")));
}

export interface PriceSpec {
  /** Stable per product and amount, so a price change makes a new price instead of reusing the old one. */
  lookupKey: string;
  productName: string;
  amountMinor: number;
  currency?: string;
  /** Set for a subscription price. */
  interval?: "month";
}

// Per client, so a test-mode price id is never reused in live mode (Stripe keeps the two apart, and
// lookup keys are per mode, so each mode finds or creates its own price once).
let priceCache = new WeakMap<Stripe, Map<string, string>>();
function cacheFor(stripe: Stripe): Map<string, string> {
  let c = priceCache.get(stripe);
  if (!c) priceCache.set(stripe, (c = new Map()));
  return c;
}

/** Finds the price with this lookup key, or creates it once. Checkout calls reuse it instead of making a price per order. */
export async function ensurePrice(stripe: Stripe, spec: PriceSpec): Promise<string> {
  if (!Number.isInteger(spec.amountMinor) || spec.amountMinor <= 0) throw new Error("amountMinor must be a positive integer.");
  const cache = cacheFor(stripe);
  const cached = cache.get(spec.lookupKey);
  if (cached) return cached;
  const found = (await stripe.prices.list({ lookup_keys: [spec.lookupKey], active: true, limit: 1 })).data[0];
  const matches = found && found.unit_amount === spec.amountMinor && (found.recurring?.interval ?? null) === (spec.interval ?? null);
  const id = matches
    ? found.id
    : (
        await stripe.prices.create({
          currency: spec.currency ?? "usd",
          unit_amount: spec.amountMinor,
          lookup_key: spec.lookupKey,
          transfer_lookup_key: true,
          ...(spec.interval ? { recurring: { interval: spec.interval } } : {}),
          product_data: { name: spec.productName },
        })
      ).id;
  cache.set(spec.lookupKey, id);
  return id;
}

/** For tests: forget prices found earlier in this process. */
export function clearPriceCache(): void {
  priceCache = new WeakMap();
}

export interface CheckoutInput {
  mode: "payment" | "subscription";
  priceId: string;
  /** Travels to the webhook on the session, and onto the payment or subscription itself. */
  metadata: Record<string, string>;
  customerEmail: string;
  leadId: string;
  successUrl: string;
  cancelUrl: string;
}

/** A hosted Checkout page for one order. */
export async function createCheckout(stripe: Stripe, input: CheckoutInput): Promise<{ url: string; id: string }> {
  const session = await stripe.checkout.sessions.create({
    mode: input.mode,
    line_items: [{ price: input.priceId, quantity: 1 }],
    customer_email: input.customerEmail,
    client_reference_id: input.leadId,
    metadata: input.metadata,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    ...(input.mode === "subscription" ? { subscription_data: { metadata: input.metadata } } : { payment_intent_data: { metadata: input.metadata } }),
  });
  if (!session.url) throw new Error("Checkout didn't return a page to pay on.");
  return { url: session.url, id: session.id };
}

export type WebhookOutcome =
  | { kind: "ignored"; type: string }
  | { kind: "duplicate"; eventId: string }
  | { kind: "paid"; payment: PaymentRecord; metadata: Record<string, string>; customerEmail: string | null; subscriptionId: string | null }
  | { kind: "renewal"; payment: PaymentRecord; subscriptionId: string }
  | { kind: "cancelled"; subscriptionId: string; leadId: string | null; livemode: boolean };

const idOf = (v: string | { id: string } | null | undefined): string | null => (typeof v === "string" ? v : v?.id ?? null);

/**
 * Verifies and handles one Stripe webhook:
 *   checkout.session.completed (paid)  records the payment once (Stripe retries), notes a new
 *                                      subscription, moves the lead to pilot_paid, and adds a pending delivery
 *   invoice.paid                       records a subscription renewal once (the first invoice is skipped)
 *   customer.subscription.deleted      marks the subscription cancelled, once
 */
export async function handleStripeWebhook(args: {
  stripe: Stripe;
  /** One or more signing secrets (test and live endpoints each have their own); the first that verifies wins. */
  webhookSecret: string | string[];
  rawBody: string | Buffer;
  signature: string | undefined;
  store: Store;
}): Promise<WebhookOutcome> {
  if (!args.signature) throw new Error("Missing stripe-signature header.");
  const secrets = (Array.isArray(args.webhookSecret) ? args.webhookSecret : [args.webhookSecret]).filter(Boolean);
  let event: ReturnType<typeof args.stripe.webhooks.constructEvent> | null = null;
  let lastErr: unknown = null;
  for (const secret of secrets) {
    try {
      event = args.stripe.webhooks.constructEvent(args.rawBody, args.signature, secret);
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!event) throw lastErr ?? new Error("no webhook secret configured");
  if (event.type === "invoice.paid") return handleInvoicePaid(event, args.store);
  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object;
    const leadId = sub.metadata?.lead_id || null;
    const cancelled = await args.store.cancelSubscription({ id: sub.id, leadId, livemode: event.livemode });
    if (!cancelled) return { kind: "duplicate", eventId: event.id };
    return { kind: "cancelled", subscriptionId: sub.id, leadId: cancelled.leadId ?? leadId, livemode: event.livemode };
  }
  if (event.type !== "checkout.session.completed") return { kind: "ignored", type: event.type };

  const session = event.data.object;
  if (session.payment_status !== "paid") return { kind: "ignored", type: `${event.type}:${session.payment_status}` };

  const leadId = session.metadata?.lead_id || null;
  const product = (session.metadata?.product as Product | undefined) ?? "other";
  const subscriptionId = idOf(session.subscription);
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

  if (subscriptionId) {
    await args.store.addSubscription({
      id: subscriptionId, leadId, livemode: event.livemode,
      gameUrl: session.metadata?.game_url || null, difficulty: session.metadata?.difficulty || null,
    });
  }
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
  return {
    kind: "paid", payment, metadata: { ...(session.metadata ?? {}) },
    customerEmail: session.customer_details?.email ?? session.customer_email ?? null, subscriptionId,
  };
}

/**
 * A subscription invoice was paid. The first one is already counted by its checkout session, so
 * only later invoices (renewals) are recorded, once per event, with a pending delivery for the month.
 */
async function handleInvoicePaid(event: Stripe.InvoicePaidEvent, store: Store): Promise<WebhookOutcome> {
  const invoice = event.data.object;
  const details = invoice.parent?.subscription_details ?? null;
  const subscriptionId = idOf(details?.subscription);
  if (!subscriptionId) return { kind: "ignored", type: `${event.type}:not_a_subscription` };
  if (invoice.billing_reason === "subscription_create") return { kind: "ignored", type: `${event.type}:first_invoice` };
  const known = await store.getSubscription(subscriptionId);
  const leadId = details?.metadata?.lead_id || known?.leadId || null;
  const payment = await store.recordPayment({
    leadId, provider: "stripe", providerEventId: event.id, amountMinor: invoice.amount_paid,
    currency: invoice.currency ?? "usd", livemode: event.livemode, product: "subscription",
  });
  if (!payment) return { kind: "duplicate", eventId: event.id };
  await store.addDelivery({ paymentId: payment.id, leadId, status: "pending", detail: "this month's subscription levels" });
  return { kind: "renewal", payment, subscriptionId };
}
