import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MonidRunner } from "../research/monid.js";
import { isRoleAddress } from "../research/contacts.js";

/**
 * Finds game-development agencies and their public role-based addresses.
 *
 * Sources, checked with `monid inspect` on Nov 7, 2026:
 *   clutch /search_companies    query { category, page }, $0.01/call. Category "developers/gaming" is
 *                               Clutch's game development directory (name + profile slug per company).
 *   clutch /get_company_profile query { slug }, $0.02/call: website, service lines, location.
 *   hunterio /domain-search     { domain, type: "generic" }, $0.0245 per 10 addresses, nothing on no results.
 * The agency's own homepage (and /contact) is fetched directly, for free: its title and description
 * say what they do, and its mailto links are the cheapest source of a public address.
 */
export const CLUTCH_CATEGORY = "developers/gaming";

export interface ClutchCompany { name: string; slug: string }
export interface ClutchProfile { name: string; website: string | null; services: string[]; location: string | null }
export interface SiteInfo { title: string | null; description: string | null; emails: string[]; text: string }

export function parseClutchSearch(raw: unknown): ClutchCompany[] {
  const list = ((raw as { data?: { companies?: unknown[] } })?.data?.companies ?? []) as Array<Record<string, unknown>>;
  const seen = new Set<string>();
  const out: ClutchCompany[] = [];
  for (const c of list) {
    const slug = typeof c.slug === "string" ? c.slug : null;
    const name = typeof c.name === "string" ? c.name.trim() : null;
    if (!slug || !name || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ name, slug });
  }
  return out;
}

export function parseClutchProfile(raw: unknown): ClutchProfile | null {
  const d = (raw as { data?: Record<string, unknown> })?.data;
  if (!d || typeof d.name !== "string") return null;
  const lines = (Array.isArray(d.service_lines) ? d.service_lines : []) as Array<Record<string, unknown>>;
  const details = (d.details ?? {}) as Record<string, unknown>;
  return {
    name: d.name,
    website: typeof d.website_url === "string" ? cleanUrl(d.website_url) : null,
    services: lines.map((l) => String(l.service ?? "")).filter(Boolean),
    location: typeof details.locations === "string" ? details.locations : null,
  };
}

/** Drops tracking parameters (Clutch adds utm_*), keeping the site's own address. */
export function cleanUrl(u: string): string | null {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) if (/^utm_|^ref$/i.test(k)) url.searchParams.delete(k);
    url.hash = "";
    return url.toString().replace(/\?$/, "");
  } catch {
    return null;
  }
}

export function siteDomain(u: string | null): string | null {
  if (!u) return null;
  try {
    const host = new URL(u).hostname.toLowerCase().replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

/** Names that say "games" rank first: the directory also lists general software shops. */
const GAMEY_NAME = /\b(game|games|gaming|gamedev|play|pixel|arcade|interactive|studios?)\b/i;
export function rankCandidates(list: ClutchCompany[]): ClutchCompany[] {
  return [...list].sort((a, b) => Number(GAMEY_NAME.test(b.name)) - Number(GAMEY_NAME.test(a.name)));
}

/** True when the listing or the site plainly says they make games. */
export function looksLikeGameStudio(profile: ClutchProfile, site: SiteInfo | null): boolean {
  const text = [profile.name, ...profile.services, site?.title ?? "", site?.description ?? "", site?.text.slice(0, 4000) ?? ""].join(" ");
  return /\b(game|games|gaming|gamedev|game development|game art)\b/i.test(text);
}

const decode = (s: string): string =>
  s.replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));

export function parseSite(html: string): SiteInfo {
  const meta = (name: string): string | null => {
    const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, "i");
    const tag = html.match(re)?.[0];
    const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
    return content ? decode(content).replace(/\s+/g, " ").trim() || null : null;
  };
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const emails = new Set<string>();
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) emails.add(decodeURIComponent(m[1]!).toLowerCase());
  for (const m of html.matchAll(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi)) emails.add(m[0].toLowerCase());
  const text = decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return {
    title: title ? decode(title).replace(/\s+/g, " ").trim() || null : null,
    description: meta("description") ?? meta("og:description"),
    emails: [...emails].filter((e) => !/\.(png|jpe?g|gif|svg|webp)$/.test(e)),
    text: text.slice(0, 20_000),
  };
}

