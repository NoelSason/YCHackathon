import type { MonidRunner } from "./monid.js";

/**
 * Finds a studio's public, role-based contact address (contact@, info@, support@, business@) through
 * Monid's Hunter.io domain search with type "generic", so we never email a person's own address.
 * Checked Nov 7: hunterio /domain-search takes { company | domain, type, limit }, about $0.025 per
 * block of 10 results, and nothing when there are no results.
 */
const PREFERRED = ["business", "partnerships", "partners", "bd", "publishing", "contact", "hello", "info", "support"];

export function pickGenericEmail(raw: unknown): string | null {
  const data = (raw as { data?: unknown })?.data ?? raw;
  const list = ((data as { emails?: unknown[] })?.emails ?? []) as Array<Record<string, unknown>>;
  const emails = list
    .filter((e) => (e.type === undefined || e.type === "generic") && typeof e.value === "string")
    .map((e) => String(e.value).toLowerCase());
  if (!emails.length) return null;
  const rank = (e: string): number => {
    const local = e.split("@")[0] ?? "";
    const i = PREFERRED.findIndex((p) => local === p || local.startsWith(p));
    return i === -1 ? PREFERRED.length : i;
  };
  return emails.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** Role-based local parts we're willing to email. A person's own address (jane@, hulusi@) never qualifies. */
const ROLE = /^(business|partnerships?|partners|bd|publishing|contact|hello|hi|info|support|help|studio|team|games?|marketing|press|biz|office|feedback|dev|developers?|admin|mail|enquiries|inquiries|sales|care|cs|service)([._+-].*)?$/;

export function isRoleAddress(email: string): boolean {
  const [local, domain] = email.toLowerCase().split("@");
  return Boolean(local && domain && ROLE.test(local));
}

export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
    // Store, social, and link-in-bio hosts don't identify the studio.
    if (/(^|\.)(google\.com|play\.google\.com|apple\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|linktr\.ee|github\.io|blogspot\.com|wixsite\.com|sites\.google\.com)$/.test(host)) return null;
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

/** The developer contact block on a Google Play listing (dataforseo /google-play/app-info, $0.0012). */
export async function fetchPlayDeveloper(monid: MonidRunner, appId: string): Promise<{ email: string | null; website: string | null }> {
  if (appId.startsWith("ios:")) return { email: null, website: null };
  const raw = await monid.run({
    provider: "dataforseo",
    endpoint: "/google-play/app-info",
    body: { app_id: appId, location_code: 2840, language_code: "en" },
    waitSeconds: 90,
  });
  const text = JSON.stringify(raw);
  const pick = (k: string): string | null => {
    const m = text.match(new RegExp(`"${k}":"([^"]+)"`));
    return m ? m[1]! : null;
  };
  return { email: pick("developer_email")?.toLowerCase() ?? null, website: pick("developer_website") };
}

/**
 * A studio's public, role-based contact, cheapest and most specific source first:
 * 1. the email on the game's Google Play listing, if it's role-based (support@, contact@, …);
 * 2. Hunter generic addresses for the listing's website domain;
 * 3. Hunter generic addresses by company name.
 */
export async function findGenericContact(monid: MonidRunner, company: string, appId?: string): Promise<string | null> {
  let website: string | null = null;
  if (appId) {
    const dev = await fetchPlayDeveloper(monid, appId).catch(() => ({ email: null, website: null }));
    if (dev.email && isRoleAddress(dev.email)) return dev.email;
    website = dev.website;
  }
  const domain = domainOf(website);
  if (domain) {
    const raw = await monid.run({ provider: "hunterio", endpoint: "/domain-search", body: { domain, type: "generic", limit: 5 }, waitSeconds: 60 }).catch(() => null);
    const hit = raw ? pickGenericEmail(raw) : null;
    if (hit) return hit;
  }
  if (company.trim().length < 3) return null;
  const raw = await monid.run({
    provider: "hunterio",
    endpoint: "/domain-search",
    body: { company, type: "generic", limit: 5 },
    waitSeconds: 60,
  });
  return pickGenericEmail(raw);
}
