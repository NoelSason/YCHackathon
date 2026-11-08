import { titleMatches, type StoreGame } from "./monid.js";

/**
 * Finds a game on Google Play by name from the store's own public search page. It answers in about
 * 0.4 s, where the Monid search took 5 s alone and over 12 s at times on Nov 7, so the live signup
 * races the two and takes the first match (leads/live.ts). Same strict title rule as the Monid search.
 */
const decode = (s: string): string =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));

/** Each result's app id and title, in the page's order. */
export function parsePlaySearchPage(html: string): Array<{ appId: string; title: string }> {
  const out: Array<{ appId: string; title: string }> = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/href="\/store\/apps\/details\?id=([A-Za-z0-9_.]+)"[^>]*?aria-label="([^"]{1,200})"/g)) {
    const appId = m[1]!;
    if (seen.has(appId)) continue;
    seen.add(appId);
    out.push({ appId, title: decode(m[2]!).trim() });
  }
  return out;
}

export async function searchPlayPage(query: string, timeoutMs = 6_000, fetchImpl: typeof fetch = fetch): Promise<StoreGame | null> {
  const url = `https://play.google.com/store/search?q=${encodeURIComponent(query.slice(0, 200))}&c=apps&hl=en&gl=US`;
  const res = await fetchImpl(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36", "Accept-Language": "en-US" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`store search page answered HTTP ${res.status}`);
  const hit = parsePlaySearchPage(await res.text()).find((r) => titleMatches(query, r.title));
  return hit ? { appId: hit.appId, title: hit.title, developer: "Unknown developer", rating: null, downloads: null } : null;
}
