import { z } from "zod";
import type { Store } from "../store.js";
import type { Lead } from "../types.js";

/**
 * A store link as people type it. A link without "https://" gets one; anything that still isn't a
 * link is dropped instead of failing the whole signup, and the game name is used instead.
 */
export function lenientUrl(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t) return undefined;
  for (const candidate of [t, `https://${t.replace(/^\/+/, "")}`]) {
    try {
      const u = new URL(candidate);
      if ((u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".")) return u.toString().slice(0, 500);
    } catch { /* try the next form */ }
  }
  return undefined;
}

const looksLikeStoreLink = (v: string): boolean => /(play\.google\.com|apps\.apple\.com|itunes\.apple\.com)\//i.test(v);

/**
 * The inbound form behind the QR code at our table ("Get 10 free levels for your game").
 * A signup becomes a lead, and the agents take it from there.
 */
export const LeadFormSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().max(200),
  company: z.string().trim().min(1).max(160),
  game: z.string().trim().max(200).optional(),
  storeUrl: z.preprocess(lenientUrl, z.string().max(500).optional()),
  // Consent to be emailed about their request. Required, so outreach to them is expected.
  consent: z.literal(true),
});

export type LeadForm = z.infer<typeof LeadFormSchema>;

/**
 * Pulls an app id out of a store link. Google Play: the package name ("com.studio.game").
 * App Store: "ios:<numeric id>" from links like apps.apple.com/us/app/name/id1482155847.
 */
export function appIdFromStoreUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (/(^|\.)apple\.com$/.test(u.hostname)) {
      const m = u.pathname.match(/\/id(\d{5,})/);
      return m ? `ios:${m[1]}` : null;
    }
    if (!/(^|\.)google\.com$/.test(u.hostname)) return null;
    const id = u.searchParams.get("id")?.trim() ?? "";
    // A Java package name, like com.studio.game. Anything else can't be a Play listing.
    return /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * A signup becomes a lead. Returns this signup's own game and app id too: a repeat signup from the
 * same address reuses the lead, which keeps its earlier app id when this form had no link.
 */
export async function intakeLead(
  input: unknown,
  store: Store,
  opts: { teamTest?: boolean } = {},
): Promise<{ ok: true; lead: Lead; game: string | null; appId: string | null } | { ok: false; error: string }> {
  const raw = input && typeof input === "object" ? { ...(input as Record<string, unknown>) } : input;
  // A store link pasted into the game name box is still a store link.
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (typeof r.game === "string" && looksLikeStoreLink(r.game) && !lenientUrl(r.storeUrl)) {
      r.storeUrl = r.game;
      delete r.game;
    }
  }
  const parsed = LeadFormSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Please fill in your name, email, and company, and tick the box." };
  const f = parsed.data;
  const appId = appIdFromStoreUrl(f.storeUrl);
  const lead = await store.upsertLead({
    company: f.company,
    appId,
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
    why: opts.teamTest ? "a team member's test signup (not counted as a customer)" : "signed up through the table QR code",
    result: `lead ${lead.id}`,
    costUsd: null,
    human: false,
  });
  return { ok: true, lead, game: f.game?.trim() || null, appId };
}
