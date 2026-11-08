import { catalogLevelId } from "../../games/shared/catalog.js";
// Catalog addressing only. Match-3 rules remain in the shared game engine.
const KEY = "levelai:match3:verified";
export async function productionId(position:number):Promise<string>{return catalogLevelId("match3",position);}
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
