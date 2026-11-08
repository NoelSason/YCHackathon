// Catalog addressing only. Match-3 rules remain in the shared game engine.
const KEY = "levelai:match3:verified";
export async function productionId(position: number): Promise<string> {
  if (!Number.isInteger(position) || position < 1 || position > 1000) throw new Error("Garden position must be 1–1000");
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`production-v1:1:match3:${position}`));
  const h = [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
export async function seriesPosition(level: { level_id: string; level: { name: string } }): Promise<number> {
  const n = Number(/^Garden (\d{4})$/.exec(level.level.name)?.[1]);
  return Number.isInteger(n) && n >= 1 && n <= 1000 && await productionId(n) === level.level_id ? n : 0;
}
export function resumePosition(): number {
  try { const n = Number(localStorage.getItem(KEY)); return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 1; } catch { return 1; }
}
export function rememberWin(position: number): void {
  if (position < 1 || position > 1000) return;
  try { localStorage.setItem(KEY, String(Math.max(resumePosition(), Math.min(1000, position + 1)))); } catch { /* private browsing */ }
}