export async function fetchSite(url: string, fetchImpl: typeof fetch = fetch): Promise<SiteInfo | null> {
  const get = async (u: string): Promise<string | null> => {
    try {
      const r = await fetchImpl(u, { redirect: "follow", signal: AbortSignal.timeout(8000), headers: { "user-agent": "Mozilla/5.0 (compatible; LevelAI/1.0; +https://levelai.vercel.app)" } });
      if (!r.ok || !(r.headers.get("content-type") ?? "").includes("html")) return null;
      return (await r.text()).slice(0, 600_000);
    } catch {
      return null;
    }
  };
  const home = await get(url);
  if (home === null) return null;
  const info = parseSite(home);
  if (!info.emails.length) {
    const contact = await get(new URL("/contact", url).toString());
    if (contact) info.emails = parseSite(contact).emails;
  }
  return info;
}

/**
 * Local parts we email at an agency: the company's front door, never a person. Stricter than the
 * studio list (no support@, press@, or careers addresses).
 */
const AGENCY_ROLES = ["business", "partnerships", "partners", "partner", "bd", "newbusiness", "sales", "hello", "contact", "info", "hi", "studio", "team", "office", "enquiries", "inquiries"];

export function isAgencyRoleAddress(email: string): boolean {
  const [local, domain] = email.toLowerCase().split("@");
  if (!local || !domain || !isRoleAddress(email)) return false;
  const base = local.split(/[._+-]/)[0]!;
  return AGENCY_ROLES.includes(local) || AGENCY_ROLES.includes(base);
}

/** The best role address on the agency's own domain, or null. */
export function pickAgencyAddress(emails: string[], domain: string): string | null {
  const ok = emails
    .map((e) => e.trim().toLowerCase())
    .filter((e) => {
      const d = e.split("@")[1] ?? "";
      return (d === domain || d.endsWith(`.${domain}`) || domain.endsWith(`.${d}`)) && isAgencyRoleAddress(e);
    });
  const rank = (e: string): number => {
    const local = e.split("@")[0]!;
    const i = AGENCY_ROLES.findIndex((r) => local === r || local.startsWith(r));
    return i === -1 ? AGENCY_ROLES.length : i;
  };
  return [...new Set(ok)].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

export async function hunterGeneric(monid: MonidRunner, domain: string): Promise<string[]> {
  const raw = await monid.run({ provider: "hunterio", endpoint: "/domain-search", body: { domain, type: "generic", limit: 10 }, waitSeconds: 60 });
  const data = (raw as { data?: unknown })?.data ?? raw;
  const list = ((data as { emails?: unknown[] })?.emails ?? []) as Array<Record<string, unknown>>;
  return list.filter((e) => (e.type === undefined || e.type === "generic") && typeof e.value === "string").map((e) => String(e.value).toLowerCase());
}

// Clutch search pages, cached for a day in a temp file so a restart doesn't pay for them again.
const CACHE_FILE = join(tmpdir(), "levelai-agency-clutch.json");
type PageCache = Record<string, { at: number; companies: ClutchCompany[] }>;
function readCache(): PageCache {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf8")) as PageCache;
  } catch {
    return {};
  }
}

export async function clutchPage(monid: MonidRunner, page: number, opts: { cache?: boolean } = {}): Promise<ClutchCompany[]> {
  const useCache = opts.cache ?? true;
  const cache = useCache ? readCache() : {};
  const hit = cache[String(page)];
  if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.companies;
  const raw = await monid.run({ provider: "clutch", endpoint: "/search_companies", query: { category: CLUTCH_CATEGORY, page }, waitSeconds: 60 });
  const companies = parseClutchSearch(raw);
  if (useCache) {
    cache[String(page)] = { at: Date.now(), companies };
    try {
      writeFileSync(CACHE_FILE, JSON.stringify(cache));
    } catch {
      // Best effort.
    }
  }
  return companies;
}

export async function clutchProfile(monid: MonidRunner, slug: string): Promise<ClutchProfile | null> {
  return parseClutchProfile(await monid.run({ provider: "clutch", endpoint: "/get_company_profile", query: { slug }, waitSeconds: 90 }));
}
