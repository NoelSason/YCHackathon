import { z } from "zod";
import type { Store } from "../store.js";
import type { Lead } from "../types.js";

/**
 * The inbound form behind the QR code at our table ("Get 10 free levels for your game").
 * A signup becomes a lead, and the agents take it from there.
 */
export const LeadFormSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().max(200),
  company: z.string().trim().min(1).max(160),
  game: z.string().trim().max(200).optional(),
  storeUrl: z.url().max(500).optional(),
  // Consent to be emailed about their request. Required, so outreach to them is expected.
  consent: z.literal(true),
});

export type LeadForm = z.infer<typeof LeadFormSchema>;

/** Pulls an app id out of a Google Play URL, if there is one. */
export function appIdFromStoreUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).searchParams.get("id");
  } catch {
    return null;
  }
}

export async function intakeLead(input: unknown, store: Store): Promise<{ ok: true; lead: Lead } | { ok: false; error: string }> {
  const parsed = LeadFormSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please fill in your name, email, and company, and tick the box." };
  const f = parsed.data;
  const lead = await store.upsertLead({
    company: f.company,
    appId: appIdFromStoreUrl(f.storeUrl),
    contactName: f.name,
    email: f.email,
    source: "inbound_form",
    stage: "found",
    reason: f.game ? `Signed up at our table for free levels for ${f.game}.` : "Signed up at our table for free levels.",
    sampleUrl: null,
    crmContactId: null,
  });
  await store.logActivity({
    at: new Date().toISOString(),
    agent: "intake",
    action: `new inbound lead: ${f.company}`,
    why: "signed up through the table QR code",
    result: `lead ${lead.id}`,
    costUsd: null,
    human: false,
  });
  return { ok: true, lead };
}
