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

export async function findGenericContact(monid: MonidRunner, company: string): Promise<string | null> {
  if (company.trim().length < 3) return null;
  const raw = await monid.run({
    provider: "hunterio",
    endpoint: "/domain-search",
    body: { company, type: "generic", limit: 5 },
    waitSeconds: 60,
  });
  return pickGenericEmail(raw);
}
